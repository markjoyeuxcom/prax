import test from 'node:test';
import assert from 'node:assert/strict';
import { exportFilename, tasksFromImportPayload } from '../../public/js/importExport.js';

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
