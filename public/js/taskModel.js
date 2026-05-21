function parseTaskDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : new Date(value);
  if (typeof value !== 'string') return null;

  const dateOnlyMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getWeekBounds(today) {
  const parsedToday = parseTaskDate(today);
  if (!parsedToday) return null;

  const weekStart = new Date(parsedToday);
  weekStart.setHours(0, 0, 0, 0);
  const day = weekStart.getDay();
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  weekStart.setDate(weekStart.getDate() - daysSinceMonday);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  return { weekStart, weekEnd };
}

function completedInWeek(task, weekBounds) {
  if (!weekBounds || (task.status !== 'completed' && task.column !== 'completed')) return false;

  const completedDate = parseTaskDate(task.completedAt || task.updatedAt);
  if (!completedDate) return false;

  return completedDate >= weekBounds.weekStart && completedDate <= weekBounds.weekEnd;
}

export function normalizeTask(task) {
  return {
    id: task.id,
    title: task.title || '',
    description: task.description || '',
    priority: task.priority || 'medium',
    status: task.status || task.column || 'planned',
    column: task.status || task.column || 'planned',
    projectId: task.projectId || null,
    dueDate: task.dueDate || task.due_date || null,
    sortOrder: Number.isFinite(task.sortOrder) ? task.sortOrder : task.order || 0,
    order: Number.isFinite(task.sortOrder) ? task.sortOrder : task.order || 0,
    archivedAt: task.archivedAt || null,
    createdAt: task.createdAt || null,
    updatedAt: task.updatedAt || null,
    completedAt: task.completedAt || task.completed_at || null,
  };
}

export function buildMetrics(tasks, today) {
  const weekBounds = getWeekBounds(today);

  return tasks.reduce((metrics, task) => {
    metrics.total += 1;
    if (task.dueDate === today && task.status !== 'completed' && task.column !== 'completed') metrics.dueToday += 1;
    if (task.dueDate && task.dueDate < today && task.status !== 'completed' && task.column !== 'completed') metrics.overdue += 1;
    if (task.priority === 'high') metrics.highPriority += 1;
    if (task.status === 'in-progress' || task.column === 'in-progress') metrics.inProgress += 1;
    if (completedInWeek(task, weekBounds)) metrics.completedThisWeek += 1;
    return metrics;
  }, {
    total: 0,
    dueToday: 0,
    completedThisWeek: 0,
    highPriority: 0,
    overdue: 0,
    inProgress: 0,
  });
}
