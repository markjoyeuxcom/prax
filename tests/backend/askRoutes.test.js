import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';
import { buildAskMessages, collectSources } from '../../server/askLibrary.js';

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';

test('buildAskMessages grounds the prompt in the pack and asks the question', () => {
  const msgs = buildAskMessages('  how do we fail over?  ', '# Pack\n- [Doc] body');
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].role, 'system');
  assert.match(msgs[0].content, /ONLY the CONTEXT/);
  assert.match(msgs[0].content, /cite/i);
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
    { id: 'a', title: 'A', documentType: 'note', verified: true },
    { id: 'b', title: 'B', documentType: 'runbook', verified: false },
  ]);
  assert.deepEqual(collectSources(null), []);
});

// ---- route ----
function makeApp({ chat, docs } = {}) {
  const library = {
    listDocuments: async () => docs ?? [],
    searchDocumentsSemantic: async () => docs ?? [],
    getDocument: async () => null,
  };
  return buildApp({
    skipDb: true,
    libraryRepository: library,
    projectsRepository: { resolveProject: async (v) => (v === 'missing' ? null : { id: PROJECT_ID, slug: 'homelab', name: 'Homelab' }) },
    documentLinksRepository: { listOutboundLinksForDocuments: async () => new Map() },
    appSettingsRepository: { async getSetting(_k, fb) { return fb; }, async putSetting() {} },
    embedder: { backend: 'fake', async isAvailable() { return true; }, async embed() { return { vector: [0.1], model: 'fake', dim: 1 }; } },
    chat: chat ?? null,
  });
}

const DOCS = [{ id: 'd1', title: 'Postgres failover', documentType: 'runbook', projectId: PROJECT_ID, tags: [], body: 'Promote the standby.', verified: true, status: 'active', kind: 'source' }];

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
  assert.ok(body.sources.some((s) => s.title === 'Postgres failover'));
  assert.ok(body.markdown.includes('Postgres failover'));
  // the chat saw the system contract + the pack
  assert.equal(seenMessages[0].role, 'system');
  assert.match(seenMessages[1].content, /Postgres failover/);
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
  assert.ok(body.markdown.length > 0);            // still returns retrieved context
  assert.ok(body.sources.length >= 1);
  await app.close();
});

test('POST /api/library/ask still returns sources when generation fails', async () => {
  const chat = { backend: 'fake', model: 'boom', async complete() { throw new Error('provider 500'); } };
  const app = await makeApp({ chat, docs: DOCS });
  const res = await app.inject({ method: 'POST', url: '/api/library/ask', payload: { q: 'failover?' } });
  assert.equal(res.statusCode, 200);              // never 500s on the AI path
  const body = res.json();
  assert.equal(body.answer, null);
  assert.equal(body.degraded, true);
  assert.equal(body.reason, 'generation-failed');
  assert.ok(body.sources.length >= 1);
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
