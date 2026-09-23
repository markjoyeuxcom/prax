#!/usr/bin/env node
// Retrieval-recall report. Runs the fixture queries through the real keyword
// retrieval + context-pack pipeline and prints a per-case pass/fail table with
// an overall recall score, then the budgeted-context and since-last-session
// delta cases (keyword mode; no embedder needed). Exits non-zero if any case
// fails, so it doubles as a CI check and a local "did my retrieval change
// break recall?" tool.
//
//   npm run eval
import {
  DOCS, CASES, MEMORY_DOCS, BUDGET_CASES, DELTA_EVENTS, DELTA_CASES, DELTA_T0,
} from '../tests/eval/fixtures.js';
import { runRetrievalEval, runBudgetEval, runDeltaEval } from '../tests/eval/retrievalEval.js';

function pct(n) { return `${(n * 100).toFixed(0)}%`; }

const { results, recall, passed, total } = await runRetrievalEval(DOCS, CASES);

console.log('\nRetrieval recall eval (keyword + context pack)\n');
for (const r of results) {
  const mark = r.pass ? '✓' : '✗';
  console.log(`  ${mark} ${r.name}`);
  console.log(`      query: "${r.query}"`);
  console.log(`      retrieved: [${r.retrieved.join(', ') || '—'}]`);
  if (r.missing.length) console.log(`      MISSING:    ${r.missing.join(', ')}`);
  if (r.unexpected.length) console.log(`      UNEXPECTED: ${r.unexpected.join(', ')}`);
}
console.log(`\n  ${passed}/${total} cases passed · recall ${pct(recall)}\n`);

const budget = await runBudgetEval(MEMORY_DOCS, BUDGET_CASES);
console.log('Budgeted context eval (keyword mode · fill: verified → cited-unchanged → recent · chars/4)\n');
for (const r of budget.results) {
  console.log(`  ${r.pass ? '✓' : '✗'} ${r.name}`);
  console.log(`      query: "${r.query}" · budget ${r.budget} · used ~${r.used}`);
  console.log(`      filled: ${r.order.map((key) => `${key}(${r.forms[key]})`).join(' > ')}`);
  for (const problem of r.problems) console.log(`      PROBLEM: ${problem}`);
}
console.log(`\n  ${budget.passed}/${budget.total} budget cases passed\n`);

const delta = await runDeltaEval(MEMORY_DOCS, DELTA_EVENTS, DELTA_CASES, { t0: DELTA_T0 });
console.log('Since-last-session delta eval (keyword mode)\n');
for (const r of delta.results) {
  console.log(`  ${r.pass ? '✓' : '✗'} ${r.name}`);
  console.log(`      since: ${r.since}`);
  console.log(`      changed: [${r.ordered.join(', ') || '—'}]`);
  for (const problem of r.problems) console.log(`      PROBLEM: ${problem}`);
}
console.log(`\n  ${delta.passed}/${delta.total} delta cases passed\n`);

if (passed !== total || budget.passed !== budget.total || delta.passed !== delta.total) process.exit(1);
