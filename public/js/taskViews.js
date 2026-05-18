export function isArchiveView(activeView) {
  return activeView === 'archive';
}

export function tasksForView(tasks, activeView) {
  if (activeView === 'backlog') {
    return tasks.filter(task => (task.status || task.column) === 'planned' && !task.dueDate);
  }

  return tasks;
}
