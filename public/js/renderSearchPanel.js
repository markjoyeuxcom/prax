import { escapeHtml } from './renderHelpers.js';

// Prax-native find/replace panel for the Markdown editor. It floats over the
// editor (top-right) and drives CodeMirror's search *commands* through the
// mounted controller — the inputs live in the app DOM so they never fight
// CodeMirror's own panel focus behavior. Rendered/updated by main.js via
// direct DOM insertion (NOT renderApp) so CodeMirror is never remounted
// mid-search. Events delegate through main.js by data-action / data-* hooks.

// Human-readable match readout: "3/12", "No results", "Bad pattern", or '' when
// the Find field is empty.
export function searchCountLabel(state) {
  if (!state.searchQuery) return '';
  const info = state.searchMatchInfo || { total: 0, current: 0, valid: true };
  if (info.valid === false) return 'Bad pattern';
  if (!info.total) return 'No results';
  return `${info.current || '·'}/${info.total}${info.capped ? '+' : ''}`;
}

export function renderSearchPanelHtml(state) {
  const toggle = (key, label, title, on) =>
    `<button type="button" class="editor-search__toggle${on ? ' is-on' : ''}" data-action="search-toggle-${key}" title="${title}" aria-label="${title}" aria-pressed="${Boolean(on)}">${label}</button>`;

  return `
    <div class="editor-search" role="search" data-editor-search>
      <div class="editor-search__row">
        <input class="editor-search__input" type="text" data-search-find placeholder="Find" value="${escapeHtml(state.searchQuery || '')}" autocomplete="off" spellcheck="false" aria-label="Find">
        <span class="editor-search__count" data-search-count>${escapeHtml(searchCountLabel(state))}</span>
        <button type="button" class="editor-search__btn" data-action="search-previous" title="Previous match (⇧⏎)" aria-label="Previous match">↑</button>
        <button type="button" class="editor-search__btn" data-action="search-next" title="Next match (⏎)" aria-label="Next match">↓</button>
        ${toggle('case', 'Aa', 'Match case', state.searchCaseSensitive)}
        ${toggle('word', 'W', 'Whole word', state.searchWholeWord)}
        ${toggle('regexp', '.*', 'Regular expression', state.searchRegexp)}
        <button type="button" class="editor-search__btn" data-action="close-editor-search" title="Close (Esc)" aria-label="Close search">✕</button>
      </div>
      <div class="editor-search__row">
        <input class="editor-search__input" type="text" data-search-replace placeholder="Replace" value="${escapeHtml(state.searchReplace || '')}" autocomplete="off" spellcheck="false" aria-label="Replace">
        <button type="button" class="editor-search__btn editor-search__btn--text" data-action="search-replace" title="Replace current match (⏎)">Replace</button>
        <button type="button" class="editor-search__btn editor-search__btn--text" data-action="search-replace-all" title="Replace every match">All</button>
      </div>
    </div>`;
}
