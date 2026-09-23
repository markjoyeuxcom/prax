import { escapeHtml } from './html.js';

// In-app confirmation dialog — pure `confirm-state → HTML string` renderer.
// Native window.confirm/prompt are unavailable in the desktop webview (Tauri
// does not implement JS dialogs), so destructive actions gate through this
// instead: the OK button re-dispatches the original data-action with
// data-confirmed="1" plus any extra data-* payload from `confirm.data`.
//
// confirm = {
//   message,             — dialog body text
//   action,              — data-action re-dispatched on OK
//   okLabel?,            — OK button label (default "Confirm")
//   danger?,             — true → destructive styling on OK
//   data?,               — { 'kebab-key': value } extra data-* for the OK button
//   input?,              — { value?, placeholder? } optional text field
// }
export function renderConfirmHtml(confirm) {
  const dataAttrs = Object.entries(confirm.data || {})
    .map(([key, value]) => ` data-${escapeHtml(key)}="${escapeHtml(String(value))}"`)
    .join('');
  const input = confirm.input
    ? `<input class="text-input confirm__input" type="text" data-confirm-input value="${escapeHtml(confirm.input.value || '')}" placeholder="${escapeHtml(confirm.input.placeholder || '')}" autocomplete="off" spellcheck="false">`
    : '';
  return `
    <div class="overlay-center" data-overlay="confirm" data-action="confirm-cancel">
      <div class="confirm" role="alertdialog" aria-modal="true" aria-label="Confirm">
        <p class="confirm__message">${escapeHtml(confirm.message)}</p>
        ${input}
        <div class="confirm__actions">
          <button type="button" class="btn-ghost" data-action="confirm-cancel">Cancel</button>
          <button type="button" class="btn-primary${confirm.danger ? ' confirm__ok--danger' : ''}" data-confirm-ok data-action="${escapeHtml(confirm.action)}" data-confirmed="1"${dataAttrs}>${escapeHtml(confirm.okLabel || 'Confirm')}</button>
        </div>
      </div>
    </div>`;
}
