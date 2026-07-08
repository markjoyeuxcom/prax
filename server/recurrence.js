// Task recurrence — a small, additive scheduling model. A task carries a
// nullable `recurrence` token; when it is completed, the PATCH route spawns the
// next instance with an advanced due date. Kept deliberately simple: three
// presets plus an `every:Nd` / `every:Nw` escape hatch for agents/power users.

export const RECURRENCES = ['daily', 'weekly', 'monthly'];

const EVERY_RE = /^every:(\d+)([dw])$/;

// null / '' / undefined all mean "no recurrence" (and are valid — clearing).
export function isValidRecurrence(value) {
  if (value === null || value === undefined || value === '') return true;
  if (typeof value !== 'string') return false;
  if (RECURRENCES.includes(value)) return true;
  const m = EVERY_RE.exec(value);
  return Boolean(m) && Number(m[1]) > 0;
}

function addDays(date, n) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + n);
  return d;
}

// Same day-of-month n months on, clamped to the target month's last day so
// "monthly" on the 31st lands on Feb 28/29 rather than skipping into March.
function addMonths(date, n) {
  const target = new Date(date.getFullYear(), date.getMonth() + n, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(date.getDate(), lastDay));
  return target;
}

function advanceOnce(date, recurrence) {
  if (recurrence === 'daily') return addDays(date, 1);
  if (recurrence === 'weekly') return addDays(date, 7);
  if (recurrence === 'monthly') return addMonths(date, 1);
  const m = EVERY_RE.exec(recurrence);
  if (m) return addDays(date, Number(m[1]) * (m[2] === 'w' ? 7 : 1));
  return null;
}

function isoDate(date) {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

// The due date for the next instance after completing a recurring task.
// Advances from the task's due date (or today when it has none) by one interval,
// then rolls forward until strictly after today — so completing an overdue
// recurring task reschedules into the future rather than the past, without
// materialising every skipped occurrence. Returns null for no/invalid recurrence.
export function nextDueDate(recurrence, dueDate, now = new Date()) {
  if (!recurrence || !isValidRecurrence(recurrence)) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let base = /^\d{4}-\d{2}-\d{2}$/.test(dueDate || '')
    ? new Date(Number(dueDate.slice(0, 4)), Number(dueDate.slice(5, 7)) - 1, Number(dueDate.slice(8, 10)))
    : new Date(today);

  let guard = 0;
  do {
    const next = advanceOnce(base, recurrence);
    if (!next) return null;
    base = next;
    guard += 1;
  } while (base <= today && guard < 1000);

  return isoDate(base);
}
