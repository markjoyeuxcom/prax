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
  '&': { backgroundColor: 'var(--bg)', color: 'var(--text-body)' },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace' },
  '.cm-content': { caretColor: 'var(--caret)', padding: '14px' },
  '.cm-gutters': { backgroundColor: 'var(--bg-deep)', color: 'var(--text-dimmer)', border: 'none', borderRight: '1px solid var(--border)' },
  '.cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--accent) 6%, transparent)', color: 'var(--accent)' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--accent) 4%, transparent)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--caret)', borderLeftWidth: '2px' },
  '.cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'color-mix(in srgb, var(--accent) 22%, transparent) !important' },
  '&.cm-focused': { outline: 'none' },
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
} = {}) {
  if (!host) return null;

  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: String(value ?? ''),
      extensions: [
        lineNumbers(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        markdown(),
        syntaxHighlighting(operatorHighlight, { fallback: true }),
        highlightActiveLine(),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          onChange?.(update.state.doc.toString());
        }),
        operatorTheme,
        keymap.of([...defaultKeymap, ...historyKeymap]),
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
