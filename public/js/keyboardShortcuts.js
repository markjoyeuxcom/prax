// Pure: given a keydown-like descriptor and the pending chord prefix,
// return { action, view, pending } where action/view may be null and
// pending is the next chord-prefix state ('' or 'g').
//
// The Prax keymap: ⌘K palette · ⌘I assistant · ⌘J theme · ⌘/ shortcuts · N capture · E done ·
// ↑↓/↵ list navigation · Esc close-cascade · '/' searches (the Library's bar there,
// the palette elsewhere) · plus
// the legacy g-chord view navigation (g t/b/k/a/l).
export function matchShortcut({ key, metaOrCtrl = false, alt = false }, pending = '') {
  if (metaOrCtrl) {
    const k = String(key || '').toLowerCase();
    if (k === 'k') return { action: 'palette', view: null, pending: '' };
    if (k === 'i') return { action: 'assistant', view: null, pending: '' };
    if (k === 'j') return { action: 'theme', view: null, pending: '' };
    if (k === '/') return { action: 'shortcuts', view: null, pending: '' };
    return { action: null, view: null, pending: '' };
  }
  if (alt) return { action: null, view: null, pending: '' };

  // Chord: 'g' then a view letter.
  if (pending === 'g') {
    const views = { t: 'list', b: 'board', k: 'backlog', a: 'archive', l: 'library' };
    return { action: null, view: views[key] || null, pending: '' };
  }
  if (key === 'g') return { action: null, view: null, pending: 'g' };

  const actions = {
    '/': 'search',
    n: 'capture',
    e: 'toggle-done',
    Escape: 'escape',
    ArrowDown: 'nav-down',
    ArrowUp: 'nav-up',
    Enter: 'open-selected',
  };
  return { action: actions[key] || null, view: null, pending: '' };
}

// Global one-key commands must not steal Enter, letters, or arrows from a
// focused native control. Meta/Ctrl commands and Escape remain global.
export function isInteractiveShortcutTarget(target) {
  const tag = String(target?.tagName || '').toUpperCase();
  if (tag === 'BUTTON' || tag === 'SUMMARY') return true;
  if (tag === 'A' && (target?.hasAttribute?.('href') || target?.href)) return true;
  return Boolean(target?.closest?.('button, a[href], summary, [role="button"]'));
}

// A key that is part of an IME composition (Japanese, Chinese, Korean, …):
// Escape cancels and Enter commits the composition, never the app's action.
// WebKit reports the committing keydown with isComposing false and keyCode
// 229, so both signals count.
export function isImeComposing(event) {
  return Boolean(event?.isComposing) || event?.keyCode === 229;
}

// The global-shortcut layer: returns the keydown handler the keyboard
// dispatcher (keyboardDispatcher.js) runs last, after every surface-specific
// layer let the key pass. It keeps the g-chord state between keys.
export function createGlobalShortcuts({ handlers }) {
  let pending = '';
  let pendingTimer = null;

  const clearPending = () => {
    pending = '';
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
  };

  function isTypingTarget(target) {
    if (!target) return false;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (target.isContentEditable) return true;
    if (target.closest && target.closest('.cm-editor')) return true; // CodeMirror
    return false;
  }

  return function handleGlobalShortcut(event) {
    if (isImeComposing(event)) return;
    const metaOrCtrl = event.metaKey || event.ctrlKey;
    // ⌘K/⌘J work everywhere, Escape works everywhere; other shortcuts are
    // suppressed while typing.
    const typing = isTypingTarget(event.target);
    const interactive = isInteractiveShortcutTarget(event.target);
    if ((typing || interactive) && event.key !== 'Escape' && !metaOrCtrl) return;
    const result = matchShortcut({ key: event.key, metaOrCtrl, alt: event.altKey }, pending);
    // An open modal (a confirm, the task drawer, ...) owns the one-key
    // commands: a letter, arrow or Enter must not act on the workspace behind
    // it. N still opens quick capture, a new layer above (capture from the
    // drawer is a supported flow; main.js refuses it over a confirm).
    if (event.key !== 'Escape' && !metaOrCtrl && result.action !== 'capture' && handlers.modalOpen?.()) {
      clearPending();
      return;
    }

    if (result.pending === 'g') {
      pending = 'g';
      pendingTimer = setTimeout(clearPending, 1200);
      event.preventDefault();
      return;
    }
    clearPending();

    if (result.view) { event.preventDefault(); handlers.switchView(result.view); return; }
    if (!result.action) return;

    if (result.action === 'escape') { handlers.escape(); return; }
    event.preventDefault();
    switch (result.action) {
      case 'palette': handlers.openPalette(); break;
      case 'search': if (handlers.search) handlers.search(); else handlers.openPalette(); break;
      case 'assistant': handlers.openAssistant?.(); break;
      case 'theme': handlers.toggleTheme(); break;
      case 'shortcuts': handlers.openShortcuts?.(); break;
      case 'capture': handlers.openCapture(); break;
      case 'toggle-done': handlers.toggleDoneSelected(); break;
      case 'nav-down': handlers.navigate(1); break;
      case 'nav-up': handlers.navigate(-1); break;
      case 'open-selected': handlers.openSelected(); break;
      default: break;
    }
  };
}

// Standalone installation of the global layer on the document.
export function installKeyboardShortcuts({ handlers }) {
  document.addEventListener('keydown', createGlobalShortcuts({ handlers }));
}
