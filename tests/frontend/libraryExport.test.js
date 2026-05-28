import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExportedMarkdown,
  documentFilename,
  triggerDownload,
} from '../../public/js/libraryExport.js';
import { renderDocumentMarkdown } from '../../server/libraryExport.js';

const BASE_DOC = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Postgres restore',
  body: '# Postgres restore\n\nSteps...\n',
  documentType: 'runbook',
  projectId: 'pid',
  tags: ['postgres', 'dr'],
  sourceFilename: null,
  archivedAt: null,
  createdAt: '2026-04-12T10:33:21.000Z',
  updatedAt: '2026-05-20T08:11:09.000Z',
};

test('buildExportedMarkdown produces byte-identical output to server renderDocumentMarkdown', () => {
  const fixtures = [
    { doc: BASE_DOC, slug: 'homelab' },
    { doc: { ...BASE_DOC, tags: [] }, slug: 'homelab' },
    { doc: { ...BASE_DOC, title: 'Has: colon' }, slug: 'homelab' },
    { doc: { ...BASE_DOC, title: 'Has "quote"' }, slug: 'homelab' },
    { doc: { ...BASE_DOC, title: 'line1\nline2' }, slug: 'homelab' },
    { doc: { ...BASE_DOC, title: '#heading' }, slug: 'homelab' },
    { doc: { ...BASE_DOC, body: 'no newline' }, slug: 'homelab' },
    { doc: { ...BASE_DOC, body: 'before\n---\nafter\n' }, slug: 'homelab' },
    { doc: { ...BASE_DOC, body: '' }, slug: 'homelab' },
    { doc: { ...BASE_DOC, documentType: 'has: colon' }, slug: 'weird: slug' },
    { doc: BASE_DOC, slug: '' },
  ];
  for (const { doc, slug } of fixtures) {
    assert.equal(buildExportedMarkdown(doc, slug), renderDocumentMarkdown(doc, slug));
  }
});

test('documentFilename matches server filename rules', () => {
  const cases = [
    { doc: { sourceFilename: 'runbooks/restore.md', title: 'x' }, expect: 'restore.md' },
    { doc: { sourceFilename: 'restore', title: 'x' }, expect: 'restore.md' },
    { doc: { sourceFilename: '../../etc/passwd', title: 'x' }, expect: 'passwd.md' },
    { doc: { sourceFilename: '..\\foo.md', title: 'x' }, expect: 'foo.md' },
    { doc: { sourceFilename: null, title: 'Postgres Restore — Steps' }, expect: 'postgres-restore-steps.md' },
    { doc: { sourceFilename: null, title: '   ' }, expect: 'untitled.md' },
    { doc: { sourceFilename: '   ', title: '' }, expect: 'untitled.md' },
  ];
  for (const { doc, expect } of cases) {
    assert.equal(documentFilename(doc), expect);
  }
});

test('triggerDownload creates an anchor, clicks it, and revokes the URL', () => {
  const events = [];
  const fakeAnchor = {
    set href(v) { events.push(`href:${v}`); },
    set download(v) { events.push(`download:${v}`); },
    click() { events.push('click'); },
  };
  const documentRef = {
    createElement(tag) { events.push(`create:${tag}`); return fakeAnchor; },
    body: { appendChild() { events.push('append'); }, removeChild() { events.push('remove'); } },
  };
  const URL = { createObjectURL: () => 'blob:fake', revokeObjectURL: (u) => events.push(`revoke:${u}`) };
  const blob = { fake: true };

  triggerDownload('foo.md', blob, { documentRef, URLRef: URL });

  assert.deepEqual(events, [
    'create:a',
    'href:blob:fake',
    'download:foo.md',
    'append',
    'click',
    'remove',
    'revoke:blob:fake',
  ]);
});
