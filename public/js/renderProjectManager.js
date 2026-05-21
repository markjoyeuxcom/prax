const STATUS_GROUPS = [
  { value: 'active', label: 'Active' },
  { value: 'on-hold', label: 'On hold' },
  { value: 'completed', label: 'Completed' },
];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderStatusSelect(project) {
  const id = escapeHtml(project.id);
  const selected = STATUS_GROUPS.some(option => option.value === project.status)
    ? project.status
    : STATUS_GROUPS[0].value;
  return `<select class="project-row__status" data-project-status="${id}" aria-label="Status">${
    STATUS_GROUPS.map(option =>
      `<option value="${option.value}"${option.value === selected ? ' selected' : ''}>${option.label}</option>`,
    ).join('')
  }</select>`;
}

function renderProjectRow(project) {
  const id = escapeHtml(project.id);
  return `
    <li class="project-row" data-project-row="${id}">
      <input type="text" class="project-row__name" data-project-name="${id}" value="${escapeHtml(project.name)}" autocomplete="off" aria-label="Project name">
      ${renderStatusSelect(project)}
      <div class="project-row__actions">
        <button class="bracket-button bracket-button--quiet" type="button" data-action="manager-move-up" data-project-id="${id}" aria-label="Move up">[↑]</button>
        <button class="bracket-button bracket-button--quiet" type="button" data-action="manager-move-down" data-project-id="${id}" aria-label="Move down">[↓]</button>
        <button class="bracket-button" type="button" data-action="manager-save" data-project-id="${id}">[s] save</button>
        <button class="bracket-button bracket-button--quiet" type="button" data-action="manager-archive" data-project-id="${id}">[a] archive</button>
        <button class="bracket-button bracket-button--quiet" type="button" data-action="manager-delete" data-project-id="${id}">[x] delete</button>
      </div>
    </li>`;
}

function effectiveStatus(status) {
  // Archived never belongs to a live group (it lives in the Archive dialog).
  // Any other unrecognised status falls back to 'active', matching the
  // status-select default so the project still appears and is editable.
  if (status === 'archived') return 'archived';
  return STATUS_GROUPS.some(g => g.value === status) ? status : 'active';
}

function renderGroup(group, projects) {
  const inGroup = projects.filter(p => effectiveStatus(p.status) === group.value);
  if (inGroup.length === 0) return '';
  return `
    <li class="project-group" data-project-group="${group.value}">
      <p class="project-group__label">${group.label} · ${inGroup.length}</p>
      <ul class="project-manager__list">${inGroup.map(renderProjectRow).join('')}</ul>
    </li>`;
}

export function renderProjectManagerHtml({ projects = [], archivedCount = 0, error = '' } = {}) {
  const groups = STATUS_GROUPS.map(group => renderGroup(group, projects)).join('');
  return `
    <div class="modal-backdrop" data-project-manager>
      <section class="admin-modal" role="dialog" aria-modal="true" aria-labelledby="project-manager-title">
        <header class="modal-header">
          <div class="modal-header--desktop">
            <div class="modal-header__heading">
              <span class="detail-kicker">Organize</span>
              <h2 id="project-manager-title">Projects</h2>
              <p>Create, rename, set status, reorder, archive, and delete your projects.</p>
            </div>
            <button class="modal-header__close bracket-button bracket-button--quiet" type="button" data-action="close-project-manager" aria-label="Close projects">[x] close</button>
          </div>
          <div class="modal-header--mobile">
            <button class="modal-header__cancel bracket-button bracket-button--quiet" type="button" data-action="close-project-manager">cancel</button>
            <h2 class="modal-header__title">projects</h2>
            <span></span>
          </div>
        </header>
        <div class="project-manager">
          ${error ? `<p class="project-manager__error" role="alert">${escapeHtml(error)}</p>` : ''}
          <div class="project-manager__create">
            <input type="text" class="project-manager__new-name" data-project-new-name placeholder="New project name" autocomplete="off" aria-label="New project name">
            <button class="bracket-button bracket-button--primary" type="button" data-action="manager-create">[+] add</button>
          </div>
          <ul class="project-manager__groups">
            ${groups || '<li class="project-manager__empty">No projects yet — add one above.</li>'}
          </ul>
          <button class="bracket-button bracket-button--quiet project-manager__archive-link" type="button" data-action="open-project-archive">[a] archived projects · ${Number(archivedCount) || 0}</button>
        </div>
      </section>
    </div>`;
}
