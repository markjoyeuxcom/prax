// HTML escaping for every module that builds HTML strings. Library documents,
// task text and model output are often written by AI agents, so every value
// interpolated into markup goes through one of these (or is provably safe:
// tests/frontend/htmlEscaping.test.js checks each `${…}` in an HTML template).
// DOM-free, so it can be imported anywhere.

export { isSafeHttpUrl } from './externalRefKind.js';

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

// Text content and quoted attribute values. null and undefined become ''.
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ENTITIES[ch]);
}

// A quoted attribute value. The same escaping as escapeHtml (both quote
// characters included); the name says where the value goes.
export function escapeAttr(value) {
  return escapeHtml(value);
}

// A CSS colour for a style attribute (`style="--dot: ${cssColor(c)}"`).
// Escaping alone keeps a value inside its attribute, but not inside its CSS
// declaration: `red; background: url(https://…)` would still load a remote
// image. Only a hex colour, a named colour, var(--name) or a colour function
// with plain arguments passes; anything else becomes `fallback`.
const CSS_COLOR = /^(?:#[\da-f]{3,8}|[a-z]+|var\(--[\w-]+\)|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([-\w\s.,%/+]*\))$/i;

export function cssColor(value, fallback = 'var(--ink3)') {
  const color = String(value ?? '').trim();
  return escapeHtml(CSS_COLOR.test(color) ? color : fallback);
}
