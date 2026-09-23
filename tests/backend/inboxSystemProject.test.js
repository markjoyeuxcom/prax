import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDb } from '../../server/db.js';
import { runMigrations } from '../../server/migrate.js';
import { buildApp } from '../../server/index.js';
import { loadConfig } from '../../server/config.js';

const SILENT = { info() {}, error() {} };
const MIGRATION = '0032_restore_inbox_system_project.sql';
const config = loadConfig({ PRAX_DB_FILE: ':memory:', EMBEDDING_BACKEND: 'none' });

async function historical(t) {
  const db = createDb(':memory:');
  await runMigrations(db, { logger: SILENT, through: '0031' });
  const app = await buildApp({ db, config });
  t.after(() => app.close());
  return { db, app };
}

async function inject(app, method, url, payload, status = 200) {
  const response = await app.inject({ method, url, ...(payload ? { payload } : {}) });
  assert.equal(response.statusCode, status, response.body);
  return response.json();
}

async function upgrade(db) {
  assert.deepEqual((await runMigrations(db, { logger: SILENT })).applied, [MIGRATION, '0033_inbox_action_receipts.sql', '0034_record_creation_receipts.sql', '0035_single_line_document_titles.sql', '0036_add_task_activity_agent.sql', '0037_add_task_recurrence_anchor_day.sql', '0038_repair_legacy_cycles_and_receipts.sql', '0039_add_citation_anchors.sql', '0040_recall_telemetry_and_librarian.sql', '0041_add_agent_recall_markers.sql']);
  assert.deepEqual((await runMigrations(db, { logger: SILENT })).applied, []);
  assert.deepEqual((await db.query('pragma foreign_key_check')).rows, []);
  return (await db.query("select * from projects where slug = 'inbox'")).rows[0];
}

test('upgrade recreates deleted Inbox with a new ID and restores capture and weekly review', async (t) => {
  const { db, app } = await historical(t);
  const old = (await db.query("select id from projects where slug = 'inbox'")).rows[0];
  await db.query("delete from projects where slug = 'inbox'");
  const inbox = await upgrade(db);
  assert.notEqual(inbox.id, old.id, 'a permanently deleted ID is never reused');
  assert.equal(inbox.status, 'active');
  assert.equal(inbox.name, 'Inbox');
  assert.equal(inbox.sort_order, -1);
  const task = await inject(app, 'POST', '/api/tasks', {
    title: 'Captured after upgrade', project: 'inbox', priority: 'medium', status: 'planned',
  }, 201);
  assert.equal(task.projectId, inbox.id);
  const review = await inject(app, 'POST', '/api/library/weekly-review', { date: '2026-09-20' });
  assert.equal(review.created, true);
  const document = await inject(app, 'GET', `/api/library/documents/${review.documentId}`);
  assert.equal(document.projectId, inbox.id);
  assert.equal(document.verified, false);
  const replay = await inject(app, 'POST', '/api/library/weekly-review', { date: '2026-09-20' });
  assert.equal(replay.documentId, document.id);
});

test('upgrade preserves healthy Inbox byte-for-byte including timestamps', async (t) => {
  const { db } = await historical(t);
  const before = (await db.query("select * from projects where slug = 'inbox'")).rows[0];
  assert.deepEqual(await upgrade(db), before);
});

for (const status of ['on-hold', 'completed', 'archived']) {
  test(`upgrade adopts a recreated, renamed ${status} Inbox without changing content or links`, async (t) => {
    const { db, app } = await historical(t);
    await db.query("delete from projects where slug = 'inbox'");
    const id = randomUUID();
    await db.query("insert into projects (id, name, slug, status, sort_order, handoff_notes) values ($1, 'Triage', 'inbox', $2, 18, 'Keep these notes')", [id, status]);
    const task = await inject(app, 'POST', '/api/tasks', {
      title: 'Keep captured work', project: id, priority: 'medium', status: 'planned', notes: 'Unfinished work',
    }, 201);
    const document = await inject(app, 'POST', '/api/library/documents', {
      title: 'Keep note', project: id, documentType: 'note', body: 'Original note',
    }, 201);
    await db.query('insert into task_documents (task_id, document_id) values ($1, $2)', [task.id, document.id]);
    const beforeTask = await inject(app, 'GET', `/api/tasks/${task.id}`);
    const beforeDocument = await inject(app, 'GET', `/api/library/documents/${document.id}`);
    const inbox = await upgrade(db);
    assert.equal(inbox.id, id);
    assert.equal(inbox.name, 'Inbox');
    assert.equal(inbox.status, 'active');
    assert.equal(inbox.sort_order, -1);
    assert.equal(inbox.handoff_notes, 'Keep these notes');
    assert.deepEqual(await inject(app, 'GET', `/api/tasks/${task.id}`), beforeTask);
    assert.deepEqual(await inject(app, 'GET', `/api/library/documents/${document.id}`), beforeDocument);
    assert.equal((await db.query('select count(*) as n from task_documents where task_id = $1 and document_id = $2', [task.id, document.id])).rows[0].n, 1);
    assert.equal((await db.query("select count(*) as n from projects where slug = 'inbox'")).rows[0].n, 1);
  });
}

test('upgrade does not repurpose a different project holding the original Inbox ID', async (t) => {
  const { db } = await historical(t);
  await db.query("update projects set name = 'Keep me', slug = 'legacy-capture' where slug = 'inbox'");
  const before = (await db.query("select * from projects where slug = 'legacy-capture'")).rows[0];
  const inbox = await upgrade(db);
  assert.notEqual(inbox.id, before.id);
  assert.deepEqual((await db.query('select * from projects where id = $1', [before.id])).rows[0], before);
});

for (const slug of ['inbox', 'memory']) {
  test(`${slug} rejects project mutations while content can be edited and filed elsewhere`, async (t) => {
    const app = await buildApp({ config });
    t.after(() => app.close());
    const projects = await inject(app, 'GET', '/api/projects');
    const system = projects.find(p => p.slug === slug);
    const work = projects.find(p => p.slug === 'work');
    const task = await inject(app, 'POST', '/api/tasks', {
      title: 'To file', project: slug, priority: 'medium', status: 'planned',
    }, 201);
    const doc = await inject(app, 'POST', '/api/library/documents', {
      title: 'To file too', project: slug, documentType: 'note', body: 'Keep me',
    }, 201);
    for (const payload of [{ name: 'Changed' }, { status: 'on-hold' }, { status: 'completed' }, { status: 'archived' }, { sortOrder: 99 }, { repoUrl: 'repo' }, { onCall: 'A' }, { handoffNotes: 'B' }, { area: 'C' }]) {
      const rejected = await inject(app, 'PATCH', `/api/projects/${system.id}`, payload, 403);
      assert.match(rejected.message, new RegExp(slug, 'i'));
    }
    await inject(app, 'DELETE', `/api/projects/${system.id}`, null, 403);
    await inject(app, 'DELETE', `/api/projects/${system.id}/permanent`, null, 403);
    assert.equal((await inject(app, 'GET', `/api/tasks/${task.id}`)).title, 'To file');
    assert.equal((await inject(app, 'GET', `/api/library/documents/${doc.id}`)).body, 'Keep me');
    const movedTask = await inject(app, 'PATCH', `/api/tasks/${task.id}`, { project: 'work', title: 'Filed' });
    const movedDoc = await inject(app, 'PATCH', `/api/library/documents/${doc.id}`, { project: 'work', body: 'Filed reference' });
    assert.equal(movedTask.projectId, work.id);
    assert.equal(movedDoc.projectId, work.id);
    assert.deepEqual((await inject(app, 'GET', '/api/projects')).find(p => p.id === system.id), system);
  });
}
