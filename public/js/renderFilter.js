import { escapeHtml } from './renderHelpers.js';
import { isOpen } from './statusMap.js';
import { dueFlag } from './dueFlags.js';
import { logo } from './icons.js';
import { renderTaskGroupsHtml } from './renderList.js';
import { projectChipHtml } from './renderToday.js';
import { projectResolver } from './taskFilter.js';

// Filter view — a cross-project result set from a shared task-filter predicate.
// Decorate exactly like Today (done / dueInfo / project chip) and reuse the
// list-group renderer; split into Open and Done groups. The predicate is bound
// at call time with a ctx { now, resolveProjectId } so #project works.
export function buildFilterGroups(tasks, projects, predicate, { now = new Date() } = {}) {
  const projectById = new Map((projects || []).map((p) => [p.id, p]));
  const ctx = { now, resolveProjectId: projectResolver(projects) };
  const matched = (tasks || []).filter((task) => {
    try { return predicate(task, ctx); } catch { return false; }
  });
  const decorate = (task) => {
    const project = projectById.get(task.projectId);
    const done = !isOpen(task);
    return {
      ...task,
      done,
      dueInfo: dueFlag(task.dueDate, { done, now }),
      projName: project ? project.name : 'No project',
      projColor: project ? project.color : null,
    };
  };
  const open = matched.filter((task) => isOpen(task)).map(decorate);
  const done = matched.filter((task) => !isOpen(task)).map(decorate);
  const groups = [];
  if (open.length) groups.push({ key: 'open', label: 'Open', tone: 'muted', tasks: open });
  if (done.length) groups.push({ key: 'done', label: 'Done', tone: 'muted', tasks: done });
  return { groups, flatIds: groups.flatMap((g) => g.tasks.map((t) => t.id)), count: matched.length };
}

// renderFilterHtml(state, model) — model = { groups, count, error } from
// buildFilterGroups + parseTaskFilter. The input is live; main.js re-renders and
// restores focus/caret on each keystroke (like the library search).
export function renderFilterHtml(state, model) {
  const expr = state.activeFilterExpr || '';
  const view = (state.taskSmartViews || []).find((v) => v.id === state.activeSmartViewId);
  const title = view ? escapeHtml(view.label) : 'Filter';
  const errHint = model.error
    ? `<span class="filter-bar__hint filter-bar__hint--error">${escapeHtml(model.error)}</span>`
    : '<span class="filter-bar__hint">@label · p1 · overdue · due:today · status:in-progress · &amp; | -</span>';
  const canSave = Boolean(expr.trim()) && !model.error;
  const saveBtn = canSave
    ? '<button class="btn-ghost" type="button" data-action="save-smart-view">Save as view</button>'
    : '';
  const body = model.groups.length
    ? renderTaskGroupsHtml(state, model.groups, { rowExtra: projectChipHtml })
    : `<div class="empty">${logo(48)}`
      + '<p class="empty__title">No matches</p>'
      + `<p class="empty__sub">${expr.trim() ? 'No tasks match this filter.' : 'Type a filter — e.g. p1 &amp; overdue, or @waiting.'}</p>`
      + '</div>';
  return `<div class="page">
      <header class="page-head"><h1 class="page-head__title">${title}</h1></header>
      <div class="filter-bar">
        <input class="filter-bar__input" type="text" data-filter-input placeholder="p1 &amp; overdue · @waiting · due:today" value="${escapeHtml(expr)}" autocomplete="off" spellcheck="false" aria-label="Task filter">
        <span class="filter-bar__count">${model.count} match${model.count === 1 ? '' : 'es'}</span>
        ${saveBtn}
      </div>
      ${errHint}
      ${body}
    </div>`;
}
