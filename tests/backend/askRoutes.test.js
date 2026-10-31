import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';
import { buildAskMessages, buildAnswerContext, collectSources, normalizeAnswerCitations, selectAnswerContext, validateAnswerCitations } from '../../server/askLibrary.js';

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

test('buildAskMessages lists the citable titles before the context', () => {
  const msgs = buildAskMessages('q', '## Release runbook (runbook · verified)\n\n## Packaged rehearsal\nsteps', ['Release runbook', 'Release history']);
  assert.match(msgs[0].content, /Never cite a heading inside a document/);
  assert.match(msgs[1].content, /^SOURCES \(the only citable titles\):\n- \[Release runbook\]\n- \[Release history\]\n\nCONTEXT:/);
  assert.doesNotMatch(buildAskMessages('q', 'ctx')[1].content, /SOURCES/); // no titles, no list
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
    { id: 'a', title: 'A', documentType: 'note', verified: true, verifiedAt: null, verifiedBy: null, status: 'active', updatedBy: null, kind: 'source', stale: false, revision: null },
    { id: 'b', title: 'B', documentType: 'runbook', verified: false, verifiedAt: null, verifiedBy: null, status: 'active', updatedBy: null, kind: 'source', stale: false, revision: null },
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

test('selectAnswerContext budgets by relevance and shows verified first', () => {
  // Retrieval order is relevance: the unverified runbook is the best match, the
  // verified note the weakest. With room for two, the runbook is placed whole
  // and the weak verified note is the one left out.
  const runbook = { id: 'r', title: 'Release runbook', documentType: 'runbook', verified: false, status: 'active', body: `Steps. ${'detail '.repeat(150)} WITHHELD_RELEASE_SECTION` };
  const history = { id: 'h', title: 'Release history', documentType: 'reference', verified: true, status: 'active', body: 'v0.45.0 never published.' };
  const unrelated = { id: 'u', title: 'CLI install note', documentType: 'note', verified: true, status: 'active', body: 'Install the shim.' };
  const { context, documents } = selectAnswerContext([runbook, history, unrelated], { limit: 2 });
  assert.deepEqual(documents.map((d) => d.title), ['Release history', 'Release runbook']); // verified shown first
  assert.match(context, /WITHHELD_RELEASE_SECTION/);
  assert.doesNotMatch(context, /CLI install note/);
});

test('a runbook longer than the old 3000-char cap reaches the model whole', () => {
  const body = `${'Release step. '.repeat(260)}v0.37.0 was withheld when a symlinked restore did nothing.`; // ~3700 chars
  const { context } = selectAnswerContext([{ id: 'p', title: 'Prax release process', documentType: 'runbook', verified: false, status: 'active', body }]);
  assert.match(context, /v0\.37\.0 was withheld/);
  assert.doesNotMatch(context, /…\(truncated\)/);
});

test('normalizeAnswerCitations strips only the label Prax gave that source', () => {
  const sources = [
    { title: 'Using Prax from inside a Docker container', documentType: 'runbook', verified: false },
    { title: 'Postgres failover', documentType: 'runbook', verified: true },
  ];
  assert.equal(
    normalizeAnswerCitations('Build it [Using Prax from inside a Docker container (runbook · UNVERIFIED — pending human review)].', sources),
    'Build it [Using Prax from inside a Docker container].',
  );
  assert.equal(normalizeAnswerCitations('[postgres  failover (runbook · verified)]', sources), '[Postgres failover]'); // case and spacing fold
  assert.equal(normalizeAnswerCitations('[Postgres failover (runbook · UNVERIFIED — pending human review)]', sources),
    '[Postgres failover (runbook · UNVERIFIED — pending human review)]'); // not this source's label
  assert.equal(normalizeAnswerCitations('[Invented doc (note · verified)]', sources), '[Invented doc (note · verified)]');
  assert.equal(normalizeAnswerCitations('[Postgres failover] and array[0]', sources), '[Postgres failover] and array[0]');
});

test('a qualified title that names a different, linked document is not credited to a source', () => {
  // Review finding 2026-10-31: [Failover (staging · retired)] is another
  // document's title, not the label Prax gives [Failover].
  const sources = [{ title: 'Failover', documentType: 'runbook', verified: true }];
  const answer = 'Use the staging-only sequence [Failover (staging · retired)].';
  const normalized = normalizeAnswerCitations(answer, sources);
  assert.equal(normalized, answer);
  assert.equal(validateAnswerCitations(normalized, sources).valid, false);
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

test('POST /api/library/ask accepts a citation that copied the context header, and returns it as the bare title', async () => {
  const chat = { backend: 'fake', model: 'fake-chat', async complete() { return { text: 'Promote the standby [Postgres failover (runbook · verified)].', model: 'fake-chat' }; } };
  const app = await makeApp({ chat, docs: DOCS });
  const body = (await app.inject({ method: 'POST', url: '/api/library/ask', payload: { q: 'failover?' } })).json();
  assert.equal(body.degraded, false);
  assert.equal(body.answer, 'Promote the standby [Postgres failover].');
  assert.deepEqual(body.citation.citations, ['Postgres failover']);
  await app.close();
});

test('POST /api/library/ask asks the model for high effort', async () => {
  let seenOpts;
  const chat = { backend: 'fake', model: 'fake-chat', async complete(_messages, opts) { seenOpts = opts; return { text: 'Promote the standby [Postgres failover].', model: 'fake-chat' }; } };
  const app = await makeApp({ chat, docs: DOCS });
  await app.inject({ method: 'POST', url: '/api/library/ask', payload: { q: 'failover?' } });
  assert.equal(seenOpts.effort, 'high');
  assert.equal(seenOpts.maxTokens, 1024);
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

test('without embeddings a question in plain words still finds the runbook (ranked keyword fallback)', async () => {
  const { buildApp: build } = await import('../../server/index.js');
  const { loadConfig } = await import('../../server/config.js');
  const app = await build({ config: loadConfig({ PRAX_DB_FILE: ':memory:', EMBEDDING_BACKEND: 'none', CHAT_BACKEND: 'none' }), librarianSweep: false });
  const create = (payload) => app.inject({ method: 'POST', url: '/api/library/documents', payload: { project: 'homelab', documentType: 'runbook', ...payload } });
  assert.equal((await create({ title: 'Postgres failover runbook', body: 'Promote the standby with pg_ctl promote, then repoint the app.' })).statusCode, 201);
  assert.equal((await create({ title: 'DNS resolver notes', body: 'Unbound forwards to Quad9.' })).statusCode, 201);
  const res = await app.inject({ method: 'POST', url: '/api/library/ask', payload: { q: 'how do we fail over postgres' } });
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json();
  assert.notEqual(body.reason, 'no-sources', 'an all-terms filter would find nothing for a natural question');
  assert.equal(body.sources[0]?.title, 'Postgres failover runbook');
  assert.ok(!body.sources.some((s) => s.title === 'DNS resolver notes'), 'the unrelated note is not a source');
  const none = await app.inject({ method: 'POST', url: '/api/library/ask', payload: { q: 'zebra quantum teleporter' } });
  assert.equal(none.json().sources.length, 0, 'nonsense still matches nothing');
  await app.close();
});

test('verified-only retrieval is applied before the candidate limit, so one verified match among fifty unverified is found', async () => {
  const { buildApp: build } = await import('../../server/index.js');
  const { loadConfig } = await import('../../server/config.js');
  const app = await build({ config: loadConfig({ PRAX_DB_FILE: ':memory:', EMBEDDING_BACKEND: 'none', CHAT_BACKEND: 'none' }), librarianSweep: false });
  for (let i = 0; i < 50; i += 1) {
    const res = await app.inject({ method: 'POST', url: '/api/library/documents', headers: { 'x-prax-origin': 'agent', 'x-prax-agent': 'codex' }, payload: { project: 'homelab', documentType: 'note', title: `Crowding note ${i}`, body: 'The crowdprobe keyword appears here, again and again: crowdprobe crowdprobe.' } });
    assert.equal(res.statusCode, 201);
  }
  const verified = (await app.inject({ method: 'POST', url: '/api/library/documents', payload: { project: 'homelab', documentType: 'runbook', title: 'Crowding runbook', body: 'The crowdprobe procedure.' } })).json();
  await app.inject({ method: 'POST', url: `/api/library/documents/${verified.id}/verify`, payload: { verified: true, as: 'Mark', revision: verified.revision } });
  const res = await app.inject({ method: 'POST', url: '/api/library/ask', payload: { q: 'crowdprobe', trust: 'verified' } });
  const body = res.json();
  assert.notEqual(body.reason, 'no-sources');
  assert.deepEqual(body.sources.map((s) => s.title), ['Crowding runbook']);
  assert.equal(body.retrieval.trust, 'verified');
  assert.ok(body.retrieval.hiddenUnverified >= 1);
  assert.ok(body.sources[0].revision, 'sources carry the revision they were read at');
  await app.close();
});

test('a truncated completion is a degraded answer, and suggests no tasks', async () => {
  const { buildApp: build } = await import('../../server/index.js');
  const { loadConfig } = await import('../../server/config.js');
  const chat = { backend: 'fake', model: 'probe', supportsTools: false, async isAvailable() { return true; }, async complete() { return { text: 'Stop the primary [Truncation probe]. Then promote the', model: 'probe', truncated: true, finishReason: 'max_tokens' }; } };
  const app = await build({ config: loadConfig({ PRAX_DB_FILE: ':memory:', EMBEDDING_BACKEND: 'none', CHAT_BACKEND: 'fake' }), chat, librarianSweep: false });
  const doc = (await app.inject({ method: 'POST', url: '/api/library/documents', payload: { project: 'homelab', documentType: 'runbook', title: 'Truncation probe', body: 'Stop the primary, then promote the standby.' } })).json();
  const ask = (await app.inject({ method: 'POST', url: '/api/library/ask', payload: { q: 'truncation probe' } })).json();
  assert.equal(ask.degraded, true);
  assert.equal(ask.reason, 'truncated');
  assert.equal(ask.answer, null);
  assert.equal(ask.sources[0].id, doc.id, 'the sources stay');
  const tasks = (await app.inject({ method: 'POST', url: '/api/library/ask/tasks', payload: { q: 'truncation probe', answer: 'Stop the primary [Truncation probe].', sourceIds: [doc.id] } })).json();
  assert.equal(tasks.degraded, true);
  assert.equal(tasks.reason, 'truncated');
  assert.deepEqual(tasks.tasks, []);
  await app.close();
});

test('keyword verified-only reports an unreviewed harvested candidate as hidden by triage, not by trust', async () => {
  const { buildApp: build } = await import('../../server/index.js');
  const { loadConfig } = await import('../../server/config.js');
  const app = await build({ config: loadConfig({ PRAX_DB_FILE: ':memory:', EMBEDDING_BACKEND: 'none', CHAT_BACKEND: 'none' }), librarianSweep: false });
  const res = await app.inject({ method: 'POST', url: '/api/library/documents', headers: { 'x-prax-origin': 'agent', 'x-prax-agent': 'codex' }, payload: { project: 'homelab', documentType: 'note', title: 'Harvestcount', body: 'A harvested candidate mentioning harvestcount.', tags: ['harvested'] } });
  assert.equal(res.statusCode, 201);
  const body = (await app.inject({ method: 'POST', url: '/api/library/ask', payload: { q: 'harvestcount', trust: 'verified' } })).json();
  assert.equal(body.retrieval.hiddenHarvested, 1, 'turning Verified only off would not admit it either');
  assert.equal(body.retrieval.hiddenUnverified, 0);
  await app.close();
});

test('the hidden-unverified count says "at least" when the bounded pass filled, even after harvested candidates are set aside', async () => {
  const { buildApp: build } = await import('../../server/index.js');
  const { loadConfig } = await import('../../server/config.js');
  const app = await build({ config: loadConfig({ PRAX_DB_FILE: ':memory:', EMBEDDING_BACKEND: 'none', CHAT_BACKEND: 'none' }), librarianSweep: false });
  for (let i = 0; i < 60; i += 1) {
    const res = await app.inject({ method: 'POST', url: '/api/library/documents', headers: { 'x-prax-origin': 'agent', 'x-prax-agent': 'codex' }, payload: { project: 'homelab', documentType: 'note', title: `Capprobe note ${i}`, body: 'capprobe capprobe capprobe.', tags: i < 10 ? ['harvested'] : [] } });
    assert.equal(res.statusCode, 201);
  }
  const verified = (await app.inject({ method: 'POST', url: '/api/library/documents', payload: { project: 'homelab', documentType: 'runbook', title: 'Capprobe runbook', body: 'The capprobe procedure.' } })).json();
  await app.inject({ method: 'POST', url: `/api/library/documents/${verified.id}/verify`, payload: { verified: true, as: 'Mark', revision: verified.revision } });
  const body = (await app.inject({ method: 'POST', url: '/api/library/ask', payload: { q: 'capprobe', trust: 'verified' } })).json();
  assert.deepEqual(body.sources.map((s) => s.title), ['Capprobe runbook']);
  assert.equal(body.retrieval.hiddenUnverifiedCapped, true, 'the 50-candidate pass filled: the count is a lower bound');
  assert.ok(body.retrieval.hiddenUnverified >= 40 && body.retrieval.hiddenUnverified <= 50, String(body.retrieval.hiddenUnverified));
  await app.close();
});
