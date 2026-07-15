import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PERFORMANCE_APPROVAL,
  REQUIRED_PERFORMANCE_MEASUREMENTS,
  evaluatePerformanceBudget,
  validatePerformanceBudget,
} from '../../scripts/verify-performance-budget.mjs';
import { runPerformanceGate } from '../../scripts/run-performance-gate.mjs';

function report() {
  const group = { samplesMs: [10, 12, 15], minMs: 10, p50Ms: 12, p95Ms: 15, maxMs: 15 };
  return {
    format: 'prax.quality-performance', version: 1, activation: 'candidate-baseline-only',
    reference: {
      platform: 'linux', release: 'reference-release', architecture: 'arm64', node: 'v24.18.0', chromium: '149.0.1',
      cpuModel: 'Reference CPU', logicalCpuCount: 14, totalMemoryBytes: 16_000_000_000,
    },
    fixture: { profile: 'large' }, configuration: { samples: 3, warmups: 1 },
    http: Object.fromEntries(REQUIRED_PERFORMANCE_MEASUREMENTS.http.map((name) => [name, { ...group }])),
    browser: Object.fromEntries(REQUIRED_PERFORMANCE_MEASUREMENTS.browser.map((name) => [name, { ...group }])),
    resources: {
      databaseBytes: 100, nodeRssAfterBytes: 200, userCpuMicroseconds: 300, systemCpuMicroseconds: 400,
    },
  };
}

function budget(status = 'approved') {
  const thresholdGroup = { p50Ms: 20, p95Ms: 30 };
  return {
    format: 'prax.performance-budget', version: 1, status,
    title: 'Reference performance boundary', rationale: 'Human feedback boundary plus measured headroom.',
    approval: status === 'approved' ? {
      approvedBy: 'product-owner', approvedAt: '2026-07-14T16:00:00Z', statement: PERFORMANCE_APPROVAL,
    } : null,
    reference: {
      profile: 'large', samples: 3, warmups: 1, platform: 'linux', release: 'reference-release', architecture: 'arm64',
      cpuModel: 'Reference CPU', minimumLogicalCpuCount: 14, minimumTotalMemoryBytes: 16_000_000_000,
      nodeMajor: 24, chromiumMajor: 149,
    },
    harness: { command: 'npm run measure:performance -- --output report.json' },
    thresholds: {
      http: Object.fromEntries(REQUIRED_PERFORMANCE_MEASUREMENTS.http.map((name) => [name, { ...thresholdGroup }])),
      browser: Object.fromEntries(REQUIRED_PERFORMANCE_MEASUREMENTS.browser.map((name) => [name, { ...thresholdGroup }])),
      resources: { databaseBytes: 200, nodeRssAfterBytes: 400, userCpuMicroseconds: 600, systemCpuMicroseconds: 800 },
    },
  };
}

test('proposed budgets validate as proposals but cannot activate a report gate', () => {
  assert.equal(validatePerformanceBudget(budget('proposed'), { requireApproved: false }), true);
  assert.throws(() => validatePerformanceBudget(budget('proposed')), /not human-approved/);
  assert.deepEqual(evaluatePerformanceBudget(report(), budget('proposed'), { requireApproved: false }), {
    passed: true, gateActive: false, budgetStatus: 'proposed', failures: [],
  });
});

test('approved compatible reports pass every declared latency and resource boundary', () => {
  assert.deepEqual(evaluatePerformanceBudget(report(), budget()), {
    passed: true, gateActive: true, budgetStatus: 'approved', failures: [],
  });
});

test('budget evaluation reports threshold and reference mismatches without averaging them away', () => {
  const slow = report();
  slow.browser['editor-completion'].p95Ms = 31;
  slow.browser['editor-completion'].maxMs = 31;
  slow.resources.nodeRssAfterBytes = 401;
  slow.reference.cpuModel = 'Different CPU';
  const result = evaluatePerformanceBudget(slow, budget());
  assert.equal(result.passed, false);
  assert.match(result.failures.join('\n'), /reference.cpuModel/);
  assert.match(result.failures.join('\n'), /editor-completion.p95Ms/);
  assert.match(result.failures.join('\n'), /nodeRssAfterBytes/);
});

test('approval cannot be inferred from status or generated prose', () => {
  const invalid = budget();
  invalid.approval.statement = 'Automatically approved';
  assert.throws(() => validatePerformanceBudget(invalid), /approval statement/);
  const malformed = budget('proposed');
  malformed.approval = { approvedBy: 'bot' };
  assert.throws(() => validatePerformanceBudget(malformed, { requireApproved: false }), /null approval/);
});

test('live gate derives measurement configuration from the approved manifest', async () => {
  const approved = budget();
  let received;
  const outcome = await runPerformanceGate({
    budget: approved,
    measure: async (configuration) => { received = configuration; return report(); },
  });
  assert.deepEqual(received, { profile: 'large', samples: 3, warmups: 1 });
  assert.equal(outcome.result.passed, true);
  assert.equal(outcome.result.gateActive, true);
});
