import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TASK_CAPTURE_RECOVERY_KEY,
  captureIntentKey,
  clearTaskCaptureRecovery,
  loadTaskCaptureRecovery,
  storeTaskCaptureRecovery,
} from '../../public/js/taskCaptureRecovery.js';

const ID = '11111111-1111-4111-8111-111111111111';
const PROJECT = '99999999-9999-4999-8999-999999999999';

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function recovery(overrides = {}) {
  return {
    query: 'Ship release',
    projectId: PROJECT,
    dueDate: null,
    status: 'planned',
    nlFields: { priority: 'high', labels: ['@Waiting'] },
    nlDropped: [{ field: 'project', value: 'missing' }],
    nlRaw: 'ship release !high',
    requestPayload: null,
    requestIntent: null,
    ...overrides,
  };
}

test('capture recovery round-trips visible and parsed draft state', () => {
  const storage = memoryStorage();
  assert.equal(storeTaskCaptureRecovery(storage, recovery()), true);
  assert.deepEqual(loadTaskCaptureRecovery(storage), recovery({
    nlFields: { priority: 'high', labels: ['waiting'] },
  }));
});

test('capture recovery preserves a safe retry payload and intent', () => {
  const storage = memoryStorage();
  const intent = captureIntentKey({ query: 'Ship release', projectId: PROJECT, status: 'planned' });
  const requestPayload = {
    id: ID, title: 'Ship release', priority: 'medium', status: 'planned', project: PROJECT,
    labels: [], sortOrder: 3,
  };
  storeTaskCaptureRecovery(storage, recovery({ requestPayload, requestIntent: intent }));
  const loaded = loadTaskCaptureRecovery(storage);
  assert.equal(loaded.requestIntent, intent);
  assert.deepEqual(loaded.requestPayload, {
    id: ID,
    title: 'Ship release',
    description: '',
    notes: '',
    priority: 'medium',
    status: 'planned',
    project: PROJECT,
    dueDate: null,
    dueTime: null,
    recurrence: null,
    labels: [],
    sortOrder: 3,
  });
});

test('empty, malformed, and explicitly cleared capture recovery does not resurrect', () => {
  const storage = memoryStorage();
  assert.equal(storeTaskCaptureRecovery(storage, recovery({ query: '' })), false);
  assert.equal(loadTaskCaptureRecovery(storage), null);
  storage.setItem(TASK_CAPTURE_RECOVERY_KEY, '{bad json');
  assert.equal(loadTaskCaptureRecovery(storage), null);
  storeTaskCaptureRecovery(storage, recovery());
  assert.equal(clearTaskCaptureRecovery(storage), true);
  assert.equal(loadTaskCaptureRecovery(storage), null);
});
