import test from 'node:test';
import assert from 'node:assert/strict';
import {
  openDocumentInfoDraft,
  normalizeInfoFields,
  documentInfoPatch,
  mergeDocumentInfo,
  documentInfoCommitted,
  rebaseDocumentInfoDraft,
} from '../../public/js/documentInfoDraft.js';

const REV_A = 'a'.repeat(64);
const REV_B = 'b'.repeat(64);
const doc = {
  id: 'doc-1', title: 'Postgres restore', body: '# body', documentType: 'runbook', projectId: 'p1',
  tags: ['postgres', 'backup'], sourceFilename: 'restore.md', revision: REV_A,
};

test('opening the form captures a baseline (fields + revision) and editable fields from the document', () => {
  const draft = openDocumentInfoDraft(doc, { refs: [{ id: 'r1', url: 'https://x/pr/1', label: 'PR' }] });
  assert.equal(draft.documentId, 'doc-1');
  assert.deepEqual(draft.baseline, { revision: REV_A, title: 'Postgres restore', documentType: 'runbook', projectId: 'p1', tags: ['postgres', 'backup'], sourceFilename: 'restore.md' });
  assert.deepEqual(draft.fields, { title: 'Postgres restore', documentType: 'runbook', projectId: 'p1', tags: 'postgres, backup', sourceFilename: 'restore.md', refsText: 'https://x/pr/1 | PR' });
  assert.equal(draft.pending, false);
  assert.equal(draft.conflict, null);
  assert.throws(() => openDocumentInfoDraft({ ...doc, revision: undefined }, {}), /revision/);
});

test('normalizeInfoFields trims, splits tags, and nulls an empty source filename', () => {
  assert.deepEqual(normalizeInfoFields({ title: '  New  ', documentType: 'note', projectId: 'p2', tags: ' a, ,b ,a ', sourceFilename: '  ' }),
    { title: 'New', documentType: 'note', projectId: 'p2', tags: ['a', 'b'], sourceFilename: null });
});

test('documentInfoPatch sends only the fields that differ from the baseline, guarded by its revision', () => {
  const draft = openDocumentInfoDraft(doc, { refs: [] });
  const unchanged = documentInfoPatch(draft.baseline, normalizeInfoFields(draft.fields));
  assert.deepEqual(unchanged, { ifRevision: REV_A }, 'nothing changed → only the guard');
  const patch = documentInfoPatch(draft.baseline, normalizeInfoFields({ ...draft.fields, title: 'Renamed', projectId: 'p2', tags: 'postgres, backup' }));
  assert.deepEqual(patch, { ifRevision: REV_A, title: 'Renamed', project: 'p2' }, 'project travels as `project`; equal tags are not resent');
  const cleared = documentInfoPatch(draft.baseline, normalizeInfoFields({ ...draft.fields, sourceFilename: '' }));
  assert.deepEqual(cleared, { ifRevision: REV_A, sourceFilename: null });
});

test('mergeDocumentInfo keeps my edits, adopts remote changes I did not touch, and flags same-field conflicts', () => {
  const draft = openDocumentInfoDraft(doc, { refs: [] });
  const mine = normalizeInfoFields({ ...draft.fields, tags: 'postgres, backup, dr' });
  // Remote renamed the title; I only added a tag → no conflict, remote title adopted.
  const remote = { ...doc, title: 'Remote title', revision: REV_B };
  const merged = mergeDocumentInfo(draft.baseline, mine, remote);
  assert.deepEqual(merged.conflicts, []);
  assert.equal(merged.fields.title, 'Remote title');
  assert.deepEqual(merged.fields.tags, ['postgres', 'backup', 'dr']);
  // Both changed the title → conflict on title only; my other edits stay.
  const both = mergeDocumentInfo(draft.baseline, { ...mine, title: 'My title' }, remote);
  assert.deepEqual(both.conflicts, ['title']);
  assert.equal(both.fields.title, 'My title');
  assert.deepEqual(both.remote.title, 'Remote title');
});

test('documentInfoCommitted recognises a lost response only when every changed field already matches', () => {
  const draft = openDocumentInfoDraft(doc, { refs: [] });
  const intended = normalizeInfoFields({ ...draft.fields, title: 'Renamed', tags: 'x' });
  const patch = documentInfoPatch(draft.baseline, intended);
  assert.equal(documentInfoCommitted({ ...doc, title: 'Renamed', tags: ['x'], revision: REV_B }, patch), true);
  assert.equal(documentInfoCommitted({ ...doc, title: 'Renamed', revision: REV_B }, patch), false, 'tags not applied');
  assert.equal(documentInfoCommitted(null, patch), false);
});

test('rebaseDocumentInfoDraft moves the baseline to the remote record and resolves conflicts either way', () => {
  const draft = { ...openDocumentInfoDraft(doc, { refs: [] }), fields: { ...openDocumentInfoDraft(doc, { refs: [] }).fields, title: 'My title' } };
  const remote = { ...doc, title: 'Remote title', tags: ['remote'], revision: REV_B };
  const theirs = rebaseDocumentInfoDraft(draft, remote, { keep: 'theirs', conflicts: ['title'] });
  assert.equal(theirs.baseline.revision, REV_B);
  assert.equal(theirs.fields.title, 'Remote title', 'theirs: the conflicting field takes the remote value');
  assert.equal(theirs.fields.tags, 'remote', 'untouched fields follow the remote record');
  assert.equal(theirs.conflict, null);
  const mine = rebaseDocumentInfoDraft(draft, remote, { keep: 'mine', conflicts: ['title'] });
  assert.equal(mine.baseline.revision, REV_B);
  assert.equal(mine.fields.title, 'My title', 'mine: my value is kept and will now be sent against the remote revision');
  assert.equal(mine.fields.tags, 'remote');
  assert.equal(mine.conflict, null);
});
