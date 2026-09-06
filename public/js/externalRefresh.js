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
    .map((item) => `${item?.id ?? ''}:${item?.updatedAt ?? ''}:${item?.archivedAt ?? ''}:${item?.status ?? ''}`)
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
