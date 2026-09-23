import test from 'node:test';
import assert from 'node:assert/strict';

import { buildApp } from '../../server/index.js';
import { loadConfig } from '../../server/config.js';
import {
  canonicalPortableTask,
  comparePortableTaskSets,
  runPortableRoundTripDrill,
} from '../../scripts/verify-portable-round-trip.js';

test('portable canonical form keeps every accepted semantic and excludes runtime identity', () => {
  assert.deepEqual(canonicalPortableTask({
    id: 'runtime-id',
    title: 'Portable',
    description: '  exact description  ',
    notes: 'line one\nline two',
    priority: 'high',
    status: 'planned',
    projectId: 'runtime-project',
    dueDate: '2026-07-13',
    dueTime: '09:30',
    deferredUntil: '2026-07-14T12:00:00.000Z',
    recurrence: 'every:3d',
    labels: ['waiting'],
    sortOrder: 7,
    archivedAt: null,
    createdAt: 'runtime-created',
    updatedAt: 'runtime-updated',
    checklist: [{ id: 'runtime-item', label: 'Verify', completed: true, sortOrder: 3 }],
  }), {
    title: 'Portable',
    description: '  exact description  ',
    notes: 'line one\nline two',
    priority: 'high',
    status: 'planned',
    dueDate: '2026-07-13',
    dueTime: '09:30',
    deferredUntil: '2026-07-14T12:00:00.000Z',
    recurrence: 'every:3d',
    recurrenceAnchorDay: null,
    labels: ['waiting'],
    sortOrder: 7,
    archivedAt: null,
    checklist: [{ label: 'Verify', completed: true }],
  });
});

// The monthly anchor day (0037) is a portable semantic: a Feb 28 task anchored
// on the 31st must come back anchored on the 31st.
test('portable canonical form keeps a monthly anchor day and detects its loss', () => {
  const anchored = { title: 'Rent', recurrence: 'monthly', dueDate: '2026-02-28', recurrenceAnchorDay: 31 };
  assert.equal(canonicalPortableTask(anchored).recurrenceAnchorDay, 31);
  assert.throws(
    () => comparePortableTaskSets([anchored], [{ ...anchored, recurrenceAnchorDay: null }]),
    /Portable round-trip mismatch/,
  );
});

test('portable comparison is order-independent and diagnoses semantic drift', () => {
  const first = { title: 'A', description: 'one', priority: 'low', status: 'planned' };
  const second = { title: 'B', description: 'two', priority: 'high', status: 'completed' };
  assert.match(comparePortableTaskSets([first, second], [second, first]).digest, /^[a-f0-9]{64}$/);
  assert.throws(
    () => comparePortableTaskSets([first], [{ ...first, description: 'changed' }]),
    /Portable round-trip mismatch/,
  );
});

test('current CI mature workspace round-trips every declared task and checklist semantic', async () => {
  const report = await runPortableRoundTripDrill();
  assert.deepEqual(report, {
    format: 'prax.portable-round-trip',
    version: 1,
    fixture: {
      format: 'prax.quality-fixture',
      version: 1,
      profile: 'ci',
      clock: '2026-07-13T12:00:00.000Z',
      seed: 20260713,
    },
    taskCount: 200,
    checklistItemCount: 150,
    checklistStates: { completed: 50, open: 100 },
    archivedTaskCount: 12,
    targetProjectRemapped: true,
    taskIdsRegenerated: true,
    checklistIdsRegenerated: true,
    portableDigest: 'b0be390126e64e48f7f756c1392e3a12f5102304dc2b599ecec3b2ac813d125d',
  });
});

test('production replace import rolls back its deletion when checklist persistence fails', async () => {
  const app = await buildApp({
    config: loadConfig({ PRAX_DB_FILE: ':memory:', EMBEDDING_BACKEND: 'none' }),
  });
  try {
    const project = (await app.inject({
      method: 'POST', url: '/api/projects', payload: { name: 'Atomic import target' },
    })).json();
    const existing = (await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        title: 'Existing task must survive',
        priority: 'medium',
        status: 'planned',
        project: project.slug,
      },
    })).json();
    await app.db.query(`
      create trigger fail_portable_checklist
      before insert on task_checklist_items
      when new.label = 'INJECT PORTABLE FAILURE'
      begin
        select raise(abort, 'injected portable checklist failure');
      end
    `);

    const response = await app.inject({
      method: 'POST',
      url: '/api/tasks/import',
      payload: {
        requestId: '99999999-9999-4999-8999-999999999999',
        format: 'moomora.tasks',
        version: 1,
        project: project.slug,
        mode: 'replace',
        tasks: [{
          title: 'Replacement must roll back',
          checklist: [{ label: 'INJECT PORTABLE FAILURE', completed: true }],
        }],
      },
    });
    assert.equal(response.statusCode, 500);

    const operation = await app.db.query(
      "select count(*) as count from task_import_operations where id = '99999999-9999-4999-8999-999999999999'",
    );
    assert.equal(operation.rows[0].count, 0);

    const remaining = (await app.inject({
      method: 'GET', url: `/api/tasks?project=${encodeURIComponent(project.slug)}&archived=all`,
    })).json();
    assert.deepEqual(remaining.map((task) => task.id), [existing.id]);
  } finally {
    await app.db.query('drop trigger if exists fail_portable_checklist').catch(() => {});
    await app.close();
  }
});
