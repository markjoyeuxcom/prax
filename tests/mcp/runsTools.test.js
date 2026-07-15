import test from 'node:test';
import assert from 'node:assert/strict';
import { createRunTools } from '../../mcp/tools/runs.js';

const DOC_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const STEP_ID = '33333333-3333-4333-8333-333333333333';
const BAD_ID = 'not-a-uuid';

function byName(tools, name) {
  const tool = tools.find((t) => t.name === name);
  assert.ok(tool, `tool ${name} should exist`);
  return tool;
}
const data = (res) => JSON.parse(res.content[0].text);

test('exposes the runbook-run tools', () => {
  assert.deepEqual(
    createRunTools({}).map((t) => t.name).sort(),
    ['get_runbook_run', 'list_runbook_runs', 'set_run_status', 'set_run_step', 'start_runbook_run'],
  );
});

test('the read tools are annotated read-only; the write tools are not', () => {
  const tools = createRunTools({});
  for (const n of ['list_runbook_runs', 'get_runbook_run']) {
    assert.equal(byName(tools, n).annotations?.readOnlyHint, true, `${n} read-only`);
  }
  for (const n of ['start_runbook_run', 'set_run_step', 'set_run_status']) {
    assert.notEqual(byName(tools, n).annotations?.readOnlyHint, true, `${n} not read-only`);
  }
});

test('start_runbook_run snapshots steps and defaults the title to empty', async () => {
  const calls = [];
  const run = { id: RUN_ID, documentId: DOC_ID, status: 'running', steps: [{ id: STEP_ID, text: 'Stop writes', checkedAt: null }] };
  const client = { startRunbookRun: async (id, title, runId) => { calls.push([id, title, runId]); return run; } };
  const tool = byName(createRunTools(client), 'start_runbook_run');

  const res = await tool.handler({ documentId: DOC_ID, runId: RUN_ID });
  assert.deepEqual(calls[0], [DOC_ID, '', RUN_ID]); // title defaulted, stable id forwarded
  assert.equal(data(res).id, RUN_ID);

  await tool.handler({ documentId: DOC_ID, title: 'DR drill', runId: RUN_ID });
  assert.deepEqual(calls[1], [DOC_ID, 'DR drill', RUN_ID]);
  const invalidRunId = await tool.handler({ documentId: DOC_ID, runId: BAD_ID });
  assert.equal(invalidRunId.isError, true);
  assert.match(invalidRunId.content[0].text, /runId must be a valid UUID/);
});

test('start_runbook_run rejects a non-UUID document id before calling the API', async () => {
  let called = false;
  const client = { startRunbookRun: async () => { called = true; } };
  const res = await byName(createRunTools(client), 'start_runbook_run').handler({ documentId: BAD_ID });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /documentId must be a valid UUID/);
  assert.equal(called, false);
});

test('list_runbook_runs returns a paginated run list (and coerces non-arrays to [])', async () => {
  const runs = [{ id: RUN_ID, status: 'completed', stepCount: 3, doneCount: 3 }];
  const okTool = byName(createRunTools({ listRunbookRuns: async () => runs }), 'list_runbook_runs');
  const page = data(await okTool.handler({ documentId: DOC_ID }));
  assert.deepEqual(page.items, runs);
  assert.equal(page.page.total, 1);

  const nullTool = byName(createRunTools({ listRunbookRuns: async () => null }), 'list_runbook_runs');
  assert.deepEqual(data(await nullTool.handler({ documentId: DOC_ID })).items, []);
});

test('get_runbook_run returns the chronicle, and 404s become a friendly error', async () => {
  const run = { id: RUN_ID, status: 'completed', steps: [{ id: STEP_ID, text: 'A', checkedAt: '2026-07-08T10:00:00.000Z' }] };
  const found = byName(createRunTools({ getRunbookRun: async () => run }), 'get_runbook_run');
  assert.equal(data(await found.handler({ runId: RUN_ID })).steps[0].checkedAt, '2026-07-08T10:00:00.000Z');

  const missing = byName(createRunTools({ getRunbookRun: async () => null }), 'get_runbook_run');
  const res = await missing.handler({ runId: RUN_ID });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, new RegExp(`No run with id ${RUN_ID}`));
});

test('set_run_step validates both ids and forwards the checked flag', async () => {
  const calls = [];
  const client = { setRunStep: async (r, s, c) => { calls.push([r, s, c]); return { id: s, checkedAt: c ? 'now' : null }; } };
  const tool = byName(createRunTools(client), 'set_run_step');

  const ok = await tool.handler({ runId: RUN_ID, stepId: STEP_ID, checked: true });
  assert.deepEqual(calls[0], [RUN_ID, STEP_ID, true]);
  assert.equal(data(ok).checkedAt, 'now');

  const bad = await tool.handler({ runId: RUN_ID, stepId: BAD_ID, checked: true });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /must be valid UUIDs/);
});

test('set_run_step surfaces a 404 (unknown step) as an error', async () => {
  const tool = byName(createRunTools({ setRunStep: async () => null }), 'set_run_step');
  const res = await tool.handler({ runId: RUN_ID, stepId: STEP_ID, checked: false });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /No step/);
});

test('set_run_status forwards the status and 404s become an error', async () => {
  const calls = [];
  const client = { setRunStatus: async (r, s) => { calls.push([r, s]); return { id: r, status: s, finishedAt: 'now' }; } };
  const tool = byName(createRunTools(client), 'set_run_status');
  assert.equal(data(await tool.handler({ runId: RUN_ID, status: 'completed' })).status, 'completed');
  assert.deepEqual(calls[0], [RUN_ID, 'completed']);

  const missing = byName(createRunTools({ setRunStatus: async () => null }), 'set_run_status');
  const res = await missing.handler({ runId: RUN_ID, status: 'aborted' });
  assert.equal(res.isError, true);
});
