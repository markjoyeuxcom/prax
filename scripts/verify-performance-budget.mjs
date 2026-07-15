#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validatePerformanceReport } from './measure-quality-performance.js';

export const PERFORMANCE_BUDGET_FORMAT = 'prax.performance-budget';
export const PERFORMANCE_BUDGET_VERSION = 1;
export const PERFORMANCE_APPROVAL = 'I approve these thresholds as the Prax reference-hardware excellence boundary.';

export const REQUIRED_PERFORMANCE_MEASUREMENTS = Object.freeze({
  http: ['projects', 'tasks-all', 'tasks-search', 'library-all', 'document-detail'],
  browser: [
    'shell-feedback', 'task-collection-completion', 'quick-capture-feedback',
    'library-completion', 'editor-completion',
  ],
  resources: ['databaseBytes', 'nodeRssAfterBytes', 'userCpuMicroseconds', 'systemCpuMicroseconds'],
});

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim() || /^<.*>$/.test(value.trim())) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function finitePositive(value, label, { allowZero = false, integer = false } = {}) {
  if (!Number.isFinite(value) || value < (allowZero ? 0 : Number.EPSILON) || (integer && !Number.isInteger(value))) {
    throw new Error(`${label} must be a ${allowZero ? 'non-negative' : 'positive'}${integer ? ' integer' : ' number'}`);
  }
  return value;
}

function isoDate(value, label) {
  const text = requiredString(value, label);
  if (!Number.isFinite(Date.parse(text))) throw new Error(`${label} must be an ISO date/time`);
  return text;
}

function major(value) {
  const match = String(value || '').match(/^(?:v)?(\d+)/);
  return match ? Number(match[1]) : null;
}

function validateThresholdGroup(group, label) {
  finitePositive(group?.p50Ms, `${label}.p50Ms`);
  finitePositive(group?.p95Ms, `${label}.p95Ms`);
  if (group.p50Ms > group.p95Ms) throw new Error(`${label} p50 cannot exceed p95`);
}

export function validatePerformanceBudget(budget, { requireApproved = true } = {}) {
  if (budget?.format !== PERFORMANCE_BUDGET_FORMAT || budget?.version !== PERFORMANCE_BUDGET_VERSION) {
    throw new Error('performance budget format/version is invalid');
  }
  if (!['proposed', 'approved', 'retired'].includes(budget.status)) throw new Error('performance budget status is invalid');
  requiredString(budget.title, 'title');
  requiredString(budget.rationale, 'rationale');
  if (requireApproved && budget.status !== 'approved') throw new Error('performance budget is not human-approved');
  if (budget.status === 'approved') {
    requiredString(budget.approval?.approvedBy, 'approval.approvedBy');
    isoDate(budget.approval?.approvedAt, 'approval.approvedAt');
    if (budget.approval?.statement !== PERFORMANCE_APPROVAL) throw new Error('performance approval statement is invalid');
  } else if (budget.approval !== null) {
    throw new Error('non-approved performance budgets must have a null approval');
  }
  const reference = budget.reference;
  requiredString(reference?.profile, 'reference.profile');
  finitePositive(reference?.samples, 'reference.samples', { integer: true });
  finitePositive(reference?.warmups, 'reference.warmups', { allowZero: true, integer: true });
  requiredString(reference?.platform, 'reference.platform');
  requiredString(reference?.release, 'reference.release');
  requiredString(reference?.architecture, 'reference.architecture');
  requiredString(reference?.cpuModel, 'reference.cpuModel');
  finitePositive(reference?.minimumLogicalCpuCount, 'reference.minimumLogicalCpuCount', { integer: true });
  finitePositive(reference?.minimumTotalMemoryBytes, 'reference.minimumTotalMemoryBytes', { integer: true });
  finitePositive(reference?.nodeMajor, 'reference.nodeMajor', { integer: true });
  finitePositive(reference?.chromiumMajor, 'reference.chromiumMajor', { integer: true });
  requiredString(budget.harness?.command, 'harness.command');
  for (const section of ['http', 'browser']) {
    for (const name of REQUIRED_PERFORMANCE_MEASUREMENTS[section]) {
      validateThresholdGroup(budget.thresholds?.[section]?.[name], `thresholds.${section}.${name}`);
    }
  }
  for (const name of REQUIRED_PERFORMANCE_MEASUREMENTS.resources) {
    finitePositive(budget.thresholds?.resources?.[name], `thresholds.resources.${name}`);
  }
  return true;
}

function compatibilityFailures(report, budget) {
  const expected = budget.reference;
  const actual = report.reference || {};
  const failures = [];
  const checks = [
    ['fixture.profile', report.fixture?.profile, expected.profile],
    ['configuration.samples', report.configuration?.samples, expected.samples],
    ['configuration.warmups', report.configuration?.warmups, expected.warmups],
    ['reference.platform', actual.platform, expected.platform],
    ['reference.release', actual.release, expected.release],
    ['reference.architecture', actual.architecture, expected.architecture],
    ['reference.cpuModel', actual.cpuModel, expected.cpuModel],
    ['reference.nodeMajor', major(actual.node), expected.nodeMajor],
    ['reference.chromiumMajor', major(actual.chromium), expected.chromiumMajor],
  ];
  for (const [label, value, required] of checks) {
    if (value !== required) failures.push(`${label}: expected ${required}, received ${value}`);
  }
  if (actual.logicalCpuCount < expected.minimumLogicalCpuCount) {
    failures.push(`reference.logicalCpuCount: expected at least ${expected.minimumLogicalCpuCount}, received ${actual.logicalCpuCount}`);
  }
  if (actual.totalMemoryBytes < expected.minimumTotalMemoryBytes) {
    failures.push(`reference.totalMemoryBytes: expected at least ${expected.minimumTotalMemoryBytes}, received ${actual.totalMemoryBytes}`);
  }
  return failures;
}

export function evaluatePerformanceBudget(report, budget, { requireApproved = true } = {}) {
  validatePerformanceReport(report);
  validatePerformanceBudget(budget, { requireApproved });
  const failures = compatibilityFailures(report, budget);
  for (const section of ['http', 'browser']) {
    for (const name of REQUIRED_PERFORMANCE_MEASUREMENTS[section]) {
      const measurement = report[section]?.[name];
      if (!measurement) {
        failures.push(`${section}.${name}: measurement missing`);
        continue;
      }
      for (const percentile of ['p50Ms', 'p95Ms']) {
        const limit = budget.thresholds[section][name][percentile];
        if (measurement[percentile] > limit) {
          failures.push(`${section}.${name}.${percentile}: ${measurement[percentile]} exceeds ${limit}`);
        }
      }
    }
  }
  for (const name of REQUIRED_PERFORMANCE_MEASUREMENTS.resources) {
    const value = report.resources?.[name];
    const limit = budget.thresholds.resources[name];
    if (!Number.isFinite(value)) failures.push(`resources.${name}: measurement missing`);
    else if (value > limit) failures.push(`resources.${name}: ${value} exceeds ${limit}`);
  }
  return {
    passed: failures.length === 0,
    gateActive: budget.status === 'approved',
    budgetStatus: budget.status,
    failures,
  };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--validate-proposal') options.validateProposal = true;
    else if (arg === '--budget' || arg === '--report') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a file`);
      options[arg.slice(2)] = resolve(value);
      index += 1;
    } else throw new Error(`Unknown performance budget option: ${arg}`);
  }
  return options;
}

const HELP = `Usage:
  npm run verify:performance-budget -- --budget <budget.json> --validate-proposal
  npm run verify:performance-budget -- --budget <approved.json> --report <report.json>

Proposal validation checks shape only and never activates a gate. Report evaluation requires an
explicitly human-approved budget and exact reference-hardware compatibility.
`;

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return process.stdout.write(HELP);
  if (!options.budget) throw new Error('--budget is required');
  const budget = JSON.parse(readFileSync(options.budget, 'utf8'));
  if (options.validateProposal) {
    validatePerformanceBudget(budget, { requireApproved: false });
    return process.stdout.write(`${JSON.stringify({ valid: true, gateActive: false, status: budget.status }, null, 2)}\n`);
  }
  if (!options.report) throw new Error('--report is required unless --validate-proposal is used');
  const report = JSON.parse(readFileSync(options.report, 'utf8'));
  const result = evaluatePerformanceBudget(report, budget);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.passed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
