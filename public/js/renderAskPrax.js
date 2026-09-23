import { incompleteIndexNotice } from './retrievalStatus.js';
import { escapeHtml } from './html.js';
import { icon } from './icons.js';

// "Ask Prax" overlay — ask a question and get a grounded, cited answer
// synthesized from the library (or, when no chat model is configured, the raw
// retrieved context pack as a fallback). Pure state->HTML; the caller passes bodyHtml
// (the answer or pack markdown already run through the markdown renderer,
// trusted, not re-escaped). The input is uncontrolled between renders.
function renderSources(sources) {
  if (!Array.isArray(sources) || sources.length === 0) return '';
  const pills = sources.map((s) => {
    const cls = s.verified ? 'askprax__src is-verified' : 'askprax__src';
    const trust = [
      s.kind === 'synthesized' ? 'synthesized' : null,
      s.stale ? 'stale' : null,
      s.verified ? 'verified' : 'unverified',
    ].filter(Boolean).join(', ');
    const title = s.title || 'Untitled';
    const type = s.documentType || 'note';
    return `<button type="button" class="${cls}" data-action="open-ask-source" data-document-id="${escapeHtml(s.id || '')}" aria-label="Open ${escapeHtml(title)}, ${escapeHtml(type)}, ${escapeHtml(trust)}">${escapeHtml(title)} · ${escapeHtml(trust)}</button>`;
  }).join('');
  return `<div class="askprax__sources"><span class="askprax__sources-label">Sources</span>${pills}</div>`;
}

function retrievalNotice(result) {
  const indexNotice = incompleteIndexNotice(result?.retrieval?.index);
  const coverage = indexNotice ? `<div class="askprax__notice askprax__notice--retrieval">${escapeHtml(indexNotice)}</div>` : '';
  if (!result?.retrieval?.fallback) return coverage;
  const text = result.retrieval.reason === 'semantic-unavailable'
    ? 'Semantic retrieval was unavailable, so these results were retrieved with keyword search.'
    : 'Semantic retrieval found no relevant matches, so Prax also checked keyword search.';
  return coverage + `<div class="askprax__notice askprax__notice--retrieval">${text}</div>`;
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
          ? 'The AI model failed to answer — showing the relevant sources instead. Check the model and API key in Settings ▸ Intelligence.'
          : r.reason === 'citation-validation-failed'
            ? 'The generated answer did not cite the retrieved sources correctly, so Prax withheld it and is showing the sources instead.'
            : 'No AI model is set, so here are the most relevant sources. Configure one in Settings ▸ Intelligence for a written answer.'}</div>`
      : '';
    const modelNote = (!r.degraded && r.model)
      ? `<div class="askprax__model">Answered by ${escapeHtml(r.model)} · grounded in your library</div>`
      : '';
    result = `<div class="brief__result">${retrievalNotice(r)}${degradedNotice}<div class="prose">${bodyHtml}</div>${renderSources(r.sources)}${modelNote}</div>`;
  } else {
    result = '<div class="brief__status brief__status--hint">Ask about a system, an incident, or a runbook — Prax answers from your library and cites the sources, verified first.</div>';
  }

  const canCopy = Boolean(r) && !state.askPraxLoading && !state.askPraxError;
  return `
    <div class="overlay-center" data-overlay="askprax" data-action="close-ask-prax">
      <div class="brief" role="dialog" aria-modal="true" aria-label="Ask Prax" aria-busy="${Boolean(state.askPraxLoading)}">
        <div class="brief__row">
          ${icon('spark')}
          <input class="brief__input" type="text" data-ask-prax-input aria-label="Question for Prax" placeholder="Ask Prax about your library…" value="${escapeHtml(state.askPraxQuery || '')}" autocomplete="off" spellcheck="false">
          <button type="button" class="btn-primary btn-primary--sm" data-action="run-ask-prax"${String(state.askPraxQuery || '').trim() ? '' : ' disabled'}>Ask</button>
        </div>
        <div class="askprax__result" aria-live="polite">${result}</div>
        <div class="brief__foot">
          <span class="brief__hint-k"><span class="kbd">↵</span> ask · <span class="kbd">Esc</span> close</span>
          ${canCopy ? '<button type="button" class="btn-ghost" data-action="copy-ask-prax">Copy</button>' : ''}
        </div>
      </div>
    </div>`;
}
