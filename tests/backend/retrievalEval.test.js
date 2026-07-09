import test from 'node:test';
import assert from 'node:assert/strict';
import { DOCS, CASES } from '../eval/fixtures.js';
import { runRetrievalEval } from '../eval/retrievalEval.js';

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
