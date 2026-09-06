import test from 'node:test';
import assert from 'node:assert/strict';
import { remember } from '../../cli/lib/remember.js';

const fakeClient = (overrides = {}) => ({
  ensureProject: async (p) => p,
  listDocuments: async () => [],
  createMemory: async (doc) => ({ id: 'new', ...doc }),
  updateMemory: async (id, patch) => ({ id, ...patch }),
  ...overrides,
});

test('remember ensures the target project and creates without a kind field by default', async () => {
  let ensured; let created;
  const client = fakeClient({
    ensureProject: async (p) => { ensured = p; return p; },
    createMemory: async (doc) => { created = doc; return { id: 'new', ...doc }; },
  });
  const { doc, action } = await remember(client, { title: 'T', body: 'B', project: 'homelab', tags: ['x'] });
  assert.equal(ensured, 'homelab');
  assert.equal(action, 'created');
  assert.equal('kind' in created, false);
  assert.equal(created.project, 'homelab');
  assert.deepEqual(created.tags, ['x']);
  assert.match(doc.id, /^[0-9a-f-]{36}$/);
  assert.equal(created.id, doc.id);
});

test('remember updates in place when an exact title already exists', async () => {
  let updatedId;
  const client = fakeClient({
    listDocuments: async () => [{ id: 'dup', title: 'T' }],
    updateMemory: async (id, patch) => { updatedId = id; return { id, ...patch }; },
  });
  const { action } = await remember(client, { title: 'T', body: 'B2', project: 'memory', tags: [] });
  assert.equal(action, 'updated');
  assert.equal(updatedId, 'dup');
});

test('remember does not treat a substring title match as a duplicate', async () => {
  let created = false;
  const client = fakeClient({
    listDocuments: async () => [{ id: 'other', title: 'T extended' }],
    createMemory: async (doc) => { created = true; return { id: 'new', ...doc }; },
  });
  const { action } = await remember(client, { title: 'T', body: 'B', project: 'memory', tags: [] });
  assert.equal(action, 'created');
  assert.ok(created);
});

test('remember dedups an exact stop-word-only title (listDocuments, not full-text search)', async () => {
  let updatedId; let createCalled = false;
  const client = fakeClient({
    listDocuments: async () => [{ id: 'sw', title: 'how to do it' }],
    updateMemory: async (id, patch) => { updatedId = id; return { id, ...patch }; },
    createMemory: async (doc) => { createCalled = true; return { id: 'new', ...doc }; },
  });
  const { action } = await remember(client, { title: 'how to do it', body: 'B', project: 'memory', tags: [] });
  assert.equal(action, 'updated');
  assert.equal(updatedId, 'sw');
  assert.equal(createCalled, false);
});

test('remember forwards kind:synthesized into the create body when the caller passes it', async () => {
  let created;
  const client = fakeClient({ createMemory: async (doc) => { created = doc; return { id: 'n', ...doc }; } });
  await remember(client, { title: 'T', body: 'B', project: 'memory', tags: ['memory'], kind: 'synthesized' });
  assert.equal(created.kind, 'synthesized');
});

test('remember de-duplicates the passed tags', async () => {
  let created;
  const client = fakeClient({ createMemory: async (doc) => { created = doc; return { id: 'n', ...doc }; } });
  await remember(client, { title: 'T', body: 'B', project: 'memory', tags: ['memory', 'memory', 'a'] });
  assert.deepEqual(created.tags, ['memory', 'a']);
});

test('remember: explicit --type sets documentType on create and retypes on update', async () => {
  let created; let patch;
  const existing = { id: 'e1', title: 'Use SQLite', documentType: 'decision' };
  const client = fakeClient({
    listDocuments: async () => [existing],
    updateMemory: async (id, p) => { patch = p; return { id, ...p }; },
  });
  // update with an explicit type -> retype
  await remember(client, { title: 'Use SQLite', body: 'B', project: 'm', type: 'reference' });
  assert.equal(patch.documentType, 'reference');
  // create with an explicit type
  const c2 = fakeClient({ createMemory: async (d) => { created = d; return { id: 'n', ...d }; } });
  await remember(c2, { title: 'New', body: 'B', project: 'm', type: 'runbook' });
  assert.equal(created.documentType, 'runbook');
});

test('remember: a re-remember WITHOUT --type preserves the stored type (no silent demotion)', async () => {
  let patch;
  const client = fakeClient({
    listDocuments: async () => [{ id: 'e1', title: 'Use SQLite', documentType: 'decision' }],
    updateMemory: async (id, p) => { patch = p; return { id, ...p }; },
  });
  await remember(client, { title: 'Use SQLite', body: 'refreshed', project: 'm' }); // no type
  assert.equal('documentType' in patch, false); // stored 'decision' left untouched
});

test('remember: create WITHOUT --type defaults to note', async () => {
  let created;
  const client = fakeClient({ createMemory: async (d) => { created = d; return { id: 'n', ...d }; } });
  await remember(client, { title: 'Plain', body: 'B', project: 'm' });
  assert.equal(created.documentType, 'note');
});

// --- atomic upsert path + legacy fallback ---------------------------------------

test('remember prefers the atomic upsert-by-title endpoint and never lists the project', async () => {
  let listed = false; let sent;
  const client = fakeClient({
    listDocuments: async () => { listed = true; return []; },
    upsertMemory: async (doc) => { sent = doc; return { document: { id: doc.id, title: doc.title }, created: true }; },
  });
  const { doc, action } = await remember(client, { title: 'T', body: 'B', project: 'memory', type: 'decision', tags: ['memory', 'memory', 'x'], kind: 'synthesized' });
  assert.equal(action, 'created');
  assert.equal(listed, false);
  assert.match(sent.id, /^[0-9a-f-]{36}$/);
  assert.equal(doc.id, sent.id);
  assert.deepEqual(sent.tags, ['memory', 'x']);
  assert.equal(sent.documentType, 'decision');
  assert.equal(sent.kind, 'synthesized');
  assert.equal(sent.project, 'memory');
});

test('remember maps an upsert that matched an existing title to "updated" and omits documentType when not explicit', async () => {
  let sent;
  const client = fakeClient({ upsertMemory: async (doc) => { sent = doc; return { document: { id: 'existing' }, created: false }; } });
  const { doc, action } = await remember(client, { title: 'T', body: 'B2', project: 'memory', tags: [] });
  assert.equal(action, 'updated');
  assert.equal(doc.id, 'existing');
  assert.equal('documentType' in sent, false);
});

test('remember falls back to the legacy list+write path only when the server has no upsert endpoint (404)', async () => {
  let created;
  const missing = Object.assign(new Error('Route POST:/api/library/documents/upsert-by-title not found'), { status: 404 });
  const client = fakeClient({
    upsertMemory: async () => { throw missing; },
    createMemory: async (doc) => { created = doc; return { id: doc.id, ...doc }; },
  });
  const { action } = await remember(client, { title: 'T', body: 'B', project: 'memory', tags: [] });
  assert.equal(action, 'created');
  assert.ok(created);

  const broken = Object.assign(new Error('boom'), { status: 500 });
  const failing = fakeClient({ upsertMemory: async () => { throw broken; } });
  await assert.rejects(remember(failing, { title: 'T', body: 'B', project: 'memory', tags: [] }), /boom/);
});

test('legacy fallback never revives a superseded or deprecated title — it creates a new active memory', async () => {
  let createCalled = false; let updateCalled = false; let listArgs;
  const client = fakeClient({
    listDocuments: async (...args) => { listArgs = args; return [{ id: 'retired', title: 'T', status: 'superseded' }, { id: 'dep', title: 'T', status: 'deprecated' }]; },
    createMemory: async (doc) => { createCalled = true; return { id: doc.id, ...doc }; },
    updateMemory: async () => { updateCalled = true; return {}; },
  });
  const { action } = await remember(client, { title: 'T', body: 'fresh', project: 'memory', tags: [] });
  assert.equal(action, 'created');
  assert.equal(createCalled, true);
  assert.equal(updateCalled, false);
  assert.deepEqual(listArgs, ['memory', { status: 'active' }]);
});
