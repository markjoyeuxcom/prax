import { escapeHtml } from './html.js';
import { icon } from './icons.js';

// "Generate runbook" overlay — describe an alert/incident, pick a project, and
// Prax drafts a runnable runbook (agent-written, unverified) for review. Pure
// state->HTML; inputs are uncontrolled (read from the DOM on submit), with the
// description/project mirrored into state so they survive the loading re-render.
export function renderGenerateRunbookHtml(state, { projects = [] } = {}) {
  let status;
  if (state.genRbLoading) {
    status = '<div class="brief__status">Drafting a runbook — steps, commands, and a rollback…</div>';
  } else if (state.genRbError) {
    status = `<div class="brief__status brief__status--error">${escapeHtml(state.genRbError)}</div>`;
  } else {
    status = '<div class="brief__status brief__status--hint">Describe the alert or incident. Prax drafts a runnable runbook with checkbox steps and a rollback for you to review and verify.</div>';
  }
  const options = projects.length
    ? projects.map((p) => `<option value="${escapeHtml(p.id)}"${state.genRbProject === p.id ? ' selected' : ''}>${escapeHtml(p.name)}</option>`).join('')
    : '<option value="">No project available</option>';

  return `
    <div class="overlay-center" data-overlay="genrb" data-action="close-generate-runbook">
      <div class="brief" role="dialog" aria-label="Generate runbook">
        <div class="brief__row genrb__row">
          ${icon('spark')}
          <textarea class="brief__input genrb__input" data-genrb-input rows="3" placeholder="e.g. Postgres primary is unresponsive, replicas lagging, writes failing…" autocomplete="off" spellcheck="false">${escapeHtml(state.genRbDescription || '')}</textarea>
        </div>
        <div class="genrb__controls">
          <label class="genrb__proj">Project <select class="text-input" data-genrb-project>${options}</select></label>
          <button type="button" class="btn-primary btn-primary--sm" data-action="run-generate-runbook"${state.genRbLoading ? ' disabled' : ''}>${state.genRbLoading ? 'Generating…' : 'Generate runbook'}</button>
        </div>
        ${status}
        <div class="brief__foot">
          <span class="brief__hint-k"><span class="kbd">Esc</span> close</span>
        </div>
      </div>
    </div>`;
}
