import test from 'node:test';
import assert from 'node:assert/strict';
import { renderLinkPickerHtml } from '../../public/js/renderLinkPicker.js';

const sampleDocuments = [
  { id: 'doc-1', title: 'Deploy Runbook', documentType: 'runbook', tags: ['deploy'] },
  { id: 'doc-2', title: 'Ops Note', documentType: 'note', tags: ['ops'] },
  { id: 'doc-3', title: 'Homelab Setup', documentType: 'runbook', tags: ['setup'] },
];

function makeState(overrides = {}) {
  return {
    isLinkPickerOpen: true,
    pickerMode: 'link',
    linkPickerDocuments: sampleDocuments,
    linkPickerQuery: '',
    taskDocuments: [],
    ...overrides,
  };
}

test('picker renders a centered overlay with palette dialog semantics', () => {
  const html = renderLinkPickerHtml(makeState());
  assert.match(html, /class="overlay-center" data-link-picker/);
  assert.match(html, /class="palette" role="dialog" aria-modal="true" aria-labelledby="link-picker-title"/);
  assert.match(html, /id="link-picker-title"/);
});

test('picker heading reads "Link a document" in link mode', () => {
  const html = renderLinkPickerHtml(makeState());
  assert.match(html, /id="link-picker-title">Link a document</);
});

test('picker heading switches to supersede copy in supersede mode', () => {
  const html = renderLinkPickerHtml(makeState({ pickerMode: 'supersede' }));
  assert.match(html, /id="link-picker-title">Supersede with…</);
  assert.doesNotMatch(html, /Link a document/);
});

test('picker renders every document as a row button with a type chip', () => {
  const html = renderLinkPickerHtml(makeState());
  assert.match(html, /data-link-picker-doc data-document-id="doc-1"/);
  assert.match(html, /data-link-picker-doc data-document-id="doc-2"/);
  assert.match(html, /data-link-picker-doc data-document-id="doc-3"/);
  assert.match(html, /Deploy Runbook/);
  assert.match(html, /class="chip chip--type-runbook">runbook</);
  assert.match(html, /class="chip chip--type-note">note</);
});

test('picker renders the search input holding the current query', () => {
  const html = renderLinkPickerHtml(makeState({ linkPickerQuery: 'run' }));
  assert.match(html, /data-link-picker-search value="run"/);
});

test('picker escapes the query value attribute', () => {
  const html = renderLinkPickerHtml(makeState({ linkPickerQuery: '"><img src=x>' }));
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /value="&quot;&gt;&lt;img src=x&gt;"/);
});

test('picker filters rows by title', () => {
  const html = renderLinkPickerHtml(makeState({ linkPickerQuery: 'deploy' }));
  assert.match(html, /Deploy Runbook/);
  assert.doesNotMatch(html, /Ops Note/);
  assert.doesNotMatch(html, /Homelab Setup/);
});

test('picker filters rows by documentType', () => {
  const html = renderLinkPickerHtml(makeState({ linkPickerQuery: 'note' }));
  assert.match(html, /Ops Note/);
  assert.doesNotMatch(html, /Deploy Runbook/);
  assert.doesNotMatch(html, /Homelab Setup/);
});

test('picker filters rows by tags', () => {
  const html = renderLinkPickerHtml(makeState({ linkPickerQuery: 'setup' }));
  assert.match(html, /Homelab Setup/);
  assert.doesNotMatch(html, /Deploy Runbook/);
  assert.doesNotMatch(html, /Ops Note/);
});

test('picker marks already-linked documents with is-linked and aria-pressed', () => {
  const html = renderLinkPickerHtml(makeState({ taskDocuments: [{ id: 'doc-1' }, { id: 'doc-3' }] }));
  assert.match(html, /class="palette__item is-linked"[^>]*data-document-id="doc-1" aria-pressed="true"/);
  assert.match(html, /class="palette__item is-linked"[^>]*data-document-id="doc-3" aria-pressed="true"/);
  assert.match(html, /class="palette__item"[^>]*data-document-id="doc-2" aria-pressed="false"/);
});

test('picker ignores linked ids in supersede mode', () => {
  const html = renderLinkPickerHtml(makeState({ pickerMode: 'supersede', taskDocuments: [{ id: 'doc-1' }] }));
  assert.doesNotMatch(html, /is-linked/);
  assert.doesNotMatch(html, /aria-pressed/);
});

test('picker shows an empty state when nothing matches the query', () => {
  const html = renderLinkPickerHtml(makeState({ linkPickerQuery: 'zzznomatch' }));
  assert.match(html, /class="palette__empty">No documents match\./);
  assert.doesNotMatch(html, /data-link-picker-doc/);
});

test('picker shows the empty state when there are no documents at all', () => {
  const html = renderLinkPickerHtml(makeState({ linkPickerDocuments: [] }));
  assert.match(html, /class="palette__empty"/);
});

test('picker renders a close control', () => {
  const html = renderLinkPickerHtml(makeState());
  assert.match(html, /data-action="close-link-picker"/);
});

test('picker escapes HTML in document titles', () => {
  const docs = [{ id: 'doc-x', title: '<script>alert(1)</script>', documentType: 'note', tags: [] }];
  const html = renderLinkPickerHtml(makeState({ linkPickerDocuments: docs }));
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('picker tolerates documents with missing fields', () => {
  const html = renderLinkPickerHtml(makeState({ linkPickerDocuments: [{ id: 'doc-x' }] }));
  assert.match(html, /Untitled document/);
  assert.match(html, /data-link-picker-doc data-document-id="doc-x"/);
  assert.match(html, /chip--type-note/);
});
