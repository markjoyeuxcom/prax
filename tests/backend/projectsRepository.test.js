import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeProjectRow,
  buildListProjects,
  buildCreateProject,
  buildUpdateProject,
  buildArchiveProject,
  buildCountProjectDependents,
  buildDeleteProject,
  createProjectsRepository,
} from '../../server/projectsRepository.js';

test('normalizeProjectRow maps snake_case to camelCase', () => {
  const row = {
    id: 'p1', name: 'Work', slug: 'work', status: 'active',
    sort_order: 1, created_at: 'c', updated_at: 'u',
  };
  assert.deepEqual(normalizeProjectRow(row), {
    id: 'p1', name: 'Work', slug: 'work', status: 'active',
    sortOrder: 1, createdAt: 'c', updatedAt: 'u',
  });
});

test('buildListProjects filters by status when provided', () => {
  const all = buildListProjects();
  assert.match(all.text, /from projects/);
  assert.equal(all.values.length, 0);

  const active = buildListProjects('active');
  assert.match(active.text, /where status = \$1/);
  assert.deepEqual(active.values, ['active']);
});

test('buildCreateProject inserts name, slug, status and a unique trailing sort_order', () => {
  const q = buildCreateProject({ name: 'Work', slug: 'work', status: 'active' });
  assert.match(q.text, /insert into projects/);
  // New projects land at the end with a distinct sort_order so reorder swaps work.
  assert.match(q.text, /coalesce\(max\(sort_order\), -1\) \+ 1/);
  assert.deepEqual(q.values, ['Work', 'work', 'active']);
});

test('buildUpdateProject sets only provided fields', () => {
  const q = buildUpdateProject('p1', { name: 'Renamed', status: 'on-hold' });
  assert.match(q.text, /name = \$2/);
  assert.match(q.text, /status = \$3/);
  assert.deepEqual(q.values, ['p1', 'Renamed', 'on-hold']);
});

test('buildCountProjectDependents counts tasks + documents', () => {
  const q = buildCountProjectDependents('p1');
  assert.match(q.text, /from tasks/);
  assert.match(q.text, /from markdown_documents/);
  assert.deepEqual(q.values, ['p1']);
});

test('buildArchiveProject sets status archived', () => {
  const q = buildArchiveProject('p1');
  assert.match(q.text, /set status = 'archived'/);
  assert.deepEqual(q.values, ['p1']);
});

test('buildDeleteProject deletes by id', () => {
  const q = buildDeleteProject('p1');
  assert.match(q.text, /delete from projects/);
  assert.deepEqual(q.values, ['p1']);
});

test('createProject re-derives and retries on a slug unique-violation', async () => {
  let inserts = 0;
  const db = {
    async query(text) {
      if (/select slug from projects/.test(text)) return { rows: [{ slug: 'work' }] };
      inserts += 1;
      if (inserts === 1) {
        const err = new Error('duplicate key');
        err.code = '23505';
        throw err;
      }
      return {
        rows: [{
          id: 'p9', name: 'Work', slug: 'work-2', status: 'active',
          sort_order: 0, created_at: 'c', updated_at: 'u',
        }],
      };
    },
  };
  const repo = createProjectsRepository(db);
  const project = await repo.createProject({ name: 'Work' });
  assert.equal(project.slug, 'work-2');
  assert.equal(inserts, 2);
});
