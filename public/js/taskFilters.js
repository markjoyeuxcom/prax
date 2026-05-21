function normalize(value) {
  return String(value ?? '').toLowerCase().replace(/-/g, ' ');
}

function searchableText(task) {
  return [
    task.title,
    task.description,
    task.priority,
    task.status,
    task.dueDate,
  ].map(normalize).join(' ');
}

export function filterTasks(tasks, query) {
  const trimmedQuery = normalize(query).trim();
  if (!trimmedQuery) return tasks;

  return tasks.filter(task => searchableText(task).includes(trimmedQuery));
}
