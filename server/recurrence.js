// Task recurrence — a small, additive scheduling model. A task carries a
// nullable `recurrence` token; when it is completed, the PATCH route spawns the
// next instance with an advanced due date. Kept deliberately simple: three
// presets plus an `every:Nd` / `every:Nw` escape hatch for agents/power users.

export const RECURRENCES = ['daily', 'weekly', 'monthly'];

const EVERY_RE = /^every:(\d+)([dw])$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
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

// The anchor's day-of-month n months on, clamped to the target month's last
// day so "monthly" on the 31st lands on Feb 28/29 rather than skipping into
// March. Always counted from the anchor, never from a previous clamped step:
// stepping Feb 28 → Mar 28 would lose the 31st for good.
function addMonths(anchor, n) {
  const target = new Date(anchor.getFullYear(), anchor.getMonth() + n, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(anchor.getDate(), lastDay));
  return target;
}

function localDate(iso) {
  return new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
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
// `today` is the person's calendar date ('YYYY-MM-DD', see server/localDay.js)
// or a Date read through local getters: a UTC server's clock is not their day.
// A monthly series is anchored on the due date's day-of-month. That due date is
// the only anchor stored, so a series already on a clamped day (Feb 28 from a
// Jan 31 start) continues from that day; carrying the 31st past one completion
// would need the anchor stored with the series.
export function nextDueDate(recurrence, dueDate, today = new Date()) {
  if (!recurrence || !isValidRecurrence(recurrence)) return null;
  const clock = today instanceof Date ? today : new Date();
  const todayDate = typeof today === 'string' && ISO_DATE.test(today)
    ? localDate(today)
    : new Date(clock.getFullYear(), clock.getMonth(), clock.getDate());
  const base = ISO_DATE.test(dueDate || '') ? localDate(dueDate) : new Date(todayDate);

  if (recurrence === 'monthly') {
    const monthsBehind = (todayDate.getFullYear() - base.getFullYear()) * 12 + todayDate.getMonth() - base.getMonth();
    let n = Math.max(1, monthsBehind);
    let next = addMonths(base, n);
    while (next <= todayDate) next = addMonths(base, ++n);
    return isoDate(next);
  }

  const every = EVERY_RE.exec(recurrence);
  const intervalDays = recurrence === 'daily' ? 1
    : recurrence === 'weekly' ? 7
      : Number(every[1]) * (every[2] === 'w' ? 7 : 1);
  if (base > todayDate) return isoDate(addDays(base, intervalDays));
  const utc = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const elapsedDays = Math.floor((utc(todayDate) - utc(base)) / 86_400_000);
  return isoDate(addDays(base, (Math.floor(elapsedDays / intervalDays) + 1) * intervalDays));
}

// Plans the authoritative side effects of one task update. The repository
// executes this plan inside the same write transaction as the source update.
// Reopening an old occurrence deliberately detaches that occurrence from the
// series: the already-created future occurrence remains the series carrier.
// `today` is the requester's calendar date (server/localDay.js requestToday);
// without it the server clock's local date is used.
export function planTaskRecurrenceTransition(prior, patch, { now = new Date(), today = null } = {}) {
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
    const dueDate = nextDueDate(proposed.recurrence, proposed.dueDate, today || now);
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
