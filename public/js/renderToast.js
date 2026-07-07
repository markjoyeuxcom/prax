import { escapeHtml } from './renderHelpers.js';

// Bottom-center toast (design-handoff §10) — optional Undo action; main.js owns
// the 5s/2.4s timers and runs state.toast.undo on toast-undo.
export function renderToastHtml(state) {
  const toast = state?.toast;
  if (!toast) return '';
  const undo = toast.undo
    ? '<button class="toast__undo" type="button" data-action="toast-undo">Undo</button>'
    : '';
  return `<div class="toast" role="status"><span>${escapeHtml(toast.message)}</span>${undo}</div>`;
}
