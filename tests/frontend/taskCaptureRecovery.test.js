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
  // Every write stamps this tab's owner token (multi-tab clear guard).
  const { owner, ...loaded } = loadTaskCaptureRecovery(storage);
  assert.equal(typeof owner, 'string');
  assert.ok(owner.length > 0);
  assert.deepEqual(loaded, recovery({
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

// ---- Multi-tab ownership guard ----------------------------------------------
// The key is shared across tabs. A tab that opens a fresh capture must not
// clobber a draft another tab is still typing — but the user explicitly
// discarding, or a confirmed-created payload, must clear regardless of owner.

function foreignDraft(overrides = {}) {
  // What another tab's storeTaskCaptureRecovery would persist: same schema,
  // its own owner token.
  return JSON.stringify({
    schemaVersion: 1,
    ...recovery(overrides),
    owner: 'some-other-tab',
    savedAt: new Date().toISOString(),
  });
}

test('clear skips a draft owned by another tab by default', () => {
  const storage = memoryStorage();
  storage.setItem(TASK_CAPTURE_RECOVERY_KEY, foreignDraft());
  assert.equal(clearTaskCaptureRecovery(storage), false);
  assert.equal(loadTaskCaptureRecovery(storage).query, 'Ship release');
  // ...and a load still reads it: recovery restore after reload is cross-tab.
  assert.equal(loadTaskCaptureRecovery(storage).owner, 'some-other-tab');
});

test('force clears a draft regardless of its owner', () => {
  const storage = memoryStorage();
  storage.setItem(TASK_CAPTURE_RECOVERY_KEY, foreignDraft());
  assert.equal(clearTaskCaptureRecovery(storage, { force: true }), true);
  assert.equal(loadTaskCaptureRecovery(storage), null);
});

test('clear removes this tab\'s own draft without force', () => {
  const storage = memoryStorage();
  storeTaskCaptureRecovery(storage, recovery());
  assert.equal(clearTaskCaptureRecovery(storage), true);
  assert.equal(loadTaskCaptureRecovery(storage), null);
});

test('clear still removes ownerless (legacy) and corrupt payloads by default', () => {
  const storage = memoryStorage();
  const { owner, ...legacy } = JSON.parse(foreignDraft());
  storage.setItem(TASK_CAPTURE_RECOVERY_KEY, JSON.stringify(legacy));
  assert.equal(clearTaskCaptureRecovery(storage), true);
  assert.equal(storage.getItem(TASK_CAPTURE_RECOVERY_KEY), null);
  storage.setItem(TASK_CAPTURE_RECOVERY_KEY, '{bad json');
  assert.equal(clearTaskCaptureRecovery(storage), true);
  assert.equal(storage.getItem(TASK_CAPTURE_RECOVERY_KEY), null);
});

test('store refuses to overwrite another tab\'s draft by default', () => {
  const storage = memoryStorage();
  storage.setItem(TASK_CAPTURE_RECOVERY_KEY, foreignDraft());
  // A crashed tab's pending recovery outranks casual typing here.
  assert.equal(storeTaskCaptureRecovery(storage, recovery({ query: 'Typing in tab B' })), false);
  const kept = loadTaskCaptureRecovery(storage);
  assert.equal(kept.query, 'Ship release');
  assert.equal(kept.owner, 'some-other-tab');
});

test('force store takes the slot and stamps this tab as owner', () => {
  const storage = memoryStorage();
  storage.setItem(TASK_CAPTURE_RECOVERY_KEY, foreignDraft());
  assert.equal(storeTaskCaptureRecovery(storage, recovery({ query: 'Adopted here' }), { force: true }), true);
  const adopted = loadTaskCaptureRecovery(storage);
  assert.equal(adopted.query, 'Adopted here');
  assert.notEqual(adopted.owner, 'some-other-tab');
});

test('adopting a restored draft (force re-stamp) makes it clearable by this tab', () => {
  const storage = memoryStorage();
  // The stored stamp predates this load (a reload mints a fresh owner token).
  storage.setItem(TASK_CAPTURE_RECOVERY_KEY, foreignDraft());
  // restoreCaptureRecovery adopts the draft into this tab with one force store.
  assert.equal(storeTaskCaptureRecovery(storage, recovery(), { force: true }), true);
  // The user empties the restored draft in one input event: the empty-draft
  // path routes through the OWNER-GUARDED clear, which now succeeds — before
  // the re-stamp it refused forever and the deleted draft resurrected.
  assert.equal(storeTaskCaptureRecovery(storage, recovery({ query: '' })), false);
  assert.equal(loadTaskCaptureRecovery(storage), null);
});

test('emptying an unrelated capture leaves another tab\'s draft in place', () => {
  const storage = memoryStorage();
  storage.setItem(TASK_CAPTURE_RECOVERY_KEY, foreignDraft());
  // An empty capture closed in this tab (Esc without restoring anything) must
  // not destroy the other tab's pending recovery.
  assert.equal(storeTaskCaptureRecovery(storage, recovery({ query: '' })), false);
  assert.equal(loadTaskCaptureRecovery(storage).query, 'Ship release');
});
