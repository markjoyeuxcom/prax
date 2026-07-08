export const LOCAL_STORAGE_KEY = 'prax.preferences';

// Prax appearance preferences. Theme is light "Porcelain" / dark "Deep Fern";
// accent is one of four oklch swatches applied as a --accent override; the
// reading scale (0.85–1.25) applies to editor/preview prose only; chromeOS
// picks macOS traffic lights vs Windows controls in the titlebar.
export const DEFAULT_PREFERENCES = Object.freeze({
  theme: 'light',
  accent: 'fern',
  chromeOS: 'mac',
  readingScale: 1,
  lineNumbers: false,
  reminders: true,
  editorEngine: 'codemirror',
  editorFont: 'proportional',
  previewFont: 'serif',
});

export const THEME_OPTIONS = Object.freeze(['light', 'dark']);
export const EDITOR_ENGINE_OPTIONS = Object.freeze(['codemirror', 'plain']);
// The editor's text font. 'monospace' lets the plain editor keep real bold/
// italic (width-neutral in a mono face); 'proportional' keeps Instrument Sans
// and shows emphasis by colour + a metrics-safe faux-bold so the textarea caret
// never drifts off the styled text. Applies to both engines.
export const EDITOR_FONT_OPTIONS = Object.freeze(['proportional', 'monospace']);
// The rendered-preview body font. Serif (Source Serif 4) is the reading default;
// sans matches the app chrome; mono suits code-heavy runbooks. Headings stay the
// clean sans face in every mode.
export const PREVIEW_FONT_OPTIONS = Object.freeze(['serif', 'sans', 'mono']);
export const ACCENT_OPTIONS = Object.freeze(['fern', 'teal', 'sky', 'indigo', 'plum', 'rose', 'amber', 'clay', 'moss']);
export const CHROME_OPTIONS = Object.freeze(['mac', 'win']);
export const READING_SCALE_MIN = 0.85;
export const READING_SCALE_MAX = 1.25;

// Fern is the token default in prax.css (per theme); the others override --accent
// with a single oklch tuned to read on both light and dark. A full spread from
// green through blue/violet to red so "colour mode" is a real choice.
export const ACCENT_CSS = Object.freeze({
  fern: null,
  teal: 'oklch(0.62 0.10 200)',
  sky: 'oklch(0.60 0.13 240)',
  indigo: 'oklch(0.60 0.11 265)',
  plum: 'oklch(0.56 0.14 320)',
  rose: 'oklch(0.58 0.16 18)',
  amber: 'oklch(0.68 0.13 65)',
  clay: 'oklch(0.62 0.11 40)',
  moss: 'oklch(0.58 0.10 130)',
});

// Pre-rename palettes ('prax.preferences' may hold the old shape) map onto
// the nearest theme so an upgrade keeps roughly the user's brightness choice.
const LEGACY_PALETTE_TO_THEME = {
  console: 'dark',
  graphite: 'dark',
  midnight: 'dark',
  daylight: 'light',
};

function isAllowed(value, allowed) {
  return allowed.includes(String(value || ''));
}

function clampReadingScale(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_PREFERENCES.readingScale;
  return Math.min(READING_SCALE_MAX, Math.max(READING_SCALE_MIN, n));
}

export function normalizePreferences(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const legacyTheme = LEGACY_PALETTE_TO_THEME[String(source.palette || '')];
  return {
    theme: isAllowed(source.theme, THEME_OPTIONS) ? source.theme : (legacyTheme || DEFAULT_PREFERENCES.theme),
    accent: isAllowed(source.accent, ACCENT_OPTIONS) ? source.accent : DEFAULT_PREFERENCES.accent,
    chromeOS: isAllowed(source.chromeOS, CHROME_OPTIONS) ? source.chromeOS : DEFAULT_PREFERENCES.chromeOS,
    readingScale: clampReadingScale(source.readingScale),
    lineNumbers: source.lineNumbers === true,
    reminders: source.reminders !== false, // opt-out; defaults on
    editorEngine: isAllowed(source.editorEngine, EDITOR_ENGINE_OPTIONS) ? source.editorEngine : DEFAULT_PREFERENCES.editorEngine,
    editorFont: isAllowed(source.editorFont, EDITOR_FONT_OPTIONS) ? source.editorFont : DEFAULT_PREFERENCES.editorFont,
    previewFont: isAllowed(source.previewFont, PREVIEW_FONT_OPTIONS) ? source.previewFont : DEFAULT_PREFERENCES.previewFont,
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

// Theme goes on <body data-theme> (the prax.css hook); accent + reading scale
// are custom-property overrides scoped to the body inline style.
export function applyPreferences(preferences, body = globalThis.document?.body) {
  const normalized = normalizePreferences(preferences);
  body?.setAttribute?.('data-theme', normalized.theme);
  body?.setAttribute?.('data-editor-font', normalized.editorFont);
  body?.setAttribute?.('data-preview-font', normalized.previewFont);
  const accentCss = ACCENT_CSS[normalized.accent];
  if (accentCss) body?.style?.setProperty?.('--accent', accentCss);
  else body?.style?.removeProperty?.('--accent');
  body?.style?.setProperty?.('--reading-scale', String(normalized.readingScale));
  return normalized;
}
