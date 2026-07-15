import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HUMAN_ATTESTATION,
  LANE_JOURNEYS,
  REQUIRED_MANUAL_MATRIX,
  validateManualActivationMatrix,
  validateManualActivationRecord,
} from '../../scripts/verify-manual-activation.mjs';

function recordFor(requirement, overrides = {}) {
  const lane = requirement.lane;
  const record = {
    format: 'prax.manual-activation',
    version: 1,
    candidate: { revision: 'abc123', artifactOrServer: 'Prax candidate abc123' },
    executedAt: '2026-07-14T15:00:00Z',
    operator: {
      nameOrHandle: 'human-reviewer', role: 'quality reviewer', human: true,
      independentOfImplementation: requirement.independentReviewer || false,
    },
    environment: {
      lane,
      platformFamily: requirement.platformFamily || 'macos',
      platformVersion: 'test platform 1',
      platformTarget: requirement.platformTarget,
      device: 'real test device',
      realHardware: lane === 'physical-touch',
      browserOrArtifact: 'candidate artifact',
      ...(requirement.assistiveTechnology ? {
        assistiveTechnology: { name: requirement.assistiveTechnology, version: '1' },
      } : {}),
    },
    journeys: LANE_JOURNEYS[lane].map((id) => ({ id, result: 'pass', notes: `${id} passed`, issues: [] })),
    attestation: {
      attestedBy: 'human-reviewer', attestedAt: '2026-07-14T16:00:00Z', statement: HUMAN_ATTESTATION,
    },
  };
  return { ...record, ...overrides };
}

test('complete human records validate without converting honest failures into passes', () => {
  const record = recordFor(REQUIRED_MANUAL_MATRIX[0]);
  assert.deepEqual(validateManualActivationRecord(record), {
    lane: 'screen-reader', passed: true, journeyCount: LANE_JOURNEYS['screen-reader'].length,
  });
  record.journeys[0] = { ...record.journeys[0], result: 'fail', notes: 'Location was not announced', issues: ['issue-101'] };
  assert.equal(validateManualActivationRecord(record).passed, false);
  assert.throws(() => validateManualActivationRecord(record, { requirePass: true }), /failed or blocked/);
});

test('manual records reject missing journeys, duplicate journeys, placeholders, and generated attestations', () => {
  const record = recordFor(REQUIRED_MANUAL_MATRIX[0]);
  assert.throws(() => validateManualActivationRecord({ ...record, journeys: record.journeys.slice(1) }), /missing required journeys/);
  assert.throws(() => validateManualActivationRecord({ ...record, journeys: [...record.journeys, record.journeys[0]] }), /unique/);
  assert.throws(() => validateManualActivationRecord({ ...record, operator: { ...record.operator, nameOrHandle: '<name>' } }), /completed by the human/);
  assert.throws(() => validateManualActivationRecord({ ...record, operator: { ...record.operator, human: false } }), /human must be true/);
  assert.throws(() => validateManualActivationRecord({ ...record, attestation: { ...record.attestation, statement: 'AI says this passed' } }), /attestation statement/);
});

test('failed and blocked journeys require issue evidence', () => {
  for (const result of ['fail', 'blocked']) {
    const record = recordFor(REQUIRED_MANUAL_MATRIX[0]);
    record.journeys[0] = { ...record.journeys[0], result, notes: `${result} observation`, issues: [] };
    assert.throws(() => validateManualActivationRecord(record), /must link an issue/);
  }
});

test('aggregate activation requires every declared real-platform lane', () => {
  const records = REQUIRED_MANUAL_MATRIX.map((requirement) => recordFor(requirement));
  assert.deepEqual(validateManualActivationMatrix(records), { recordCount: records.length, passed: true });
  assert.throws(() => validateManualActivationMatrix(records.slice(1)), /matrix is incomplete/);
  const emulated = recordFor(REQUIRED_MANUAL_MATRIX.find((item) => item.lane === 'physical-touch'));
  emulated.environment.realHardware = false;
  assert.throws(() => validateManualActivationRecord(emulated), /realHardware true/);
});
