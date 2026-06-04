import test from 'node:test';
import assert from 'node:assert/strict';
import { formatSearchResults, formatDocument, trustTag } from '../../cli/lib/format.js';

test('trustTag reflects verified + status', () => {
  assert.equal(trustTag({ verified: true, status: 'active' }), '[verified]');
  assert.equal(trustTag({ verified: false, status: 'active' }), '[unverified]');
  assert.equal(trustTag({ verified: true, status: 'superseded' }), '[superseded]');
});

test('formatSearchResults lists title, trust, and snippet', () => {
  const out = formatSearchResults([
    { id: 'a', title: 'Alpha', verified: true, status: 'active', snippet: 'hello' },
    { id: 'b', title: 'Beta', verified: false, status: 'active', snippet: 'world' },
  ]);
  assert.match(out, /Alpha \[verified\]/);
  assert.match(out, /Beta \[unverified\]/);
  assert.match(out, /hello/);
});

test('formatSearchResults handles empty', () => {
  assert.match(formatSearchResults([]), /No results/);
});

test('formatDocument shows trust header and body', () => {
  const out = formatDocument({ id: 'a', title: 'Alpha', verified: false, status: 'active', updatedBy: 'agent', body: '# Body' });
  assert.match(out, /Alpha \[unverified\]/);
  assert.match(out, /updated by agent/);
  assert.match(out, /# Body/);
});
