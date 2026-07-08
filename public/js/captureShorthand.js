import { isoDate, addDays, nextWeekday } from './dateHelpers.js';

// Parse lightweight shorthand out of a quick-capture title.
//
//   priority — a `!` sigil: !high / !hi / !p1, !medium / !med / !p2, !low / !lo / !p3
//   due date — a curated keyword (today, tomorrow, a weekday, next week) or an
//              explicit YYYY-MM-DD, matched only as a whole standalone token
//   labels   — @label (repeatable), lowercased + deduped
//   project  — #project (last one wins)
//
// Returns { title, priority?, dueDate?, project?, labels? }: fields appear only
// when a token matched, and the matched tokens are stripped from the returned
// title. The leading `(^|\s)` boundary keeps emails (foo@bar) and c# from
// matching; the `(?=\s|$)` guard on date words leaves possessives and mid-word
// hits (e.g. "Monday's", "highway") alone.

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

  // @labels (repeatable) and #project — whole tokens with a leading boundary.
  const labels = [];
  title = title.replace(/(^|\s)@([a-z0-9][a-z0-9-]*)(?=\s|$)/gi, (m, pre, name) => {
    labels.push(name.toLowerCase());
    return pre;
  });
  if (labels.length) result.labels = Array.from(new Set(labels));

  let project;
  title = title.replace(/(^|\s)#([a-z0-9][a-z0-9-]*)(?=\s|$)/gi, (m, pre, name) => {
    project = name.toLowerCase(); // last one wins
    return pre;
  });
  if (project) result.project = project;

  result.title = title.replace(/\s+/g, ' ').trim();
  return result;
}
