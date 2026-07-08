// Parse lightweight shorthand out of a quick-capture title.
//
//   priority — a `!` sigil: !high / !hi / !p1, !medium / !med / !p2, !low / !lo / !p3
//   due date — a curated keyword (today, tomorrow, a weekday, next week) or an
//              explicit YYYY-MM-DD, matched only as a whole standalone token
//
// Returns { title, priority?, dueDate? }: priority/dueDate appear only when a
// token matched, and the matched tokens are stripped from the returned title.
// The `!` sigil keeps priority unambiguous; the `(?=\s|$)` guard on date words
// means possessives and mid-word hits (e.g. "Monday's", "highway") are left alone.

const PRIORITY = [
  [/(^|\s)!(?:high|hi|p1)(?=\s|$)/i, 'high'],
  [/(^|\s)!(?:medium|med|p2)(?=\s|$)/i, 'medium'],
  [/(^|\s)!(?:low|lo|p3)(?=\s|$)/i, 'low'],
];

const DOW = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tuesday: 2, wed: 3, wednesday: 3,
  thu: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
};

const DATE_KEYWORDS = /(^|\s)(today|tod|tomorrow|tmr|tom|next\s?week|nextweek|sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat)(?=\s|$)/i;

function isoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(now, n) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() + n);
  return d;
}

// The next occurrence of weekday `target` (0=Sun) strictly after today; if today
// already is that weekday, jump a full week rather than resolving to today.
function nextWeekday(now, target) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getDay();
  const delta = ((target - today + 7) % 7) || 7;
  return addDays(now, delta);
}

export function parseCaptureShorthand(raw, now = new Date()) {
  let title = String(raw || '');
  const result = {};

  for (const [re, value] of PRIORITY) {
    if (re.test(title)) { result.priority = value; title = title.replace(re, ' '); break; }
  }

  const isoMatch = title.match(/(^|\s)(\d{4}-\d{2}-\d{2})(?=\s|$)/);
  if (isoMatch) {
    result.dueDate = isoMatch[2];
    title = title.replace(isoMatch[0], ' ');
  } else {
    const kw = title.match(DATE_KEYWORDS);
    if (kw) {
      const word = kw[2].toLowerCase().replace(/\s+/g, '');
      let date = null;
      if (word === 'today' || word === 'tod') date = addDays(now, 0);
      else if (word === 'tomorrow' || word === 'tmr' || word === 'tom') date = addDays(now, 1);
      else if (word === 'nextweek') date = addDays(now, 7);
      else if (word in DOW) date = nextWeekday(now, DOW[word]);
      if (date) { result.dueDate = isoDate(date); title = title.replace(kw[0], ' '); }
    }
  }

  result.title = title.replace(/\s+/g, ' ').trim();
  return result;
}
