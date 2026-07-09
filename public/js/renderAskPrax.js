import { escapeHtml } from './renderHelpers.js';
import { icon } from './icons.js';

// "Ask Prax" overlay — ask a question and get a grounded, cited answer
// synthesized from the library (or, when no chat model is configured, the raw
// context pack, like "Brief me"). Pure state->HTML; the caller passes bodyHtml
// (the answer or pack markdown already run through the markdown renderer,
// trusted, not re-escaped). The input is uncontrolled between renders.
function renderSources(sources) {
  if (!Array.isArray(sources) || sources.length === 0) return '';
  const pills = sources.map((s) => {
    const cls = s.verified ? 'askprax__src is-verified' : 'askprax__src';
    const tail = s.verified ? '' : ' · unverified';
    return `<span class="${cls}">${escapeHtml(s.title || 'Untitled')}${tail}</span>`;
  }).join('');
  return `<div class="askprax__sources"><span class="askprax__sources-label">Sources</span>${pills}</div>`;
}

export function renderAskPraxHtml(state, { bodyHtml = '' } = {}) {
  const r = state.askPraxResult;
  let result;
  if (state.askPraxLoading) {
    result = '<div class="brief__status">Reading the most relevant docs and writing an answer…</div>';
  } else if (state.askPraxError) {
    result = '<div class="brief__status brief__status--error">Could not get an answer. Check the AI model in Settings ▸ Intelligence, or try again.</div>';
  } else if (r) {
    const degradedNotice = r.degraded
      ? `<div class="askprax__notice">${r.reason === 'generation-failed'
          ? `The AI model failed to answer — showing the relevant sources instead.${r.error ? ` <span class="askprax__err">(${escapeHtml(r.error)})</span>` : ''} Check the model and API key in Settings ▸ Intelligence.`
          : 'No AI model is set, so here are the most relevant sources. Configure one in Settings ▸ Intelligence for a written answer.'}</div>`
      : '';
    const modelNote = (!r.degraded && r.model)
      ? `<div class="askprax__model">Answered by ${escapeHtml(r.model)} · grounded in your library</div>`
      : '';
    result = `<div class="brief__result">${degradedNotice}<div class="prose">${bodyHtml}</div>${renderSources(r.sources)}${modelNote}</div>`;
  } else {
    result = '<div class="brief__status brief__status--hint">Ask about a system, an incident, or a runbook — Prax answers from your library and cites the sources, verified first.</div>';
  }

  const canCopy = Boolean(r) && !state.askPraxLoading && !state.askPraxError;
  return `
    <div class="overlay-center" data-overlay="askprax" data-action="close-ask-prax">
      <div class="brief" role="dialog" aria-label="Ask Prax">
        <div class="brief__row">
          ${icon('spark')}
          <input class="brief__input" type="text" data-ask-prax-input placeholder="Ask Prax about your library…" value="${escapeHtml(state.askPraxQuery || '')}" autocomplete="off" spellcheck="false">
          <button type="button" class="btn-primary btn-primary--sm" data-action="run-ask-prax">Ask</button>
        </div>
        ${result}
        <div class="brief__foot">
          <span class="brief__hint-k"><span class="kbd">↵</span> ask · <span class="kbd">Esc</span> close</span>
          ${canCopy ? '<button type="button" class="btn-ghost" data-action="copy-ask-prax">Copy</button>' : ''}
        </div>
      </div>
    </div>`;
}
