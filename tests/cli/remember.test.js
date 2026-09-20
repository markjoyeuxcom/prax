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

// --- cross-project resolution ---------------------------------------------------
//
// Recall searches every project; upsert-by-title is scoped to one. An agent that
// recalls a homelab runbook and re-remembers it without --project used to get a
// second copy in `memory` — split-brain, both looking current. With crossProject
// (the skill's default when no project was chosen) the write goes where the
// title already lives.

import { AmbiguousTitleError } from '../../cli/lib/remember.js';

const library = (...docs) => async (project, opts) => {
  assert.equal(project, undefined, 'the cross-project lookup lists EVERY project');
  assert.deepEqual(opts, { status: 'active' });
  return docs;
};

test('crossProject: a same-title document that lives only in another project is updated THERE, tags merged', async () => {
  let updated; let upserted = false;
  const client = fakeClient({
    listDocuments: library({ id: 'h1', title: 'Agy permissions', projectId: 'p-home', projectSlug: 'homelab', tags: ['agy', 'permissions'], status: 'active' }),
    updateMemory: async (id, patch) => { updated = { id, patch }; return { id, ...patch, projectSlug: 'homelab' }; },
    upsertMemory: async () => { upserted = true; return { document: { id: 'dup' }, created: true }; },
  });
  const result = await remember(client, { title: 'Agy permissions', body: 'refined', project: 'memory', tags: ['memory'], kind: 'synthesized', crossProject: true });
  assert.equal(result.action, 'updated');
  assert.equal(result.project, 'homelab', 'the caller learns where the write landed');
  assert.equal(result.crossProject, true);
  assert.equal(result.doc.id, 'h1');
  assert.equal(upserted, false, 'no duplicate is created in memory');
  assert.equal(updated.id, 'h1');
  assert.equal(updated.patch.body, 'refined');
  assert.deepEqual(updated.patch.tags, ['agy', 'permissions', 'memory'], 'stored tags survive; the caller\'s are added');
  assert.equal('title' in updated.patch, false, 'a cross-project refine never retitles');
  assert.equal('documentType' in updated.patch, false, 'no --type: the stored type is kept');
});

test('crossProject: when the target project already has the title, the ordinary project-scoped upsert runs', async () => {
  let sent; let updateCalled = false;
  const client = fakeClient({
    listDocuments: library(
      { id: 'm1', title: 'T', projectSlug: 'memory', status: 'active' },
      { id: 'h1', title: 'T', projectSlug: 'homelab', status: 'active' },
    ),
    updateMemory: async () => { updateCalled = true; return {}; },
    upsertMemory: async (doc) => { sent = doc; return { document: { id: 'm1' }, created: false }; },
  });
  const result = await remember(client, { title: 'T', body: 'B', project: 'memory', tags: [], crossProject: true });
  assert.equal(result.action, 'updated');
  assert.equal(result.project, 'memory');
  assert.equal(sent.project, 'memory');
  assert.equal(updateCalled, false);
});

test('crossProject: a title that exists in several OTHER projects is refused, naming them', async () => {
  const client = fakeClient({
    listDocuments: library(
      { id: 'h1', title: 'T', projectSlug: 'homelab', status: 'active' },
      { id: 'w1', title: 'T', projectSlug: 'work', status: 'active' },
    ),
    upsertMemory: async () => { throw new Error('must not reach the upsert'); },
  });
  await assert.rejects(
    remember(client, { title: 'T', body: 'B', project: 'memory', tags: [], crossProject: true }),
    (err) => err instanceof AmbiguousTitleError && /homelab:h1/.test(err.message) && /work:w1/.test(err.message) && /--project <slug> or --id <uuid>/.test(err.message),
  );
});

test('crossProject: no match anywhere creates in the target project as before', async () => {
  let sent;
  const client = fakeClient({
    listDocuments: library({ id: 'x', title: 'Other', projectSlug: 'homelab', status: 'active' }),
    upsertMemory: async (doc) => { sent = doc; return { document: { id: doc.id }, created: true }; },
  });
  const result = await remember(client, { title: 'T', body: 'B', project: 'memory', tags: ['memory'], crossProject: true });
  assert.equal(result.action, 'created');
  assert.equal(result.project, 'memory');
  assert.equal(sent.project, 'memory');
});

test('crossProject: a retired same-title document elsewhere is not revived', async () => {
  let sent; let updateCalled = false;
  const client = fakeClient({
    listDocuments: library({ id: 'old', title: 'T', projectSlug: 'homelab', status: 'superseded' }),
    updateMemory: async () => { updateCalled = true; return {}; },
    upsertMemory: async (doc) => { sent = doc; return { document: { id: doc.id }, created: true }; },
  });
  const result = await remember(client, { title: 'T', body: 'B', project: 'memory', tags: [], crossProject: true });
  assert.equal(result.action, 'created');
  assert.equal(updateCalled, false);
  assert.equal(sent.project, 'memory');
});

test('crossProject: an older listing resolves project IDs and updates the original instead of duplicating it', async () => {
  let sent; let updateCalled = false;
  const client = fakeClient({
    listDocuments: library({ id: 'h1', title: 'T', projectId: 'p-home', status: 'active' }), // no projectSlug
    listProjects: async () => [{ id: 'p-home', slug: 'homelab' }],
    updateMemory: async () => { updateCalled = true; return {}; },
    upsertMemory: async (doc) => { sent = doc; return { document: { id: doc.id }, created: true }; },
  });
  await remember(client, { title: 'T', body: 'B', project: 'memory', tags: [], crossProject: true });
  assert.equal(updateCalled, true);
  assert.equal(sent, undefined, 'do not create a second title in memory');
});

test('crossProject: an unresolved owner is explicit and never creates a duplicate', async () => {
  let created = false;
  const client = fakeClient({
    listDocuments: library({ id: 'h1', title: 'T', projectId: 'gone', status: 'active' }),
    listProjects: async () => [],
    upsertMemory: async () => { created = true; },
  });
  await assert.rejects(() => remember(client, { title: 'T', body: 'B', project: 'memory', crossProject: true }), /Cannot resolve the project/);
  assert.equal(created, false);
});

test('without crossProject the library is never listed (a chosen project means a chosen project)', async () => {
  let listed = false;
  const client = fakeClient({
    listDocuments: async () => { listed = true; return [{ id: 'h1', title: 'T', projectSlug: 'homelab', status: 'active' }]; },
    upsertMemory: async (doc) => ({ document: { id: doc.id }, created: true }),
  });
  const result = await remember(client, { title: 'T', body: 'B', project: 'memory', tags: [] });
  assert.equal(listed, false);
  assert.equal(result.project, 'memory');
});

// --- --id: target one document outright -----------------------------------------

test('id: updates that document wherever it lives, merges tags, and may retitle', async () => {
  let updated; let ensured = false; let listed = false;
  const client = fakeClient({
    ensureProject: async () => { ensured = true; return 'memory'; },
    listDocuments: async () => { listed = true; return []; },
    getDocument: async (id) => ({ id, title: 'Old title', projectSlug: 'homelab', tags: ['agy'] }),
    updateMemory: async (id, patch) => { updated = { id, patch }; return { id, ...patch, projectSlug: 'homelab' }; },
  });
  const result = await remember(client, { title: 'New title', body: 'B', project: 'memory', tags: ['memory'], type: 'runbook', id: 'h1', crossProject: true });
  assert.equal(result.action, 'updated');
  assert.equal(result.project, 'homelab');
  assert.equal(result.byId, true);
  assert.equal(updated.id, 'h1');
  assert.deepEqual(updated.patch, { title: 'New title', body: 'B', tags: ['agy', 'memory'], documentType: 'runbook' });
  assert.equal(ensured, false, 'no project is created for a direct target');
  assert.equal(listed, false, 'no title lookup for a direct target');
});

test('id: a missing document surfaces the server error rather than creating anything', async () => {
  const missing = Object.assign(new Error('document not found'), { status: 404 });
  let created = false;
  const client = fakeClient({
    getDocument: async () => { throw missing; },
    upsertMemory: async () => { created = true; return { document: { id: 'x' }, created: true }; },
  });
  await assert.rejects(remember(client, { title: 'T', body: 'B', project: 'memory', id: 'gone' }), /document not found/);
  assert.equal(created, false);
});
