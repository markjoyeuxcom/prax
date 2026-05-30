import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDocumentRow } from '../../server/libraryRepository.js';
import {
  renderDocumentMarkdown,
  documentFilename,
  libraryArchiveFilename,
  dedupeFilenames,
} from '../../server/libraryExport.js';
import { buildExportedMarkdown } from '../../public/js/libraryExport.js';

// The current library document base field set this regression test locks (order-independent).
const FROZEN_DOC_KEYS = [
  'archivedAt', 'body', 'createdAt', 'documentType', 'id',
  'projectId', 'sourceFilename', 'tags', 'title', 'updatedAt',
].sort();

const GOLDEN_DOC = {
  title: 'Postgres restore',
  body: '# Postgres restore\n\nSteps...\n',
  documentType: 'runbook',
  tags: ['postgres', 'dr'],
  createdAt: '2026-04-12T10:33:21.000Z',
  updatedAt: '2026-05-20T08:11:09.000Z',
};

const GOLDEN_MARKDOWN = `---
title: Postgres restore
type: runbook
project: homelab
tags:
  - postgres
  - dr
created_at: 2026-04-12T10:33:21.000Z
updated_at: 2026-05-20T08:11:09.000Z
---

# Postgres restore

Steps...
`;

test('SHAPE: normalizeDocumentRow base field set is locked', () => {
  const row = {
    id: 'id', title: 't', body: 'b', document_type: 'note',
    project_id: 'pid', tags: ['x'], source_filename: null,
    archived_at: null, created_at: 'c', updated_at: 'u',
  };
  assert.deepEqual(Object.keys(normalizeDocumentRow(row)).sort(), FROZEN_DOC_KEYS);
});

test('SHAPE: normalizeDocumentRow adds projectSlug only when project_slug present', () => {
  const row = {
    id: 'id', title: 't', body: 'b', document_type: 'note',
    project_id: 'pid', tags: [], source_filename: null,
    archived_at: null, created_at: 'c', updated_at: 'u', project_slug: 'homelab',
  };
  const out = normalizeDocumentRow(row);
  assert.equal(out.projectSlug, 'homelab');
  assert.deepEqual(Object.keys(out).sort(), [...FROZEN_DOC_KEYS, 'projectSlug'].sort());
});

test('SHAPE: renderDocumentMarkdown emits the documented front-matter format', () => {
  assert.equal(renderDocumentMarkdown(GOLDEN_DOC, 'homelab'), GOLDEN_MARKDOWN);
});

test('SHAPE: browser serializer is byte-identical to server (dual-write invariant)', () => {
  const fixtures = [
    { doc: { ...GOLDEN_DOC, sourceFilename: null }, slug: 'homelab' },
    { doc: { ...GOLDEN_DOC, title: 'Has: colon', sourceFilename: null }, slug: 'homelab' },
    { doc: { ...GOLDEN_DOC, title: '#heading', sourceFilename: null }, slug: 'homelab' },
    { doc: { ...GOLDEN_DOC, tags: [], body: '', sourceFilename: null }, slug: 'homelab' },
  ];
  for (const { doc, slug } of fixtures) {
    assert.equal(buildExportedMarkdown(doc, slug), renderDocumentMarkdown(doc, slug));
  }
});

test('SHAPE: documentFilename precedence is locked', () => {
  assert.equal(documentFilename({ sourceFilename: 'runbooks/restore.md', title: 'x' }), 'restore.md');
  assert.equal(documentFilename({ sourceFilename: 'restore', title: 'x' }), 'restore.md');
  assert.equal(documentFilename({ sourceFilename: null, title: 'Postgres Restore — Steps' }), 'postgres-restore-steps.md');
  assert.equal(documentFilename({ sourceFilename: null, title: '   ' }), 'untitled.md');
});

test('SHAPE: libraryArchiveFilename shape is locked', () => {
  const date = new Date('2026-05-29T12:00:00.000Z');
  assert.equal(libraryArchiveFilename('homelab', date), 'moomora-console-library-homelab-2026-05-29.zip');
  assert.equal(libraryArchiveFilename('', date), 'moomora-console-library-all-2026-05-29.zip');
});

test('SHAPE: dedupeFilenames suffixes per-folder collisions with -N before .md', () => {
  const entries = [
    { path: 'homelab', filename: 'restore.md' },
    { path: 'homelab', filename: 'restore.md' },
    { path: 'homelab', filename: 'restore.md' },
    { path: 'other', filename: 'restore.md' },
  ];
  dedupeFilenames(entries);
  assert.deepEqual(
    entries.map((e) => e.filename),
    ['restore.md', 'restore-2.md', 'restore-3.md', 'restore.md'],
  );
});
