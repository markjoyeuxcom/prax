// Pinned favorites — star projects and views to float them to the top of the
// panel (and rank first in the ⌘K palette). Local-first, per-device, exactly
// like smart views: pins are a VIEW preference, not data, so they live in
// localStorage and never touch the server. Projects and smart views pin by
// id; library saved views have no id and pin by label (their only identity —
// they cannot be renamed, only created and deleted).

export const PINNED_STORAGE_KEY = 'prax.pinned.v1';
const KINDS = ['projects', 'smartViews', 'libraryViews'];
const MAX_PER_KIND = 50;

export function normalizePinned(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const result = {};
  for (const kind of KINDS) {
    const list = Array.isArray(source[kind]) ? source[kind] : [];
    result[kind] = [...new Set(list.filter((entry) => typeof entry === 'string' && entry))]
      .slice(0, MAX_PER_KIND);
  }
  return result;
}

export function loadPinned(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem?.(PINNED_STORAGE_KEY);
    return normalizePinned(raw ? JSON.parse(raw) : {});
  } catch {
    return normalizePinned({});
  }
}

export function savePinned(pinned, storage = globalThis.localStorage) {
  const normalized = normalizePinned(pinned);
  try {
    storage?.setItem?.(PINNED_STORAGE_KEY, JSON.stringify(normalized));
  } catch { /* pins are a convenience; runtime state still applies */ }
  return normalized;
}

export function isPinned(pinned, kind, key) {
  return Array.isArray(pinned?.[kind]) && pinned[kind].includes(key);
}

// Toggle returns a NEW normalized object (state-friendly); unpinning also
// serves as lazy pruning — a stale key for a deleted project simply never
// renders and disappears the next time anything is toggled... nothing keeps
// dead pins alive on purpose.
export function togglePinned(pinned, kind, key) {
  if (!KINDS.includes(kind) || typeof key !== 'string' || !key) return normalizePinned(pinned);
  const current = normalizePinned(pinned);
  current[kind] = current[kind].includes(key)
    ? current[kind].filter((entry) => entry !== key)
    : [...current[kind], key];
  return normalizePinned(current);
}

// Stable split helper for renderers: [pinned-in-list-order, rest].
export function splitPinned(items, keys) {
  const wanted = new Set(keys || []);
  const pinned = [];
  const rest = [];
  for (const item of items) {
    (wanted.has(item.key) ? pinned : rest).push(item);
  }
  return { pinned, rest };
}
