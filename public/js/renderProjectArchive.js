function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderRow(project) {
  const id = escapeHtml(project.id);
  return `
    <li class="archive-row" data-archive-row="${id}">
      <span class="archive-row__name">${escapeHtml(project.name || 'Untitled project')}</span>
      <div class="archive-row__actions">
        <button class="bracket-button" type="button" data-action="archive-restore" data-project-id="${id}">[↩] restore</button>
        <button class="bracket-button bracket-button--quiet" type="button" data-action="archive-delete" data-project-id="${id}">[x] delete</button>
      </div>
    </li>`;
}

export function renderProjectArchiveHtml({ projects = [], error = '' } = {}) {
  return `
    <div class="modal-backdrop" data-project-archive>
      <section class="admin-modal" role="dialog" aria-modal="true" aria-labelledby="project-archive-title">
        <header class="modal-header">
          <div class="modal-header--desktop">
            <div class="modal-header__heading">
              <span class="detail-kicker">Recover</span>
              <h2 id="project-archive-title">Archived projects</h2>
              <p>Restore a project to active, or permanently delete an empty one.</p>
            </div>
            <button class="modal-header__close bracket-button bracket-button--quiet" type="button" data-action="back-to-manager" aria-label="Back to projects">[&lt;] back</button>
          </div>
          <div class="modal-header--mobile">
            <button class="modal-header__cancel bracket-button bracket-button--quiet" type="button" data-action="back-to-manager">back</button>
            <h2 class="modal-header__title">archived</h2>
            <button class="modal-header__cancel bracket-button bracket-button--quiet" type="button" data-action="close-project-archive">×</button>
          </div>
        </header>
        <div class="project-archive">
          ${error ? `<p class="project-archive__error" role="alert">${escapeHtml(error)}</p>` : ''}
          <ul class="project-archive__list">
            ${projects.length
              ? projects.map(renderRow).join('')
              : '<li class="project-archive__empty">No archived projects.</li>'}
          </ul>
        </div>
      </section>
    </div>`;
}
