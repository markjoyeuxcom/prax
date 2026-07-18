import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';
import { buildAskMessages, buildAnswerContext, collectSources, validateAnswerCitations } from '../../server/askLibrary.js';

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';

test('buildAskMessages grounds the prompt in the pack and asks the question', () => {
  const msgs = buildAskMessages('  how do we fail over?  ', '# Pack\n- [Doc] body');
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].role, 'system');
  assert.match(msgs[0].content, /ONLY the CONTEXT/);
  assert.match(msgs[0].content, /cite/i);
  assert.match(msgs[0].content, /untrusted reference data/);
  assert.equal(msgs[1].role, 'user');
  assert.match(msgs[1].content, /# Pack/);
  assert.match(msgs[1].content, /QUESTION: how do we fail over\?$/);
});

test('buildAskMessages tolerates an empty pack', () => {
  const msgs = buildAskMessages('q', '');
  assert.match(msgs[1].content, /\(no matching documents\)/);
});

test('collectSources de-dupes across sections in order', () => {
  const pack = { sections: [
    { items: [{ id: 'a', title: 'A', documentType: 'note', verified: true }] },
    { items: [{ id: 'a', title: 'A', documentType: 'note', verified: true }, { id: 'b', title: 'B', documentType: 'runbook', verified: false }] },
  ] };
  assert.deepEqual(collectSources(pack), [
    { id: 'a', title: 'A', documentType: 'note', verified: true, verifiedAt: null, verifiedBy: null, status: 'active', updatedBy: null, kind: 'source', stale: false },
    { id: 'b', title: 'B', documentType: 'runbook', verified: false, verifiedAt: null, verifiedBy: null, status: 'active', updatedBy: null, kind: 'source', stale: false },
  ]);
  assert.deepEqual(collectSources(null), []);
});

test('validateAnswerCitations requires exact retrieved titles and rejects unknown citations', () => {
  const sources = [{ title: 'Postgres failover' }, { title: 'Backup policy' }];
  assert.deepEqual(validateAnswerCitations('Use the standby [Postgres failover].', sources), {
    valid: true, citations: ['Postgres failover'], unknown: [],
  });
  assert.equal(validateAnswerCitations('Use the standby.', sources).valid, false);
  assert.deepEqual(validateAnswerCitations('See [Invented runbook].', sources).unknown, ['Invented runbook']);
  assert.equal(validateAnswerCitations('Use array[0] and test [ -f /tmp/x ] [Postgres failover].', sources).valid, true);
  assert.equal(validateAnswerCitations('No context available.', []).valid, true);
});

test('buildAnswerContext feeds full bodies (not snippets), verified-first, marks trust, skips junk', () => {
  const long = 'STEP-line. '.repeat(60); // ~600 chars, well beyond a 280-char snippet
  const docs = [
    { id: 'u', title: 'Draft', documentType: 'note', verified: false, status: 'active', body: 'unverified body' },
    { id: 'v', title: 'Runbook A', documentType: 'runbook', verified: true, status: 'active', body: long },
    { id: 'e', title: 'Empty', documentType: 'note', verified: true, status: 'active', body: '   ' },
    { id: 'arch', title: 'Archived', documentType: 'note', verified: true, status: 'archived', body: 'nope' },
  ];
  const ctx = buildAnswerContext(docs);
  assert.ok(ctx.includes(long.trim()));                          // FULL body, not a snippet
  assert.ok(ctx.indexOf('Runbook A') < ctx.indexOf('Draft'));   // verified first
  assert.match(ctx, /Runbook A \(runbook · verified\)/);
  assert.match(ctx, /Draft \(note · UNVERIFIED/);
  assert.doesNotMatch(ctx, /Empty/);                            // empty-body doc skipped
  assert.doesNotMatch(ctx, /Archived/);                         // non-active doc skipped
});

test('buildAnswerContext respects the total + per-doc budget', () => {
  const huge = 'x'.repeat(50000);
  const docs = Array.from({ length: 10 }, (_, i) => ({ id: `d${i}`, title: `Doc ${i}`, documentType: 'note', verified: true, status: 'active', body: huge }));
  const ctx = buildAnswerContext(docs, { totalChars: 5000, docChars: 1000, limit: 6 });
  assert.ok(ctx.length <= 6000);                                // bounded near the total budget
  assert.match(ctx, /…\(truncated\)/);                          // per-doc cap applied
});

// ---- route ----
function makeApp({ chat, docs, semanticDocs, embedder } = {}) {
  const library = {
    listDocuments: async () => docs ?? [],
    searchDocumentsSemantic: async () => semanticDocs ?? docs ?? [],
    getDocument: async () => null,
  };
  return buildApp({
    skipDb: true,
    libraryRepository: library,
    projectsRepository: { resolveProject: async (v) => (v === 'missing' ? null : { id: PROJECT_ID, slug: 'homelab', name: 'Homelab' }) },
    documentLinksRepository: { listOutboundLinksForDocuments: async () => new Map() },
    appSettingsRepository: { async getSetting(_k, fb) { return fb; }, async putSetting() {} },
    embedder: embedder ?? { backend: 'fake', async isAvailable() { return true; }, async embed() { return { vector: [0.1], model: 'fake', dim: 1 }; } },
    chat: chat ?? null,
  });
}

// A body long enough that a 280-char pack snippet would drop the end marker.
const LONG_BODY = `Promote the standby. ${'Step detail. '.repeat(40)} END_OF_RUNBOOK_MARKER`;
const DOCS = [{ id: 'd1', title: 'Postgres failover', documentType: 'runbook', projectId: PROJECT_ID, tags: [], body: LONG_BODY, verified: true, status: 'active', kind: 'source' }];

test('POST /api/library/ask generates a grounded answer when a chat model is set', async () => {
  let seenMessages;
  const chat = { backend: 'fake', model: 'fake-chat', async complete(messages) { seenMessages = messages; return { text: 'Promote the standby [Postgres failover].', model: 'fake-chat' }; } };
  const app = await makeApp({ chat, docs: DOCS });
  const res = await app.inject({ method: 'POST', url: '/api/library/ask', payload: { q: 'how do we fail over postgres?' } });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.degraded, false);
  assert.match(body.answer, /Promote the standby/);
  assert.equal(body.model, 'fake-chat');
  assert.deepEqual(body.retrieval, { mode: 'semantic', fallback: false, reason: null });
  assert.deepEqual(body.citation, { valid: true, citations: ['Postgres failover'], unknown: [] });
  assert.ok(body.sources.some((s) => s.title === 'Postgres failover'));
  assert.ok(body.markdown.includes('Postgres failover'));
  // the chat saw the system contract + the FULL body (not just the pack snippet)
  assert.equal(seenMessages[0].role, 'system');
  assert.match(seenMessages[1].content, /Postgres failover/);
  assert.match(seenMessages[1].content, /END_OF_RUNBOOK_MARKER/);  // full body reached the model
  await app.close();
});

test('POST /api/library/ask degrades to the pack when no chat model is configured', async () => {
  const app = await makeApp({ chat: null, docs: DOCS });
  const res = await app.inject({ method: 'POST', url: '/api/library/ask', payload: { q: 'failover?' } });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.answer, null);
  assert.equal(body.degraded, true);
  assert.equal(body.reason, 'no-chat-model');
  assert.deepEqual(body.retrieval, { mode: 'semantic', fallback: false, reason: null });
  assert.ok(body.markdown.length > 0);            // still returns retrieved context
  assert.ok(body.sources.length >= 1);
  await app.close();
});

test('POST /api/library/ask still returns sources when generation fails', async () => {
  const chat = { backend: 'fake', model: 'boom', async complete() { throw new Error('gemini chat failed: 404'); } };
  const app = await makeApp({ chat, docs: DOCS });
  const res = await app.inject({ method: 'POST', url: '/api/library/ask', payload: { q: 'failover?' } });
  assert.equal(res.statusCode, 200);              // never 500s on the AI path
  const body = res.json();
  assert.equal(body.answer, null);
  assert.equal(body.degraded, true);
  assert.equal(body.reason, 'generation-failed');
  assert.equal('error' in body, false);           // provider exception text stays server-side
  assert.ok(body.sources.length >= 1);
  await app.close();
});

test('POST /api/library/ask makes semantic failure and keyword fallback explicit', async () => {
  const embedder = { backend: 'fake', async isAvailable() { return true; }, async embed() { throw new Error('private provider detail'); } };
  const app = await makeApp({ chat: null, docs: DOCS, embedder });
  const res = await app.inject({ method: 'POST', url: '/api/library/ask', payload: { q: 'failover?' } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().retrieval, { mode: 'keyword', fallback: true, reason: 'semantic-unavailable' });
  assert.ok(res.json().sources.length > 0);
  await app.close();
});

test('POST /api/library/ask withholds an answer that does not cite a retrieved source', async () => {
  const chat = { backend: 'fake', model: 'fake-chat', async complete() { return { text: 'Promote the standby.', model: 'fake-chat' }; } };
  const app = await makeApp({ chat, docs: DOCS });
  const res = await app.inject({ method: 'POST', url: '/api/library/ask', payload: { q: 'failover?' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().answer, null);
  assert.equal(res.json().degraded, true);
  assert.equal(res.json().reason, 'citation-validation-failed');
  await app.close();
});

test('POST /api/library/ask validates the query and the project', async () => {
  const app = await makeApp({ chat: null, docs: DOCS });
  assert.equal((await app.inject({ method: 'POST', url: '/api/library/ask', payload: {} })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: '/api/library/ask', payload: { q: '   ' } })).statusCode, 400);
  const badProject = await app.inject({ method: 'POST', url: '/api/library/ask', payload: { q: 'x', project: 'missing' } });
  assert.equal(badProject.statusCode, 400);
  await app.close();
});

// Regression (2026-07-18 review): citation matching is case-insensitive, as
// its contract comment always claimed — a fully grounded answer citing
// [postgres failover runbook] must not be discarded as uncited.
test('validateAnswerCitations accepts known titles regardless of casing', () => {
  const sources = [{ title: 'Postgres Failover Runbook' }];
  const lower = validateAnswerCitations('See [postgres failover runbook] for steps.', sources);
  assert.equal(lower.valid, true);
  assert.deepEqual(lower.citations, ['Postgres Failover Runbook'], 'canonical title returned');
  const upper = validateAnswerCitations('See [POSTGRES FAILOVER RUNBOOK].', sources);
  assert.equal(upper.valid, true);
  const unknown = validateAnswerCitations('See [Some Other Doc].', sources);
  assert.equal(unknown.valid, false, 'genuinely unknown citations still reject');
});
