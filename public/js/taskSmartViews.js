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
// Letters and digits of every script survive, so a non-Latin name does not
// collapse to the fallback.
function slugFromLabel(label) {
  return String(label || '')
    .trim()
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    || 'view';
}

function uniqueId(base, taken) {
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

// "Folder/Name" at creation files the view under that folder (the save
// dialog's single text input is the only creation surface, so the slash is
// the affordance). Only the FIRST slash splits; parsing happens at creation
// only — stored labels are never reinterpreted.
//
// `existing` is the saved list. A view with exactly this folder and name is
// updated in place (it keeps its id, so the caller can tell and say so); any
// other name gets an id no saved or built-in view holds — names that
// differ only by case, punctuation or script never overwrite each other
// (QINV-01, QINV-11).
export function createSmartView(label, expr, existing = []) {
  const raw = String(label || '').trim();
  const normalizedExpr = String(expr || '').trim();
  if (!raw || !normalizedExpr) return null;
  if (!parseTaskFilter(normalizedExpr).ok) return null; // must be a valid (strict) expression
  const slash = raw.indexOf('/');
  const folder = slash > 0 ? raw.slice(0, slash).trim() : null;
  const normalizedLabel = slash > 0 ? raw.slice(slash + 1).trim() : raw;
  if (!normalizedLabel) return null;
  const views = Array.isArray(existing) ? existing : [];
  const same = views.find((view) => view?.label === normalizedLabel && (view.folder || null) === folder);
  const taken = new Set([...views.map((view) => view?.id), ...BUILT_IN_SMART_VIEWS.map((view) => view.id)]);
  return {
    id: same ? same.id : uniqueId(slugFromLabel(raw), taken),
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
