import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parsePerformanceArgs,
  percentile,
  summarizeSamples,
  validatePerformanceReport,
} from '../../scripts/measure-quality-performance.js';

test('performance CLI defaults to the large fixture and keeps sampling explicit', () => {
  assert.deepEqual(parsePerformanceArgs([]), { profile: 'large', samples: 11, warmups: 3 });
  assert.deepEqual(parsePerformanceArgs([
    '--profile', 'ci', '--samples', '5', '--warmups', '0', '--keep', '--output', '/tmp/perf.json',
  ]), {
    profile: 'ci', samples: 5, warmups: 0, keepArtifacts: true, output: '/tmp/perf.json',
  });
  assert.throws(() => parsePerformanceArgs(['--samples', '0']), /positive integer/);
  assert.throws(() => parsePerformanceArgs(['--warmups', '-1']), /non-negative integer/);
  assert.throws(() => parsePerformanceArgs(['--profile', 'huge']), /Unknown quality fixture profile/);
  assert.throws(() => parsePerformanceArgs(['--wat']), /Unknown performance option/);
});

test('nearest-rank p50/p95 summaries preserve raw samples and ordered bounds', () => {
  assert.equal(percentile([10, 2, 9, 5, 7], 50), 7);
  assert.equal(percentile([10, 2, 9, 5, 7], 95), 10);
  assert.deepEqual(summarizeSamples([1.111, 4.444, 2.222]), {
    samplesMs: [1.11, 4.44, 2.22], minMs: 1.11, p50Ms: 2.22, p95Ms: 4.44, maxMs: 4.44,
  });
  assert.throws(() => percentile([], 50), /requires samples/);
  assert.throws(() => percentile([1, -1], 50), /non-negative/);
});

test('performance report validation rejects missing, malformed, and gate-looking evidence', () => {
  const group = { samplesMs: [1, 2, 3], minMs: 1, p50Ms: 2, p95Ms: 3, maxMs: 3 };
  const report = {
    format: 'prax.quality-performance',
    version: 1,
    activation: 'candidate-baseline-only',
    configuration: { samples: 3, warmups: 1 },
    http: { tasks: group },
    browser: { shell: group },
    resources: { databaseBytes: 10 },
  };
  assert.equal(validatePerformanceReport(report), true);
  assert.throws(() => validatePerformanceReport({ ...report, activation: 'active' }), /activation state/);
  assert.throws(() => validatePerformanceReport({ ...report, browser: {} }), /requires HTTP and browser/);
  assert.throws(() => validatePerformanceReport({ ...report, http: { tasks: { ...group, samplesMs: [1] } } }), /3 samples/);
});
