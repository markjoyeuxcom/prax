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
import { autocompletion, startCompletion, completionStatus } from '@codemirror/autocomplete';
import { tags } from '@lezer/highlight';

import { applyMarkdownFormat, continueListOnEnter } from '../public/js/markdownEditor.js';

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
  // Autocomplete popup (slash menu + wiki-links), themed to the Prax palette.
  '.cm-tooltip.cm-tooltip-autocomplete': {
    backgroundColor: 'var(--card)',
    border: '1px solid var(--line2)',
    borderRadius: '10px',
    boxShadow: 'var(--pop, 0 12px 32px rgba(0,0,0,.18))',
    overflow: 'hidden',
    padding: '4px',
    fontFamily: 'var(--font-ui, system-ui)',
  },
  // "> ul" matches the base theme's specificity so the UI font wins over its monospace.
  '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font-ui, system-ui)', maxHeight: '18em', minWidth: '340px', maxWidth: 'min(560px, 80vw)' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
    display: 'flex', alignItems: 'center', gap: '12px', minHeight: '30px', padding: '0 10px',
    borderRadius: '6px', color: 'var(--text-body)', lineHeight: '1.4',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--accent-soft, color-mix(in srgb, var(--accent) 16%, transparent))', color: 'var(--text-body)' },
  '.cm-completionLabel': { fontSize: '13px', flex: '1 1 auto', minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  '.cm-completionMatchedText': { textDecoration: 'none', color: 'var(--accent)', fontWeight: '600' },
  '.cm-completionDetail': { color: 'var(--text-dimmer)', fontStyle: 'normal', marginLeft: 'auto', fontSize: '11px', fontFamily: 'var(--font-mono, monospace)', whiteSpace: 'nowrap' },
  '.cm-opt--verified .cm-completionDetail': { color: 'var(--accent)' },
  '.cm-opt--unverified .cm-completionDetail': { color: 'var(--agent, var(--text-dimmer))' },
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

// Apply a Markdown formatting action at the current selection. Shared by the
// toolbar (controller.applyFormat) and the slash menu.
function runFormat(view, action) {
  const value = view.state.doc.toString();
  const sel = view.state.selection.main;
  const result = applyMarkdownFormat(value, sel.from, sel.to, action);
  view.dispatch({
    changes: { from: 0, to: value.length, insert: result.value },
    selection: { anchor: result.selectionStart, head: result.selectionEnd },
    scrollIntoView: true,
  });
  view.focus();
}

// Slash menu: type "/" at the start of a line for a block/inline formatting
// command. Each option deletes the "/query" and runs the shared format path,
// so there is no new formatting logic to maintain.
const SLASH_COMMANDS = [
  { key: 'heading', action: 'heading', detail: 'H2 heading' },
  { key: 'bullet', action: 'bullet-list', detail: '• bullet list' },
  { key: 'numbered', action: 'numbered-list', detail: '1. numbered list' },
  { key: 'task', action: 'checklist', detail: '☐ to-do item' },
  { key: 'quote', action: 'quote', detail: '❝ blockquote' },
  { key: 'code', action: 'code-block', detail: '‹⁄› code block' },
  { key: 'bold', action: 'bold', detail: 'bold text' },
  { key: 'italic', action: 'italic', detail: 'italic text' },
  { key: 'inline-code', action: 'code', detail: 'inline code' },
  { key: 'link', action: 'link', detail: 'link' },
];

function slashCompletionSource(context) {
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const match = /^\s*\/(\w*)$/.exec(before);
  if (!match) return null;
  const from = context.pos - match[1].length - 1; // include the leading '/'
  return {
    from,
    to: context.pos,
    validFor: /^\/\w*$/,
    options: SLASH_COMMANDS.map((cmd) => ({
      label: `/${cmd.key}`,
      detail: cmd.detail,
      apply: (view, _completion, fromPos, toPos) => {
        view.dispatch({ changes: { from: fromPos, to: toPos, insert: '' }, selection: { anchor: fromPos } });
        runFormat(view, cmd.action);
      },
    })),
  };
}

// Wiki-links: typing "[[" offers document titles; selecting one inserts
// "[[Title]]". Titles come from the provider (the app's current document list).
function makeWikiCompletionSource(documentsProvider) {
  return function wikiCompletionSource(context) {
    const before = context.state.sliceDoc(Math.max(0, context.pos - 160), context.pos);
    const match = /\[\[([^\]\n[]*)$/.exec(before);
    if (!match) return null;
    const from = context.pos - match[1].length;
    const docs = (typeof documentsProvider === 'function' ? documentsProvider() : []) || [];
    const options = docs
      .filter((doc) => doc && doc.title)
      .slice(0, 200)
      .map((doc) => ({
        label: doc.title,
        // Console redesign: the type and trust ride along, and verified
        // documents rank first among equal matches.
        detail: [doc.documentType ? String(doc.documentType).replace(/-/g, ' ') : '', doc.verified === true ? '✓' : (doc.verified === false ? '◌' : '')]
          .filter(Boolean).join(' '),
        boost: doc.verified === true ? 1 : 0,
        trust: doc.verified === true ? 'verified' : (doc.verified === false ? 'unverified' : ''),
        type: 'text',
        apply: (view, _completion, fromPos, toPos) => {
          const after = view.state.sliceDoc(toPos, Math.min(view.state.doc.length, toPos + 2));
          const close = after === ']]' ? '' : ']]';
          view.dispatch({
            changes: { from: fromPos, to: toPos, insert: doc.title + close },
            selection: { anchor: fromPos + doc.title.length + close.length },
          });
        },
      }));
    if (!options.length) return null;
    return { from, options, validFor: /^[^\]\n[]*$/ };
  };
}

// Enter inside a Markdown list/quote continues the marker (or exits an empty
// item). Only acts with a collapsed caret at the end of the line — otherwise it
// returns false and the default Enter (newline) runs.
function listContinuationEnter(view) {
  // Never fire while a completion popup (slash menu / wiki-links) is open —
  // Enter belongs to the popup (accept). During the popup's brief interaction
  // delay CM's accept returns false; falling through to a list continuation
  // here would be surprising, so we defer to the default newline instead.
  if (completionStatus(view.state) === 'active') return false;
  const sel = view.state.selection.main;
  if (!sel.empty) return false;
  const line = view.state.doc.lineAt(sel.head);
  if (sel.head !== line.to) return false;
  const result = continueListOnEnter(line.text);
  if (result.action === 'none') return false;
  if (result.action === 'exit') {
    // Empty item: clear the marker and drop out of the list.
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: '' },
      selection: { anchor: line.from },
      userEvent: 'delete',
    });
    return true;
  }
  const insert = `\n${result.prefix}`;
  view.dispatch({
    changes: { from: sel.head, insert },
    selection: { anchor: sel.head + insert.length },
    scrollIntoView: true,
    userEvent: 'input',
  });
  return true;
}

export function mountCodeMirrorEditor({
  host,
  value = '',
  onChange,
  onSave,
  documentsProvider,
  onSelectionChange,
  lineNumbers: showLineNumbers = false,
  cursorToEnd = true,
} = {}) {
  if (!host) return null;

  const wikiCompletionSource = makeWikiCompletionSource(documentsProvider);

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
        autocompletion({ override: [slashCompletionSource, wikiCompletionSource], icons: false, defaultKeymap: true, optionClass: (option) => (option.trust ? `cm-opt--${option.trust}` : '') }),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ 'aria-label': 'Markdown document body' }),
        EditorView.updateListener.of((update) => {
          // Selection reporting (the Console editor's floating action bar):
          // measured in CodeMirror's read phase, never during the update.
          if (onSelectionChange && (update.selectionSet || update.docChanged || update.focusChanged || update.geometryChanged)) {
            const sel = update.state.selection.main;
            update.view.requestMeasure({
              read(view) {
                if (sel.empty) return null;
                const a = view.coordsAtPos(sel.from);
                const b = view.coordsAtPos(sel.to, -1);
                return a && b ? { top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom), left: a.left, right: b.right } : null;
              },
              write(rect, view) {
                onSelectionChange({ from: sel.from, to: sel.to, empty: sel.empty, rect, focused: view.hasFocus });
              },
            });
          }
          if (!update.docChanged) return;
          onChange?.(update.state.doc.toString());
          // Slash menu ("/" at line start) and wiki-link ("[[") triggers aren't
          // word characters, so autocomplete won't auto-open — nudge it here.
          if (!update.transactions.some((tr) => tr.isUserEvent('input.type'))) return;
          const sel = update.state.selection.main;
          if (!sel.empty) return;
          const line = update.state.doc.lineAt(sel.head);
          const lineBefore = update.state.doc.sliceString(line.from, sel.head);
          const lastTwo = update.state.doc.sliceString(Math.max(0, sel.head - 2), sel.head);
          if (/^\s*\/$/.test(lineBefore) || lastTwo === '[[') {
            Promise.resolve().then(() => startCompletion(update.view));
          }
        }),
        operatorTheme,
        // Higher precedence than the default keymap (earlier in the array), so
        // Enter continues a list before the default newline runs, and the format
        // shortcuts the toolbar advertises fire in CodeMirror (they overrode
        // nothing before — a contentEditable's native Cmd-B would insert <b>).
        keymap.of([
          { key: 'Enter', run: listContinuationEnter },
          { key: 'Mod-b', preventDefault: true, run: (view) => { runFormat(view, 'bold'); return true; } },
          { key: 'Mod-i', preventDefault: true, run: (view) => { runFormat(view, 'italic'); return true; } },
          { key: 'Mod-e', preventDefault: true, run: (view) => { runFormat(view, 'code'); return true; } },
        ]),
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
    // Primary selection as document offsets ({from, to}; equal for a bare
    // caret), and whether the editor holds keyboard focus — so a host re-render
    // that has to remount the editor can put the person back where they were.
    getSelectionRange() {
      const sel = view.state.selection.main;
      return { from: sel.from, to: sel.to };
    },
    setSelectionRange(from, to = from) {
      const len = view.state.doc.length;
      const clamp = (pos) => Math.max(0, Math.min(len, Number(pos) || 0));
      view.dispatch({ selection: { anchor: clamp(from), head: clamp(to) } });
    },
    hasFocus() {
      return view.hasFocus;
    },
    // An opaque scroll position (CodeMirror's own scrollSnapshot effect) that
    // restoreScroll re-applies to a freshly mounted editor on the same text.
    scrollSnapshot() {
      return view.scrollSnapshot();
    },
    restoreScroll(snapshot) {
      if (snapshot) view.dispatch({ effects: snapshot });
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
      runFormat(view, action);
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
