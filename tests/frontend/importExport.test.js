import test from 'node:test';
import assert from 'node:assert/strict';
import {
  duplicateKeyForTask,
  exportFilename,
  normalizeImportMode,
  openTaskImportFilePicker,
  tasksFromImportPayload,
} from '../../public/js/importExport.js';

test('tasksFromImportPayload extracts tasks from an export envelope', () => {
  const tasks = tasksFromImportPayload({
    format: 'moomora.tasks',
    version: 1,
    tasks: [{ title: 'Restore drill' }],
  });

  assert.deepEqual(tasks, [{ title: 'Restore drill' }]);
});

test('tasksFromImportPayload accepts a raw task array', () => {
  const tasks = tasksFromImportPayload([{ title: 'Patch ingress' }]);

  assert.deepEqual(tasks, [{ title: 'Patch ingress' }]);
});

test('tasksFromImportPayload rejects legacy TaskBoard envelopes', () => {
  assert.throws(
    () => tasksFromImportPayload({
      format: 'taskboard.tasks',
      version: 1,
      tasks: [{ title: 'Old backup' }],
    }),
    /Moomora Console import file format is not supported/,
  );
});

test('tasksFromImportPayload rejects unsupported payloads', () => {
  assert.throws(
    () => tasksFromImportPayload({ items: [] }),
    /Moomora Console import file must contain a tasks array/,
  );
});

test('exportFilename builds a stable context filename', () => {
  const filename = exportFilename('home/lab', new Date('2026-05-18T18:30:00.000Z'));

  assert.equal(filename, 'moomora-console-home-lab-2026-05-18.json');
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

test('openTaskImportFilePicker opens the picker before handling the selected file', () => {
  const events = [];
  let changeHandler;
  const selectedFile = { name: 'tasks.json' };
  const input = {
    files: [],
    addEventListener(eventName, handler) {
      if (eventName === 'change') changeHandler = handler;
    },
    click() {
      events.push('click');
    },
  };
  const documentRef = {
    createElement(tagName) {
      assert.equal(tagName, 'input');
      return input;
    },
  };

  openTaskImportFilePicker({
    documentRef,
    handleFile(file) {
      events.push(`handle:${file.name}`);
    },
  });

  assert.deepEqual(events, ['click']);

  input.files = [selectedFile];
  changeHandler();

  assert.deepEqual(events, ['click', 'handle:tasks.json']);
  assert.equal(input.type, 'file');
  assert.equal(input.accept, 'application/json,.json');
});
