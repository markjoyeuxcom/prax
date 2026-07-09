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

function localHHMM(now) {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

export function computeDueReminders(tasks, { now = new Date() } = {}) {
  const today = isoDateOnly(now);
  const time = localHHMM(now);
  return (tasks || []).filter((task) => {
    if (!task || task.archivedAt) return false;
    if (task.status === 'completed') return false;
    if (!task.dueDate) return false;
    if (task.dueDate > today) return false; // due in the future
    // A task with a time-of-day that is due TODAY only warrants a reminder once
    // its time has arrived; an overdue timed task (its date already past) fires
    // regardless. Zero-padded 'HH:MM' compares correctly as strings.
    if (task.dueTime && task.dueDate === today && time < task.dueTime) return false;
    if (task.deferredUntil && new Date(task.deferredUntil) > now) return false; // snoozed
    return true;
  });
}

// Whether a due date is strictly before today (overdue) vs due today — used to
// phrase the reminder.
export function isOverdue(dueDate, now = new Date()) {
  return Boolean(dueDate) && dueDate < isoDateOnly(now);
}
