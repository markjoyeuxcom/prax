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

// A monthly series' anchor day (tasks.recurrence_anchor_day, migration 0037):
// the day-of-month the series was set up on, kept so a Jan 31 series that is
// clamped to Feb 28 goes back to the 31st in March. null means "not stored":
// monthly tasks created before 0037, and every non-monthly task.
export function isValidRecurrenceAnchorDay(value) {
  return value === null || value === undefined
    || (Number.isInteger(value) && value >= 1 && value <= 31);
}

function anchorDayOf(value) {
  return Number.isInteger(value) && value >= 1 && value <= 31 ? value : null;
}

function dayOfMonth(iso) {
  return ISO_DATE.test(iso || '') ? Number(iso.slice(8, 10)) : null;
}

// The anchor a task should be stored with when it is created (or imported)
// with these fields: an explicit anchor wins, otherwise a monthly task takes
// its due date's day. Anything but a monthly task stores none.
export function recurrenceAnchorDayFor({ recurrence, dueDate, recurrenceAnchorDay } = {}) {
  if (recurrence !== 'monthly') return null;
  if (recurrenceAnchorDay !== undefined) return anchorDayOf(recurrenceAnchorDay);
  return dayOfMonth(dueDate);
}

function addDays(date, n) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + n);
  return d;
}

// The anchor day n months after `base`'s month, clamped to the target month's
// last day so "monthly" on the 31st lands on Feb 28/29 rather than skipping
// into March. The day comes from the series anchor, never from a previous
// clamped step: stepping Feb 28 → Mar 28 would lose the 31st for good.
function addMonths(base, n, anchorDay = base.getDate()) {
  const target = new Date(base.getFullYear(), base.getMonth() + n, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(anchorDay, lastDay));
  return target;
}

// The person's calendar day as a local-midnight Date: a 'YYYY-MM-DD' string
// is taken as given, a Date is read through its local getters.
function calendarDay(today) {
  if (typeof today === 'string' && ISO_DATE.test(today)) return localDate(today);
  const clock = today instanceof Date ? today : new Date();
  return new Date(clock.getFullYear(), clock.getMonth(), clock.getDate());
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
// A monthly step lands on `anchorDay` (the series' stored anchor) clamped to
// the target month; without one it uses the due date's own day, which is all a
// series created before migration 0037 has.
export function nextDueDate(recurrence, dueDate, today = new Date(), { anchorDay = null } = {}) {
  if (!recurrence || !isValidRecurrence(recurrence)) return null;
  const todayDate = calendarDay(today);
  const base = ISO_DATE.test(dueDate || '') ? localDate(dueDate) : new Date(todayDate);

  if (recurrence === 'monthly') {
    const day = anchorDayOf(anchorDay) ?? base.getDate();
    const monthsBehind = (todayDate.getFullYear() - base.getFullYear()) * 12 + todayDate.getMonth() - base.getMonth();
    let n = Math.max(1, monthsBehind);
    let next = addMonths(base, n, day);
    while (next <= todayDate) next = addMonths(base, ++n, day);
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

  // The monthly anchor follows the person's own scheduling: setting a monthly
  // recurrence or moving a monthly task's due date re-anchors it on that day.
  // Re-sending an unchanged due date (a full-form save) keeps the anchor, and
  // leaving monthly clears it. Existing monthly tasks without an anchor stay
  // unanchored until one of those edits, or until their next completion.
  const priorAnchor = anchorDayOf(prior?.recurrenceAnchorDay);
  let anchor = priorAnchor;
  if (proposed.recurrence !== 'monthly') {
    anchor = null;
  } else if (prior?.recurrence !== 'monthly' || (prior?.dueDate || null) !== (proposed.dueDate || null)) {
    anchor = dayOfMonth(proposed.dueDate);
  }
  if (anchor !== priorAnchor) fields.recurrenceAnchorDay = anchor;
  proposed.recurrenceAnchorDay = anchor;

  let nextTask = null;
  if (prior?.status !== 'completed' && proposed.status === 'completed' && proposed.recurrence) {
    const day = today || now;
    const dueDate = nextDueDate(proposed.recurrence, proposed.dueDate, day, { anchorDay: anchor });
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
        // An unanchored (pre-0037) monthly series takes its anchor from the
        // occurrence being completed: its due date's day, or today's when it
        // had none. A clamped day is never widened back to a guessed 31st.
        recurrenceAnchorDay: proposed.recurrence === 'monthly'
          ? anchor ?? dayOfMonth(proposed.dueDate) ?? calendarDay(day).getDate()
          : null,
        labels: Array.isArray(proposed.labels) ? [...proposed.labels] : [],
        sortOrder: 0,
      };
    }
  }

  return { fields, nextTask, reopenedAsOneOff };
}
