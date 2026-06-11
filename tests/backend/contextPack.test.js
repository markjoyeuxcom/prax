import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContextPack, renderContextPackMarkdown } from '../../server/contextPack.js';

const project = { id: 'p1', slug: 'demo', name: 'Demo', status: 'active' };

const docs = [
  { id: 'c', title: 'Project card', body: 'Overview body', documentType: 'note', tags: ['project-card'], verified: true, status: 'active' },
  { id: 'r', title: 'Restore runbook', body: 'steps', documentType: 'runbook', tags: [], verified: true, status: 'active' },
  { id: 'm', title: 'A decision', body: 'we chose X', documentType: 'note', tags: [], verified: true, status: 'active' },
  { id: 'u', title: 'Agent note', body: 'maybe Y', documentType: 'note', tags: [], verified: false, status: 'active' },
  { id: 's', title: 'Old', body: 'gone', documentType: 'note', tags: [], verified: true, status: 'superseded' },
];

test('buildContextPack quarantines unverified, excludes superseded, sorts sections', () => {
  const pack = buildContextPack(docs, { project, query: 'how do we restore', limit: 12 });
  const kinds = pack.sections.map((s) => s.kind);
  assert.deepEqual(kinds, ['overview', 'relevant', 'runbooks', 'unverified']);
  assert.deepEqual(pack.sections.find((s) => s.kind === 'overview').items.map((i) => i.id), ['c']);
  assert.deepEqual(pack.sections.find((s) => s.kind === 'runbooks').items.map((i) => i.id), ['r']);
  assert.deepEqual(pack.sections.find((s) => s.kind === 'relevant').items.map((i) => i.id), ['m']);
  assert.deepEqual(pack.sections.find((s) => s.kind === 'unverified').items.map((i) => i.id), ['u']);
  const allIds = pack.sections.flatMap((s) => s.items.map((i) => i.id));
  assert.ok(!allIds.includes('s'));
});

test('buildContextPack limit is a pack-wide budget, not per-section', () => {
  const many = [
    { id: 'c1', title: 'Card', body: 'b', documentType: 'note', tags: ['project-card'], verified: true, status: 'active' },
    { id: 'm1', title: 'm1', body: 'b', documentType: 'note', tags: [], verified: true, status: 'active' },
    { id: 'm2', title: 'm2', body: 'b', documentType: 'note', tags: [], verified: true, status: 'active' },
    { id: 'r1', title: 'r1', body: 'b', documentType: 'runbook', tags: [], verified: true, status: 'active' },
    { id: 'u1', title: 'u1', body: 'b', documentType: 'note', tags: [], verified: false, status: 'active' },
    { id: 'u2', title: 'u2', body: 'b', documentType: 'note', tags: [], verified: false, status: 'active' },
  ];
  const pack = buildContextPack(many, { project, query: 'x', limit: 4 });
  const allIds = pack.sections.flatMap((s) => s.items.map((i) => i.id));
  assert.equal(allIds.length, 4);
  // Budget spends in section order: overview → relevant → runbooks → unverified.
  assert.deepEqual(allIds, ['c1', 'm1', 'm2', 'r1']);
  assert.ok(!pack.sections.some((s) => s.kind === 'unverified'));
});

test('buildContextPack omits empty sections and respects limit', () => {
  const pack = buildContextPack(
    [{ id: 'm1', title: 'm1', body: 'b', documentType: 'note', tags: [], verified: true, status: 'active' },
     { id: 'm2', title: 'm2', body: 'b', documentType: 'note', tags: [], verified: true, status: 'active' }],
    { project, query: '', limit: 1 },
  );
  assert.deepEqual(pack.sections.map((s) => s.kind), ['relevant']);
  assert.equal(pack.sections[0].items.length, 1);
  assert.equal(pack.sections[0].title, 'Recent memory');
});

test('renderContextPackMarkdown renders header, query, and unverified marker', () => {
  const pack = buildContextPack(docs, { project, query: 'restore', limit: 12 });
  const md = renderContextPackMarkdown(pack);
  assert.match(md, /^# Context: Demo \(active\)/);
  assert.match(md, /_Query: restore_/);
  assert.match(md, /## ⚠ Unverified — pending human review/);
  assert.match(md, /### Agent note — _unverified_/);
  assert.match(md, /\(runbook · r\)/);
});
