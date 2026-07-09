#!/usr/bin/env node
// Retrieval-recall report. Runs the fixture queries through the real keyword
// retrieval + context-pack pipeline and prints a per-case pass/fail table with
// an overall recall score. Exits non-zero if any case fails, so it doubles as a
// CI check and a local "did my retrieval change break recall?" tool.
//
//   npm run eval
import { DOCS, CASES } from '../tests/eval/fixtures.js';
import { runRetrievalEval } from '../tests/eval/retrievalEval.js';

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

if (passed !== total) process.exit(1);
