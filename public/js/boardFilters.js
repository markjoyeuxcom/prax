function isCompleted(task) {
  return (task.status || task.column || 'planned') === 'completed';
}

function isOverdue(task, today) {
  return Boolean(task.dueDate && task.dueDate < today && !isCompleted(task));
}

function isDueToday(task, today) {
  return Boolean(task.dueDate && task.dueDate === today && !isCompleted(task));
}

function extraFor(taskExtras, id) {
  return taskExtras?.[id] || {};
}

const FILTERS = {
  overdue: (task, extras, today) => isOverdue(task, today),
  'due-today': (task, extras, today) => isDueToday(task, today),
  high: task => String(task.priority || '').toLowerCase() === 'high',
  'has-docs': (task, extras) => Number(extras.docsCount || 0) > 0,
  'no-checklist': (task, extras) => Number(extras.checklistTotal || 0) === 0 && !isCompleted(task),
  notes: task => Boolean(String(task.notes || '').trim()),
};

export function applyBoardFilters(tasks = [], filters = [], taskExtras = {}, today = '') {
  const safeTasks = Array.isArray(tasks) ? tasks : [];
  const activeFilters = Array.isArray(filters) ? filters.filter(filter => FILTERS[filter]) : [];
  if (!activeFilters.length) return safeTasks;

  return safeTasks.filter(task => activeFilters.every(filter => (
    FILTERS[filter](task, extraFor(taskExtras, task.id), today)
  )));
}

export function boardFilterOptions() {
  return [
    { id: 'overdue', label: 'overdue' },
    { id: 'due-today', label: 'due today' },
    { id: 'high', label: 'high' },
    { id: 'has-docs', label: 'has docs' },
    { id: 'no-checklist', label: 'no checklist' },
    { id: 'notes', label: 'notes' },
  ];
}
