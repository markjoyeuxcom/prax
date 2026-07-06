import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLibraryModel, renderLibraryHtml } from '../../public/js/renderLibrary.js';

// Trust chips survive the redesign: SYNTH marks agent-synthesized docs, STALE
// marks derived docs whose source changed. They render on library doc cards
// exactly when the flags apply — never on plain source docs.

function doc(overrides = {}) {
  return {
    id: 'd1',
    title: 'Doc',
    body: 'Body line.',
    documentType: 'note',
    tags: [],
    updatedAt: '2026-06-01T00:00:00.000Z',
    kind: 'source',
    stale: false,
    ...overrides,
  };
}

function render(documents) {
  const state = {
    documents,
    libraryQuery: '',
    librarySemantic: false,
    activeLibraryTags: [],
    librarySortBy: 'updated',
    libraryView: 'active',
    semanticStatus: { available: false },
    semanticResults: null,
  };
  return renderLibraryHtml(state, buildLibraryModel(state, { now: new Date('2026-07-06T12:00:00.000Z') }));
}

test('SYNTH chip renders only on synthesized cards', () => {
  const html = render([
    doc({ id: 'a', title: 'src', kind: 'source' }),
    doc({ id: 'b', title: 'syn', kind: 'synthesized' }),
  ]);
  const matches = html.match(/chip--synth/g) || [];
  assert.equal(matches.length, 1, 'exactly one synthesized card should render the chip');
  assert.match(html, /class="chip chip--synth"[^>]*>SYNTH</);
});

test('STALE chip renders only on stale cards', () => {
  const html = render([
    doc({ id: 'a', title: 'fresh', stale: false }),
    doc({ id: 'b', title: 'old', stale: true }),
  ]);
  const matches = html.match(/chip--stale/g) || [];
  assert.equal(matches.length, 1, 'exactly one stale card should render the chip');
  assert.match(html, /class="chip chip--stale"[^>]*>STALE</);
});

test('a synthesized AND stale doc shows both chips on its card', () => {
  const html = render([doc({ id: 'b', title: 'derived', kind: 'synthesized', stale: true })]);
  assert.equal((html.match(/chip--synth/g) || []).length, 1);
  assert.equal((html.match(/chip--stale/g) || []).length, 1);
  assert.match(html, /chip--synth[^]*chip--stale/);
});

test('plain source non-stale card renders neither chip', () => {
  const html = render([doc({ id: 'a', title: 'clean' })]);
  assert.equal(html.includes('chip--synth'), false);
  assert.equal(html.includes('chip--stale'), false);
});
