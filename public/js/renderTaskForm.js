const PRIORITIES = [
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const STATUSES = [
  { value: 'high-priority', label: 'High Priority' },
  { value: 'in-progress', label: 'In Progress' },
  { value: 'planned', label: 'Planned' },
  { value: 'completed', label: 'Completed' },
  { value: 'notes', label: 'Notes' },
];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderOptions(options, selectedValue) {
  return options.map(option => `
            <option value="${option.value}"${option.value === selectedValue ? ' selected' : ''}>${option.label}</option>`).join('');
}

export function renderTaskFormHtml({
  task = null,
  projects = [],
  values: valuesOverride = {},
  error = '',
  isSaving = false,
} = {}) {
  const isEditing = Boolean(task);
  const values = {
    title: task?.title || '',
    description: task?.description || '',
    priority: task?.priority || 'medium',
    status: task?.status || 'planned',
    project: valuesOverride.project || task?.projectId || '',
    dueDate: task?.dueDate || '',
  };

  return `
    <div class="modal-backdrop" data-modal="task-form">
      <section class="task-form-modal" role="dialog" aria-modal="true" aria-labelledby="task-form-title">
        <header class="modal-header">
          <div class="modal-header--desktop">
            <div class="modal-header__heading">
              <h2 id="task-form-title">${isEditing ? 'edit task' : 'new task'}</h2>
              <p>${isEditing ? 'Update the selected operational task.' : 'Add work to the active queue.'}</p>
            </div>
            <button class="modal-header__close bracket-button bracket-button--quiet" type="button" data-action="close-task-form" aria-label="Close task form">[x] close</button>
          </div>
          <div class="modal-header--mobile">
            <button class="modal-header__cancel bracket-button bracket-button--quiet" type="button" data-action="close-task-form">cancel</button>
            <h2 class="modal-header__title">${isEditing ? 'edit task' : 'new task'}</h2>
            <button class="modal-header__save bracket-button bracket-button--primary" type="submit" form="task-form" data-action="submit-from-header"${isSaving ? ' disabled' : ''}>${isSaving ? '[s] saving...' : '[s] save'}</button>
          </div>
        </header>

        <form class="task-form" id="task-form" data-task-form>
          ${error ? `<div class="form-error" role="alert">${escapeHtml(error)}</div>` : ''}
          <label>
            <span>Title</span>
            <input name="title" type="text" value="${escapeHtml(values.title)}" autocomplete="off" required>
          </label>
          <label>
            <span>Description</span>
            <textarea name="description" rows="4">${escapeHtml(values.description)}</textarea>
          </label>
          <div class="form-grid">
            <label>
              <span>Priority</span>
              <select name="priority">${renderOptions(PRIORITIES, values.priority)}
              </select>
            </label>
            <label>
              <span>Status</span>
              <select name="status">${renderOptions(STATUSES, values.status)}
              </select>
            </label>
            <label>
              <span>Project</span>
              <select name="project">${projects.map(project =>
    `<option value="${escapeHtml(project.id)}"${project.id === values.project ? ' selected' : ''}>${escapeHtml(project.name)}</option>`
  ).join('')}</select>
            </label>
            <label>
              <span>Due</span>
              <input name="dueDate" type="date" value="${escapeHtml(values.dueDate)}">
            </label>
          </div>
          <footer class="task-form-actions">
            <button class="bracket-button bracket-button--quiet" type="button" data-action="close-task-form">cancel</button>
            <button class="bracket-button bracket-button--primary" type="submit"${isSaving ? ' disabled' : ''}>${isSaving ? '[s] saving...' : '[s] save'}</button>
          </footer>
        </form>
      </section>
    </div>`;
}
