import { escapeHtml } from './renderHelpers.js';
import { icon } from './icons.js';

// Quick capture (N, design-handoff §10) — one input, Enter adds a planned/medium
// task to the destination project shown in the footer. Input events bind in
// main.js via [data-capture-input].
export function renderCaptureHtml(state, project) {
  const color = escapeHtml(project?.color || 'var(--accent)');
  return `
    <div class="overlay-center" data-overlay="capture" data-action="close-capture">
      <div class="capture" role="dialog" aria-label="Quick capture">
        <div class="capture__row">
          ${icon('check')}
          <input class="capture__input" type="text" data-capture-input placeholder="What needs doing?" value="${escapeHtml(state?.captureQuery ?? '')}" autocomplete="off" spellcheck="false">
        </div>
        <div class="capture__foot">
          <span class="capture__proj">Adding to <span class="proj-dot" style="--dot:${color}" aria-hidden="true"></span>${escapeHtml(project?.name ?? '')}</span>
          <span><span class="kbd">↵</span> add task</span>
        </div>
      </div>
    </div>`;
}
