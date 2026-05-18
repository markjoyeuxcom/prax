export const BOARD_STATUSES = ['high-priority', 'in-progress', 'planned', 'completed', 'notes'];

function sortByBoardOrder(tasks) {
  return [...tasks].sort((a, b) => {
    const orderDelta = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    if (orderDelta !== 0) return orderDelta;
    return String(a.title || '').localeCompare(String(b.title || ''));
  });
}

export function moveTaskOnBoard(tasks = [], move = {}) {
  const safeTasks = Array.isArray(tasks) ? tasks : [];
  const movingTask = safeTasks.find(task => task.id === move.taskId);
  if (!movingTask || !BOARD_STATUSES.includes(move.targetStatus)) {
    return { tasks: safeTasks, updates: [] };
  }

  const originalById = new Map(safeTasks.map(task => [task.id, task]));
  const groups = BOARD_STATUSES.reduce((columns, status) => {
    columns[status] = sortByBoardOrder(
      safeTasks.filter(task => task.id !== movingTask.id && task.status === status),
    );
    return columns;
  }, {});

  const targetGroup = groups[move.targetStatus];
  const movingNext = { ...movingTask, status: move.targetStatus };
  const beforeIndex = move.beforeTaskId
    ? targetGroup.findIndex(task => task.id === move.beforeTaskId)
    : -1;
  targetGroup.splice(beforeIndex >= 0 ? beforeIndex : targetGroup.length, 0, movingNext);

  const nextTasks = BOARD_STATUSES.flatMap(status =>
    groups[status].map((task, sortOrder) => ({ ...task, sortOrder })),
  );

  const updates = nextTasks
    .filter((task) => {
      const original = originalById.get(task.id);
      return original && (original.status !== task.status || original.sortOrder !== task.sortOrder);
    })
    .map(task => ({
      id: task.id,
      status: task.status,
      sortOrder: task.sortOrder,
    }));

  return { tasks: nextTasks, updates };
}
