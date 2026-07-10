import { escapeHtml } from './renderHelpers.js';
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
  const chip = (field, label, { tone = '', dot = '' } = {}) =>
    `<button type="button" class="nlchip${tone ? ` nlchip--${tone}` : ''}" data-action="drop-nl-field" data-field="${escapeHtml(field)}" title="Click to remove">${dot}${escapeHtml(label)}<span class="nlchip__x" aria-hidden="true">×</span></button>`;

  if (fields.project) {
    const proj = (projects || []).find((p) => p.slug === fields.project);
    const dot = `<span class="proj-dot" style="--dot:${escapeHtml(proj?.color || 'var(--accent)')}" aria-hidden="true"></span>`;
    chips.push(chip('project', proj?.name || `#${fields.project}`, { dot }));
  }
  if (fields.priority) chips.push(chip('priority', `!${fields.priority}`));
  if (fields.dueDate) {
    const flag = dueFlag(fields.dueDate, {});
    const isPast = flag?.bucket === 'overdue';
    chips.push(chip('dueDate', `${chipDate(fields.dueDate)}${fields.dueTime ? ` · ${fields.dueTime}` : ''}`, { tone: isPast ? 'warn' : '' }));
  }
  if (fields.recurrence) chips.push(chip('recurrence', `↻ ${fields.recurrence}`));
  for (const label of fields.labels || []) {
    chips.push(`<button type="button" class="nlchip" data-action="drop-nl-label" data-value="${escapeHtml(label)}" title="Click to remove">@${escapeHtml(label)}<span class="nlchip__x" aria-hidden="true">×</span></button>`);
  }

  const ignored = (state.nlCaptureDropped || []).length
    ? `<div class="capture__ignored">ignored: ${state.nlCaptureDropped.map((d) => escapeHtml(d.field === 'project' ? `#${d.value} (no such project)` : `@${d.value}`)).join(' · ')}</div>`
    : '';
  return `<div class="capture__preview" data-nl-preview>${chips.length ? chips.join('') : '<span class="capture__preview-none">No fields parsed — ↵ adds the task as titled.</span>'}</div>${ignored}`;
}

export function renderCaptureHtml(state, project, projects = []) {
  const color = escapeHtml(project?.color || 'var(--accent)');
  const dueHint = state?.captureDueDate && !state?.nlCaptureFields ? '<span class="capture__due">Due today</span>' : '';
  const canNl = Boolean(state?.chatStatus?.available);
  const previewing = Boolean(state?.nlCaptureFields);
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
  const error = state?.nlCaptureError
    ? `<div class="capture__nl-error">${escapeHtml(state.nlCaptureError)}</div>`
    : '';
  const hint = state?.nlCaptureLoading
    ? '<span class="capture__hint capture__hint--busy">✦ Parsing…</span>'
    : previewing
      ? '<span class="capture__hint"><span class="kbd">↵</span> add task · <span class="kbd">⌘↵</span> re-parse · <span class="kbd">esc</span> cancel</span>'
      : canNl
        ? '<span class="capture__hint"><span class="kbd">↵</span> add task · <span class="kbd">⌘↵</span> ✦ smart add</span>'
        : '<span class="capture__hint"><span class="kbd">↵</span> add task</span>';
  return `
    <div class="overlay-center" data-overlay="capture" data-action="close-capture">
      <div class="capture" role="dialog" aria-label="Quick capture">
        <div class="capture__row">
          ${icon('check')}
          <input class="capture__input" type="text" data-capture-input placeholder="What needs doing?  —  try “rotate certs #homelab @cert !high fri”" value="${escapeHtml(state?.captureQuery ?? '')}" autocomplete="off" spellcheck="false">
        </div>
        ${nlPreviewHtml(state, projects)}
        ${error}
        <div class="capture__foot">
          <button type="button" class="capture__proj" data-action="toggle-capture-menu" aria-haspopup="listbox" aria-expanded="${state?.captureMenuOpen ? 'true' : 'false'}">
            <span class="capture__proj-label">Adding to</span>
            <span class="proj-dot" style="--dot:${color}" aria-hidden="true"></span>${escapeHtml(project?.name ?? 'Inbox')}
            <span class="capture__caret" aria-hidden="true">▾</span>
          </button>
          <span class="capture__foot-right">
            ${dueHint}
            ${hint}
          </span>
        </div>
        ${menu}
      </div>
    </div>`;
}
