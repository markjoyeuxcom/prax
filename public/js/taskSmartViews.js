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

export function createSmartView(label, expr) {
  const normalizedLabel = String(label || '').trim();
  const normalizedExpr = String(expr || '').trim();
  if (!normalizedLabel || !normalizedExpr) return null;
  if (!parseTaskFilter(normalizedExpr).ok) return null; // must be a valid (strict) expression
  return { id: slugFromLabel(normalizedLabel), label: normalizedLabel, expr: normalizedExpr };
}

export function sanitizeSmartViews(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.reduce((views, item) => {
    const view = createSmartView(item?.label, item?.expr);
    if (!view || seen.has(view.id)) return views;
    seen.add(view.id);
    views.push(view);
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
