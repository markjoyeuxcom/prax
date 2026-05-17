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

const CONTEXTS = [
  { value: 'personal', label: 'Personal' },
  { value: 'work', label: 'Work' },
  { value: 'homelab', label: 'Homelab' },
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
  activeContext = 'homelab',
  error = '',
  isSaving = false,
} = {}) {
  const isEditing = Boolean(task);
  const values = {
    title: task?.title || '',
    description: task?.description || '',
    priority: task?.priority || 'medium',
    status: task?.status || 'planned',
    context: task?.context || task?.tab || activeContext,
    dueDate: task?.dueDate || '',
  };

  return `
    <div class="modal-backdrop" data-modal="task-form">
      <section class="task-form-modal" role="dialog" aria-modal="true" aria-labelledby="task-form-title">
        <header class="task-form-header">
          <div>
            <h2 id="task-form-title">${isEditing ? 'Edit Task' : 'New Task'}</h2>
            <p>${isEditing ? 'Update the selected operational task.' : 'Add work to the active queue.'}</p>
          </div>
          <button class="icon-action" type="button" data-action="close-task-form" aria-label="Close task form">x</button>
        </header>

        <form class="task-form" data-task-form>
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
              <span>Context</span>
              <select name="context">${renderOptions(CONTEXTS, values.context)}
              </select>
            </label>
            <label>
              <span>Due</span>
              <input name="dueDate" type="date" value="${escapeHtml(values.dueDate)}">
            </label>
          </div>
          <footer class="task-form-actions">
            <button class="secondary-action" type="button" data-action="close-task-form">Cancel</button>
            <button class="primary-action" type="submit"${isSaving ? ' disabled' : ''}>${isSaving ? 'Saving...' : 'Save Task'}</button>
          </footer>
        </form>
      </section>
    </div>`;
}
