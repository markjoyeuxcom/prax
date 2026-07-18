// Pure iCalendar (RFC 5545) serialization for the task calendar feed — no db,
// no Fastify, so the format is unit-testable byte-for-byte. The route hands in
// already-listed tasks; this module only shapes them.
//
// Format decisions (the contract for consumers):
// - One VEVENT per task instance. Recurring tasks deliberately get NO RRULE:
//   Prax recurrence spawns the next instance server-side on completion, so an
//   RRULE would double-count every future occurrence the app will create as a
//   real task anyway.
// - A task without dueTime is an all-day event (VALUE=DATE, exclusive DTEND of
//   the next day, per spec). A task with dueTime uses a FLOATING local
//   date-time (no TZID, no Z): Prax stores wall-clock times, and floating is
//   exactly "9:00 wherever the reader is" — matching the app's semantics.
// - UID is `<taskId>@prax` — stable across refreshes, so a resubscribed feed
//   updates events in place instead of duplicating them.
// - DTSTAMP comes from the task's updatedAt (fallback createdAt, then the
//   caller's `now`), keeping output deterministic for tests and letting
//   consumers detect which events changed.

const PRIORITY_MAP = { high: 1, medium: 5, low: 9 }; // RFC 5545 §3.8.1.9

// TEXT value escaping per §3.3.11: backslash first, then structural chars;
// real newlines become the literal two-character sequence "\n".
export function escapeIcsText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

// Content lines are folded at 75 octets (not chars — a multibyte character
// must never be split), continuation lines start with a single space.
export function foldIcsLine(line) {
  const out = [];
  let current = '';
  let currentBytes = 0;
  // First line gets 75 octets; continuations get 74 (the leading space counts).
  let budget = 75;
  for (const ch of line) {
    const chBytes = Buffer.byteLength(ch, 'utf8');
    if (currentBytes + chBytes > budget) {
      out.push(current);
      current = ' ';
      currentBytes = 1;
      budget = 75;
    }
    current += ch;
    currentBytes += chBytes;
  }
  out.push(current);
  return out.join('\r\n');
}

function toIcsUtcStamp(isoString) {
  // '2026-07-10T18:57:05.251Z' -> '20260710T185705Z'
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.toISOString().slice(0, 19).replace(/[-:]/g, '')}Z`;
}

function nextDay(dateOnly) {
  // Date-only arithmetic in UTC is exact (no DST in a Z clock).
  const ms = Date.parse(`${dateOnly}T00:00:00Z`) + 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

function compactDate(dateOnly) {
  return dateOnly.replace(/-/g, '');
}

export function taskToVEvent(task, { projectName, now } = {}) {
  if (!task || !task.dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(task.dueDate)) return null;
  const lines = ['BEGIN:VEVENT', `UID:${task.id}@prax`];

  const stamp = toIcsUtcStamp(task.updatedAt || task.createdAt || now || '');
  lines.push(`DTSTAMP:${stamp || '19700101T000000Z'}`);

  if (task.dueTime && /^\d{2}:\d{2}$/.test(task.dueTime)) {
    lines.push(`DTSTART:${compactDate(task.dueDate)}T${task.dueTime.replace(':', '')}00`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${compactDate(task.dueDate)}`);
    // RFC 5545 dates are exactly 8 digits, and a dueDate of 9999-12-31 rolls
    // into year 10000 (JS emits the expanded "+010000-…" ISO form, which is
    // grammar-invalid ICS). Omitting DTEND is spec-correct there: an all-day
    // DTSTART with no DTEND defaults to a one-day event (§3.6.1).
    const end = nextDay(task.dueDate);
    if (/^\d{4}-\d{2}-\d{2}$/.test(end)) lines.push(`DTEND;VALUE=DATE:${compactDate(end)}`);
  }

  lines.push(`SUMMARY:${escapeIcsText(task.title)}`);
  if (task.description) lines.push(`DESCRIPTION:${escapeIcsText(task.description)}`);
  if (projectName) lines.push(`CATEGORIES:${escapeIcsText(projectName)}`);
  if (PRIORITY_MAP[task.priority]) lines.push(`PRIORITY:${PRIORITY_MAP[task.priority]}`);
  lines.push(`STATUS:${task.status === 'completed' ? 'CANCELLED' : 'CONFIRMED'}`);
  lines.push('END:VEVENT');
  return lines;
}

// tasks: normalized task records (normalizeTaskRow shape). Tasks without a due
// date are skipped here regardless of caller filtering — an event needs a date.
export function tasksToIcs(tasks, { calendarName = 'Prax', projectNamesById, now } = {}) {
  const names = projectNamesById || new Map();
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Prax//Task Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
  ];
  for (const task of Array.isArray(tasks) ? tasks : []) {
    const event = taskToVEvent(task, { projectName: names.get(task.projectId), now });
    if (event) lines.push(...event);
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}

// The single "belongs on a calendar" rule, shared by the ICS feed and the
// Google Calendar push: open dated tasks only — completed is done, 'notes'
// is the design-vocab backlog, and a snoozed task is hidden everywhere in
// the app until it wakes.
export function isCalendarEligible(task, now = new Date()) {
  return Boolean(task && task.dueDate)
    && task.status !== 'completed'
    && task.status !== 'notes'
    && !(task.deferredUntil && new Date(task.deferredUntil) > now);
}
