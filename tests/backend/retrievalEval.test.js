import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOCS, CASES, MEMORY_DOCS, BUDGET_CASES, DELTA_EVENTS, DELTA_CASES, DELTA_T0,
} from '../eval/fixtures.js';
import { runRetrievalEval, runBudgetEval, runDeltaEval } from '../eval/retrievalEval.js';

// The budget gate: the fill order (verified, cited-and-unchanged, recent),
// deterministic compaction, trust chips on every entry line and the budget
// itself, through the code behind `prax context --budget` in keyword mode.
test('budget gate: every budget case fills, compacts and labels as specified', async () => {
  const { results, passed, total } = await runBudgetEval(MEMORY_DOCS, BUDGET_CASES);
  const failures = results.filter((r) => !r.pass).map((r) => ({ name: r.name, problems: r.problems }));
  assert.deepEqual(failures, [], `budget regressions:\n${JSON.stringify(failures, null, 2)}`);
  assert.equal(passed, total);
});

// The delta gate: only memory changed in the window, classified correctly,
// verified changes first.
test('delta gate: every delta case returns exactly the changed memory', async () => {
  const { results, passed, total } = await runDeltaEval(MEMORY_DOCS, DELTA_EVENTS, DELTA_CASES, { t0: DELTA_T0 });
  const failures = results.filter((r) => !r.pass).map((r) => ({ name: r.name, problems: r.problems }));
  assert.deepEqual(failures, [], `delta regressions:\n${JSON.stringify(failures, null, 2)}`);
  assert.equal(passed, total);
});

// The retrieval-recall gate: every fixture query must retrieve exactly the docs
// it should (recall = 1.0) and none it shouldn't. A regression in FTS
// tokenization/ranking or the context pack's filters fails here — the same
// class of miss (e.g. a title-only term) this harness exists to catch.
test('retrieval recall gate: every fixture query retrieves its expected docs and no junk', async () => {
  const { results, recall, passed, total } = await runRetrievalEval(DOCS, CASES);
  const failures = results.filter((r) => !r.pass).map((r) => ({ name: r.name, query: r.query, missing: r.missing, unexpected: r.unexpected }));
  assert.deepEqual(failures, [], `retrieval regressions:\n${JSON.stringify(failures, null, 2)}`);
  assert.equal(recall, 1, `recall must be 1.0, got ${recall}`);
  assert.equal(passed, total);
});

test('the empty scratch doc never reaches a result set', async () => {
  const { results } = await runRetrievalEval(DOCS, CASES);
  for (const r of results) assert.ok(!r.retrieved.includes('empty-scratch'), `${r.name} leaked the empty doc`);
});
