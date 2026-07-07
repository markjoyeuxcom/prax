import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import {
  search,
  SearchQuery,
  setSearchQuery,
  getSearchQuery,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
  openSearchPanel,
  highlightSelectionMatches,
} from '@codemirror/search';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';

import { applyMarkdownFormat } from '../public/js/markdownEditor.js';

// Colors reference CSS custom properties so the editor follows the active
// palette (console / graphite / daylight). CodeMirror injects these as real
// CSS, so var() and color-mix() resolve against :root at paint time.
const operatorTheme = EditorView.theme({
  // Transparent: the sheet (page) behind the editor is the surface.
  '&': { backgroundColor: 'transparent', color: 'var(--text-body)' },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace' },
  '.cm-content': { caretColor: 'var(--caret)', padding: '24px 32px 60px' },
  '.cm-gutters': { backgroundColor: 'var(--bg-deep)', color: 'var(--text-dimmer)', border: 'none', borderRight: '1px solid var(--border)' },
  '.cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--accent) 6%, transparent)', color: 'var(--accent)' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--accent) 4%, transparent)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--caret)', borderLeftWidth: '2px' },
  '.cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'color-mix(in srgb, var(--accent) 22%, transparent) !important' },
  '&.cm-focused': { outline: 'none' },
  // The search panel is invisible (our real UI is Prax-native) — hide CM's
  // panel container so its base-theme border never shows. Match highlighting
  // is gated on the panel's JS state, not its CSS, so this is safe.
  '.cm-panels': { display: 'none' },
  // Search-match highlights. The find/replace UI itself is a Prax-native panel
  // (public/js/renderSearchPanel.js), not CodeMirror's built-in panel — but the
  // search() extension still tracks the query and paints these highlights.
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--accent) 22%, transparent)', borderRadius: '2px' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, var(--accent) 45%, transparent)' },
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--accent) 14%, transparent)' },
}, { dark: true });

const operatorHighlight = HighlightStyle.define([
  { tag: tags.heading,         color: 'var(--accent)', fontWeight: '700' },
  { tag: tags.strong,          color: 'var(--accent-amber)', fontWeight: '700' },
  { tag: tags.emphasis,        color: 'var(--text-body)', fontStyle: 'italic' },
  { tag: tags.link,            color: 'var(--accent-cyan)', textDecoration: 'underline' },
  { tag: tags.monospace,       color: 'var(--accent-amber)', backgroundColor: 'var(--bg-deep)' },
  { tag: tags.quote,           color: 'var(--accent-cyan)' },
  { tag: tags.keyword,         color: 'var(--accent)' },
  { tag: tags.comment,         color: 'var(--text-dimmer)', fontStyle: 'italic' },
]);

// CodeMirror only paints match highlights while a search panel is "open"
// (searchHighlighter gates on state.panel). Our real UI is the Prax-native
// panel, so we hand CM an invisible, empty panel to satisfy that gate — then
// keep it permanently open. It has no focusable content, so it never competes
// for keyboard focus.
function hiddenSearchPanel() {
  const dom = document.createElement('div');
  dom.className = 'cm-search-hidden';
  dom.style.display = 'none';
  return { dom, top: true };
}

function saveKeymap(onSave) {
  return keymap.of([
    {
      key: 'Mod-s',
      run() {
        onSave?.();
        return true;
      },
    },
  ]);
}

// Count total matches for the current query and which one (1-based) the primary
// selection currently sits on (0 = none). Powers the panel's "n of N" readout.
// Returns { total, current, valid } — valid:false for a broken regexp.
function searchMatchInfo(view) {
  // getSearchQuery returns the SearchQuery *spec* — it exposes getCursor (a
  // SearchCursor) but not matchAll (that lives on the internal query type). We
  // iterate the cursor to count total matches and which one (1-based) the
  // primary selection sits on. Capped so a pathological query can't hang.
  const query = getSearchQuery(view.state);
  if (!query || !query.search) return { total: 0, current: 0, valid: true };
  if (!query.valid) return { total: 0, current: 0, valid: false };
  const sel = view.state.selection.main;
  const cursor = query.getCursor(view.state);
  let total = 0;
  let current = 0;
  const LIMIT = 5000;
  while (!cursor.next().done) {
    total += 1;
    const range = cursor.value;
    if (range.from === sel.from && range.to === sel.to) current = total;
    if (total >= LIMIT) return { total: LIMIT, current, valid: true, capped: true };
  }
  return { total, current, valid: true };
}

export function mountCodeMirrorEditor({
  host,
  value = '',
  onChange,
  onSave,
  lineNumbers: showLineNumbers = false,
  cursorToEnd = true,
} = {}) {
  if (!host) return null;

  const doc = String(value ?? '');
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc,
      // Open with the caret at the end so typing continues the document
      // instead of landing above the title heading.
      selection: cursorToEnd ? { anchor: doc.length } : undefined,
      extensions: [
        ...(showLineNumbers ? [lineNumbers()] : []),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        markdown(),
        syntaxHighlighting(operatorHighlight, { fallback: true }),
        highlightActiveLine(),
        highlightSelectionMatches(),
        // Track the query + paint match highlights. The panel is invisible
        // (hiddenSearchPanel) because our real find/replace UI is Prax-native —
        // CM's panel exists only to keep highlighting alive (see openSearchPanel
        // below).
        search({ createPanel: hiddenSearchPanel }),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          onChange?.(update.state.doc.toString());
        }),
        operatorTheme,
        // Note: Mod-f (open search) is handled by Prax's own keydown listener
        // so it works from the panel inputs too, not just the focused editor.
        keymap.of([...defaultKeymap, ...historyKeymap]),
        ...(onSave ? [saveKeymap(onSave)] : []),
      ],
    }),
  });

  // Open the invisible panel so match highlights render whenever a query is
  // set. The panel has no focusable content, so this doesn't move focus.
  openSearchPanel(view);

  return {
    getValue() {
      return view.state.doc.toString();
    },
    focus() {
      view.focus();
    },
    // Text of the primary selection ('' when nothing is selected) — used to
    // seed the Find field from a selection when the panel opens.
    getSelectionText() {
      const sel = view.state.selection.main;
      return sel.empty ? '' : view.state.sliceDoc(sel.from, sel.to);
    },
    scrollToLine(lineNumber) {
      const line = view.state.doc.line(
        Math.max(1, Math.min(view.state.doc.lines, Number(lineNumber) + 1)),
      );
      view.dispatch({
        selection: { anchor: line.from },
        effects: EditorView.scrollIntoView(line.from, { y: 'start' }),
      });
      view.focus();
    },
    applyFormat(action) {
      const currentValue = view.state.doc.toString();
      const selection = view.state.selection.main;
      const result = applyMarkdownFormat(currentValue, selection.from, selection.to, action);

      view.dispatch({
        changes: { from: 0, to: currentValue.length, insert: result.value },
        selection: { anchor: result.selectionStart, head: result.selectionEnd },
        scrollIntoView: true,
      });
      view.focus();
    },

    // ---- Search (driven by the Prax-native panel) --------------------------
    // Each method returns the current match info so the caller can update the
    // "n of N" readout without touching CodeMirror focus. Replace commands act
    // on document ranges and never need the editor focused.
    applySearch({ search: term = '', replace = '', caseSensitive = false, regexp = false, wholeWord = false } = {}) {
      const query = new SearchQuery({ search: term, replace, caseSensitive, regexp, wholeWord });
      view.dispatch({ effects: setSearchQuery.of(query) });
      return searchMatchInfo(view);
    },
    searchNext() { findNext(view); return searchMatchInfo(view); },
    searchPrevious() { findPrevious(view); return searchMatchInfo(view); },
    replaceMatch() { replaceNext(view); return searchMatchInfo(view); },
    replaceAllMatches() { replaceAll(view); return searchMatchInfo(view); },
    searchInfo() { return searchMatchInfo(view); },
    clearSearch() {
      view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: '' })) });
    },

    destroy() {
      view.destroy();
    },
  };
}
