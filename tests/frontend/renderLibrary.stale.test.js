import test from 'node:test';
import assert from 'node:assert/strict';
import { renderLibraryHtml } from '../../public/js/renderLibrary.js';

function row(overrides) {
  return {
    id: overrides.id || 'd1',
    title: overrides.title || 'Doc',
    documentType: 'note',
    sourceFilename: null,
    tags: [],
    kind: overrides.kind || 'source',
    stale: overrides.stale ?? false,
  };
}

test('SYNTH chip renders only on synthesized rows', () => {
  const html = renderLibraryHtml({ documents: [
    row({ id: 'a', title: 'src', kind: 'source' }),
    row({ id: 'b', title: 'syn', kind: 'synthesized' }),
  ]});
  // Naive proxy: count occurrences of chip-synth class.
  const matches = html.match(/chip-synth/g) || [];
  assert.equal(matches.length, 1, 'exactly one synthesized row should render the chip');
  assert.ok(html.includes('SYNTH'), 'chip label appears');
});

test('STALE pill renders only on stale rows', () => {
  const html = renderLibraryHtml({ documents: [
    row({ id: 'a', title: 'fresh', stale: false }),
    row({ id: 'b', title: 'old', stale: true }),
  ]});
  const matches = html.match(/chip-stale/g) || [];
  assert.equal(matches.length, 1, 'exactly one stale row should render the pill');
  assert.ok(html.includes('STALE'), 'pill label appears');
});

test('source non-stale row renders neither chip', () => {
  const html = renderLibraryHtml({ documents: [row({ id: 'a', title: 'clean' })] });
  assert.equal(html.includes('chip-synth'), false);
  assert.equal(html.includes('chip-stale'), false);
});
