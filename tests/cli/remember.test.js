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
