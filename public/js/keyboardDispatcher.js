// One keyboard dispatcher for the whole app.
//
// A single document-level keydown listener routes every key through an
// ordered list of layers. Each layer sees the key only when every layer above
// it let it pass, so which surface owns a key is decided in one place instead
// of by listener registration order (#app vs document, capture vs bubble).
//
// Priority order (main.js wires the layers; see installKeyboard there):
//   0. IME composition — a key that commits or cancels a composition belongs
//      to the IME and reaches no layer (isImeComposing: WebKit reports the
//      committing Enter with isComposing false but keyCode 229).
//   1. Plan / shutdown walk — Enter runs the primary decision, S skips, a
//      held Enter is swallowed. Also for keys whose target is <body>, where
//      focus sits after a render. Consumes what it handles.
//   2. Inbox processing dialog (#app targets) — Escape closes, Tab wraps.
//   3. Modal focus trap — Tab / Shift+Tab stay inside the topmost aria-modal
//      overlay (modalFocus.js), for #app and <body> targets alike.
//   4. Template studio (#app targets) — owns every key while open; Escape closes.
//   5. Workspace fields (#app targets) — ⌘F find, then per-field keys: find /
//      replace, palette, new project, confirm input, capture Enter (⌘Enter =
//      AI parse), filter ⌘Enter, Ask Prax, assistant, project rename,
//      Markdown checkboxes, checklist, labels, library search, the fallback
//      editor's formatting shortcuts.
//   5b. Review desk (main.js, #app and <body> targets) — V verify, E edit,
//      M supersede, R reject, J skip, ↑↓ move, while the desk is open and the
//      key is not typed into a field. Consumes what it handles.
//   6. Global shortcuts (keyboardShortcuts.js) — ⌘K / ⌘I / ⌘J / ⌘/, N, E,
//      ↑↓ ↵, '/', the g-chords, and the Escape cascade. One-key commands never
//      act from a typing target or a focused button (Enter on a button stays
//      the button's), and an open modal owns them — except N, which opens
//      capture as a new layer (N from the task drawer).
//
// A layer returns:
//   KEY_CONSUMED — the key is fully handled; no later layer sees it.
//   KEY_HANDLED  — the layer acted; the remaining workspace layers skip the key
//                  but the global layer still sees it (it ignores typing
//                  targets except for Escape and ⌘ commands). This keeps the
//                  long-standing contract that, e.g., Escape in the capture
//                  field reaches the Escape cascade.
//   anything else — not this layer's key; routing continues.

import { isImeComposing } from './keyboardShortcuts.js';

export const KEY_CONSUMED = 'consumed';
export const KEY_HANDLED = 'handled';

// layers: [{ name, scope?: 'app', global?: true, handle(event, context) }]
// scope 'app' layers see only keys whose target is inside the app root;
// global layers run even after an earlier layer returned KEY_HANDLED.
// A layer that throws is reported like an uncaught listener error and routing
// continues, as it did when each surface had a listener of its own.
export function createKeyboardDispatcher({
  getRoot, layers, isComposing = isImeComposing,
  reportError = (error) => (globalThis.reportError ? globalThis.reportError(error) : console.error(error)),
}) {
  function dispatch(event) {
    if (isComposing(event)) return null;
    const root = getRoot();
    const inApp = Boolean(root && event.target && root.contains?.(event.target));
    let handledBy = null;
    for (const layer of layers) {
      if (handledBy && !layer.global) continue;
      if (layer.scope === 'app' && !inApp) continue;
      let result;
      try {
        result = layer.handle(event, { inApp, handledBy });
      } catch (error) {
        reportError(error);
        continue;
      }
      if (result === KEY_CONSUMED) return layer.name;
      if (result === KEY_HANDLED && !handledBy) handledBy = layer.name;
    }
    return handledBy;
  }

  function install(doc = globalThis.document) {
    doc.addEventListener('keydown', dispatch);
    return () => doc.removeEventListener('keydown', dispatch);
  }

  return { dispatch, install, order: layers.map(layer => layer.name) };
}
