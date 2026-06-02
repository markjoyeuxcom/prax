import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatFrontMatter,
  renderDocumentMarkdown,
  computeLinkRef,
} from '../../server/libraryExport.js';

const HASH = '47421290090a9c1fbe1c5d3a7c2f9d8e4b1a6c3e8d5f2a9b7c4e1d8a5b2f9c6e3d';

const BASE_DOC = {
  title: 'Postgres restore',
  documentType: 'runbook',
  tags: ['postgres', 'dr'],
  createdAt: '2026-04-12T10:33:21.000Z',
  updatedAt: '2026-05-20T08:11:09.000Z',
  kind: 'source',
  contentHash: HASH,
  updatedBy: 'user',
  body: '# Postgres restore\n\nSteps...\n',
};

const EMPTY_LINKS = { 'derived-from': [], supersedes: [] };

test('SHAPE: v2 front-matter places kind/content_hash/updated_by between updated_at and links', () => {
  const out = formatFrontMatter(BASE_DOC, 'homelab', EMPTY_LINKS);
  const lines = out.split('\n');
  const idx = (key) => lines.findIndex((l) => l.startsWith(`${key}:`));
  assert.ok(idx('updated_at') < idx('kind'));
  assert.ok(idx('kind') < idx('content_hash'));
  assert.ok(idx('content_hash') < idx('updated_by'));
  assert.ok(idx('updated_by') < idx('links'));
});

test('SHAPE: empty links emit inline derived-from: [] / supersedes: []', () => {
  const out = formatFrontMatter(BASE_DOC, 'homelab', EMPTY_LINKS);
  assert.match(out, /links:\n  derived-from: \[\]\n  supersedes: \[\]\n---/);
});

test('SHAPE: a single derived-from entry emits an id/ref block sequence', () => {
  const links = {
    'derived-from': [
      { id: 'c58d3108-4f93-4a50-ac42-0c1d61e61b08', ref: 'homelab/cloudnativepg-restore.md' },
    ],
    supersedes: [],
  };
  const out = formatFrontMatter(BASE_DOC, 'homelab', links);
  assert.match(out, /links:\n  derived-from:\n    - id: c58d3108-4f93-4a50-ac42-0c1d61e61b08\n      ref: homelab\/cloudnativepg-restore.md\n  supersedes: \[\]/);
});

test('SHAPE: derived-from list order is preserved', () => {
  const links = {
    'derived-from': [
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ref: 'homelab/a.md' },
      { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ref: 'homelab/b.md' },
    ],
    supersedes: [],
  };
  const out = formatFrontMatter(BASE_DOC, 'homelab', links);
  const aIdx = out.indexOf('aaaaaaaa');
  const bIdx = out.indexOf('bbbbbbbb');
  assert.ok(aIdx > 0 && bIdx > aIdx);
});

test('SHAPE: both relations populated, derived-from emits before supersedes', () => {
  const links = {
    'derived-from': [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ref: 'a.md' }],
    supersedes: [{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ref: 'b.md' }],
  };
  const out = formatFrontMatter(BASE_DOC, 'homelab', links);
  const dfIdx = out.indexOf('derived-from:');
  const supIdx = out.indexOf('supersedes:');
  assert.ok(dfIdx > 0 && supIdx > dfIdx);
});

test('SHAPE: kind, content_hash, updated_by are unquoted', () => {
  const out = formatFrontMatter(BASE_DOC, 'homelab', EMPTY_LINKS);
  assert.match(out, new RegExp(`kind: source\\n`));
  assert.match(out, new RegExp(`content_hash: ${HASH}\\n`));
  assert.match(out, new RegExp(`updated_by: user\\n`));
});

test('SHAPE: links default to empty when omitted (back-compat for callers without graph data)', () => {
  const out = formatFrontMatter(BASE_DOC, 'homelab');
  assert.match(out, /links:\n  derived-from: \[\]\n  supersedes: \[\]/);
});

test('SHAPE: renderDocumentMarkdown threads links through and appends body', () => {
  const links = {
    'derived-from': [{ id: 'c58d3108-4f93-4a50-ac42-0c1d61e61b08', ref: 'homelab/x.md' }],
    supersedes: [],
  };
  const out = renderDocumentMarkdown(BASE_DOC, 'homelab', links);
  assert.match(out, /c58d3108-4f93-4a50-ac42-0c1d61e61b08/);
  assert.ok(out.endsWith('# Postgres restore\n\nSteps...\n'));
});

test('computeLinkRef: all-projects export emits <projectSlug>/<filename>', () => {
  const ref = computeLinkRef({
    scope: 'all',
    currentDocProjectSlug: 'work',
    targetProjectSlug: 'homelab',
    targetSourceFilename: null,
    targetTitle: 'Postgres restore',
  });
  assert.equal(ref, 'homelab/postgres-restore.md');
});

test('computeLinkRef: single-project export, same project, bare filename', () => {
  const ref = computeLinkRef({
    scope: 'single-project',
    currentDocProjectSlug: 'homelab',
    targetProjectSlug: 'homelab',
    targetSourceFilename: null,
    targetTitle: 'Postgres restore',
  });
  assert.equal(ref, 'postgres-restore.md');
});

test('computeLinkRef: single-project export, cross-project target dangles', () => {
  const ref = computeLinkRef({
    scope: 'single-project',
    currentDocProjectSlug: 'work',
    targetProjectSlug: 'homelab',
    targetSourceFilename: null,
    targetTitle: 'Postgres restore',
  });
  assert.equal(ref, 'homelab/postgres-restore.md');
});

test('computeLinkRef: prefers sourceFilename basename when present', () => {
  const ref = computeLinkRef({
    scope: 'all',
    currentDocProjectSlug: 'work',
    targetProjectSlug: 'homelab',
    targetSourceFilename: 'runbooks/restore.md',
    targetTitle: 'Whatever',
  });
  assert.equal(ref, 'homelab/restore.md');
});
