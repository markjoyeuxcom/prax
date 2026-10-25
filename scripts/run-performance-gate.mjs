#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { measureQualityPerformance } from './measure-quality-performance.js';
import { evaluatePerformanceBudget, validatePerformanceBudget } from './verify-performance-budget.mjs';

export const DEFAULT_PERFORMANCE_BUDGET = resolve(
  'scripts/performance/2026-07-14-linux-arm64-budget.json',
);

export async function runPerformanceGate({ budget, measure = measureQualityPerformance, output } = {}) {
  validatePerformanceBudget(budget);
  const report = await measure({
    profile: budget.reference.profile,
    samples: budget.reference.samples,
    warmups: budget.reference.warmups,
  });
  const result = evaluatePerformanceBudget(report, budget);
  if (output) writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return { result, report };
}

function parseArgs(argv) {
  const options = { budget: DEFAULT_PERFORMANCE_BUDGET };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--budget' || arg === '--output') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a file`);
      options[arg.slice(2)] = resolve(value);
      index += 1;
    } else throw new Error(`Unknown performance gate option: ${arg}`);
  }
  return options;
}

const HELP = `Usage:
  npm run gate:performance -- [--budget <approved.json>] [--output <raw-report.json>]

Runs a fresh measurement using the approved profile/sample configuration, requires the exact
declared reference environment, and fails when any p50/p95/resource boundary is exceeded.
`;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return process.stdout.write(HELP);
  const budget = JSON.parse(readFileSync(options.budget, 'utf8'));
  const { result, report } = await runPerformanceGate({ budget, output: options.output });
  process.stdout.write(`${JSON.stringify({
    ...result,
    generatedAt: report.generatedAt,
    reference: report.reference,
    reportOutput: options.output || null,
  }, null, 2)}\n`);
  if (!result.passed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
