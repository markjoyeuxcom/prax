// Assistant panel width — dragged from the panel's left edge. A per-device
// view preference in localStorage, the same regime as the library layout:
// never data, never sent to the server. null means the stylesheet's default.

export const ASSISTANT_WIDTH_KEY = 'prax.assistantWidth.v1';
export const ASSISTANT_MIN_WIDTH = 360;
// The panel never covers the whole window: a strip of backdrop stays to click
// the panel closed.
export const ASSISTANT_BACKDROP_GUTTER = 120;
const KEY_STEP = 32;

export function maxAssistantWidth(viewport) {
  const width = Number(viewport);
  return Number.isFinite(width) ? Math.max(ASSISTANT_MIN_WIDTH, Math.round(width - ASSISTANT_BACKDROP_GUTTER)) : Infinity;
}

export function clampAssistantWidth(width, viewport) {
  const value = Number(width);
  if (width == null || !Number.isFinite(value)) return null;
  return Math.round(Math.min(Math.max(value, ASSISTANT_MIN_WIDTH), maxAssistantWidth(viewport)));
}

export function loadAssistantWidth(storage = globalThis.localStorage) {
  try {
    const value = Number.parseInt(storage?.getItem?.(ASSISTANT_WIDTH_KEY) ?? '', 10);
    return Number.isFinite(value) && value >= ASSISTANT_MIN_WIDTH ? value : null;
  } catch {
    return null;
  }
}

export function saveAssistantWidth(width, storage = globalThis.localStorage) {
  const value = width == null ? null : clampAssistantWidth(width);
  try {
    if (value == null) storage?.removeItem?.(ASSISTANT_WIDTH_KEY);
    else storage?.setItem?.(ASSISTANT_WIDTH_KEY, String(value));
  } catch { /* a convenience; runtime state still applies */ }
  return value;
}

// Pointer and keyboard resizing for [data-assistant-resize], delegated from the
// app root so it survives re-renders. Dragging writes the CSS variable straight
// onto the panel (no re-render per move) and commits the width to state and
// storage when the pointer is released. Double-click or Home restores the
// default width.
export function installAssistantResize({ root, setState, storage = () => globalThis.localStorage, win = globalThis.window }) {
  // Set when a drag ends; consumed by the one click that release produces.
  let swallowReleaseClickUntil = 0;

  const panel = () => root.querySelector('.asst');
  const apply = (width) => {
    const el = panel();
    if (!el) return;
    if (width == null) el.style.removeProperty('--asst-width');
    else el.style.setProperty('--asst-width', `${width}px`);
    el.querySelector('[data-assistant-resize]')?.setAttribute('aria-valuenow', String(Math.round(width ?? el.getBoundingClientRect().width)));
  };
  const commit = (width) => {
    setState({ assistantWidth: saveAssistantWidth(width, storage()) });
    apply(width);
  };

  // A drag that ends over the backdrop can be delivered as a click on it
  // (WebKit does), which would close the panel the person was resizing. Only
  // that one release click is swallowed: any new press or key clears the
  // guard, so a click made after the drag (Close, Send, a citation) always runs.
  const clearGuard = () => { swallowReleaseClickUntil = 0; };
  win.addEventListener('pointerdown', clearGuard, true);
  win.addEventListener('keydown', clearGuard, true);
  win.addEventListener('click', (event) => {
    if (Date.now() >= swallowReleaseClickUntil) return;
    clearGuard();
    event.stopPropagation();
    event.preventDefault();
  }, true);

  root.addEventListener('pointerdown', (event) => {
    const handle = event.target.closest?.('[data-assistant-resize]');
    if (!handle || event.button !== 0) return;
    const el = panel();
    if (!el) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = el.getBoundingClientRect().width;
    let width = startWidth;
    let moved = false;
    win.document.documentElement.classList.add('is-resizing-x');
    const move = (e) => {
      moved ||= Math.abs(e.clientX - startX) > 2;
      width = clampAssistantWidth(startWidth + (startX - e.clientX), win.innerWidth);
      apply(width);
    };
    const end = () => {
      win.removeEventListener('pointermove', move);
      win.removeEventListener('pointerup', end);
      win.removeEventListener('pointercancel', end);
      win.document.documentElement.classList.remove('is-resizing-x');
      if (!moved) return;
      swallowReleaseClickUntil = Date.now() + 400;
      commit(width);
    };
    win.addEventListener('pointermove', move);
    win.addEventListener('pointerup', end);
    win.addEventListener('pointercancel', end);
  });

  root.addEventListener('dblclick', (event) => {
    if (event.target.closest?.('[data-assistant-resize]')) commit(null);
  });

  root.addEventListener('keydown', (event) => {
    if (!event.target.closest?.('[data-assistant-resize]')) return;
    const el = panel();
    if (!el) return;
    const current = el.getBoundingClientRect().width;
    const step = event.shiftKey ? KEY_STEP * 3 : KEY_STEP;
    let next;
    if (event.key === 'ArrowLeft') next = clampAssistantWidth(current + step, win.innerWidth);
    else if (event.key === 'ArrowRight') next = clampAssistantWidth(current - step, win.innerWidth);
    else if (event.key === 'Home') next = null;
    else return;
    event.preventDefault();
    event.stopPropagation();
    commit(next);
  });
}
