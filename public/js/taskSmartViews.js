import { parseTaskFilter } from './taskFilter.js';

// Saved task smart views — a named filter expression, stored in localStorage
// exactly like saved library views (local-first; per-device). The portable,
// agent-shareable artifact is the expression string itself.

// Built-in views ship with the app (not stored, not deletable). Stale is the
// slippage-honesty mirror: open work untouched for a month — deliberately
// excluding the backlog, which is a parking lot by intent.
export const BUILT_IN_SMART_VIEWS = Object.freeze([
  Object.freeze({ id: 'builtin-stale', label: 'Stale', expr: 'stale:30 -status:backlog', builtIn: true }),
]);

export function findSmartView(views, id) {
  return (views || []).find((view) => view.id === id)
    || BUILT_IN_SMART_VIEWS.find((view) => view.id === id)
    || null;
}
function slugFromLabel(label) {
  return String(label || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    || 'view';
}

// "Folder/Name" at creation files the view under that folder (the save
// dialog's single text input is the only creation surface, so the slash is
// the affordance). Only the FIRST slash splits; parsing happens at creation
// only — stored labels are never reinterpreted.
export function createSmartView(label, expr) {
  const raw = String(label || '').trim();
  const normalizedExpr = String(expr || '').trim();
  if (!raw || !normalizedExpr) return null;
  if (!parseTaskFilter(normalizedExpr).ok) return null; // must be a valid (strict) expression
  const slash = raw.indexOf('/');
  const folder = slash > 0 ? raw.slice(0, slash).trim() : null;
  const normalizedLabel = slash > 0 ? raw.slice(slash + 1).trim() : raw;
  if (!normalizedLabel) return null;
  return {
    id: slugFromLabel(raw),
    label: normalizedLabel,
    expr: normalizedExpr,
    ...(folder ? { folder } : {}),
  };
}

export function sanitizeSmartViews(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.reduce((views, item) => {
    // Stored labels pass through verbatim (a label containing '/' from before
    // the folder convention must not be reinterpreted on load) — only the
    // stored folder field is honored.
    const label = String(item?.label || '').trim();
    const expr = String(item?.expr || '').trim();
    if (!label || !expr || !parseTaskFilter(expr).ok) return views;
    const folder = typeof item?.folder === 'string' && item.folder.trim() ? item.folder.trim() : null;
    const id = typeof item?.id === 'string' && item.id ? item.id : slugFromLabel(label);
    if (seen.has(id)) return views;
    seen.add(id);
    views.push({ id, label, expr, ...(folder ? { folder } : {}) });
    return views;
  }, []);
}

export function smartViewsFromJson(value) {
  try {
    return sanitizeSmartViews(JSON.parse(value || '[]'));
  } catch {
    return [];
  }
}
