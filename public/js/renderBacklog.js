// Prax backlog + archive tabs (design-handoff §Screens 3–4). Pure render
// modules: the caller pre-filters the task lists (backlog = designStatus
// 'backlog' i.e. API status 'notes', not archived; archive = archivedAt set).
// Actions delegate in main.js: open-task / promote-task on backlog rows,
// restore-task / delete-archived-task on archive rows.

import { escapeHtml } from './html.js';
import { prioDotClass } from './renderHelpers.js';
import { renderTaskCollectionProgressHtml } from './renderList.js';

export function renderBacklogHtml(state, tasks = [], { collection = null } = {}) {
  const safeTasks = Array.isArray(tasks) ? tasks : [];
  const hint = '<p class="view-hint">Someday / maybe — no dates, no pressure.</p>';

  if (!safeTasks.length) {
    return `${hint}<div class="empty-slot">The backlog is empty — enjoy it while it lasts.</div>`;
  }

  const rows = safeTasks.map((task) => {
    const id = escapeHtml(task.id);
    return `<div class="plain-row" data-action="open-task" data-task-id="${id}">`
      + `<span class="${prioDotClass(task.priority)}"></span>`
      + `<span class="plain-row__title">${escapeHtml(task.title || 'Untitled task')}</span>`
      + `<button type="button" class="btn-outline" data-action="promote-task" data-task-id="${id}">Promote to board</button>`
      + '</div>';
  }).join('');

  return `${hint}<div class="rows">${rows}</div>${renderTaskCollectionProgressHtml(collection)}`;
}

export function renderArchiveHtml(state, tasks = [], { collection = null } = {}) {
  const safeTasks = Array.isArray(tasks) ? tasks : [];

  if (!safeTasks.length) {
    return '<div class="empty-slot">Nothing archived in this project.</div>';
  }

  const rows = safeTasks.map((task) => {
    const id = escapeHtml(task.id);
    return `<div class="plain-row is-dim" data-task-id="${id}">`
      + `<span class="plain-row__title">${escapeHtml(task.title || 'Untitled task')}</span>`
      + `<button type="button" class="btn-outline" data-action="restore-task" data-task-id="${id}">Restore</button>`
      + `<button type="button" class="btn-outline btn-outline--danger" data-action="delete-archived-task" data-task-id="${id}">Delete</button>`
      + '</div>';
  }).join('');

  return `<div class="rows">${rows}</div>${renderTaskCollectionProgressHtml(collection)}`;
}
