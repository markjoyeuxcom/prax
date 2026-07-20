// Collapsed panel sections — per-device view state (localStorage), the same
// regime as pinned favorites. Keys are namespaced section names
// ('area:Work', 'folder:Daily'); stale keys for renamed areas are inert (the
// section simply starts expanded) and the list is capped, never an error.

export const COLLAPSED_STORAGE_KEY = 'prax.collapsedSections.v1';
const MAX_SECTIONS = 200;

export function normalizeCollapsed(value) {
  const list = Array.isArray(value) ? value : [];
  return [...new Set(list.filter((entry) => typeof entry === 'string' && entry))]
    .slice(0, MAX_SECTIONS);
}

export function loadCollapsed(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem?.(COLLAPSED_STORAGE_KEY);
    return normalizeCollapsed(raw ? JSON.parse(raw) : []);
  } catch {
    return [];
  }
}

export function saveCollapsed(collapsed, storage = globalThis.localStorage) {
  const normalized = normalizeCollapsed(collapsed);
  try {
    storage?.setItem?.(COLLAPSED_STORAGE_KEY, JSON.stringify(normalized));
  } catch { /* collapse is a convenience; runtime state still applies */ }
  return normalized;
}

export function isCollapsed(collapsed, key) {
  return Array.isArray(collapsed) && collapsed.includes(key);
}

export function toggleCollapsed(collapsed, key) {
  if (typeof key !== 'string' || !key) return normalizeCollapsed(collapsed);
  const current = normalizeCollapsed(collapsed);
  return current.includes(key)
    ? current.filter((entry) => entry !== key)
    : normalizeCollapsed([...current, key]);
}
