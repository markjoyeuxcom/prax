import test from 'node:test';
import assert from 'node:assert/strict';

import {
  documentMatchesLifecycle,
  lifecycleOutcomeMessage,
} from '../../public/js/documentLifecycleOutcome.js';

test('lifecycle readback accepts only the exact observable intent', () => {
  assert.equal(documentMatchesLifecycle({ verified: true }, { type: 'verify', verified: true }), true);
  assert.equal(documentMatchesLifecycle({ verified: false }, { type: 'verify', verified: true }), false);
  assert.equal(documentMatchesLifecycle({ status: 'superseded' }, { type: 'supersede' }), true);
  assert.equal(documentMatchesLifecycle({ status: 'active' }, { type: 'activate' }), true);
  assert.equal(documentMatchesLifecycle({ archivedAt: '2026-07-13T10:00:00.000Z' }, { type: 'archive' }), true);
  assert.equal(documentMatchesLifecycle({ archivedAt: null }, { type: 'restore' }), true);
  assert.equal(documentMatchesLifecycle(null, { type: 'delete' }), true);
  assert.equal(documentMatchesLifecycle({ id: 'still-here' }, { type: 'delete' }), false);
  assert.equal(documentMatchesLifecycle(null, { type: 'archive' }), false);
  assert.equal(documentMatchesLifecycle({}, { type: 'unknown' }), false);
});

test('ambiguous and partial lifecycle copy never claims a hard failure', () => {
  assert.match(lifecycleOutcomeMessage('Archive', 'unknown'), /could not confirm/i);
  assert.match(lifecycleOutcomeMessage('Archive', 'unknown'), /reload before retrying/i);
  assert.match(lifecycleOutcomeMessage('Archive', 'refresh-failed'), /completed/i);
  assert.match(lifecycleOutcomeMessage('Archive', 'refresh-failed'), /could not refresh/i);
  assert.match(lifecycleOutcomeMessage('Archive', 'reconciled'), /confirmed the result/i);
  assert.equal(lifecycleOutcomeMessage('Archive', 'committed'), null);
});
