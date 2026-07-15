// Pure: given a keydown-like descriptor and the pending chord prefix,
// return { action, view, pending } where action/view may be null and
// pending is the next chord-prefix state ('' or 'g').
//
// The Prax keymap: ⌘K palette · ⌘I assistant · ⌘J theme · N capture · E done ·
// ↑↓/↵ list navigation · Esc close-cascade · '/' also opens the palette · plus
// the legacy g-chord view navigation (g t/b/k/a/l).
export function matchShortcut({ key, metaOrCtrl = false, alt = false }, pending = '') {
  if (metaOrCtrl) {
    const k = String(key || '').toLowerCase();
    if (k === 'k') return { action: 'palette', view: null, pending: '' };
    if (k === 'i') return { action: 'assistant', view: null, pending: '' };
    if (k === 'j') return { action: 'theme', view: null, pending: '' };
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
    '/': 'palette',
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

export function installKeyboardShortcuts({ handlers }) {
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

  document.addEventListener('keydown', (event) => {
    const metaOrCtrl = event.metaKey || event.ctrlKey;
    // ⌘K/⌘J work everywhere, Escape works everywhere; other shortcuts are
    // suppressed while typing.
    const typing = isTypingTarget(event.target);
    const interactive = isInteractiveShortcutTarget(event.target);
    if ((typing || interactive) && event.key !== 'Escape' && !metaOrCtrl) return;

    const result = matchShortcut({ key: event.key, metaOrCtrl, alt: event.altKey }, pending);

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
      case 'assistant': handlers.openAssistant?.(); break;
      case 'theme': handlers.toggleTheme(); break;
      case 'capture': handlers.openCapture(); break;
      case 'toggle-done': handlers.toggleDoneSelected(); break;
      case 'nav-down': handlers.navigate(1); break;
      case 'nav-up': handlers.navigate(-1); break;
      case 'open-selected': handlers.openSelected(); break;
      default: break;
    }
  });
}
