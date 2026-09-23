import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBrief, formatBrief, briefJson, latestHandoff, briefQuery, LINKED_READ_MAX,
} from '../../cli/lib/brief.js';

const NOW = new Date('2026-09-23T12:00:00Z');
const TASK_ID = '11111111-1111-4111-8111-111111111111';
const TASK = {
  id: TASK_ID,
  title: 'Rotate the tunnel token',
  description: 'Token expires on the 3rd.',
  notes: 'Origin: review.\n\nBranch feat/x, tests green.\n\n  \n\nNext: revoke the old token.',
  status: 'in-progress',
  priority: 'high',
  projectId: 'p',
  dueDate: '2026-10-01',
  plannedFor: '2026-09-24',
  labels: ['ops'],
};
const DOCS = {
  linked: { id: 'linked', title: 'Tunnel setup', documentType: 'runbook', projectId: 'p', verified: true, verifiedBy: 'mark', status: 'active', updatedAt: '2026-09-01T00:00:00Z', updatedBy: 'user', body: 'Setup.' },
  rel: { id: 'rel', title: 'Cloudflare notes', documentType: 'note', projectId: 'p', verified: false, status: 'active', updatedAt: '2026-09-20T00:00:00Z', updatedBy: 'agent', updatedByAgent: 'codex', body: 'Notes.' },
  m1: { id: 'm1', title: 'Token rotation how-to', documentType: 'note', projectId: 'p', verified: false, status: 'active', updatedAt: '2026-09-10T00:00:00Z', body: 'Rotate with the dashboard.' },
  m2: { id: 'm2', title: 'Tunnel token policy', documentType: 'decision', projectId: 'm', verified: true, verifiedBy: 'mark', status: 'active', updatedAt: '2026-05-01T00:00:00Z', body: 'Tokens rotate yearly.' },
  m3: { id: 'm3', title: 'Old token notes', documentType: 'note', projectId: 'p', verified: false, status: 'active', updatedAt: '2026-08-01T00:00:00Z', body: 'Old.' },
  m4: { id: 'm4', title: 'Fourth match', documentType: 'note', projectId: 'p', verified: false, status: 'active', updatedAt: '2026-08-02T00:00:00Z', body: 'Fourth.' },
};

function client({
  linked = [{ id: 'linked', title: 'Tunnel setup', documentType: 'runbook', projectId: 'p' }],
  related = { suggestions: [{ id: 'rel', title: 'Cloudflare notes', documentType: 'note', similarity: 0.71 }, { id: 'm1', title: 'Token rotation how-to', documentType: 'note', similarity: 0.7 }] },
  search = ['linked', 'm1', 'm2', 'm3', 'm4'],
  index = { total: 9, embedded: 9, pending: 0 },
  unreadable = [],
} = {}) {
  const calls = { search: [] };
  return {
    calls,
    getTask: async (id) => { assert.equal(id, TASK_ID); return TASK; },
    listChecklist: async () => [{ id: 'c1', label: 'New token issued', completed: true }, { id: 'c2', label: 'Old token revoked', completed: false }],
    listProjects: async () => [{ id: 'p', slug: 'homelab' }, { id: 'm', slug: 'memory' }],
    listTaskDocuments: async () => linked,
    relatedTaskDocuments: async () => related,
    semanticSearch: async (project, q, opts) => {
      calls.search.push({ project, q, limit: opts.limit });
      const items = search.slice(0, opts.limit).map((id) => {
        const { body, ...ref } = DOCS[id] || { id, title: id };
        return { ...ref, snippet: String(body || '').slice(0, 200) };
      });
      return {
        items, page: { returned: items.length, total: search.length, hasMore: search.length > items.length }, index,
        degraded: index.pending > 0, reason: index.pending > 0 ? 'index-incomplete' : null,
      };
    },
    keywordSearch: async () => [],
    getDocument: async (id) => {
      if (unreadable.includes(id)) throw new Error('HTTP 500');
      return DOCS[id] || { id, title: id, documentType: 'note', projectId: 'p', verified: false, status: 'active' };
    },
    listCodeRefs: async () => [],
  };
}

test('latestHandoff returns the last non-blank paragraph and the paragraph count', () => {
  assert.deepEqual(latestHandoff(TASK.notes), { paragraph: 'Next: revoke the old token.', paragraphs: 3 });
  assert.deepEqual(latestHandoff(''), { paragraph: null, paragraphs: 0 });
  assert.deepEqual(latestHandoff(null), { paragraph: null, paragraphs: 0 });
});

test('briefQuery searches the title and description, bounded', () => {
  assert.equal(briefQuery(TASK), 'Rotate the tunnel token Token expires on the 3rd.');
  assert.equal(briefQuery({ title: 'x'.repeat(900) }).length, 500);
});

test('a brief composes header, numbered checklist, handoff, trusted documents and memory', async () => {
  const c = client();
  const brief = await buildBrief(c, { taskId: TASK_ID });
  // Memory skips the linked document and keeps the top 3 of the rest.
  assert.deepEqual(c.calls.search, [{ project: undefined, q: briefQuery(TASK), limit: 4 }]);
  assert.deepEqual(brief.memory.items.map((i) => i.id), ['m2', 'm1', 'm3'], 'fill order: verified first, then newest');
  // Related suggestions already under Memory are not repeated.
  assert.deepEqual(brief.related.items.map((i) => i.id), ['rel']);
  assert.equal(brief.related.alsoUnderMemory, 1);

  const text = formatBrief(brief, NOW);
  assert.match(text, /^# Brief: Rotate the tunnel token\nin-progress · high · in homelab · planned 2026-09-24 · due 2026-10-01 · @ops · 11111111-/);
  assert.match(text, /## Checklist \(1 of 2 done\)\n {2}1\. \[x\] New token issued\n {2}2\. \[ \] Old token revoked/);
  assert.match(text, /## Latest handoff \(latest of 3 paragraphs — prax task show 11111111-1111-4111-8111-111111111111 for all\)\nNext: revoke the old token\./);
  assert.match(text, /## Linked documents\n- \[verified\] Tunnel setup \(runbook · linked · in homelab · verified by mark · 22d old · human-written\)/);
  assert.match(text, /## Related documents\n- \[unverified\] Cloudflare notes \(note · rel · in homelab · unverified · 3d old · via codex · similarity 0\.71\)\n\(1 more shown under Memory\)/);
  assert.match(text, /## Memory — top 3 for "Rotate the tunnel token Token expires on the 3rd\."\n\n?### \[verified\] Tunnel token policy {2}\(decision · m2 · in memory · verified by mark/);
  assert.doesNotMatch(text, /\(budget:/, 'no budget line without --budget');
});

test('--budget applies to the memory section only', async () => {
  const brief = await buildBrief(client(), { taskId: TASK_ID, budget: 60 });
  const text = formatBrief(brief, NOW);
  assert.match(text, /## Checklist/);
  assert.match(text, /Next: revoke the old token\./);
  const memory = text.slice(text.indexOf('## Memory'));
  assert.match(memory, /\(budget: ~\d+ of 60 tokens/);
  const json = briefJson(brief, NOW);
  assert.equal(json.schemaVersion, 1);
  assert.equal(json.memory.budget.tokens, 60);
  assert.ok(json.memory.budget.used <= 60 || json.memory.budget.omitted.total === 3);
  assert.deepEqual(json.memory.budget.entries.map((e) => e.id), ['m2', 'm1', 'm3']);
  for (const line of memory.split('\n')) {
    if (/^(###|- )/.test(line)) assert.match(line, /^(### |- )\[(verified|unverified)\] /, line);
  }
});

test('unknown trust is said, never guessed; degraded related and incomplete index are disclosed', async () => {
  const many = Array.from({ length: LINKED_READ_MAX + 2 }, (_, i) => ({ id: `l${i}`, title: `Linked ${i}`, documentType: 'note', projectId: 'p' }));
  const brief = await buildBrief(client({
    linked: many,
    related: { suggestions: [], degraded: true, reason: 'semantic-off' },
    index: { total: 10, embedded: 7, pending: 3 },
    unreadable: ['l0'],
    search: ['m1'],
  }), { taskId: TASK_ID });
  const text = formatBrief(brief, NOW);
  assert.match(text, /- \[trust unknown\] Linked 0 \(note · l0\)/);
  assert.match(text, /- \[trust unknown\] Linked 21 \(note · l21\)/);
  assert.match(text, /\(3 linked documents not read for trust — prax get <id>\)/);
  assert.match(text, /\(related documents unavailable: semantic-off\)/);
  assert.match(text, /\(index incomplete: 3 of 10 documents have no current embedding — results may be missing\)/);
});

test('an empty memory section is an honest miss only on a complete index', async () => {
  const miss = formatBrief(await buildBrief(client({ search: [], linked: [] }), { taskId: TASK_ID }), NOW);
  assert.match(miss, /No relevant memory found for: "Rotate the tunnel token Token expires on the 3rd\."$/m);
  const pending = formatBrief(await buildBrief(client({ search: [], linked: [], index: { total: 4, embedded: 2, pending: 2 } }), { taskId: TASK_ID }), NOW);
  assert.match(pending, /this may not be a true miss/);
});

test('a server without related-documents is reported, not an error', async () => {
  const c = client();
  c.relatedTaskDocuments = async () => { const e = new Error('HTTP 404'); e.status = 404; throw e; };
  const brief = await buildBrief(c, { taskId: TASK_ID });
  assert.equal(brief.related.reason, 'not-supported');
  assert.match(formatBrief(brief, NOW), /\(related documents unavailable: not-supported\)/);
});
