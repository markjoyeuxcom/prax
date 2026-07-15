import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalTaskCreatePayload,
  taskMatchesCreatePayload,
} from '../../public/js/taskCreateOutcome.js';

const ID = '11111111-1111-4111-8111-111111111111';
const PROJECT = '99999999-9999-4999-8999-999999999999';
const payload = {
  id: ID,
  title: ' Capture me ',
  description: '',
  notes: '',
  priority: 'high',
  status: 'planned',
  project: PROJECT,
  dueDate: '2026-07-14',
  dueTime: '',
  recurrence: null,
  labels: ['@Waiting', 'waiting', 'ops'],
  sortOrder: 8,
};

test('canonicalTaskCreatePayload mirrors server create normalization', () => {
  assert.deepEqual(canonicalTaskCreatePayload(payload), {
    id: ID,
    title: 'Capture me',
    description: '',
    notes: '',
    priority: 'high',
    status: 'planned',
    project: PROJECT,
    dueDate: '2026-07-14',
    dueTime: null,
    recurrence: null,
    labels: ['waiting', 'ops'],
    sortOrder: 8,
  });
});

test('taskMatchesCreatePayload acknowledges only an exact observable create', () => {
  const task = {
    id: ID,
    title: 'Capture me',
    description: '',
    notes: '',
    priority: 'high',
    status: 'planned',
    projectId: PROJECT,
    dueDate: '2026-07-14',
    dueTime: null,
    recurrence: null,
    labels: ['waiting', 'ops'],
    sortOrder: 8,
  };
  assert.equal(taskMatchesCreatePayload(task, payload), true);
  assert.equal(taskMatchesCreatePayload({ ...task, projectId: 'other' }, payload), false);
  assert.equal(taskMatchesCreatePayload({ ...task, labels: ['ops', 'waiting'] }, payload), false);
  assert.equal(taskMatchesCreatePayload({ ...task, sortOrder: 9 }, payload), false);
  assert.equal(taskMatchesCreatePayload(null, payload), false);
});
