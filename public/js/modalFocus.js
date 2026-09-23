// One focus rule for every aria-modal overlay (confirm, capture, link picker,
// task drawer, Ask Prax, import/export, template studio, shortcuts, Inbox):
// while one is open, the workspace and the layers beneath it are inert (no
// focus, no clicks, hidden from assistive technology) and Tab wraps inside it.
//
// Overlays render into [data-overlay-root] in stacking order, so the LAST
// aria-modal there is the topmost. Layers rendered after it (a non-modal
// panel such as the assistant, the toast) sit above it and stay live; the
// scrim a drawer renders just before its dialog stays live so a click on it
// still closes the drawer.

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(', ');

export function topmostModal(root) {
  const modals = root?.querySelectorAll?.('[data-overlay-root] [aria-modal="true"]');
  return modals && modals.length ? modals[modals.length - 1] : null;
}

function overlayLayerOf(overlayRoot, node) {
  let layer = node;
  while (layer && layer.parentElement !== overlayRoot) layer = layer.parentElement;
  return layer || null;
}

// Idempotent; call after anything that rebuilds the workspace or the overlays.
export function syncModalInert(root) {
  if (!root?.querySelector) return null;
  const modal = topmostModal(root);
  const overlayRoot = root.querySelector('[data-overlay-root]');
  for (const child of root.children || []) {
    if (child !== overlayRoot) child.inert = Boolean(modal);
  }
  if (!overlayRoot) return modal;
  const modalLayer = modal ? overlayLayerOf(overlayRoot, modal) : null;
  const scrim = modalLayer?.previousElementSibling?.matches?.('.scrim') ? modalLayer.previousElementSibling : null;
  let beneath = Boolean(modalLayer);
  for (const layer of overlayRoot.children) {
    if (layer === modalLayer) beneath = false;
    layer.inert = beneath && layer !== scrim;
  }
  return modal;
}

function isShown(element) {
  return typeof element.getClientRects !== 'function' || element.getClientRects().length > 0;
}

export function focusableWithin(container) {
  return [...(container?.querySelectorAll?.(FOCUSABLE) || [])]
    .filter((element) => !element.closest?.('[inert]') && isShown(element));
}

// Keeps Tab / Shift+Tab inside the topmost modal: wraps at its first and last
// controls and pulls focus back in from anywhere beneath it; between those,
// the browser's own order applies. Returns true when it moved focus. Focus
// inside a live layer above the modal is left alone.
export function trapModalTab(event, root, activeElement = globalThis.document?.activeElement) {
  if (event.key !== 'Tab' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return false;
  const modal = topmostModal(root);
  if (!modal) return false;
  const inside = Boolean(activeElement) && modal.contains(activeElement);
  if (!inside && activeElement) {
    const overlayRoot = root.querySelector('[data-overlay-root]');
    const layers = [...(overlayRoot?.children || [])];
    const activeLayer = layers.indexOf(overlayLayerOf(overlayRoot, activeElement));
    if (activeLayer > layers.indexOf(overlayLayerOf(overlayRoot, modal))) return false;
  }
  const focusable = focusableWithin(modal);
  if (!focusable.length) {
    event.preventDefault();
    if (!modal.hasAttribute('tabindex')) modal.setAttribute('tabindex', '-1');
    modal.focus();
    return true;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  let next = null;
  if (!inside || activeElement === modal) next = event.shiftKey ? last : first;
  else if (event.shiftKey && activeElement === first) next = last;
  else if (!event.shiftKey && activeElement === last) next = first;
  if (!next) return false;
  event.preventDefault();
  next.focus();
  return true;
}
