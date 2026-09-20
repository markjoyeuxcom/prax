// public/js/externalRefresh.js — refresh the workspace after writes made
// OUTSIDE this window: the desktop capture bar (a separate webview), the memory
// skills, the CLI, the MCP server, or another tab. The main window otherwise
// loads its collections once and only refetches after its own writes, so a
// task captured from the menu bar never appeared until the app was relaunched
// (QINV-05: lifecycle state must agree across surfaces).
//
// Triggers: the window regaining focus, the document becoming visible, top-level
// navigation, and a same-origin change announcement (a BroadcastChannel message
// plus a localStorage key, for webviews where the channel does not cross
// documents). The scheduler is pure and testable with an injected clock and
// timer; only the installer touches the DOM.

export const CHANGE_CHANNEL = 'prax-changes';
export const CHANGE_STORAGE_KEY = 'prax:last-external-change';

// A cheap identity of a collection's visible state, so a refresh re-renders
// only when something actually changed (never mid-keystroke for nothing).
export function collectionFingerprint(items) {
  if (!Array.isArray(items)) return '';
  return items
    .map((item) => JSON.stringify([item?.id, item?.updatedAt, item?.archivedAt, item?.status,
      item?.revision, item?.verified, item?.verifiedAt, item?.verifiedBy]))
    .sort()
    .join('|');
}

// Coalesces concurrent triggers into one in-flight load and throttles bursts
// to one load per `minIntervalMs` — but never drops a trigger: one arriving
// inside the interval runs at its end (trailing), so a capture made right
// after a refresh is still picked up by the very next focus.
export function createExternalRefresh({
  load,
  minIntervalMs = 1500,
  now = () => Date.now(),
  schedule = (fn, ms) => setTimeout(fn, ms),
} = {}) {
  if (typeof load !== 'function') throw new Error('createExternalRefresh needs a load function');
  let last = Number.NEGATIVE_INFINITY;
  let inFlight = null;
  let queued = null;
  let armed = false;

  function arm(delay) {
    if (armed) return;
    armed = true;
    schedule(() => {
      armed = false;
      const reason = queued;
      queued = null;
      if (reason) trigger(reason);
    }, Math.max(0, delay));
  }

  function run(reason) {
    last = now();
    // Start the load synchronously so a trigger observed by the caller has
    // already begun its fetch; only the settlement is asynchronous.
    let started;
    try { started = Promise.resolve(load(reason)); } catch (error) { started = Promise.reject(error); }
    inFlight = started
      .catch(() => false)
      .finally(() => {
        inFlight = null;
        if (queued) arm(minIntervalMs - (now() - last));
      });
    return inFlight;
  }

  function trigger(reason = 'unknown') {
    if (inFlight) {
      queued = reason;
      return inFlight;
    }
    const wait = minIntervalMs - (now() - last);
    if (wait > 0) {
      queued = reason;
      arm(wait);
      return null;
    }
    return run(reason);
  }

  return {
    trigger,
    get inFlight() { return inFlight; },
    get pending() { return queued; },
  };
}

// Wire the browser events to a refresher. Returns an uninstall function.
export function installExternalRefreshTriggers({
  refresh,
  target = globalThis.window,
  doc = globalThis.document,
  channelName = CHANGE_CHANNEL,
  storageKey = CHANGE_STORAGE_KEY,
  BroadcastChannelCtor = globalThis.BroadcastChannel,
} = {}) {
  if (!refresh || typeof refresh.trigger !== 'function') throw new Error('installExternalRefreshTriggers needs a refresher');
  const cleanups = [];
  const on = (node, event, handler) => {
    node.addEventListener(event, handler);
    cleanups.push(() => node.removeEventListener(event, handler));
  };
  if (target) on(target, 'focus', () => refresh.trigger('focus'));
  if (doc) on(doc, 'visibilitychange', () => { if (doc.visibilityState === 'visible') refresh.trigger('visible'); });
  if (target) on(target, 'storage', (event) => { if (event?.key === storageKey) refresh.trigger('storage'); });
  if (typeof BroadcastChannelCtor === 'function') {
    try {
      const channel = new BroadcastChannelCtor(channelName);
      channel.onmessage = (event) => { if (event?.data && typeof event.data === 'object') refresh.trigger('broadcast'); };
      cleanups.push(() => channel.close());
    } catch { /* no channel in this environment; focus and visibility still cover it */ }
  }
  return () => { for (const fn of cleanups.splice(0)) { try { fn(); } catch { /* ignore */ } } };
}

// ---- write epoch ----------------------------------------------------------
// A refresh snapshot taken before a local write completed must not overwrite
// that write's result (an older GET landing after a newer PATCH would revert
// the drawer to the pre-save title). Every non-GET request this window makes
// bumps the epoch when it starts and when it settles; a refresh compares the
// epoch around its fetch and discards a snapshot that spans a write.
let epoch = 0;
export function writeEpoch() { return epoch; }
export function noteWrite() { epoch += 1; return epoch; }

export function installWriteEpoch(target = globalThis) {
  const original = target?.fetch;
  if (typeof original !== 'function' || original.praxWriteEpoch) return () => {};
  const wrapped = function praxFetch(input, init) {
    const method = String(init?.method || (input && typeof input === 'object' && input.method) || 'GET').toUpperCase();
    const result = original.call(this, input, init);
    if (method !== 'GET' && method !== 'HEAD') {
      noteWrite();
      Promise.resolve(result).then(noteWrite, noteWrite);
    }
    return result;
  };
  wrapped.praxWriteEpoch = true;
  target.fetch = wrapped;
  return () => { if (target.fetch === wrapped) target.fetch = original; };
}

// ---- focus preservation ---------------------------------------------------
// A refresh re-render rebuilds the DOM; the drawer's draft text survives via
// state, but keyboard focus and the caret did not, so the next keystroke went
// to a global shortcut. Capture what is focused, re-render, put it back.
// Restored AFTER the render's own focus policy runs, so the quick-capture and
// palette inputs (which a render focuses with the caret at the end) get their
// mid-text caret back too.
const FOCUS_ATTRS = [
  'data-task-title', 'data-task-description', 'data-task-notes',
  'data-capture-input', 'data-palette-input', 'data-project-rename',
  'data-library-search', 'data-task-search', 'data-filter-input',
];
export function captureFocus(doc = globalThis.document) {
  const active = doc?.activeElement;
  if (!active || active === doc.body) return null;
  let selector = null;
  if (active.id) selector = `#${CSS.escape(active.id)}`;
  else {
    const attr = FOCUS_ATTRS.find((name) => active.hasAttribute?.(name));
    if (attr) selector = `[${attr}]`;
    else if (active.getAttribute?.('name')) selector = `${active.tagName.toLowerCase()}[name="${CSS.escape(active.getAttribute('name'))}"]`;
  }
  if (!selector) return null;
  const range = typeof active.selectionStart === 'number' ? { start: active.selectionStart, end: active.selectionEnd, direction: active.selectionDirection } : null;
  return { selector, range };
}

export function restoreFocus(snapshot, doc = globalThis.document) {
  if (!snapshot) return false;
  const el = doc?.querySelector(snapshot.selector);
  if (!el || typeof el.focus !== 'function') return false;
  el.focus({ preventScroll: true });
  if (snapshot.range && typeof el.setSelectionRange === 'function') {
    try { el.setSelectionRange(snapshot.range.start, snapshot.range.end, snapshot.range.direction || 'none'); } catch { /* not a text control */ }
  }
  return doc.activeElement === el;
}

function safeStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

// Tell other same-origin documents (the main window) that something changed.
// Both routes are best-effort; the main window's focus/visibility refresh is
// the guaranteed path. Returns true when at least one route accepted it.
export function announceChange(change, {
  channelName = CHANGE_CHANNEL,
  storageKey = CHANGE_STORAGE_KEY,
  BroadcastChannelCtor = globalThis.BroadcastChannel,
  storage = safeStorage(),
  now = () => Date.now(),
} = {}) {
  const message = { ...(change || {}), at: now() };
  let delivered = false;
  if (typeof BroadcastChannelCtor === 'function') {
    try {
      const channel = new BroadcastChannelCtor(channelName);
      channel.postMessage(message);
      channel.close();
      delivered = true;
    } catch { /* no channel */ }
  }
  try {
    if (storage) { storage.setItem(storageKey, JSON.stringify(message)); delivered = true; }
  } catch { /* storage unavailable or full */ }
  return delivered;
}
