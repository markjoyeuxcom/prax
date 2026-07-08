// Due-date reminders — the pure "what is due right now" selection. A task
// warrants a reminder when it is active (not archived, not completed), carries a
// due date of today or earlier, and is not currently snoozed past now. The
// delivery (native notification / in-app toast) lives in main.js; this stays
// pure and testable so the selection never drifts from the Today view's logic.

function isoDateOnly(now) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function computeDueReminders(tasks, { now = new Date() } = {}) {
  const today = isoDateOnly(now);
  return (tasks || []).filter((task) => {
    if (!task || task.archivedAt) return false;
    if (task.status === 'completed') return false;
    if (!task.dueDate) return false;
    if (task.dueDate > today) return false; // due in the future
    if (task.deferredUntil && new Date(task.deferredUntil) > now) return false; // snoozed
    return true;
  });
}

// Whether a due date is strictly before today (overdue) vs due today — used to
// phrase the reminder.
export function isOverdue(dueDate, now = new Date()) {
  return Boolean(dueDate) && dueDate < isoDateOnly(now);
}
