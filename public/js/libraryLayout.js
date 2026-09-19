// Library layout — cards or table (year-one shell spec, item 7). A per-device
// view preference in localStorage, the same regime as pinned favorites and
// collapsed sections: never data, never sent to the server.

export const LAYOUT_STORAGE_KEY = 'prax.libraryLayout.v1';
export const LIBRARY_LAYOUTS = Object.freeze(['cards', 'table']);

export function normalizeLayout(value) {
  return LIBRARY_LAYOUTS.includes(value) ? value : 'cards';
}

export function loadLayout(storage = globalThis.localStorage) {
  try {
    return normalizeLayout(storage?.getItem?.(LAYOUT_STORAGE_KEY));
  } catch {
    return 'cards';
  }
}

export function saveLayout(layout, storage = globalThis.localStorage) {
  const normalized = normalizeLayout(layout);
  try {
    storage?.setItem?.(LAYOUT_STORAGE_KEY, normalized);
  } catch { /* a convenience; runtime state still applies */ }
  return normalized;
}
