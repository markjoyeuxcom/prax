import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExportedMarkdown } from '../../public/js/libraryExport.js';

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

test('SHAPE (browser): v2 front-matter contains all five new keys', () => {
  const out = buildExportedMarkdown(BASE_DOC, 'homelab', EMPTY_LINKS);
  assert.match(out, /kind: source/);
  assert.match(out, new RegExp(`content_hash: ${HASH}`));
  assert.match(out, /updated_by: user/);
  assert.match(out, /links:\n  derived-from: \[\]\n  supersedes: \[\]/);
});

test('SHAPE (browser): non-empty derived-from emits id/ref entries', () => {
  const links = {
    'derived-from': [{ id: 'c58d3108-4f93-4a50-ac42-0c1d61e61b08', ref: 'homelab/x.md' }],
    supersedes: [],
  };
  const out = buildExportedMarkdown(BASE_DOC, 'homelab', links);
  assert.match(out, /- id: c58d3108-4f93-4a50-ac42-0c1d61e61b08\n      ref: homelab\/x.md/);
});

test('SHAPE (browser): links default to empty when omitted', () => {
  const out = buildExportedMarkdown(BASE_DOC, 'homelab');
  assert.match(out, /links:\n  derived-from: \[\]\n  supersedes: \[\]/);
});
