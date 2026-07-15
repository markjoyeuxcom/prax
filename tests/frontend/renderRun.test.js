import test from 'node:test';
import assert from 'node:assert/strict';
import { renderRunHtml, buildChronicle } from '../../public/js/renderRun.js';

const NOW = new Date('2026-07-08T10:20:00.000Z');

function makeRun(overrides = {}) {
  return {
    id: 'run-1',
    documentId: 'doc-1',
    documentTitle: 'Failover runbook',
    title: 'DR drill',
    status: 'running',
    startedBy: 'user',
    startedAt: '2026-07-08T10:00:00.000Z',
    finishedAt: null,
    finishedBy: null,
    steps: [
      { id: 's1', position: 0, text: 'Stop writes', checkedAt: '2026-07-08T10:05:00.000Z', checkedBy: 'user' },
      { id: 's2', position: 1, text: 'Promote replica', checkedAt: null, checkedBy: null },
    ],
    events: [
      { id: 'e1', sequence: 0, type: 'started', actor: 'user', createdAt: '2026-07-08T10:00:00.000Z' },
      { id: 'e2', sequence: 1, type: 'step-checked', stepText: 'Stop writes', actor: 'user', createdAt: '2026-07-08T10:05:00.000Z' },
    ],
    ...overrides,
  };
}

test('renderRunHtml shows progress, per-step timestamps, and finish/abort while running', () => {
  const html = renderRunHtml({}, makeRun(), { docTitle: 'Failover runbook', now: NOW });
  assert.match(html, /1 of 2 steps/);
  assert.match(html, /width:50%/); // progress bar
  assert.match(html, /chip--run-running/);
  assert.match(html, /Failover runbook/); // back button carries the doc title
  // The checked step is marked done and stamped; the unchecked one is not.
  assert.match(html, /class="run-step is-done"[\s\S]*?data-step-id="s1"[\s\S]*?10:05/);
  assert.match(html, /data-action="toggle-run-step" data-step-id="s2" data-checked="0"/);
  // Elapsed since 10:00 at a 10:20 "now".
  assert.match(html, /20m/);
  assert.match(html, /data-action="finish-run"/);
  assert.match(html, /data-action="abort-run"/);
  assert.match(html, /data-action="copy-chronicle"/);
  assert.match(html, /Chronicle/);
  assert.match(html, /Checked “Stop writes”/);
  assert.match(html, /2 events/);
});

test('renderRunHtml locks the steps and hides finish/abort once the run is finished', () => {
  const html = renderRunHtml({}, makeRun({ status: 'completed', finishedAt: '2026-07-08T10:12:00.000Z' }), { docTitle: 'Failover', now: NOW });
  assert.match(html, /chip--run-completed/);
  assert.match(html, /data-action="toggle-run-step"[^>]*disabled/); // steps not clickable
  assert.doesNotMatch(html, /data-action="finish-run"/);
  assert.doesNotMatch(html, /data-action="abort-run"/);
  assert.doesNotMatch(html, /data-action="resume-run"/);
  assert.match(html, /Run completed at 10:12/);
  // Elapsed uses finishedAt, not "now".
  assert.match(html, /12m/);
});

test('renderRunHtml offers Resume only for aborted runs and locks every mutation while pending', () => {
  const aborted = renderRunHtml(
    {},
    makeRun({ status: 'aborted', finishedAt: '2026-07-08T10:08:00.000Z', finishedBy: 'user' }),
    { now: NOW },
  );
  assert.match(aborted, /data-action="resume-run"/);
  assert.match(aborted, /Run aborted at 10:08 by user/);

  const pending = renderRunHtml({ runMutationPending: true }, makeRun(), { now: NOW });
  assert.match(pending, /aria-busy="true"/);
  assert.match(pending, /data-action="toggle-run-step"[^>]*disabled/);
  assert.match(pending, /data-action="finish-run"[^>]*disabled/);
  assert.match(pending, /Saving…/);
});

test('renderRunHtml hints when a runbook has no checkbox steps', () => {
  const html = renderRunHtml({}, makeRun({ steps: [] }), { docTitle: 'Empty', now: NOW });
  assert.match(html, /no checkbox steps/);
  assert.match(html, /0 of 0 steps/);
});

test('renderRunHtml escapes step text and titles', () => {
  const html = renderRunHtml({}, makeRun({ title: '<x>', steps: [{ id: 's1', position: 0, text: '<script>alert(1)</script>', checkedAt: null }] }), { now: NOW });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});

test('buildChronicle renders a Markdown record with status, times, and per-step stamps', () => {
  const md = buildChronicle(makeRun({
    status: 'completed',
    finishedAt: '2026-07-08T10:12:00.000Z',
    finishedBy: 'agent',
    events: [
      { type: 'started', actor: 'user', createdAt: '2026-07-08T10:00:00.000Z' },
      { type: 'step-checked', stepText: 'Stop writes', actor: 'user', createdAt: '2026-07-08T10:05:00.000Z' },
      { type: 'step-unchecked', stepText: 'Stop writes', actor: 'agent', createdAt: '2026-07-08T10:07:00.000Z' },
      { type: 'completed', actor: 'agent', createdAt: '2026-07-08T10:12:00.000Z' },
    ],
  }), 'Failover');
  assert.match(md, /# Run: DR drill/);
  assert.match(md, /- Runbook: Failover runbook/);
  assert.match(md, /- Status: completed/);
  assert.match(md, /- Started: 2026-07-08T10:00:00.000Z \(by user\)/);
  assert.match(md, /- Finished: 2026-07-08T10:12:00.000Z \(by agent\)/);
  assert.match(md, /- \[x\] Stop writes — 2026-07-08T10:05:00.000Z \(by user\)/);
  assert.match(md, /- \[ \] Promote replica/);
  assert.match(md, /## Chronicle/);
  assert.match(md, /Unchecked “Stop writes” \(by agent\)/);
});

test('buildChronicle falls back to the doc title when the run is untitled', () => {
  assert.match(buildChronicle(makeRun({ title: '' }), 'Failover runbook'), /# Run: Failover runbook/);
  assert.equal(buildChronicle(null), '');
});
