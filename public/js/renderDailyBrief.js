import { escapeHtml } from './renderHelpers.js';
import { icon } from './icons.js';

// "Daily brief" overlay — a copyable stand-up / on-call handoff built from live
// state (overdue / due / on-call / recent docs). "Draft with AI" narrates it in
// prose when a chat model is configured. Pure state->HTML; the caller passes the
// rendered brief + narrative markdown.
export function renderDailyBriefHtml(state, { briefHtml = '', narrativeHtml = '' } = {}) {
  let body;
  if (state.dailyBriefLoading) {
    body = '<div class="brief__status">Drafting the stand-up…</div>';
  } else if (narrativeHtml) {
    body = `<div class="brief__result"><div class="prose">${narrativeHtml}</div><div class="askprax__model">AI stand-up · narrated from your live brief</div></div>`;
  } else {
    const note = state.dailyBriefError ? `<div class="askprax__notice">${escapeHtml(state.dailyBriefError)}</div>` : '';
    body = `<div class="brief__result">${note}<div class="prose">${briefHtml}</div></div>`;
  }
  return `
    <div class="overlay-center" data-overlay="dailybrief" data-action="close-daily-brief">
      <div class="brief" role="dialog" aria-label="Daily brief">
        <div class="brief__row">
          ${icon('spark')}
          <span class="brief__title-text">Daily brief</span>
          <button type="button" class="btn-primary btn-primary--sm" data-action="draft-daily-brief"${state.dailyBriefLoading ? ' disabled' : ''}>${narrativeHtml ? 'Redraft' : 'Draft with AI'}</button>
        </div>
        ${body}
        <div class="brief__foot">
          <span class="brief__hint-k"><span class="kbd">Esc</span> close</span>
          <button type="button" class="btn-ghost" data-action="copy-daily-brief">Copy</button>
        </div>
      </div>
    </div>`;
}
