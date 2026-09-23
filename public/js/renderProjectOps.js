// Project ops metadata — who's on call, handoff notes for the next shift, the
// repo the prax CLI matches this project by, and the area that groups it in
// the panel. Pure `project → HTML string` renderers (no DOM, no main.js
// import); events are delegated in main.js via data-action attributes.
//
// 2026-09-19 year-one shell spec: the four fields used to sit on the header
// row beside the title, every one of them rendered even when empty, so a
// long project name truncated ("Homel…") to make room for placeholders.
// Now the header keeps only an "Ops" disclosure; the fields live on their own
// row beneath it, and a field that has no value renders as a small "+ Field"
// affordance instead of an empty input. The input markup (data attributes,
// aria labels, placeholders) is unchanged so the existing debounced-PATCH
// handler in main.js keeps working.

import { escapeHtml } from './html.js';

export const OPS_FIELDS = Object.freeze([
  { key: 'onCall', label: 'On call', attr: 'data-project-oncall', ariaLabel: 'On-call owner', placeholder: 'who is on call' },
  { key: 'handoffNotes', label: 'Handoff', attr: 'data-project-handoff', ariaLabel: 'Handoff notes', placeholder: 'notes for the next shift…', modifier: 'notes' },
  { key: 'repoUrl', label: 'Repo', attr: 'data-project-repourl', ariaLabel: 'Repository URL', placeholder: 'git@github.com:org/repo.git', modifier: 'repo' },
  { key: 'area', label: 'Area', attr: 'data-project-area', ariaLabel: 'Area', placeholder: 'e.g. Work', maxlength: 60 },
]);

// The collapsed-sections key for a project's ops row (same localStorage
// regime as panel areas: absent = expanded).
export function opsSectionKey(projectId) {
  return `ops:${projectId}`;
}

export function revealKey(projectId, field) {
  return `${projectId}:${field}`;
}

// The input's data attribute for a field key (main.js focuses it after a reveal).
export function opsFieldAttr(fieldKey) {
  return OPS_FIELDS.find((field) => field.key === fieldKey)?.attr || null;
}

function hasValue(project, key) {
  return String(project?.[key] ?? '').trim() !== '';
}

// Field keys that carry a value — what the header toggle counts.
export function setOpsFields(project) {
  return OPS_FIELDS.filter((field) => hasValue(project, field.key)).map((field) => field.key);
}

// Header-row disclosure. `collapsed` hides the row; the count tells the truth
// about how many fields are set even while it is hidden.
export function renderOpsToggleHtml(project, { collapsed = false } = {}) {
  const id = escapeHtml(project.id);
  const count = setOpsFields(project).length;
  const label = count ? `Ops <span class="page-head__ops-count">${count}</span>` : 'Ops';
  return `<button type="button" class="page-head__ops-toggle${collapsed ? '' : ' is-open'}" data-action="toggle-section" data-section-key="${escapeHtml(opsSectionKey(project.id))}" data-project-id="${id}" aria-expanded="${!collapsed}" aria-controls="proj-ops-${id}" title="${collapsed ? 'Show' : 'Hide'} on-call, handoff, repo and area">${label}<span class="page-head__ops-chevron" aria-hidden="true">${collapsed ? '▸' : '▾'}</span></button>`;
}

function fieldInputHtml(project, field) {
  const id = escapeHtml(project.id);
  const modifier = field.modifier ? ` proj-ops__field--${field.modifier}` : '';
  const maxlength = field.maxlength ? ` maxlength="${field.maxlength}"` : '';
  return `<label class="proj-ops__field${modifier}"><span class="proj-ops__label">${field.label}</span>`
    + `<input class="proj-ops__input" type="text" ${field.attr} data-project-id="${id}" value="${escapeHtml(project[field.key] || '')}" placeholder="${escapeHtml(field.placeholder)}"${maxlength} aria-label="${field.ariaLabel}"></label>`;
}

function fieldAddHtml(project, field) {
  return `<button type="button" class="proj-ops__add" data-action="reveal-ops-field" data-project-id="${escapeHtml(project.id)}" data-field="${field.key}" aria-label="Add ${field.label.toLowerCase()}">＋ ${field.label}</button>`;
}

// The ops row. A field shows its input when it has a value or when the user
// revealed it this session (`revealed` holds revealKey strings); otherwise it
// is a "+ Field" button. Collapsed renders nothing — the toggle still shows.
export function renderProjectOpsHtml(project, { collapsed = false, revealed = [] } = {}) {
  if (!project || collapsed) return '';
  const shown = new Set(Array.isArray(revealed) ? revealed : []);
  const parts = OPS_FIELDS.map((field) => (
    hasValue(project, field.key) || shown.has(revealKey(project.id, field.key))
      ? fieldInputHtml(project, field)
      : fieldAddHtml(project, field)
  ));
  return `<div class="proj-ops" id="proj-ops-${escapeHtml(project.id)}">${parts.join('')}</div>`;
}
