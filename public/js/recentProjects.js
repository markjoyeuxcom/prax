// Recently visited projects — the panel's "Recent" section (year-one shell
// spec, item 4). After a year the browser panel holds dozens of projects
// across areas; the three you were just in are what you want first. Per-device
// view state in localStorage, the same regime as pinned favorites and
// collapsed sections: never data, never sent to the server. Most recent
// first; a project that no longer renders in the panel (deleted, completed,
// archived) is simply skipped at render time, never an error.

export const RECENT_STORAGE_KEY = 'prax.recentProjects.v1';
export const MAX_RECENT = 3;

export function normalizeRecent(value) {
  const list = Array.isArray(value) ? value : [];
  return [...new Set(list.filter((entry) => typeof entry === 'string' && entry))]
    .slice(0, MAX_RECENT);
}

export function loadRecent(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem?.(RECENT_STORAGE_KEY);
    return normalizeRecent(raw ? JSON.parse(raw) : []);
  } catch {
    return [];
  }
}

export function saveRecent(recent, storage = globalThis.localStorage) {
  const normalized = normalizeRecent(recent);
  try {
    storage?.setItem?.(RECENT_STORAGE_KEY, JSON.stringify(normalized));
  } catch { /* a convenience; runtime state still applies */ }
  return normalized;
}

// Move (or add) a project to the front, capped at MAX_RECENT.
export function pushRecent(recent, projectId) {
  if (typeof projectId !== 'string' || !projectId) return normalizeRecent(recent);
  return normalizeRecent([projectId, ...normalizeRecent(recent).filter((id) => id !== projectId)]);
}
