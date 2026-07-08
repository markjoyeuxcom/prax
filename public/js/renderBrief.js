import { escapeHtml } from './renderHelpers.js';
import { icon } from './icons.js';

// "Brief me" overlay — ask the library a question and get a trust-aware brief
// (the /context-pack markdown) rendered inline. Pure state->HTML; the caller
// passes bodyHtml (the brief markdown already run through the markdown renderer,
// trusted, not re-escaped). The input is uncontrolled between renders — its
// value is read from the DOM on submit — so typing never triggers a re-render.
export function renderBriefHtml(state, { bodyHtml = '' } = {}) {
  let result;
  if (state.briefLoading) {
    result = '<div class="brief__status">Gathering the most relevant runbooks and notes…</div>';
  } else if (state.briefError) {
    result = '<div class="brief__status brief__status--error">Could not build a brief. Check the semantic provider in Settings, or try a keyword.</div>';
  } else if (typeof state.briefMarkdown === 'string') {
    result = `<div class="brief__result"><div class="prose">${bodyHtml}</div></div>`;
  } else {
    result = '<div class="brief__status brief__status--hint">Ask about a system, an incident, or a topic — Prax pulls the most relevant docs into one brief, verified sources first.</div>';
  }

  const canCopy = typeof state.briefMarkdown === 'string' && !state.briefLoading && !state.briefError;
  return `
    <div class="overlay-center" data-overlay="brief" data-action="close-brief">
      <div class="brief" role="dialog" aria-label="Brief me">
        <div class="brief__row">
          ${icon('spark')}
          <input class="brief__input" type="text" data-brief-input placeholder="What do we know about…?" value="${escapeHtml(state.briefQuery || '')}" autocomplete="off" spellcheck="false">
          <button type="button" class="btn-primary btn-primary--sm" data-action="run-brief">Brief me</button>
        </div>
        ${result}
        <div class="brief__foot">
          <span class="brief__hint-k"><span class="kbd">↵</span> brief · <span class="kbd">Esc</span> close</span>
          ${canCopy ? '<button type="button" class="btn-ghost" data-action="copy-brief">Copy</button>' : ''}
        </div>
      </div>
    </div>`;
}
