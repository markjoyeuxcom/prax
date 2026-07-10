import test from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../../server/db.js';
import { runMigrations } from '../../server/migrate.js';
import { createDocumentExternalRefsRepository, sanitizeUrl, sanitizeLabel } from '../../server/documentExternalRefsRepository.js';
import { externalRefKind, isSafeHttpUrl, refsToLines, parseExternalRefLines } from '../../public/js/externalRefKind.js';

const SILENT = { info() {}, error() {} };

async function seed() {
  const db = createDb(':memory:');
  await runMigrations(db, { logger: SILENT });
  const project = (await db.query("select id from projects where slug='inbox'")).rows[0].id;
  await db.query(
    `insert into markdown_documents (id, title, body, document_type, project_id)
     values ('00000000-0000-4000-8000-0000000000d1', 'Decision', 'we chose X', 'decision', $1),
            ('00000000-0000-4000-8000-0000000000d2', 'Archived', 'old', 'note', $1)`,
    [project],
  );
  await db.query("update markdown_documents set archived_at = '2026-01-01T00:00:00Z' where id = '00000000-0000-4000-8000-0000000000d2'");
  return db;
}

// ---- pure helpers ----

test('externalRefKind derives github/gitlab/link from any URL spelling', () => {
  assert.equal(externalRefKind('https://github.com/org/repo/pull/42'), 'github');
  assert.equal(externalRefKind('git@github.com:org/repo.git'), 'github');
  assert.equal(externalRefKind('https://gitlab.example.com/g/p/-/issues/1'), 'gitlab');
  assert.equal(externalRefKind('https://grafana.internal/d/abc'), 'link');
  assert.equal(externalRefKind('not a url'), 'link');
});

test('isSafeHttpUrl only trusts http/https/mailto — javascript:/data:/scp are inert', () => {
  assert.equal(isSafeHttpUrl('https://github.com/o/r/pull/1'), true);
  assert.equal(isSafeHttpUrl('http://internal/dash'), true);
  assert.equal(isSafeHttpUrl('  HTTPS://Example.com  '), true); // trimmed + case-insensitive
  assert.equal(isSafeHttpUrl('mailto:on-call@example.com'), true);
  assert.equal(isSafeHttpUrl('javascript:alert(1)'), false);
  assert.equal(isSafeHttpUrl('JavaScript:alert(1)'), false);
  assert.equal(isSafeHttpUrl('data:text/html,<script>alert(1)</script>'), false);
  assert.equal(isSafeHttpUrl('git@github.com:org/repo.git'), false); // scp-like, not navigable
  assert.equal(isSafeHttpUrl(''), false);
  assert.equal(isSafeHttpUrl(null), false);
  assert.equal(isSafeHttpUrl(undefined), false);
});

// The separator is whitespace-then-pipe, so a bare `|` inside a URL (Grafana
// template-variable query strings) survives the textarea round-trip intact.
// Regression: splitting on the first bare `|` deleted and recreated a
// truncated ref on every Document-info save.
test('parseExternalRefLines round-trips pipe-bearing URLs unchanged', () => {
  const pipeUrl = 'https://grafana.internal/d/abc?var-node=a|b|c';
  assert.deepEqual(parseExternalRefLines(refsToLines([{ url: pipeUrl, label: null }])),
    [{ url: pipeUrl, label: null }]);
  assert.deepEqual(parseExternalRefLines(refsToLines([{ url: pipeUrl, label: 'Dash' }])),
    [{ url: pipeUrl, label: 'Dash' }]);
  // label containing a pipe: the FIRST whitespace-pipe is the separator
  assert.deepEqual(parseExternalRefLines('https://x.com/a | my | label'),
    [{ url: 'https://x.com/a', label: 'my | label' }]);
  // plain lines, blank lines, no-label lines
  assert.deepEqual(parseExternalRefLines('https://x.com/a\n\n  https://y.com/b | B  \n'),
    [{ url: 'https://x.com/a', label: null }, { url: 'https://y.com/b', label: 'B' }]);
  assert.deepEqual(parseExternalRefLines(null), []);
});

test('sanitizeUrl trims, rejects empty/oversized; sanitizeLabel trims to null', () => {
  assert.equal(sanitizeUrl('  https://x.com  '), 'https://x.com');
  assert.equal(sanitizeUrl(''), null);
  assert.equal(sanitizeUrl('x'.repeat(3000)), null);
  assert.equal(sanitizeLabel('  PR #42  '), 'PR #42');
  assert.equal(sanitizeLabel(''), null);
  assert.equal(sanitizeLabel(undefined), null);
});

// Regression: a stored newline in either field splits one textarea line into
// two on the next Document-info save, resurfacing as a phantom ref (the
// second line parses as a new URL). Control whitespace never survives.
test('sanitize strips newlines: URLs lose them, labels collapse to spaces', () => {
  assert.equal(sanitizeUrl('https://x.com/a\nb'), 'https://x.com/ab');
  assert.equal(sanitizeUrl('https://x.com/a\r\n\tb'), 'https://x.com/ab');
  assert.equal(sanitizeLabel('line1\nline2'), 'line1 line2');
  assert.equal(sanitizeLabel('a\r\n b\tc'), 'a b c');
});

// ---- repository against real SQLite ----

test('addExternalRef inserts, lists, and is idempotent (upsert updates the label)', async () => {
  const db = await seed();
  const repo = createDocumentExternalRefsRepository(db);
  const doc = '00000000-0000-4000-8000-0000000000d1';

  const first = await repo.addExternalRef(doc, 'https://github.com/org/repo/pull/42', 'The PR');
  assert.equal(first.alreadyExisted, false);
  assert.equal(first.ref.url, 'https://github.com/org/repo/pull/42');
  assert.equal(first.ref.label, 'The PR');

  // re-add same URL -> updates label, alreadyExisted true, no duplicate row
  const again = await repo.addExternalRef(doc, 'https://github.com/org/repo/pull/42', 'Renamed');
  assert.equal(again.alreadyExisted, true);
  const list = await repo.listExternalRefs(doc);
  assert.equal(list.length, 1);
  assert.equal(list[0].label, 'Renamed');

  await db.close();
});

test('addExternalRef refuses an archived or missing document', async () => {
  const db = await seed();
  const repo = createDocumentExternalRefsRepository(db);
  const archived = await repo.addExternalRef('00000000-0000-4000-8000-0000000000d2', 'https://x.com', null);
  assert.equal(archived.ref, null);
  const missing = await repo.addExternalRef('00000000-0000-4000-8000-00000000dead', 'https://x.com', null);
  assert.equal(missing.ref, null);
  await db.close();
});

test('removeExternalRef deletes by id scoped to the document; refs cascade on doc delete', async () => {
  const db = await seed();
  const repo = createDocumentExternalRefsRepository(db);
  const doc = '00000000-0000-4000-8000-0000000000d1';
  const { ref } = await repo.addExternalRef(doc, 'https://x.com/a', null);

  // wrong document id -> no delete
  assert.equal(await repo.removeExternalRef('00000000-0000-4000-8000-00000000beef', ref.id), false);
  assert.equal(await repo.removeExternalRef(doc, ref.id), true);
  assert.equal((await repo.listExternalRefs(doc)).length, 0);

  // cascade: deleting the document removes its refs
  await repo.addExternalRef(doc, 'https://x.com/b', null);
  await db.query('delete from markdown_documents where id = $1', [doc]);
  assert.equal((await repo.listExternalRefs(doc)).length, 0);
  await db.close();
});

test('listExternalRefsForDocuments returns a Map keyed by every requested id', async () => {
  const db = await seed();
  const repo = createDocumentExternalRefsRepository(db);
  const doc = '00000000-0000-4000-8000-0000000000d1';
  await repo.addExternalRef(doc, 'https://x.com/1', null);
  const map = await repo.listExternalRefsForDocuments([doc, '00000000-0000-4000-8000-0000000000d2']);
  assert.equal(map.get(doc).length, 1);
  assert.deepEqual(map.get('00000000-0000-4000-8000-0000000000d2'), []); // requested, no refs
  assert.deepEqual((await repo.listExternalRefsForDocuments([])) instanceof Map ? [...(await repo.listExternalRefsForDocuments([]))] : 'not-map', []);
  await db.close();
});

// ---- routes (real buildApp + real repo against in-memory SQLite) ----

test('external-refs routes: add (201), idempotent add (200), list, delete (404 after)', async () => {
  const { buildApp } = await import('../../server/index.js');
  const db = await seed();
  const app = await buildApp({ db, tasksRepository: { listTasks: async () => [] } });
  const doc = '00000000-0000-4000-8000-0000000000d1';

  const add = await app.inject({ method: 'POST', url: `/api/library/documents/${doc}/external-refs`, payload: { url: 'https://github.com/o/r/pull/1', label: 'PR 1' } });
  assert.equal(add.statusCode, 201);
  assert.equal(add.json().length, 1);
  assert.equal(add.json()[0].label, 'PR 1');
  const refId = add.json()[0].id;

  const dupe = await app.inject({ method: 'POST', url: `/api/library/documents/${doc}/external-refs`, payload: { url: 'https://github.com/o/r/pull/1' } });
  assert.equal(dupe.statusCode, 200); // already existed

  const list = await app.inject({ method: 'GET', url: `/api/library/documents/${doc}/external-refs` });
  assert.equal(list.json().length, 1);

  const del = await app.inject({ method: 'DELETE', url: `/api/library/documents/${doc}/external-refs/${refId}` });
  assert.equal(del.statusCode, 200);
  assert.equal(del.json().length, 0);

  const gone = await app.inject({ method: 'DELETE', url: `/api/library/documents/${doc}/external-refs/${refId}` });
  assert.equal(gone.statusCode, 404);

  await app.close();
});

test('external-refs routes reject bad input: empty url 400, non-uuid ids 400, archived doc 404', async () => {
  const { buildApp } = await import('../../server/index.js');
  const db = await seed();
  const app = await buildApp({ db, tasksRepository: { listTasks: async () => [] } });
  const doc = '00000000-0000-4000-8000-0000000000d1';

  assert.equal((await app.inject({ method: 'POST', url: `/api/library/documents/${doc}/external-refs`, payload: { url: '  ' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: `/api/library/documents/not-a-uuid/external-refs`, payload: { url: 'https://x.com' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: `/api/library/documents/00000000-0000-4000-8000-0000000000d2/external-refs`, payload: { url: 'https://x.com' } })).statusCode, 404); // archived
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/library/documents/${doc}/external-refs/not-a-uuid` })).statusCode, 400);

  await app.close();
});
