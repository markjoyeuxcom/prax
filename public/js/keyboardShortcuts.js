// Pure: given a keydown-like descriptor and the pending chord prefix,
// return { action, view, pending } where action/view may be null and
// pending is the next chord-prefix state ('' or 'g').
export function matchShortcut({ key, hasModifier }, pending = '') {
  // Modifiers (cmd/ctrl/alt) never trigger app shortcuts.
  if (hasModifier) return { action: null, view: null, pending: '' };

  // Chord: 'g' then a view letter.
  if (pending === 'g') {
    const views = { t: 'list', b: 'board', k: 'backlog', a: 'archive', l: 'library' };
    return { action: null, view: views[key] || null, pending: '' };
  }
  if (key === 'g') return { action: null, view: null, pending: 'g' };

  const actions = {
    '/': 'focus-search',
    n: 'new',
    e: 'edit',
    d: 'archive',
    Escape: 'escape',
  };
  return { action: actions[key] || null, view: null, pending: '' };
}

export function installKeyboardShortcuts({ getState, handlers }) {
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
    // Escape always allowed (to close things / blur), even from inputs.
    const typing = isTypingTarget(event.target);
    if (typing && event.key !== 'Escape') return;

    const hasModifier = event.metaKey || event.ctrlKey || event.altKey;
    const result = matchShortcut({ key: event.key, hasModifier }, pending);

    if (result.pending === 'g') {
      pending = 'g';
      pendingTimer = setTimeout(clearPending, 1200);
      event.preventDefault();
      return;
    }
    clearPending();

    if (result.view) { event.preventDefault(); handlers.switchView(result.view); return; }

    switch (result.action) {
      case 'focus-search': event.preventDefault(); handlers.focusSearch(); break;
      case 'new': event.preventDefault(); handlers.newItem(); break;
      case 'edit': event.preventDefault(); handlers.editSelected(); break;
      case 'archive': event.preventDefault(); handlers.archiveSelected(); break;
      case 'escape': handlers.escape(); break;
      default: break;
    }
  });
}
