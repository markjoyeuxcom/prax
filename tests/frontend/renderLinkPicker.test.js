import test from 'node:test';
import assert from 'node:assert/strict';
import { renderLinkPickerHtml } from '../../public/js/renderLinkPicker.js';

const sampleDocuments = [
  { id: 'doc-1', title: 'Deploy Runbook', documentType: 'runbook', context: 'homelab', tags: ['deploy'] },
  { id: 'doc-2', title: 'Ops Note', documentType: 'note', context: 'work', tags: ['ops'] },
  { id: 'doc-3', title: 'Homelab Setup', documentType: 'runbook', context: 'homelab', tags: ['setup'] },
];

test('link picker renders a modal backdrop and dialog', () => {
  const html = renderLinkPickerHtml({ documents: sampleDocuments });
  assert.match(html, /data-link-picker/);
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /link-picker-title/);
});

test('link picker renders all document rows', () => {
  const html = renderLinkPickerHtml({ documents: sampleDocuments });
  assert.match(html, /data-link-picker-doc="doc-1"/);
  assert.match(html, /data-link-picker-doc="doc-2"/);
  assert.match(html, /data-link-picker-doc="doc-3"/);
  assert.match(html, /Deploy Runbook/);
  assert.match(html, /Ops Note/);
  assert.match(html, /Homelab Setup/);
});

test('link picker marks already-linked documents with is-linked and [x]', () => {
  const html = renderLinkPickerHtml({ documents: sampleDocuments, linkedIds: ['doc-1', 'doc-3'] });
  // doc-1 and doc-3 should be linked — class comes before data attr in the rendered HTML
  assert.match(html, /class="link-picker__row is-linked"[^>]*data-link-picker-doc="doc-1"/);
  assert.match(html, /class="link-picker__row is-linked"[^>]*data-link-picker-doc="doc-3"/);
  // doc-2 should not be linked
  assert.doesNotMatch(html, /class="link-picker__row is-linked"[^>]*data-link-picker-doc="doc-2"/);
  // aria-pressed should reflect state
  assert.match(html, /data-link-picker-doc="doc-1"[^>]*aria-pressed="true"/);
  assert.match(html, /data-link-picker-doc="doc-2"[^>]*aria-pressed="false"/);
});

test('link picker filters by query against title', () => {
  const html = renderLinkPickerHtml({ documents: sampleDocuments, query: 'deploy' });
  assert.match(html, /Deploy Runbook/);
  assert.doesNotMatch(html, /Ops Note/);
  assert.doesNotMatch(html, /Homelab Setup/);
});

test('link picker filters by query against documentType', () => {
  const html = renderLinkPickerHtml({ documents: sampleDocuments, query: 'note' });
  assert.match(html, /Ops Note/);
  assert.doesNotMatch(html, /Deploy Runbook/);
});

test('link picker filters by query against context', () => {
  const html = renderLinkPickerHtml({ documents: sampleDocuments, query: 'work' });
  assert.match(html, /Ops Note/);
  assert.doesNotMatch(html, /Deploy Runbook/);
  assert.doesNotMatch(html, /Homelab Setup/);
});

test('link picker filters by query against tags', () => {
  const html = renderLinkPickerHtml({ documents: sampleDocuments, query: 'setup' });
  assert.match(html, /Homelab Setup/);
  assert.doesNotMatch(html, /Deploy Runbook/);
  assert.doesNotMatch(html, /Ops Note/);
});

test('link picker shows empty state when no documents match the query', () => {
  const html = renderLinkPickerHtml({ documents: sampleDocuments, query: 'zzznomatch' });
  assert.match(html, /link-picker__empty/);
  assert.match(html, /No documents match/);
});

test('link picker shows empty state when document list is empty', () => {
  const html = renderLinkPickerHtml({ documents: [] });
  assert.match(html, /link-picker__empty/);
});

test('link picker renders a search input with the current query value', () => {
  const html = renderLinkPickerHtml({ documents: sampleDocuments, query: 'run' });
  assert.match(html, /data-link-picker-search/);
  assert.match(html, /value="run"/);
});

test('link picker renders close action buttons', () => {
  const html = renderLinkPickerHtml({ documents: sampleDocuments });
  assert.match(html, /data-action="close-link-picker"/);
});

test('link picker escapes HTML in document titles', () => {
  const docs = [{ id: 'doc-x', title: '<script>alert(1)</script>', documentType: 'note', context: 'homelab', tags: [] }];
  const html = renderLinkPickerHtml({ documents: docs });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('link picker handles missing fields gracefully', () => {
  const docs = [{ id: 'doc-x' }];
  const html = renderLinkPickerHtml({ documents: docs });
  assert.match(html, /Untitled document/);
  assert.match(html, /data-link-picker-doc="doc-x"/);
});
