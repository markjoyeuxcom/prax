import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';
import { buildAskTaskMessages, coerceAskTasks, ASK_TASK_LIMIT } from '../../server/askTasks.js';

// Ask Prax, Console redesign: suggested follow-up tasks, the verified-only
// trust option, and no model call when nothing in the library matched.

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const DOC_ID = '00000000-0000-4000-8000-0000000000d1';
const DRAFT_ID = '00000000-0000-4000-8000-0000000000d2';
const DOCS = [
  { id: DOC_ID, title: 'B2 app key scopes', documentType: 'known-issue', projectId: PROJECT_ID, tags: [], body: 'Restore fails without listAllBucketNames. Recreate the key.', verified: true, status: 'active', kind: 'source' },
  { id: DRAFT_ID, title: 'Talos upgrade notes', documentType: 'note', projectId: PROJECT_ID, tags: [], body: 'Snapshot etcd before the window.', verified: false, status: 'active', kind: 'source' },
];
const SOURCES = DOCS.map((doc) => ({ id: doc.id, title: doc.title }));

function makeApp({ chat = null, docs = DOCS } = {}) {
  return buildApp({
    skipDb: true,
    libraryRepository: {
      listDocuments: async () => docs,
      searchDocumentsSemantic: async () => docs,
      getDocument: async (id) => docs.find((doc) => doc.id === id) || null,
    },
    projectsRepository: { resolveProject: async () => ({ id: PROJECT_ID, slug: 'homelab', name: 'Homelab' }) },
    documentLinksRepository: { listOutboundLinksForDocuments: async () => new Map() },
    appSettingsRepository: { async getSetting(_k, fb) { return fb; }, async putSetting() {} },
    embedder: { backend: 'fake', async isAvailable() { return true; }, async embed() { return { vector: [0.1], model: 'fake', dim: 1 }; } },
    chat,
  });
}

test('buildAskTaskMessages lists the sources and ends with the question', () => {
  const [system, user] = buildAskTaskMessages('why does restore fail?', 'Grant the key [B2 app key scopes].', SOURCES);
  assert.match(system.content, /at most 3/);
  assert.match(system.content, /untrusted data/);
  assert.match(user.content, /- B2 app key scopes/);
  assert.match(user.content, /QUESTION: why does restore fail\?$/);
});

test('coerceAskTasks keeps only tasks that cite a source, cleans titles and resolves due dates', () => {
  const text = '```json\n' + JSON.stringify({ tasks: [
    { title: 'Recreate the **B2** key\nwith listAllBucketNames', priority: 'high', due: 'today', source: 'b2 app key scopes' },
    { title: 'Invent a thing', priority: 'high', due: 'today', source: 'Not a source' },
    { title: 'Snapshot etcd', priority: 'urgent', due: 'tomorrow', source: 'Talos upgrade notes' },
    { title: 'Snapshot etcd', priority: 'low', due: null, source: 'Talos upgrade notes' },
  ] }) + '\n```';
  const result = coerceAskTasks(text, SOURCES, { today: '2026-12-31' });
  assert.equal(result.parsed, true);
  assert.equal(result.dropped, 2); // the ungrounded one and the duplicate
  assert.deepEqual(result.tasks, [
    { title: 'Recreate the B2 key with listAllBucketNames', priority: 'high', dueDate: '2026-12-31', sourceId: DOC_ID, sourceTitle: 'B2 app key scopes' },
    { title: 'Snapshot etcd', priority: 'medium', dueDate: '2027-01-01', sourceId: DRAFT_ID, sourceTitle: 'Talos upgrade notes' },
  ]);
});

test('coerceAskTasks caps the list and reports unparseable output', () => {
  const many = { tasks: Array.from({ length: 6 }, (_, i) => ({ title: `Task ${i}`, source: 'B2 app key scopes' })) };
  assert.equal(coerceAskTasks(JSON.stringify(many), SOURCES, { today: '2026-10-13' }).tasks.length, ASK_TASK_LIMIT);
  assert.deepEqual(coerceAskTasks('Sure! Here are some tasks.', SOURCES), { tasks: [], dropped: 0, parsed: false });
});

test('POST /api/library/ask/tasks proposes grounded tasks from the answer’s own sources', async () => {
  let seen;
  const chat = { backend: 'fake', model: 'fake-chat', async complete(messages) {
    seen = messages;
    return { text: JSON.stringify({ tasks: [{ title: 'Recreate the B2 key', priority: 'high', due: 'today', source: 'B2 app key scopes' }] }), model: 'fake-chat' };
  } };
  const app = await makeApp({ chat });
  const res = await app.inject({
    method: 'POST', url: '/api/library/ask/tasks',
    headers: { 'x-prax-local-date': '2026-10-13' },
    payload: { q: 'why does restore fail?', answer: 'Recreate it [B2 app key scopes].', sourceIds: [DOC_ID, 'not-a-uuid'] },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.deepEqual(body.tasks, [{ title: 'Recreate the B2 key', priority: 'high', dueDate: '2026-10-13', sourceId: DOC_ID, sourceTitle: 'B2 app key scopes' }]);
  assert.equal(body.degraded, false);
  assert.match(seen[1].content, /- B2 app key scopes/);
  assert.doesNotMatch(seen[1].content, /Talos upgrade notes/); // only the sources asked about
  await app.close();
});

test('POST /api/library/ask/tasks degrades without a model or sources, and validates input', async () => {
  const noModel = await makeApp();
  const a = await noModel.inject({ method: 'POST', url: '/api/library/ask/tasks', payload: { q: 'q', answer: 'a', sourceIds: [DOC_ID] } });
  assert.deepEqual(a.json(), { tasks: [], degraded: true, reason: 'no-chat-model', model: null });
  const b = await noModel.inject({ method: 'POST', url: '/api/library/ask/tasks', payload: { q: 'q', answer: 'a', sourceIds: [] } });
  assert.equal(b.json().reason, 'no-sources');
  const c = await noModel.inject({ method: 'POST', url: '/api/library/ask/tasks', payload: { q: 'q' } });
  assert.equal(c.statusCode, 400);
  await noModel.close();
});

test('POST /api/library/ask with no matching documents does not ask the model', async () => {
  let called = false;
  const chat = { backend: 'fake', model: 'fake-chat', async complete() { called = true; return { text: 'Hello! How can I help?', model: 'fake-chat' }; } };
  const app = await makeApp({ chat, docs: [] });
  const res = await app.inject({ method: 'POST', url: '/api/library/ask', payload: { q: 'hello' } });
  const body = res.json();
  assert.equal(called, false);
  assert.equal(body.answer, null);
  assert.equal(body.degraded, true);
  assert.equal(body.reason, 'no-sources');
  await app.close();
});

test('POST /api/library/ask with trust=verified leaves unverified memory out of the answer', async () => {
  let seen;
  const chat = { backend: 'fake', model: 'fake-chat', async complete(messages) { seen = messages; return { text: 'Recreate the key [B2 app key scopes].', model: 'fake-chat' }; } };
  const app = await makeApp({ chat });
  const res = await app.inject({ method: 'POST', url: '/api/library/ask', payload: { q: 'restore', trust: 'verified' } });
  const body = res.json();
  assert.equal(body.degraded, false);
  assert.deepEqual(body.sources.map((s) => s.title), ['B2 app key scopes']);
  assert.equal(body.retrieval.trust, 'verified');
  assert.equal(body.retrieval.hiddenUnverified, 1);
  assert.doesNotMatch(seen[1].content, /Talos upgrade notes/);
  await app.close();
});
