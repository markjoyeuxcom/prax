// Shared local-calendar date helpers so keyword→ISO date logic lives in one
// place (quick-capture shorthand, the task filter grammar, Today's week ahead).
// All operate on LOCAL dates with no timezone conversion — matching how the
// Today view and dueFlags bucket dates.

export function isoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// `now` shifted by n calendar days, normalized to local midnight.
export function addDays(now, n) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() + n);
  return d;
}

// The next occurrence of weekday `target` (0=Sun) strictly after today; if today
// already is that weekday, jump a full week rather than resolving to today.
export function nextWeekday(now, target) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getDay();
  const delta = ((target - today + 7) % 7) || 7;
  return addDays(now, delta);
}

// Stored timestamps are UTC instants ('…T13:05:00.000Z'); slicing the string
// prints UTC as if it were local, so a run started at 15:05 in Paris read
// 13:05. Read them through local getters instead. A date-only 'YYYY-MM-DD' is
// already a calendar date and passes through unchanged; anything unparseable
// renders as ''.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function instantOf(value) {
  if (value === null || value === undefined || value === '' || DATE_ONLY.test(String(value))) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function localDateOf(value) {
  if (DATE_ONLY.test(String(value ?? ''))) return String(value);
  const date = instantOf(value);
  return date ? isoDate(date) : '';
}

export function localTimeOf(value) {
  const date = instantOf(value);
  return date ? `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` : '';
}

// 'YYYY-MM-DD HH:MM' in local time; a date-only value stays date-only.
export function localDateTimeOf(value) {
  const date = instantOf(value);
  return date ? `${isoDate(date)} ${localTimeOf(date)}` : localDateOf(value);
}

// Sent with requests whose outcome depends on "today" (completing a recurring
// task, the assistant): the server may run on a UTC clock, so it takes the
// viewer's own calendar date and IANA zone (server/localDay.js).
export function localDayHeaders(now = new Date()) {
  let timeZone = '';
  try { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* no Intl zone */ }
  return { 'x-prax-local-date': isoDate(now), ...(timeZone ? { 'x-prax-time-zone': timeZone } : {}) };
}
