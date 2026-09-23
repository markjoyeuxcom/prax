import { cssColor, escapeHtml } from './html.js';
import { icon } from './icons.js';
import { dueFlag } from './dueFlags.js';

// Quick capture (N, design-handoff §10) — one input, Enter adds a task to the
// destination project. The destination is context-derived (the project you're
// viewing, else Inbox) and changeable via the footer picker; capturing from
// Today also pre-sets a due-today so the task shows up in the view you made it.
//
// Tier-3 #8 adds ⌘↵ "smart add": the AI parses the natural-language text into
// fields shown as a chips preview (the cleaned title replaces the input, still
// editable); plain Enter then confirms. Nothing is created until the human
// confirms, and every chip is removable. Plain Enter without a preview stays
// byte-identical to the deterministic path.

// "Fri Jul 17" — local-noon parse (same trick as dueFlags) avoids UTC drift.
function chipDate(dueDate) {
  const d = new Date(`${dueDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dueDate;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function nlPreviewHtml(state, projects) {
  const fields = state.nlCaptureFields;
  if (!fields) return '';
  const chips = [];
  const disabled = state?.captureSubmitting ? ' disabled' : '';
  const chip = (field, label, { tone = '', dotHtml = '' } = {}) =>
    `<button type="button" class="nlchip${tone ? ` nlchip--${escapeHtml(tone)}` : ''}" data-action="drop-nl-field" data-field="${escapeHtml(field)}" aria-label="Remove ${escapeHtml(label)}" title="Click to remove"${disabled}>${dotHtml}${escapeHtml(label)}<span class="nlchip__x" aria-hidden="true">×</span></button>`;

  if (fields.project) {
    const proj = (projects || []).find((p) => p.slug === fields.project);
    const dotHtml = `<span class="proj-dot" style="--dot:${cssColor(proj?.color, 'var(--accent)')}" aria-hidden="true"></span>`;
    chips.push(chip('project', proj?.name || `#${fields.project}`, { dotHtml }));
  }
  if (fields.priority) chips.push(chip('priority', `!${fields.priority}`));
  if (fields.dueDate) {
    const flag = dueFlag(fields.dueDate, {});
    const isPast = flag?.bucket === 'overdue';
    chips.push(chip('dueDate', `${chipDate(fields.dueDate)}${fields.dueTime ? ` · ${fields.dueTime}` : ''}`, { tone: isPast ? 'warn' : '' }));
  }
  if (fields.recurrence) chips.push(chip('recurrence', `↻ ${fields.recurrence}`));
  for (const label of fields.labels || []) {
    chips.push(`<button type="button" class="nlchip" data-action="drop-nl-label" data-value="${escapeHtml(label)}" aria-label="Remove label ${escapeHtml(label)}" title="Click to remove"${disabled}>@${escapeHtml(label)}<span class="nlchip__x" aria-hidden="true">×</span></button>`);
  }

  const ignored = (state.nlCaptureDropped || []).length
    ? `<div class="capture__ignored">ignored: ${state.nlCaptureDropped.map((d) => escapeHtml(d.field === 'project' ? `#${d.value} (no such project)` : `@${d.value}`)).join(' · ')}</div>`
    : '';
  return `<div class="capture__preview" data-nl-preview>${chips.length ? chips.join('') : '<span class="capture__preview-none">No fields parsed — ↵ adds the task as titled.</span>'}</div>${ignored}`;
}

export function renderCaptureHtml(state, project, projects = []) {
  const color = cssColor(project?.color, 'var(--accent)');
  const dueHint = state?.captureDueDate && !state?.nlCaptureFields ? '<span class="capture__due">Due today</span>' : '';
  const canNl = Boolean(state?.chatStatus?.available);
  const previewing = Boolean(state?.nlCaptureFields);
  const submitting = Boolean(state?.captureSubmitting);
  const disabled = submitting ? ' disabled' : '';
  const menu = state?.captureMenuOpen
    ? '<div class="menu capture__menu" role="listbox" aria-label="Choose project">'
      + projects.map((p) => {
        const selected = p.id === project?.id;
        return `<button type="button" class="menu__item capture__menu-item${selected ? ' is-selected' : ''}" role="option" aria-selected="${selected}" data-action="set-capture-project" data-project-id="${escapeHtml(p.id)}"${disabled}>`
          + `<span class="proj-dot" style="--dot:${cssColor(p.color, 'var(--accent)')}" aria-hidden="true"></span>`
          + `<span class="capture__menu-name">${escapeHtml(p.name)}</span>`
          + (selected ? icon('check', 12) : '')
          + '</button>';
      }).join('')
      + '</div>'
    : '';
  const error = state?.nlCaptureError
    ? `<div class="capture__nl-error" role="alert">${escapeHtml(state.nlCaptureError)}</div>`
    : '';
  const captureNotice = state?.captureError
    ? `<div class="capture__notice${state.captureRecovered ? ' capture__notice--recovered' : ''}" role="${state.captureRecovered ? 'status' : 'alert'}">${escapeHtml(state.captureError)}</div>`
    : '';
  const hint = submitting
    ? '<span class="capture__hint capture__hint--busy" role="status">Adding task…</span>'
    : state?.nlCaptureLoading
    ? '<span class="capture__hint capture__hint--busy">✦ Parsing…</span>'
    : previewing
      ? '<span class="capture__hint"><span class="kbd">↵</span> add task · <span class="kbd">⌘↵</span> re-parse · <span class="kbd">esc</span> cancel</span>'
      : canNl
        ? '<span class="capture__hint"><span class="kbd">↵</span> add task · <span class="kbd">⌘↵</span> ✦ smart add</span>'
        : '<span class="capture__hint"><span class="kbd">↵</span> add task</span>';
  return `
    <div class="overlay-center" data-overlay="capture" data-action="close-capture">
      <div class="capture" role="dialog" aria-modal="true" aria-label="Quick capture" aria-busy="${submitting}">
        <div class="capture__row">
          ${icon('check')}
          <input class="capture__input" type="text" data-capture-input aria-label="Task title" placeholder="What needs doing?  —  try “rotate certs #homelab @cert !high fri”" value="${escapeHtml(state?.captureQuery ?? '')}" autocomplete="off" spellcheck="false"${disabled}>
        </div>
        ${nlPreviewHtml(state, projects)}
        ${error}
        ${captureNotice}
        <div class="capture__foot">
          <button type="button" class="capture__proj" data-action="toggle-capture-menu" aria-label="Choose destination project, current ${escapeHtml(project?.name ?? 'No project')}" aria-haspopup="listbox" aria-expanded="${state?.captureMenuOpen ? 'true' : 'false'}"${disabled}>
            <span class="capture__proj-label">Adding to</span>
            <span class="proj-dot" style="--dot:${color}" aria-hidden="true"></span>${escapeHtml(project?.name ?? 'Inbox')}
            <span class="capture__caret" aria-hidden="true">▾</span>
          </button>
          <span class="capture__foot-right">
            ${dueHint}
            ${hint}
            <button type="button" class="btn-primary capture__submit" data-action="submit-capture"${submitting || state?.nlCaptureLoading || !String(state?.captureQuery || '').trim() ? ' disabled' : ''}>${submitting ? 'Adding…' : 'Add task'}</button>
          </span>
        </div>
        ${menu}
      </div>
    </div>`;
}
