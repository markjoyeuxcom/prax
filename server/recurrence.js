// Task recurrence — a small, additive scheduling model. A task carries a
// nullable `recurrence` token; when it is completed, the PATCH route spawns the
// next instance with an advanced due date. Kept deliberately simple: three
// presets plus an `every:Nd` / `every:Nw` escape hatch for agents/power users.

export const RECURRENCES = ['daily', 'weekly', 'monthly'];

const EVERY_RE = /^every:(\d+)([dw])$/;
const MAX_EVERY_INTERVAL = 10_000;

// null / '' / undefined all mean "no recurrence" (and are valid — clearing).
export function isValidRecurrence(value) {
  if (value === null || value === undefined || value === '') return true;
  if (typeof value !== 'string') return false;
  if (RECURRENCES.includes(value)) return true;
  const m = EVERY_RE.exec(value);
  if (!m) return false;
  const interval = Number(m[1]);
  return Number.isSafeInteger(interval) && interval > 0 && interval <= MAX_EVERY_INTERVAL;
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
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const y = date.getFullYear();
  if (y < 0 || y > 9999) return null;
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

  const every = EVERY_RE.exec(recurrence);
  const intervalDays = recurrence === 'daily' ? 1
    : recurrence === 'weekly' ? 7
      : every ? Number(every[1]) * (every[2] === 'w' ? 7 : 1) : null;
  if (intervalDays && base <= today) {
    const utc = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    const elapsedDays = Math.floor((utc(today) - utc(base)) / 86_400_000);
    base = addDays(base, (Math.floor(elapsedDays / intervalDays) + 1) * intervalDays);
  } else {
    let guard = 0;
    do {
      const next = advanceOnce(base, recurrence);
      if (!next) return null;
      base = next;
      guard += 1;
    } while (base <= today && guard < 120_000);
    if (base <= today) return null;
  }

  return isoDate(base);
}

// Plans the authoritative side effects of one task update. The repository
// executes this plan inside the same write transaction as the source update.
// Reopening an old occurrence deliberately detaches that occurrence from the
// series: the already-created future occurrence remains the series carrier.
export function planTaskRecurrenceTransition(prior, patch, { now = new Date() } = {}) {
  const fields = { ...(patch || {}) };
  const proposed = { ...(prior || {}), ...fields };
  let reopenedAsOneOff = false;

  // Reopening detaches the occurrence from the series ONLY when the caller
  // did not speak to recurrence in the same PATCH: an explicit value in the
  // patch is the caller's intent and must never be silently overwritten.
  const callerSetRecurrence = Object.prototype.hasOwnProperty.call(patch || {}, 'recurrence');
  if (prior?.status === 'completed' && proposed.status !== 'completed'
    && prior.recurrence && !callerSetRecurrence) {
    fields.recurrence = null;
    proposed.recurrence = null;
    reopenedAsOneOff = true;
  }

  let nextTask = null;
  if (prior?.status !== 'completed' && proposed.status === 'completed' && proposed.recurrence) {
    const dueDate = nextDueDate(proposed.recurrence, proposed.dueDate, now);
    if (dueDate) {
      nextTask = {
        title: proposed.title,
        description: proposed.description || '',
        notes: proposed.notes || '',
        priority: proposed.priority,
        status: 'planned',
        projectId: proposed.projectId,
        dueDate,
        dueTime: proposed.dueTime || null,
        recurrence: proposed.recurrence,
        labels: Array.isArray(proposed.labels) ? [...proposed.labels] : [],
        sortOrder: 0,
      };
    }
  }

  return { fields, nextTask, reopenedAsOneOff };
}
