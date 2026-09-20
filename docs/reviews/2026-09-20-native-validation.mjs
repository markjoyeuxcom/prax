// Final browser checks + candidate performance comparison, run through Parley's
// reviewed host-command path. No production database or external account is used.
// Usage: node this-file.mjs <baseline-checkout> <output-directory> [--performance-only]
// Use the same measurement harness in both checkouts; application code differs.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repairedRoot = process.cwd();
const baselineRoot = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
mkdirSync(output, { recursive: true });
function run(cwd, args, label) {
  const result = spawnSync(process.execPath, args, {
    cwd, env: { ...process.env, CI: '1', PRAX_E2E_PORT: '3297', PUBLIC_DIR: join(cwd, 'public') },
    encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  });
  writeFileSync(join(output, `${label}.log`), `${result.stdout || ''}\n${result.stderr || ''}`);
  if (result.status !== 0) {
    console.error(result.stdout, result.stderr);
    throw result.error || new Error(`${label} exited with ${result.status ?? result.signal}`);
  }
  return result.stdout;
}
if (process.argv[4] !== '--performance-only') {
  console.log(run(repairedRoot, ['node_modules/@playwright/test/cli.js', 'test',
    'tests/e2e/review-repairs.spec.js', 'tests/e2e/review-queue-walk.spec.js', '--max-failures=1'], 'browser-regressions'));
}
for (const [label, root] of [['before', baselineRoot], ['after', repairedRoot]]) {
  const path = join(output, `browser-performance-${label}.json`);
  run(root, ['scripts/measure-quality-performance.js', '--profile', 'large', '--samples', '11', '--warmups', '3', '--output', path], `performance-${label}`);
  const report = JSON.parse(readFileSync(path, 'utf8'));
  console.log(JSON.stringify({ label, reference: report.reference, fixture: report.fixture,
    http: Object.fromEntries(Object.entries(report.http).map(([key, value]) => [key, { p50Ms: value.p50Ms, p95Ms: value.p95Ms }])),
    browser: Object.fromEntries(Object.entries(report.browser).map(([key, value]) => [key, { p50Ms: value.p50Ms, p95Ms: value.p95Ms }])),
    resources: report.resources }, null, 2));
}
