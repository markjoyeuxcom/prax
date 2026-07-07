import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
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
  // Find/replace panel (@codemirror/search) themed to the Prax palette so it
  // reads as part of the app in both light and dark, not CodeMirror's default.
  '.cm-panels': { backgroundColor: 'var(--surface)', color: 'var(--text-body)' },
  '.cm-panel.cm-search': {
    padding: '8px 10px',
    borderTop: '1px solid var(--border)',
    fontFamily: 'var(--font-ui, system-ui)',
    fontSize: '12.5px',
  },
  '.cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label': { fontSize: '12.5px' },
  '.cm-panel.cm-search input[type=text]': {
    backgroundColor: 'var(--card)',
    color: 'var(--text-body)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    padding: '3px 7px',
  },
  '.cm-panel.cm-search button': {
    backgroundColor: 'var(--card)',
    color: 'var(--text-body)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    padding: '2px 8px',
    cursor: 'pointer',
  },
  '.cm-panel.cm-search button:hover': { backgroundColor: 'color-mix(in srgb, var(--accent) 12%, transparent)' },
  '.cm-panel.cm-search .cm-button': { backgroundImage: 'none' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--accent) 22%, transparent)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, var(--accent) 42%, transparent)' },
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
        search({ top: true }),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          onChange?.(update.state.doc.toString());
        }),
        operatorTheme,
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        ...(onSave ? [saveKeymap(onSave)] : []),
      ],
    }),
  });

  return {
    getValue() {
      return view.state.doc.toString();
    },
    focus() {
      view.focus();
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
    destroy() {
      view.destroy();
    },
  };
}
