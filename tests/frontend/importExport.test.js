import test from 'node:test';
import assert from 'node:assert/strict';
import {
  duplicateKeyForTask,
  exportFilename,
  normalizeImportMode,
  tasksFromImportPayload,
} from '../../public/js/importExport.js';

test('tasksFromImportPayload extracts tasks from an export envelope', () => {
  const tasks = tasksFromImportPayload({
    format: 'taskboard.tasks',
    version: 1,
    tasks: [{ title: 'Restore drill' }],
  });

  assert.deepEqual(tasks, [{ title: 'Restore drill' }]);
});

test('tasksFromImportPayload accepts a raw task array', () => {
  const tasks = tasksFromImportPayload([{ title: 'Patch ingress' }]);

  assert.deepEqual(tasks, [{ title: 'Patch ingress' }]);
});

test('tasksFromImportPayload rejects unsupported payloads', () => {
  assert.throws(
    () => tasksFromImportPayload({ items: [] }),
    /TaskBoard import file must contain a tasks array/,
  );
});

test('exportFilename builds a stable context filename', () => {
  const filename = exportFilename('home/lab', new Date('2026-05-18T18:30:00.000Z'));

  assert.equal(filename, 'taskboard-home-lab-2026-05-18.json');
});

test('normalizeImportMode accepts known modes and defaults blank values to skip', () => {
  assert.equal(normalizeImportMode(''), 'skip');
  assert.equal(normalizeImportMode(' SKIP '), 'skip');
  assert.equal(normalizeImportMode('append'), 'append');
  assert.equal(normalizeImportMode('replace'), 'replace');
});

test('normalizeImportMode rejects unknown modes', () => {
  assert.throws(
    () => normalizeImportMode('merge'),
    /Import mode must be append, skip, or replace/,
  );
});

test('duplicateKeyForTask normalizes title context status and due date', () => {
  assert.equal(
    duplicateKeyForTask({
      title: '  Back up CNPG ',
      context: 'Homelab',
      status: 'Planned',
      dueDate: '2026-05-18',
    }),
    'back up cnpg\u001fhomelab\u001fplanned\u001f2026-05-18',
  );
});
