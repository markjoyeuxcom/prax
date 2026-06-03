import test from 'node:test';
import assert from 'node:assert/strict';
import { renderLibraryHtml } from '../../public/js/renderLibrary.js';

const baseDoc = {
  id: 'doc-1',
  title: 'Postgres restore',
  body: '# r',
  documentType: 'runbook',
  projectId: 'p1',
  tags: ['postgres'],
  sourceFilename: null,
  archivedAt: null,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
  kind: 'source',
  updatedBy: 'user',
  stale: false,
};

test('detail header shows the kind badge', () => {
  const html = renderLibraryHtml({
    documents: [{ ...baseDoc, kind: 'synthesized' }],
    selectedDocumentId: 'doc-1',
  });
  assert.ok(html.includes('chip-kind'));
  assert.ok(html.includes('SYNTHESIZED'));
});

test('detail header shows updated_by line', () => {
  const html = renderLibraryHtml({
    documents: [{ ...baseDoc, updatedBy: 'agent' }],
    selectedDocumentId: 'doc-1',
  });
  assert.match(html, /Updated by[\s\S]*agent/);
});

test('Links section renders outbound and inbound entries', () => {
  const html = renderLibraryHtml({
    documents: [baseDoc],
    selectedDocumentId: 'doc-1',
    documentLinks: [
      { documentId: 't1', title: 'Source A', relation: 'derived-from', direction: 'outbound' },
      { documentId: 't2', title: 'Derivation B', relation: 'derived-from', direction: 'inbound' },
    ],
  });
  assert.ok(html.includes('Derived from'));
  assert.ok(html.includes('Backlinks'));
  assert.ok(html.includes('Source A'));
  assert.ok(html.includes('Derivation B'));
});

test('Links section renders empty state when no links', () => {
  const html = renderLibraryHtml({
    documents: [baseDoc],
    selectedDocumentId: 'doc-1',
    documentLinks: [],
  });
  assert.ok(html.includes('No links'));
});
