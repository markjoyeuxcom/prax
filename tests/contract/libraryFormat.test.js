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
  'archivedAt', 'body', 'contentHash', 'createdAt', 'documentType', 'id',
  'kind', 'projectId', 'sourceFilename', 'stale', 'status', 'tags', 'title',
  'updatedAt', 'updatedBy', 'verified', 'verifiedAt', 'verifiedBy',
].sort();

const GOLDEN_DOC = {
  title: 'Postgres restore',
  body: '# Postgres restore\n\nSteps...\n',
  documentType: 'runbook',
  tags: ['postgres', 'dr'],
  createdAt: '2026-04-12T10:33:21.000Z',
  updatedAt: '2026-05-20T08:11:09.000Z',
  kind: 'source',
  contentHash: '47421290090a9c1fbe1c5d3a7c2f9d8e4b1a6c3e8d5f2a9b7c4e1d8a5b2f9c6e3d',
  updatedBy: 'user',
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
kind: source
content_hash: 47421290090a9c1fbe1c5d3a7c2f9d8e4b1a6c3e8d5f2a9b7c4e1d8a5b2f9c6e3d
updated_by: user
links:
  derived-from: []
  supersedes: []
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
  const HASH = '47421290090a9c1fbe1c5d3a7c2f9d8e4b1a6c3e8d5f2a9b7c4e1d8a5b2f9c6e3d';
  const EMPTY = { 'derived-from': [], supersedes: [] };
  const baseDoc = { ...GOLDEN_DOC, sourceFilename: null };
  const fixtures = [
    { doc: baseDoc, slug: 'homelab', links: EMPTY },
    { doc: { ...baseDoc, title: 'Has: colon' }, slug: 'homelab', links: EMPTY },
    { doc: { ...baseDoc, tags: [], body: '' }, slug: 'homelab', links: EMPTY },
    {
      doc: baseDoc, slug: 'homelab',
      links: {
        'derived-from': [{ id: 'c58d3108-4f93-4a50-ac42-0c1d61e61b08', ref: 'homelab/x.md' }],
        supersedes: [],
      },
    },
    {
      doc: { ...baseDoc, kind: 'synthesized', updatedBy: 'agent', contentHash: HASH }, slug: 'homelab',
      links: {
        'derived-from': [
          { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ref: 'homelab/a.md' },
          { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ref: 'work/b.md' },
        ],
        supersedes: [{ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', ref: 'c.md' }],
      },
    },
    // Date-object fixture: locks the dual-write parity for the production data path
    // (the pg driver returns Date objects). The ISO conversion guarantee itself lives
    // in tests/backend/normalizers.timestamps.test.js — this fixture only proves the
    // two formatters AGREE on Date handling.
    {
      doc: {
        ...baseDoc,
        createdAt: new Date('2026-04-12T10:33:21.000Z'),
        updatedAt: new Date('2026-05-20T08:11:09.000Z'),
      },
      slug: 'homelab',
      links: EMPTY,
    },
  ];
  for (const { doc, slug, links } of fixtures) {
    assert.equal(buildExportedMarkdown(doc, slug, links), renderDocumentMarkdown(doc, slug, links));
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
