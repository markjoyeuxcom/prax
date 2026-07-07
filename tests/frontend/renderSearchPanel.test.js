import test from 'node:test';
import assert from 'node:assert/strict';

import { renderSearchPanelHtml, searchCountLabel } from '../../public/js/renderSearchPanel.js';

function baseState(overrides = {}) {
  return {
    searchQuery: '',
    searchReplace: '',
    searchCaseSensitive: false,
    searchWholeWord: false,
    searchRegexp: false,
    searchMatchInfo: { total: 0, current: 0, valid: true },
    ...overrides,
  };
}

test('searchCountLabel: empty query shows nothing', () => {
  assert.equal(searchCountLabel(baseState()), '');
});

test('searchCountLabel: n/total, no-results, bad-pattern, and capped', () => {
  assert.equal(searchCountLabel(baseState({ searchQuery: 'cat', searchMatchInfo: { total: 12, current: 3, valid: true } })), '3/12');
  // current 0 (query set but no match selected yet) shows a placeholder dot
  assert.equal(searchCountLabel(baseState({ searchQuery: 'cat', searchMatchInfo: { total: 5, current: 0, valid: true } })), '·/5');
  assert.equal(searchCountLabel(baseState({ searchQuery: 'zzz', searchMatchInfo: { total: 0, current: 0, valid: true } })), 'No results');
  assert.equal(searchCountLabel(baseState({ searchQuery: '(', searchMatchInfo: { total: 0, current: 0, valid: false } })), 'Bad pattern');
  assert.equal(searchCountLabel(baseState({ searchQuery: 'a', searchMatchInfo: { total: 5000, current: 0, valid: true, capped: true } })), '·/5000+');
});

test('panel renders find + replace inputs with escaped values and the action hooks', () => {
  const html = renderSearchPanelHtml(baseState({ searchQuery: 'a<b>', searchReplace: '"x"' }));
  assert.match(html, /data-editor-search/);
  assert.match(html, /data-search-find[^>]*value="a&lt;b&gt;"/);
  assert.match(html, /data-search-replace[^>]*value="&quot;x&quot;"/);
  assert.match(html, /data-search-count/);
  for (const action of ['search-previous', 'search-next', 'close-editor-search', 'search-replace', 'search-replace-all',
    'search-toggle-case', 'search-toggle-word', 'search-toggle-regexp']) {
    assert.match(html, new RegExp(`data-action="${action}"`));
  }
});

test('option toggles reflect state with is-on + aria-pressed', () => {
  const off = renderSearchPanelHtml(baseState());
  assert.match(off, /data-action="search-toggle-case"[^>]*aria-pressed="false"/);
  assert.doesNotMatch(off, /editor-search__toggle is-on"[^>]*data-action="search-toggle-case"/);

  const on = renderSearchPanelHtml(baseState({ searchCaseSensitive: true, searchRegexp: true }));
  assert.match(on, /class="editor-search__toggle is-on"[^>]*data-action="search-toggle-case"[^>]*aria-pressed="true"/);
  assert.match(on, /class="editor-search__toggle is-on"[^>]*data-action="search-toggle-regexp"[^>]*aria-pressed="true"/);
  // whole-word left off
  assert.match(on, /data-action="search-toggle-word"[^>]*aria-pressed="false"/);
});

test('the count reflects the current match info in the rendered markup', () => {
  const html = renderSearchPanelHtml(baseState({ searchQuery: 'cat', searchMatchInfo: { total: 9, current: 2, valid: true } }));
  assert.match(html, /data-search-count>2\/9</);
});
