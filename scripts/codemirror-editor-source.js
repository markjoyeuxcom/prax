import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import {
  bracketMatching,
  defaultHighlightStyle,
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

import { applyMarkdownFormat } from '../public/js/markdownEditor.js';

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
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        highlightActiveLine(),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          onChange?.(update.state.doc.toString());
        }),
        EditorView.theme({
          '&': {
            height: '100%',
          },
          '.cm-scroller': {
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
          },
        }),
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
