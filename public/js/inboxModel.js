export const INBOX_LINK = '#inbox-process';
export function isWorkspaceReview(document) {
  return Array.isArray(document?.tags) && document.tags.includes('weekly-review');
}
export function isPendingInboxTask(task) {
  return Boolean(task) && !task.archivedAt && task.status !== 'completed';
}
export function isPendingInboxDocument(document) {
  return Boolean(document) && !document.archivedAt && (document.status || 'active') === 'active' && !isWorkspaceReview(document);
}
export function ageInDays(createdAt, now = new Date()) {
  const age = new Date(now).getTime() - new Date(createdAt).getTime();
  return Number.isFinite(age) ? Math.max(0, Math.floor(age / 86400000)) : 0;
}
export function inboxSummary(tasks, documents, inboxId, now = new Date()) {
  const pendingTasks = tasks.filter(item => item.projectId === inboxId && isPendingInboxTask(item));
  const pendingNotes = documents.filter(item => item.projectId === inboxId && isPendingInboxDocument(item));
  const pending = [...pendingTasks, ...pendingNotes];
  return { total: pending.length, tasks: pendingTasks.length, notes: pendingNotes.length,
    olderThanWeek: pending.filter(item => ageInDays(item.createdAt, now) >= 7).length,
    oldestDays: pending.reduce((oldest, item) => Math.max(oldest, ageInDays(item.createdAt, now)), 0) };
}
