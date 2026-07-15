import test from 'node:test';
import assert from 'node:assert/strict';

import {
  runMatchesStartIntent,
  runMatchesStatusIntent,
  runMatchesStepIntent,
} from '../../public/js/runOutcome.js';

const run = {
  id: 'run-1',
  documentId: 'doc-1',
  title: 'Incident',
  status: 'running',
  steps: [
    { id: 'step-1', checkedAt: '2026-07-13T10:00:00.000Z' },
    { id: 'step-2', checkedAt: null },
  ],
};

test('run intent matchers compare only canonical observable state', () => {
  assert.equal(runMatchesStartIntent(run, { id: 'run-1', documentId: 'doc-1', title: 'Incident' }), true);
  assert.equal(runMatchesStartIntent(run, { id: 'run-1', documentId: 'other', title: 'Incident' }), false);
  assert.equal(runMatchesStepIntent(run, 'step-1', true), true);
  assert.equal(runMatchesStepIntent(run, 'step-2', false), true);
  assert.equal(runMatchesStepIntent(run, 'missing', false), false);
  assert.equal(runMatchesStatusIntent(run, 'running'), true);
  assert.equal(runMatchesStatusIntent(run, 'completed'), false);
});
