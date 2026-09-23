import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { recall, formatRecall } from '../../cli/lib/recall.js';
import { budgetedContext, formatBudgetedContext, budgetedContextJson } from '../../cli/lib/context.js';
import { estimateTokens } from '../../cli/lib/budget.js';

const NOW = new Date('2026-09-23T12:00:00Z');
const sha = (text) => createHash('sha256').update(text).digest('hex');
const FILE = 'line one\nline two\n';

// Four matches, in rank order: an unverified note first, a verified runbook
// third. The cited note pins lines that still match in the checkout.
const REFS = [
  { id: 'n1', title: 'Top unverified', documentType: 'note', verified: false, updatedAt: '2026-09-01T00:00:00Z', projectId: 'p', snippet: 's1' },
  { id: 'n2', title: 'Cited note', documentType: 'note', verified: false, updatedAt: '2026-01-01T00:00:00Z', projectId: 'p', snippet: 's2' },
  { id: 'r1', title: 'Verified runbook', documentType: 'runbook', verified: true, verifiedBy: 'mark', updatedAt: '2025-06-01T00:00:00Z', projectId: 'p', snippet: 's3' },
  { id: 'n3', title: 'Newest unverified', documentType: 'note', verified: false, updatedAt: '2026-09-20T00:00:00Z', projectId: 'p', snippet: 's4' },
];
const BODIES = {
  n1: `Top body.\n${'t'.repeat(600)}`, n2: 'Cited body.', r1: '# Verified runbook\n\nStep one.', n3: 'Newest body.',
};

function client({ refs = REFS, index = { total: 4, embedded: 4, pending: 0 } } = {}) {
  const calls = { getDocument: [], listCodeRefs: [] };
  return {
    calls,
    semanticSearch: async () => ({
      items: refs, page: { returned: refs.length, total: refs.length, hasMore: false }, index,
      degraded: index.pending > 0, reason: index.pending > 0 ? 'index-incomplete' : null,
    }),
    keywordSearch: async () => [],
    getDocument: async (id) => { calls.getDocument.push(id); return { ...refs.find((r) => r.id === id), body: BODIES[id] }; },
    listProjects: async () => [{ id: 'p', slug: 'homelab' }],
    listCodeRefs: async (id) => {
      calls.listCodeRefs.push(id);
      return id === 'n2' ? [{ path: 'src/a.js', startLine: 1, endLine: 2, contentHash: sha('line one\nline two') }] : [];
    },
  };
}
const checkout = { readFile: (path) => (path === 'src/a.js' ? FILE : null) };

test('without --budget recall keeps its classic shape: no budget key, top is the best rank', async () => {
  const c = client();
  const result = await recall(c, { query: 'x', limit: 5, checkout });
  assert.equal(result.budget, undefined);
  assert.equal(result.top.id, 'n1');
  assert.deepEqual(result.related.map((r) => r.id), ['n2', 'r1', 'n3']);
  assert.deepEqual(c.calls.getDocument, ['n1'], 'only the top hit is fetched');
  assert.deepEqual(c.calls.listCodeRefs, ['n1'], 'only the top hit is checked');
  assert.ok(!formatRecall(result, NOW).includes('(budget:'));
});

test('--budget fills verified, then cited-and-unchanged, then recent — checking every hit', async () => {
  const c = client();
  const result = await recall(c, { query: 'x', limit: 5, checkout, budget: 2000, now: NOW });
  assert.deepEqual([result.top.id, ...result.related.map((r) => r.id)], ['r1', 'n2', 'n3', 'n1']);
  assert.deepEqual(result.budget.entries.map((e) => e.tier), ['verified', 'cited-unchanged', 'recent', 'recent']);
  assert.deepEqual(result.budget.entries.map((e) => e.form), ['full', 'full', 'full', 'full']);
  assert.deepEqual(c.calls.listCodeRefs.slice().sort(), ['n1', 'n2', 'n3', 'r1']);
  assert.equal(result.budget.estimate, 'chars/4');
  assert.equal(result.budget.tokens, 2000);
  const text = formatRecall(result, NOW);
  assert.equal(estimateTokens(text), result.budget.used, 'used is measured on the printed text');
  assert.match(text, /^\(budget: ~\d+ of 2000 tokens/);
  assert.match(text, /## \[verified\] Verified runbook {2}\(runbook · r1 · in homelab · verified by mark/);
});

test('a small budget compacts then omits, and every entry line keeps its trust chip', async () => {
  const result = await recall(client(), { query: 'x', limit: 5, checkout, budget: 110, now: NOW });
  const text = formatRecall(result, NOW);
  assert.ok(result.budget.used <= 110, `used ${result.budget.used}`);
  const forms = result.budget.entries.map((e) => e.form);
  assert.ok(forms.includes('compact') || forms.includes('omitted'));
  // Compaction is monotonic: never full after compact.
  const firstCompact = forms.indexOf('compact');
  if (firstCompact !== -1) assert.ok(!forms.slice(firstCompact).includes('full'));
  for (const line of text.split('\n')) {
    if (/^(##|- )/.test(line)) assert.match(line, /^(## |- )\[(verified|unverified)\] /, line);
  }
  const omitted = result.budget.omitted;
  if (omitted.total) assert.match(text, new RegExp(`_${omitted.total} more left out by the budget`));
});

test('the disclosures always print, even when they alone exceed the budget', async () => {
  const result = await recall(client({ index: { total: 10, embedded: 6, pending: 4 } }), {
    query: 'x', limit: 5, checkout, budget: 10, now: NOW,
  });
  const text = formatRecall(result, NOW);
  assert.match(text, /\(index incomplete: 4 of 10 documents have no current embedding — results may be missing\)/);
  assert.match(text, /exceeded by the disclosure lines/);
  assert.deepEqual(result.budget.omitted, { total: 4, unverified: 3 });
});

test('the budgeted block is deterministic for the same input', async () => {
  const a = formatRecall(await recall(client(), { query: 'x', checkout, budget: 150, now: NOW }), NOW);
  const b = formatRecall(await recall(client(), { query: 'x', checkout, budget: 150, now: NOW }), NOW);
  assert.equal(a, b);
});

// ---- prax context --budget ------------------------------------------------

const PACK = {
  project: { id: 'p', slug: 'homelab', name: 'Homelab', status: 'active' },
  query: 'restore',
  retrieval: { mode: 'semantic', fallback: false, reason: null, index: { total: 5, embedded: 4, pending: 1 } },
  sections: [
    { kind: 'relevant', title: 'Relevant memory', items: [{ id: 'v1', title: 'Verified note', documentType: 'note', verified: true, text: 'v1 text', updatedAt: '2025-01-01' }] },
    { kind: 'runbooks', title: 'Active runbooks', items: [{ id: 'rb', title: 'Runbook', documentType: 'runbook', verified: true, text: 'rb text', updatedAt: '2025-01-01' }] },
    {
      kind: 'unverified',
      title: '⚠ Unverified — pending human review',
      items: [
        { id: 'u1', title: 'Old draft', documentType: 'note', verified: false, text: 'u1 text', updatedAt: '2026-01-01' },
        { id: 'u2', title: 'New draft', documentType: 'note', verified: false, text: 'u2 text', updatedAt: '2026-09-01' },
      ],
    },
  ],
  omitted: { total: 2, unverified: 1 },
};

function packClient() {
  const asked = [];
  return {
    asked,
    contextPack: async (project, opts) => { asked.push({ project, ...opts }); return PACK; },
    listProjects: async () => [{ id: 'p', slug: 'homelab' }],
    listCodeRefs: async () => [],
  };
}

test('context --budget asks for the JSON pack and keeps sections while filling in fill order', async () => {
  const c = packClient();
  const result = await budgetedContext(c, { project: 'homelab', query: 'restore', budget: 5000, checkout: null });
  assert.deepEqual(c.asked, [{ project: 'homelab', query: 'restore', format: 'json', limit: 50, source: 'context' }]);
  assert.deepEqual(result.items.map((i) => i.id), ['v1', 'rb', 'u2', 'u1'], 'unverified newest first');
  const text = formatBudgetedContext(result);
  assert.ok(text.indexOf('## Relevant memory') < text.indexOf('## Active runbooks'));
  assert.ok(text.indexOf('## Active runbooks') < text.indexOf('## ⚠ Unverified'));
  assert.ok(text.indexOf('New draft') < text.indexOf('Old draft'));
  assert.match(text, /\(index incomplete: 1 of 5 documents have no current embedding — results may be missing\)/);
  assert.match(text, /_2 more documents \(1 unverified\) left out by the document limit\._/);
  assert.match(text, /### \[unverified\] New draft {2}\(note · u2\)/);
  const json = budgetedContextJson(result);
  assert.equal(json.budget.tokens, 5000);
  assert.deepEqual(json.sections.map((s) => s.kind), ['relevant', 'runbooks', 'unverified']);
  assert.ok(json.sections.every((s) => s.items.every((i) => i.form === 'full')));
});

test('context --budget drops the unverified tail first and says so', async () => {
  const result = await budgetedContext(packClient(), { project: 'homelab', query: 'restore', limit: 12, budget: 120, checkout: null });
  const json = budgetedContextJson(result);
  const forms = Object.fromEntries(json.budget.entries.map((e) => [e.id, e.form]));
  assert.notEqual(forms.v1, 'omitted');
  assert.equal(forms.u1, 'omitted');
  assert.ok(json.budget.omitted.unverified >= 1);
  assert.ok(!json.sections.some((s) => s.items.some((i) => i.id === 'u1')));
  assert.match(formatBudgetedContext(result), /left out by the budget \(\d+ unverified\)/);
});
