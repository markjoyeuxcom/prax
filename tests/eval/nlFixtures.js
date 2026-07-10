// Pinned phrase → expected pairs for the NL capture / NL→filter prompts
// (Tier-3 #8). These are the regression contract for PROMPT changes: the unit
// suite already pins the deterministic pipeline (coercion, audit, merging), so
// every case here exercises the part only a real model can get wrong — date
// resolution, slug adherence, title cleanup, and the never-infer rules.
//
// All cases inject a FIXED "today" (Friday 2026-07-10) so expectations are
// reproducible forever, regardless of when the eval runs. The expected outputs
// were validated against a real model (Claude Haiku 4.5, 2026-07-10) right
// after the prompts were tightened — if a prompt edit breaks one, that is a
// real regression, not fixture drift.
//
// Matchers (see nlEval.js): `title` compares lowercased-exact; `titleIncludes`
// is a lowercased substring (for phrasing the model may legitimately vary);
// `labelsSubsetOf` allows any subset (topical known-label attachment is
// designed-in); every OTHER actual field must be in `expect` — an unexpected
// extra field is a FAILURE (that is the over-inference regression this set
// exists to catch).

export const EVAL_DATE = '2026-07-10'; // a Friday

export const GROUNDING = {
  projects: [
    { slug: 'inbox', name: 'Inbox' },
    { slug: 'personal', name: 'Personal' },
    { slug: 'work', name: 'Work' },
    { slug: 'homelab', name: 'Homelab' },
  ],
  labels: ['cert', 'tls-rotation'],
};

export const CAPTURE_CASES = [
  {
    name: 'fully explicit: relative date, time word, priority, project',
    text: 'remind me to rotate the certs next friday morning, high priority, homelab',
    expect: {
      title: 'rotate the certs',
      priority: 'high',
      dueDate: '2026-07-17', // "next friday" from a Friday = the following week
      dueTime: '09:00',      // morning → 09:00
      project: 'homelab',
      labelsSubsetOf: ['cert', 'tls-rotation'],
    },
  },
  {
    name: 'recurrence with a start date, NO project inference',
    text: 'water plants every week starting monday',
    expect: { title: 'water plants', dueDate: '2026-07-13', recurrence: 'weekly' },
  },
  {
    name: 'bare weekday that IS today, NO priority inference',
    text: 'pay rent friday',
    expect: { title: 'pay rent', dueDate: '2026-07-10' }, // pinned: today counts
  },
  {
    name: 'time with no date means today',
    text: 'take tablet at 12pm',
    expect: { title: 'take tablet', dueDate: '2026-07-10', dueTime: '12:00' },
  },
  {
    name: 'plain title: nothing invented',
    text: 'buy milk',
    expect: { title: 'buy milk' },
  },
  {
    name: 'unlisted project name stays in the title, tomorrow resolves',
    text: 'fix the flaky nginx ingress in the k8s project tomorrow',
    expect: { titleIncludes: 'nginx ingress', dueDate: '2026-07-11' },
  },
];

export const FILTER_CASES = [
  {
    name: 'the roadmap phrase',
    text: 'high priority in homelab due this week',
    expect: { expr: 'p1 & #homelab & due:week', valid: true, warnings: 0 },
  },
  {
    name: 'negated snooze',
    text: "open overdue stuff that isn't snoozed",
    expect: { expr: 'open & overdue & -is:snoozed', valid: true, warnings: 0 },
  },
  {
    name: 'recurring + done',
    text: "recurring tasks I've finished",
    expect: { expr: 'is:recurring & done', valid: true, warnings: 0 },
  },
  {
    name: 'idempotence: valid grammar passes through unchanged',
    text: 'p1 & overdue',
    expect: { expr: 'p1 & overdue', valid: true, warnings: 0 },
  },
  {
    name: 'unknown project surfaces as a lint warning, not a silent mismatch',
    text: 'urgent things in the kubernetes project',
    expect: { exprIncludes: '#kubernetes', valid: true, warningsInclude: 'is not a project' },
  },
];
