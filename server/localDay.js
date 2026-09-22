// The person's calendar "today". Prax is local-first, but a container or
// Kubernetes install runs on a UTC clock (Compose and the manifests set no TZ),
// and at 20:00 in Los Angeles that clock already says tomorrow. So requests
// whose outcome depends on today (completing a recurring task, the assistant)
// carry the browser's own view in two headers: its local date and its IANA
// zone. The date wins; a zone alone is resolved against this clock; the server
// clock is only the fallback for callers that send neither (CLI, MCP, tests).

export const LOCAL_DATE_HEADER = 'x-prax-local-date';
export const TIME_ZONE_HEADER = 'x-prax-time-zone';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function pad(n) {
  return String(n).padStart(2, '0');
}

// Server-local calendar date from local getters (never toISOString, which is UTC).
export function localToday(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// A real calendar date (rejects 2026-02-30 and the like).
export function isIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

// The calendar date at `now` in an IANA zone, or null for an unknown zone.
export function dateInTimeZone(now, timeZone) {
  if (typeof timeZone !== 'string' || !timeZone || timeZone.length > 64) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(now);
    const get = (type) => parts.find((part) => part.type === type)?.value;
    const iso = `${get('year')}-${get('month')}-${get('day')}`;
    return isIsoDate(iso) ? iso : null;
  } catch {
    return null;
  }
}

export function resolveToday({ date, timeZone } = {}, now = new Date()) {
  if (isIsoDate(date)) return date;
  return dateInTimeZone(now, timeZone) || localToday(now);
}

export function requestToday(request, now = new Date()) {
  const headers = request?.headers || {};
  return resolveToday({ date: headers[LOCAL_DATE_HEADER], timeZone: headers[TIME_ZONE_HEADER] }, now);
}

// Weekday name of a YYYY-MM-DD calendar date, independent of the host zone.
export function weekdayOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}
