import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkspaceSnapshot, buildReadOnlyRules, localToday } from '../../server/assistant/snapshot.js';

const TODAY = '2026-07-21';

function makeProjects() {
  return [
    { id: 'p-inbox', slug: 'inbox', name: 'Inbox' },
    { id: 'p-home', slug: 'homelab', name: 'Homelab' },
  ];
}

test('the snapshot states true section counts with titles, dates, and project names', () => {
  const snapshot = buildWorkspaceSnapshot({
    projects: makeProjects(),
    today: TODAY,
    tasks: [
      { title: 'go for a walk', status: 'planned', projectId: 'p-inbox', dueDate: '2026-07-19' },
      { title: 'run destroy plan', status: 'in-progress', projectId: 'p-home', dueDate: '2026-07-20' },
      { title: 'take tablet', status: 'planned', projectId: 'p-inbox', dueDate: null },
      { title: 'ship report', status: 'planned', projectId: 'p-home', dueDate: TODAY, dueTime: '14:00' },
      { title: 'old win', status: 'completed', projectId: 'p-home', dueDate: '2026-07-01' },
      { title: 'buried', status: 'planned', projectId: 'p-home', dueDate: '2026-07-01', archivedAt: '2026-07-02T00:00:00Z' },
    ],
  });
  assert.match(snapshot, /Live workspace snapshot — 2026-07-21/);
  // Totals: archived excluded entirely; completed counted, not listed as open.
  assert.match(snapshot, /Totals: 2 projects · 4 open tasks · 1 completed/);
  // Overdue: both, most-overdue first, completed/archived never counted.
  assert.match(snapshot, /Overdue \(2\):\n- go for a walk \(due 2026-07-19 · Inbox\)\n- run destroy plan \(due 2026-07-20 · in progress · Homelab\)/s);
  assert.match(snapshot, /Due today \(1\):\n- ship report \(due 2026-07-21 14:00 · Homelab\)/);
  assert.match(snapshot, /In progress \(1\):/);
  // The Inbox section carries the no-date task the totals imply.
  assert.match(snapshot, /Inbox \(2\):[\s\S]*- take tablet \(Inbox\)/);
  assert.match(snapshot, /Projects \(2\):\n- Inbox: 2 open\n- Homelab: 2 open/);
  assert.doesNotMatch(snapshot, /old win|buried/);
});

test('long sections cap the list but never the count — the elision is spelled out', () => {
  const tasks = Array.from({ length: 20 }, (_, i) => ({
    title: `overdue ${i}`, status: 'planned', projectId: 'p-home', dueDate: '2026-07-01',
  }));
  const snapshot = buildWorkspaceSnapshot({ projects: makeProjects(), today: TODAY, tasks });
  assert.match(snapshot, /Overdue \(20\):/);
  assert.match(snapshot, /- …and 8 more/);
});

test('an empty workspace is stated as empty — the one case where "no tasks" is the truth', () => {
  const snapshot = buildWorkspaceSnapshot({ projects: [], tasks: [], documents: [], today: TODAY });
  assert.match(snapshot, /The workspace is empty: no projects, tasks, or documents exist yet\./);
});

test('the Library index reports trust counts and names the docs pending review — bodies never travel', () => {
  const snapshot = buildWorkspaceSnapshot({
    projects: makeProjects(),
    today: TODAY,
    tasks: [],
    documents: [
      { title: 'Architecture', body: 'SECRET BODY TEXT', documentType: 'note', projectId: 'p-home', verified: true, updatedBy: 'human', status: 'active' },
      { title: 'Pod Restart Loop', body: 'more body', documentType: 'runbook', projectId: 'p-home', verified: false, updatedBy: 'agent', status: 'active' },
      { title: 'Weekly review — 2026-W29', documentType: 'note', projectId: 'p-inbox', verified: false, updatedBy: 'agent', status: 'active', stale: false },
      { title: 'Old doc', documentType: 'note', projectId: 'p-home', verified: false, updatedBy: 'human', status: 'archived' },
      { title: 'Rotting doc', documentType: 'note', projectId: 'p-home', verified: true, updatedBy: 'human', status: 'active', stale: true },
    ],
  });
  assert.match(snapshot, /Library \(4 docs\): 2 verified · 2 unverified · 1 stale/);
  assert.match(snapshot, /Pending human review — unverified:\n- Pod Restart Loop \(runbook · Homelab · agent-written\)\n- Weekly review — 2026-W29 \(note · Inbox · agent-written\)/);
  // Verified and archived docs are counted or excluded, never listed as pending.
  assert.doesNotMatch(snapshot, /- Architecture|Old doc/);
  // The index carries titles and metadata only — never document text.
  assert.doesNotMatch(snapshot, /SECRET BODY TEXT/);
});

test('the read-only rules flip to an explicit no-visibility stance when the snapshot is missing', () => {
  const grounded = buildReadOnlyRules(true);
  assert.match(grounded, /ONLY from the snapshot below/);
  assert.match(grounded, /never invent items or counts/);
  const blind = buildReadOnlyRules(false);
  assert.match(blind, /NO visibility/);
  assert.match(blind, /never say the workspace is empty/);
  for (const rules of [grounded, blind]) {
    assert.match(rules, /cannot create, edit, complete, or delete/);
    assert.match(rules, /Settings ▸ Intelligence/);
  }
});

test('localToday formats the local calendar date', () => {
  assert.equal(localToday(new Date(2026, 6, 21, 23, 59)), '2026-07-21');
  assert.equal(localToday(new Date(2026, 0, 2, 0, 0)), '2026-01-02');
});
