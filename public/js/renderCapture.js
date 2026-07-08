import { escapeHtml } from './renderHelpers.js';
import { icon } from './icons.js';

// Quick capture (N, design-handoff §10) — one input, Enter adds a task to the
// destination project. The destination is context-derived (the project you're
// viewing, else Inbox) and changeable via the footer picker; capturing from
// Today also pre-sets a due-today so the task shows up in the view you made it.
export function renderCaptureHtml(state, project, projects = []) {
  const color = escapeHtml(project?.color || 'var(--accent)');
  const dueHint = state?.captureDueDate ? '<span class="capture__due">Due today</span>' : '';
  const menu = state?.captureMenuOpen
    ? '<div class="menu capture__menu" role="listbox" aria-label="Choose project">'
      + projects.map((p) => {
        const selected = p.id === project?.id;
        return `<button type="button" class="menu__item capture__menu-item${selected ? ' is-selected' : ''}" role="option"${selected ? ' aria-selected="true"' : ''} data-action="set-capture-project" data-project-id="${escapeHtml(p.id)}">`
          + `<span class="proj-dot" style="--dot:${escapeHtml(p.color || 'var(--accent)')}" aria-hidden="true"></span>`
          + `<span class="capture__menu-name">${escapeHtml(p.name)}</span>`
          + (selected ? icon('check', 12) : '')
          + '</button>';
      }).join('')
      + '</div>'
    : '';
  return `
    <div class="overlay-center" data-overlay="capture" data-action="close-capture">
      <div class="capture" role="dialog" aria-label="Quick capture">
        <div class="capture__row">
          ${icon('check')}
          <input class="capture__input" type="text" data-capture-input placeholder="What needs doing?  —  try “rotate certs !high fri”" value="${escapeHtml(state?.captureQuery ?? '')}" autocomplete="off" spellcheck="false">
        </div>
        <div class="capture__foot">
          <button type="button" class="capture__proj" data-action="toggle-capture-menu" aria-haspopup="listbox" aria-expanded="${state?.captureMenuOpen ? 'true' : 'false'}">
            <span class="capture__proj-label">Adding to</span>
            <span class="proj-dot" style="--dot:${color}" aria-hidden="true"></span>${escapeHtml(project?.name ?? 'Inbox')}
            <span class="capture__caret" aria-hidden="true">▾</span>
          </button>
          <span class="capture__foot-right">
            ${dueHint}
            <span class="capture__hint"><span class="kbd">↵</span> add task</span>
          </span>
        </div>
        ${menu}
      </div>
    </div>`;
}
