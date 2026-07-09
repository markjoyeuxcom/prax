import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDailyBrief } from '../../public/js/brief.js';

const NOW = new Date('2026-07-09T09:00:00Z');
const iso = (d) => d; // dueDate is a YYYY-MM-DD string

const state = {
  projects: [
    { id: 'p1', name: 'Homelab', onCall: 'Mark', handoffNotes: 'watch the disk on node-2' },
    { id: 'p2', name: 'Work' },
  ],
  tasks: [
    { id: 't1', title: 'Rotate certs', status: 'todo', projectId: 'p1', dueDate: '2026-07-01' }, // overdue
    { id: 't2', title: 'Deploy hotfix', status: 'todo', projectId: 'p2', dueDate: '2026-07-09' }, // today
    { id: 't3', title: 'Review PR', status: 'todo', projectId: 'p1', dueDate: '2026-07-10' },      // soon
    { id: 't4', title: 'Done thing', status: 'completed', projectId: 'p1', dueDate: '2026-07-01' }, // closed — excluded
    { id: 't5', title: 'Snoozed', status: 'todo', projectId: 'p1', dueDate: '2026-07-01', deferredUntil: '2026-07-20T00:00:00Z' }, // snoozed — excluded
    { id: 't6', title: 'Someday', status: 'todo', projectId: 'p1', dueDate: '2026-12-01' },        // later — not soon
  ],
  documents: [
    { id: 'd1', title: 'Fresh doc', status: 'active', updatedAt: '2026-07-08T10:00:00Z' },
    { id: 'd2', title: 'Old doc', status: 'active', updatedAt: '2026-05-01T10:00:00Z' },           // too old
  ],
};

test('buildDailyBrief buckets overdue/today/soon, excludes closed & snoozed', () => {
  const md = buildDailyBrief(state, NOW);
  assert.match(md, /# Daily brief — 2026-07-09/);
  assert.match(md, /\*\*1 overdue · 1 due today · 1 due soon\*\*/);
  assert.match(md, /## ⚠ Overdue[\s\S]*Rotate certs _\(Homelab\)_/);
  assert.match(md, /## Due today[\s\S]*Deploy hotfix _\(Work\)_/);
  assert.match(md, /## Due soon[\s\S]*Review PR/);
  assert.doesNotMatch(md, /Done thing/);   // closed excluded
  assert.doesNotMatch(md, /Snoozed/);      // snoozed excluded
  assert.doesNotMatch(md, /Someday/);      // 'later' not in the brief
});

test('buildDailyBrief renders on-call + handoff and recent docs', () => {
  const md = buildDailyBrief(state, NOW);
  assert.match(md, /## On call & handoff[\s\S]*\*\*Homelab\*\* — on call: Mark/);
  assert.match(md, /Handoff: watch the disk on node-2/);
  assert.match(md, /## Recently changed docs[\s\S]*Fresh doc/);
  assert.doesNotMatch(md, /Old doc/);      // stale doc excluded from "recent"
});

test('buildDailyBrief handles an empty day gracefully', () => {
  const md = buildDailyBrief({ tasks: [], projects: [], documents: [] }, NOW);
  assert.match(md, /Nothing overdue or due/);
  assert.doesNotMatch(md, /## On call/);
});
