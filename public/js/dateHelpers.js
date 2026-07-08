// Shared local-calendar date helpers so keyword→ISO date logic lives in one
// place (quick-capture shorthand, the task filter grammar, the Upcoming view).
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
