import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/index.js';
import { loadConfig } from '../../server/config.js';

// The engine-swap acceptance net (docs/desktop/checklist.md Phase 2): a real
// Fastify app over a real in-memory SQLite database — real migrations, real
// repositories, real routes — driven through the HTTP API. The fake-db unit
// tests assert SQL text; this file proves the SQL actually runs.

const config = loadConfig({ PRAX_DB_FILE: ':memory:', EMBEDDING_BACKEND: 'none' });
const app = await buildApp({ config });

const homelab = async () => {
  const res = await app.inject({ method: 'GET', url: '/api/projects' });
  return res.json().find(p => p.slug === 'homelab');
};

test('readyz reports ready against the embedded database', async () => {
  const res = await app.inject({ method: 'GET', url: '/readyz' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().status, 'ready');
});

test('projects: seeds exist, create/update/archive/delete work', async () => {
  const list = await app.inject({ method: 'GET', url: '/api/projects' });
  assert.equal(list.statusCode, 200);
  assert.deepEqual(list.json().map(p => p.slug).sort(), ['homelab', 'inbox', 'personal', 'work']);

  const created = await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Skunkworks' } });
  assert.equal(created.statusCode, 201);
  const project = created.json();
  assert.match(project.id, /^[0-9a-f-]{36}$/);
  assert.equal(project.slug, 'skunkworks');

  const patched = await app.inject({ method: 'PATCH', url: `/api/projects/${project.id}`, payload: { status: 'on-hold' } });
  assert.equal(patched.statusCode, 200);
  assert.equal(patched.json().status, 'on-hold');

  const deleted = await app.inject({ method: 'DELETE', url: `/api/projects/${project.id}/permanent` });
  assert.equal(deleted.statusCode, 200);
});

let taskA;
let taskB;

test('tasks: create, list filters, update, activity', async () => {
  const proj = await homelab();

  const createA = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: { title: 'Swap NAS drive', priority: 'high', status: 'planned', project: 'homelab', dueDate: '2026-07-10' },
  });
  assert.equal(createA.statusCode, 201);
  taskA = createA.json();
  assert.equal(taskA.projectId, proj.id);
  assert.equal(taskA.dueDate, '2026-07-10');

  const createB = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: { title: 'Rotate TLS certs', priority: 'medium', status: 'in-progress', project: 'homelab' },
  });
  taskB = createB.json();

  const byProject = await app.inject({ method: 'GET', url: '/api/tasks?project=homelab' });
  assert.equal(byProject.json().length, 2);

  const byStatus = await app.inject({ method: 'GET', url: '/api/tasks?project=homelab&status=in-progress' });
  assert.deepEqual(byStatus.json().map(t => t.title), ['Rotate TLS certs']);

  const byQuery = await app.inject({ method: 'GET', url: '/api/tasks?q=nas' });
  assert.deepEqual(byQuery.json().map(t => t.title), ['Swap NAS drive']);

  const updated = await app.inject({ method: 'PATCH', url: `/api/tasks/${taskA.id}`, payload: { status: 'completed' } });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.json().status, 'completed');

  const activity = await app.inject({ method: 'GET', url: `/api/tasks/${taskA.id}/activity` });
  const messages = activity.json().map(a => a.message);
  assert.ok(messages.includes('Task created'), `activity: ${messages}`);
  assert.ok(messages.some(m => /Status/.test(m)), `status event missing: ${messages}`);
});

test('tasks: reorder persists status + sortOrder in one call', async () => {
  const res = await app.inject({
    method: 'PATCH',
    url: '/api/tasks/reorder',
    payload: {
      tasks: [
        { id: taskA.id, status: 'planned', sortOrder: 1 },
        { id: taskB.id, status: 'planned', sortOrder: 0 },
      ],
    },
  });
  assert.equal(res.statusCode, 200);
  const list = await app.inject({ method: 'GET', url: '/api/tasks?project=homelab' });
  const ordered = list.json().filter(t => t.status === 'planned').sort((a, b) => a.sortOrder - b.sortOrder);
  assert.deepEqual(ordered.map(t => t.title), ['Rotate TLS certs', 'Swap NAS drive']);
});

test('checklist: add, toggle, list, delete', async () => {
  const add = await app.inject({ method: 'POST', url: `/api/tasks/${taskA.id}/checklist`, payload: { label: 'Verify snapshot' } });
  assert.equal(add.statusCode, 201);
  const item = add.json();
  assert.equal(item.completed, false);

  const toggle = await app.inject({ method: 'PATCH', url: `/api/tasks/${taskA.id}/checklist/${item.id}`, payload: { completed: true } });
  assert.equal(toggle.statusCode, 200);
  assert.equal(toggle.json().completed, true);

  const list = await app.inject({ method: 'GET', url: `/api/tasks/${taskA.id}/checklist` });
  assert.equal(list.json().length, 1);
  assert.equal(list.json()[0].completed, true);

  const del = await app.inject({ method: 'DELETE', url: `/api/tasks/${taskA.id}/checklist/${item.id}` });
  assert.equal(del.statusCode, 204);
});

let docSource;
let docDerived;

test('library: create with tags, FTS search, filters', async () => {
  const create = await app.inject({
    method: 'POST',
    url: '/api/library/documents',
    payload: {
      title: 'Postgres restore runbook',
      body: '# Restore\n\nPromote the replica behind PgBouncer.',
      documentType: 'runbook',
      project: 'homelab',
      tags: ['postgres', 'dr'],
    },
  });
  assert.equal(create.statusCode, 201);
  docSource = create.json();
  assert.deepEqual(docSource.tags, ['postgres', 'dr']);
  assert.equal(docSource.verified, true); // human-authored default
  assert.ok(docSource.contentHash);

  const agentDoc = await app.inject({
    method: 'POST',
    url: '/api/library/documents',
    payload: {
      title: 'Synthesized recovery summary',
      body: 'When the primary dies, promote the replica.',
      documentType: 'note',
      project: 'homelab',
      tags: ['dr'],
      kind: 'synthesized',
    },
    headers: { 'x-prax-origin': 'agent' },
  });
  assert.equal(agentDoc.statusCode, 201);
  docDerived = agentDoc.json();
  assert.equal(docDerived.verified, false); // agent-authored starts unverified
  assert.equal(docDerived.kind, 'synthesized');

  // FTS5 full-text: body word hits
  const hit = await app.inject({ method: 'GET', url: '/api/library/documents?q=pgbouncer' });
  assert.deepEqual(hit.json().map(d => d.title), ['Postgres restore runbook']);

  // miss
  const miss = await app.inject({ method: 'GET', url: '/api/library/documents?q=kubernetes' });
  assert.equal(miss.json().length, 0);

  // FTS injection-ish input must not 500
  const weird = await app.inject({ method: 'GET', url: `/api/library/documents?q=${encodeURIComponent('post"; drop table--')}` });
  assert.equal(weird.statusCode, 200);

  const typed = await app.inject({ method: 'GET', url: '/api/library/documents?documentType=runbook&project=homelab' });
  assert.ok(typed.json().every(d => d.documentType === 'runbook'));

  const byKind = await app.inject({ method: 'GET', url: '/api/library/documents?kind=synthesized' });
  assert.deepEqual(byKind.json().map(d => d.id), [docDerived.id]);
});

test('library: query-scoped context-pack gathers relevant docs (semantic off → keyword fallback)', async () => {
  // Markdown by default — includes the matching verified runbook.
  const md = await app.inject({ method: 'GET', url: '/api/library/context-pack?q=pgbouncer' });
  assert.equal(md.statusCode, 200);
  assert.match(md.headers['content-type'], /markdown/);
  assert.match(md.body, /Postgres restore runbook/);

  // format=json returns the structured pack object.
  const json = await app.inject({ method: 'GET', url: '/api/library/context-pack?q=pgbouncer&format=json' });
  assert.equal(json.statusCode, 200);
  assert.equal(typeof json.json(), 'object');

  // q is required; an unknown project is a 400.
  assert.equal((await app.inject({ method: 'GET', url: '/api/library/context-pack' })).statusCode, 400);
  assert.equal((await app.inject({ method: 'GET', url: '/api/library/context-pack?q=x&project=no-such-project' })).statusCode, 400);
});

test('library: links, stale detection, orphans, maintenance', async () => {
  const link = await app.inject({
    method: 'POST',
    url: `/api/library/documents/${docDerived.id}/links`,
    payload: { targetId: docSource.id, relation: 'derived-from' },
  });
  assert.equal(link.statusCode, 201);

  const links = await app.inject({ method: 'GET', url: `/api/library/documents/${docDerived.id}/links?direction=both` });
  const outbound = links.json().filter(l => l.direction === 'outbound');
  assert.equal(outbound.length, 1);
  assert.equal(outbound[0].relation, 'derived-from');

  // Not stale yet
  const staleNone = await app.inject({ method: 'GET', url: '/api/library/maintenance/stale' });
  assert.equal(staleNone.json().length, 0);

  // Edit the source: derived doc goes stale (hash mismatch)
  const edit = await app.inject({
    method: 'PATCH',
    url: `/api/library/documents/${docSource.id}`,
    payload: { body: '# Restore\n\nCompletely rewritten procedure.' },
  });
  assert.equal(edit.statusCode, 200);

  const stale = await app.inject({ method: 'GET', url: '/api/library/maintenance/stale' });
  assert.equal(stale.json().length, 1);
  assert.equal(stale.json()[0].documentId, docDerived.id);
  assert.equal(stale.json()[0].staleSources[0].documentId, docSource.id);

  // Stale flag also rides document listings
  const listed = await app.inject({ method: 'GET', url: '/api/library/documents?kind=synthesized' });
  assert.equal(listed.json()[0].stale, true);

  const orphans = await app.inject({ method: 'GET', url: '/api/library/maintenance/orphans' });
  assert.ok(Array.isArray(orphans.json()));
});

test('library: verify and supersede round-trip', async () => {
  const verify = await app.inject({
    method: 'POST',
    url: `/api/library/documents/${docDerived.id}/verify`,
    payload: { verified: true, as: 'user' },
  });
  assert.equal(verify.statusCode, 200);
  assert.equal(verify.json().verified, true);
  assert.equal(verify.json().verifiedBy, 'user');

  const replacement = await app.inject({
    method: 'POST',
    url: '/api/library/documents',
    payload: { title: 'Recovery v2', body: 'New summary', documentType: 'note', project: 'homelab' },
  });
  const supersede = await app.inject({
    method: 'POST',
    url: `/api/library/documents/${docDerived.id}/supersede`,
    payload: { supersededBy: replacement.json().id },
  });
  assert.equal(supersede.statusCode, 200);
  assert.equal(supersede.json().status, 'superseded');

  // Unlinking the superseding doc reverts the orphaned superseded doc
  const unlink = await app.inject({
    method: 'DELETE',
    url: `/api/library/documents/${replacement.json().id}/links/${docDerived.id}?relation=supersedes`,
  });
  assert.equal(unlink.statusCode, 200);
  const after = await app.inject({ method: 'GET', url: `/api/library/documents/${docDerived.id}` });
  assert.equal(after.json().status, 'active');
});

test('task↔document links and board extras aggregate', async () => {
  const link = await app.inject({
    method: 'POST',
    url: `/api/tasks/${taskA.id}/documents`,
    payload: { documentId: docSource.id },
  });
  assert.ok([200, 201].includes(link.statusCode));

  const docs = await app.inject({ method: 'GET', url: `/api/tasks/${taskA.id}/documents` });
  assert.deepEqual(docs.json().map(d => d.id), [docSource.id]);

  await app.inject({ method: 'POST', url: `/api/tasks/${taskA.id}/checklist`, payload: { label: 'step one' } });
  const extras = await app.inject({ method: 'GET', url: `/api/tasks/board-extras?ids=${taskA.id},${taskB.id}` });
  assert.equal(extras.statusCode, 200);
  const forA = extras.json().find(e => e.taskId === taskA.id);
  assert.equal(forA.docsCount, 1);
  assert.equal(forA.checklistTotal, 1);
  assert.equal(forA.nextChecklistItem, 'step one');
  assert.ok(forA.latestActivity.length > 0);

  const unlink = await app.inject({ method: 'DELETE', url: `/api/tasks/${taskA.id}/documents/${docSource.id}` });
  assert.equal(unlink.statusCode, 200);
});

test('tasks: export envelope, import skip-dedup, replace mode', async () => {
  const exported = await app.inject({ method: 'GET', url: '/api/tasks/export?project=homelab' });
  assert.equal(exported.statusCode, 200);
  assert.equal(exported.json().format, 'moomora.tasks');
  assert.equal(exported.json().version, 1);
  assert.ok(exported.json().tasks.length >= 2);

  // skip mode dedups on [title, project, status, dueDate]
  const dupe = await app.inject({
    method: 'POST',
    url: '/api/tasks/import',
    payload: { project: 'homelab', tasks: [{ title: 'Swap NAS drive', status: 'planned', dueDate: '2026-07-10' }] },
  });
  assert.equal(dupe.json().skipped, 1);

  const replace = await app.inject({
    method: 'POST',
    url: '/api/tasks/import',
    payload: { project: 'homelab', mode: 'replace', tasks: [{ title: 'Only survivor' }] },
  });
  assert.equal(replace.statusCode, 201);
  const after = await app.inject({ method: 'GET', url: '/api/tasks?project=homelab&archived=all' });
  assert.deepEqual(after.json().map(t => t.title), ['Only survivor']);
});

test('tasks: archive → restore → permanent delete lifecycle', async () => {
  const created = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: { title: 'Ephemeral', priority: 'low', status: 'planned', project: 'homelab' },
  });
  const id = created.json().id;

  const archived = await app.inject({ method: 'DELETE', url: `/api/tasks/${id}` });
  assert.equal(archived.statusCode, 200);
  assert.ok(archived.json().archivedAt);

  const restored = await app.inject({ method: 'PATCH', url: `/api/tasks/${id}/restore` });
  assert.equal(restored.statusCode, 200);
  assert.equal(restored.json().archivedAt, null);

  await app.inject({ method: 'DELETE', url: `/api/tasks/${id}` });
  const gone = await app.inject({ method: 'DELETE', url: `/api/tasks/${id}/permanent` });
  assert.equal(gone.statusCode, 200);
});

test('projects: deleting a project with dependents returns 409', async () => {
  const proj = await homelab();
  const res = await app.inject({ method: 'DELETE', url: `/api/projects/${proj.id}/permanent` });
  assert.equal(res.statusCode, 409);
});

test('library export: single .md front-matter and zip archive', async () => {
  const single = await app.inject({ method: 'GET', url: `/api/library/documents/${docSource.id}/export` });
  assert.equal(single.statusCode, 200);
  assert.match(single.headers['content-type'], /text\/markdown/);
  assert.match(single.body, /^---\ntitle: Postgres restore runbook\n/);
  assert.match(single.body, /project: homelab/);

  const zip = await app.inject({ method: 'GET', url: '/api/library/export?project=all' });
  assert.equal(zip.statusCode, 200);
  assert.match(zip.headers['content-type'], /application\/zip/);
});

test('semantic search degrades honestly with no backend', async () => {
  const status = await app.inject({ method: 'GET', url: '/api/settings/semantic-search' });
  assert.equal(status.json().available, false);

  const search = await app.inject({ method: 'GET', url: '/api/library/documents/semantic-search?q=restore' });
  assert.equal(search.statusCode, 409);

  const reindex = await app.inject({ method: 'POST', url: '/api/library/embeddings/reindex' });
  assert.equal(reindex.statusCode, 409);
});

test('context pack renders markdown from the keyword fallback', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/projects/homelab/context-pack' });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/markdown/);
});

test('semantic search: runtime provider config + reindex + JS-cosine ranking (fake backend)', async () => {
  // Invalid provider config never persists.
  const bad = await app.inject({ method: 'PUT', url: '/api/settings/semantic-search', payload: { backend: 'quantum' } });
  assert.equal(bad.statusCode, 400);
  const badUrl = await app.inject({ method: 'PUT', url: '/api/settings/semantic-search', payload: { backend: 'ollama', ollamaUrl: 'not a url' } });
  assert.equal(badUrl.statusCode, 400);
  assert.equal((await app.inject({ method: 'GET', url: '/api/settings/semantic-search' })).json().available, false);

  // Enable the deterministic fake backend at runtime — no restart, no env.
  const put = await app.inject({ method: 'PUT', url: '/api/settings/semantic-search', payload: { backend: 'fake', enabled: true } });
  assert.equal(put.statusCode, 200);
  const status = put.json();
  assert.equal(status.available, true);
  assert.equal(status.enabled, true);
  assert.equal(status.backend, 'fake');
  assert.equal(status.connected, true);
  assert.equal(status.hasApiKey, false);
  assert.equal(typeof status.model, 'string');
  assert.equal(typeof status.baseUrl, 'string');
  assert.equal(status.keyRequired, false);
  assert.equal(typeof status.ollamaUrl, 'string');
  assert.equal(typeof status.openaiBaseUrl, 'string');

  const created = await app.inject({
    method: 'POST',
    url: '/api/library/documents',
    payload: { title: 'Backup drill', body: 'Quarterly restore rehearsal for the NAS.', documentType: 'note', project: 'homelab' },
  });
  assert.equal(created.statusCode, 201);
  const target = created.json();

  // Reindex embeds every active doc (idempotent with the write-path embed).
  const reindex = await app.inject({ method: 'POST', url: '/api/library/embeddings/reindex' });
  assert.equal(reindex.statusCode, 200);
  assert.equal(reindex.json().failed, 0);

  const counts = (await app.inject({ method: 'GET', url: '/api/settings/semantic-search' })).json();
  assert.ok(counts.totalCount >= 4, `expected the flow's docs, got ${counts.totalCount}`);
  assert.equal(counts.embeddedCount, counts.totalCount);

  // The fake embedder is deterministic (text -> fixed vector), so a query of
  // the exact embedded text (title\n\nbody) makes the doc its own top hit.
  const q = encodeURIComponent('Backup drill\n\nQuarterly restore rehearsal for the NAS.');
  const search = await app.inject({ method: 'GET', url: `/api/library/documents/semantic-search?q=${q}` });
  assert.equal(search.statusCode, 200);
  const refs = search.json();
  assert.ok(refs.length >= 1, 'expected at least the exact-match doc');
  assert.equal(refs[0].id, target.id);
  assert.ok('snippet' in refs[0]);
  for (const ref of refs) {
    // The raw embedding vector must never leak…
    assert.ok(!('embedding' in ref));
    // …but the real cosine similarity is now surfaced (0..1) so the UI can
    // show "why it matched" honestly.
    assert.ok('similarity' in ref, 'semantic results expose a similarity score');
    assert.equal(typeof ref.similarity, 'number');
    assert.ok(ref.similarity >= 0 && ref.similarity <= 1, `similarity in [0,1], got ${ref.similarity}`);
  }
  // The exact-text match is its own top hit at ~1.0 similarity.
  assert.ok(refs[0].similarity >= 0.99, `exact match should score ~1, got ${refs[0].similarity}`);

  // Project scoping still applies on the JS-cosine path.
  const scoped = await app.inject({ method: 'GET', url: `/api/library/documents/semantic-search?q=${q}&project=personal` });
  assert.equal(scoped.statusCode, 200);
  assert.equal(scoped.json().length, 0);

  // Context pack rides the same semantic branch when given a query.
  const pack = await app.inject({ method: 'GET', url: `/api/projects/homelab/context-pack?query=${q}&format=json` });
  assert.equal(pack.statusCode, 200);
  assert.ok(pack.json().sections.some((s) => s.items.some((i) => i.id === target.id)));

  // Disable -> the gate slams shut again (honest degradation).
  const off = await app.inject({ method: 'PUT', url: '/api/settings/semantic-search', payload: { enabled: false } });
  assert.equal(off.json().enabled, false);
  assert.equal((await app.inject({ method: 'GET', url: `/api/library/documents/semantic-search?q=${q}` })).statusCode, 409);

  // Back to backend none -> unavailable everywhere, like the shipped default.
  const none = await app.inject({ method: 'PUT', url: '/api/settings/semantic-search', payload: { backend: 'none' } });
  assert.equal(none.statusCode, 200);
  assert.equal(none.json().available, false);
  assert.equal((await app.inject({ method: 'POST', url: '/api/library/embeddings/reindex' })).statusCode, 409);
});

test('teardown', async () => {
  await app.close();
});
