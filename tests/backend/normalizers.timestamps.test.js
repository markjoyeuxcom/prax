import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDocumentRow } from '../../server/libraryRepository.js';
import { normalizeTaskRow, normalizeActivityRow } from '../../server/tasksRepository.js';
import { normalizeProjectRow } from '../../server/projectsRepository.js';
import { normalizeChecklistRow } from '../../server/checklistRepository.js';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const D1 = new Date('2026-06-02T19:47:21.123Z');
const D2 = new Date('2026-06-02T20:00:00.000Z');

test('normalizeDocumentRow coerces Date timestamps to ISO strings', () => {
  const out = normalizeDocumentRow({
    id: 'id', title: 't', body: 'b', document_type: 'note',
    project_id: 'pid', tags: [], source_filename: null,
    archived_at: D1, created_at: D1, updated_at: D2,
    content_hash: 'h', updated_by: 'user', kind: 'source',
  });
  assert.match(out.archivedAt, ISO);
  assert.match(out.createdAt, ISO);
  assert.match(out.updatedAt, ISO);
  assert.equal(out.createdAt, '2026-06-02T19:47:21.123Z');
});

test('normalizeDocumentRow preserves null archived_at as null', () => {
  const out = normalizeDocumentRow({
    id: 'id', title: 't', body: 'b', document_type: 'note',
    project_id: 'pid', tags: [], source_filename: null,
    archived_at: null, created_at: D1, updated_at: D2,
    content_hash: 'h', updated_by: 'user', kind: 'source',
  });
  assert.equal(out.archivedAt, null);
});

test('normalizeDocumentRow leaves ISO-string timestamps unchanged', () => {
  const out = normalizeDocumentRow({
    id: 'id', title: 't', body: 'b', document_type: 'note',
    project_id: 'pid', tags: [], source_filename: null,
    archived_at: null,
    created_at: '2026-04-12T10:33:21.000Z',
    updated_at: '2026-05-20T08:11:09.000Z',
    content_hash: 'h', updated_by: 'user', kind: 'source',
  });
  assert.equal(out.createdAt, '2026-04-12T10:33:21.000Z');
  assert.equal(out.updatedAt, '2026-05-20T08:11:09.000Z');
});

test('normalizeTaskRow coerces Date timestamps to ISO strings', () => {
  const out = normalizeTaskRow({
    id: 'id', title: 't', description: 'd', notes: 'n',
    priority: 'medium', status: 'planned', project_id: 'pid',
    due_date: null, sort_order: 0,
    archived_at: D1, created_at: D1, updated_at: D2,
  });
  assert.match(out.archivedAt, ISO);
  assert.match(out.createdAt, ISO);
  assert.match(out.updatedAt, ISO);
});

test('normalizeTaskRow preserves null archived_at as null', () => {
  const out = normalizeTaskRow({
    id: 'id', title: 't', description: 'd', notes: 'n',
    priority: 'medium', status: 'planned', project_id: 'pid',
    due_date: null, sort_order: 0,
    archived_at: null, created_at: D1, updated_at: D2,
  });
  assert.equal(out.archivedAt, null);
});

test('normalizeActivityRow coerces Date created_at to ISO string', () => {
  const out = normalizeActivityRow({
    id: 'id', task_id: 'tid', event_type: 'created', message: 'msg',
    created_at: D1,
  });
  assert.match(out.createdAt, ISO);
  assert.equal(out.createdAt, '2026-06-02T19:47:21.123Z');
});

test('normalizeProjectRow coerces Date timestamps to ISO strings', () => {
  const out = normalizeProjectRow({
    id: 'id', name: 'Homelab', slug: 'homelab', status: 'active',
    sort_order: 0, created_at: D1, updated_at: D2,
  });
  assert.match(out.createdAt, ISO);
  assert.match(out.updatedAt, ISO);
});

test('normalizeChecklistRow coerces Date timestamps to ISO strings', () => {
  const out = normalizeChecklistRow({
    id: 'id', task_id: 'tid', label: 'do', completed: false,
    sort_order: 0, created_at: D1, updated_at: D2,
  });
  assert.match(out.createdAt, ISO);
  assert.match(out.updatedAt, ISO);
});
