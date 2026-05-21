export const LOCAL_STORAGE_KEY = 'moomora-console.preferences';

export const DEFAULT_PREFERENCES = Object.freeze({
  fontScale: 'comfortable',
  palette: 'console',
  boardDensity: 'comfortable',
});

export const FONT_SCALE_OPTIONS = Object.freeze(['compact', 'comfortable', 'large']);
export const PALETTE_OPTIONS = Object.freeze(['console', 'graphite', 'daylight', 'midnight']);
export const BOARD_DENSITY_OPTIONS = Object.freeze(['comfortable', 'compact']);

function isAllowed(value, allowed) {
  return allowed.includes(String(value || ''));
}

export function normalizePreferences(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    fontScale: isAllowed(source.fontScale, FONT_SCALE_OPTIONS) ? source.fontScale : DEFAULT_PREFERENCES.fontScale,
    palette: isAllowed(source.palette, PALETTE_OPTIONS) ? source.palette : DEFAULT_PREFERENCES.palette,
    boardDensity: isAllowed(source.boardDensity, BOARD_DENSITY_OPTIONS) ? source.boardDensity : DEFAULT_PREFERENCES.boardDensity,
  };
}

export function loadPreferences(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem?.(LOCAL_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFERENCES };
    return normalizePreferences(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function savePreferences(preferences, storage = globalThis.localStorage) {
  const normalized = normalizePreferences(preferences);
  try {
    storage?.setItem?.(LOCAL_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Appearance preferences are non-critical; runtime state still applies.
  }
  return normalized;
}

export function resetPreferences(storage = globalThis.localStorage) {
  try {
    storage?.removeItem?.(LOCAL_STORAGE_KEY);
  } catch {
    // Appearance preferences are non-critical; defaults still apply.
  }
  return { ...DEFAULT_PREFERENCES };
}

export function applyPreferences(preferences, root = globalThis.document?.documentElement) {
  const normalized = normalizePreferences(preferences);
  root?.setAttribute?.('data-font-scale', normalized.fontScale);
  root?.setAttribute?.('data-palette', normalized.palette);
  root?.setAttribute?.('data-board-density', normalized.boardDensity);
  return normalized;
}
