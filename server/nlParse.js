// Natural-language parsing for tasks (Tier-3 #8) — pure prompt builders +
// output coercion for the two NL routes: NL → capture fields and NL → a
// task-filter grammar expression. The routes do the chat IO; everything here
// is deterministic and unit-testable (mirrors writingActions.js).
//
// Trust model: the model only emits text in languages the app already
// validates — a whitelisted fields JSON (coerced below, never trusted) or a
// grammar string (validated by the same parseTaskFilter the views use). The
// client previews the result before anything is created or applied.

import { extractJsonObject } from './kbHealthReview.js';
import { RECURRENCES } from './recurrence.js';
import { parseTaskFilter, slugify } from '../public/js/taskFilter.js';
import { normalizeLabel, normalizeLabels } from '../public/js/labels.js';

const MAX_TEXT = 500;
const MAX_GROUNDING = 50;
const MAX_NAME = 60;
const MAX_LABEL = 40;
const MAX_TITLE = 300;
const MAX_FIELD_LABELS = 10;

const PRIORITIES = new Set(['high', 'medium', 'low']);
const STATUSES = new Set(['high-priority', 'in-progress', 'planned', 'completed', 'notes']);
const DUE_ARGS = new Set(['today', 'tomorrow', 'soon', 'week', 'none']);
const IS_ARGS = new Set(['snoozed', 'recurring']);
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// Format AND calendar validity — a model "2026-02-31" passes the regex but
// would 400 the eventual POST /api/tasks, failing the whole capture.
function isCalendarDate(value) {
  if (!ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

// One line of user text: the capture input is single-line, and the raw text
// must stay on the FIRST line of the user message (the fake-chat provider
// echoes exactly that line, which is what makes browser verification work).
export function cleanNlText(raw) {
  return String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
}

// Local-parts date maths — never `new Date('YYYY-MM-DD')`, which parses as UTC
// midnight and can report the wrong weekday near local midnight / in negative
// offsets. Falls back to `now` when the client sent nothing usable.
export function localDateContext(dateStr, now = new Date()) {
  let d = now;
  if (typeof dateStr === 'string' && ISO_DATE.test(dateStr)) {
    const [y, m, day] = dateStr.split('-').map(Number);
    d = new Date(y, m - 1, day);
  }
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { iso, weekday: WEEKDAYS[d.getDay()] };
}

// Bound the client-sent grounding lists (the client owns what the user sees;
// the server just caps and sanitizes so the prompt stays small even if a
// hostile payload sends thousands of entries or megabyte names).
export function boundGrounding(projects, labels) {
  const boundedProjects = (Array.isArray(projects) ? projects : [])
    .filter((p) => p && typeof p === 'object' && typeof p.slug === 'string' && p.slug.trim())
    .slice(0, MAX_GROUNDING)
    .map((p) => ({
      slug: p.slug.trim().toLowerCase().slice(0, MAX_NAME),
      name: String(p.name ?? p.slug).trim().slice(0, MAX_NAME),
    }));
  const boundedLabels = normalizeLabels(labels).slice(0, MAX_GROUNDING).map((l) => l.slice(0, MAX_LABEL));
  return { projects: boundedProjects, labels: boundedLabels };
}

function groundingBlock(projects, labels) {
  const projectLines = projects.length
    ? projects.map((p) => `${p.slug} — ${p.name}`).join('\n')
    : '(none)';
  return `PROJECTS (slug — name):\n${projectLines}\n\nKNOWN LABELS: ${labels.length ? labels.join(', ') : '(none)'}`;
}

// ---- NL capture -------------------------------------------------------------

const CAPTURE_SYSTEM_HEAD = [
  'You turn one line of natural language into structured task fields for a task manager.',
  'Output ONLY one JSON object — no prose, no code fence. Allowed keys:',
  '"title" (required, string), "priority" ("high"|"medium"|"low"), "dueDate" ("YYYY-MM-DD"),',
  '"dueTime" ("HH:MM", 24-hour), "recurrence" ("daily"|"weekly"|"monthly"), "project" (one slug from PROJECTS), "labels" (array of strings).',
  'title: a clean imperative title — strip filler ("remind me to", "I need to") and any words you turned into fields. Stay faithful; never invent.',
  'Omit every key the text does not clearly state.',
  'project: ONLY when the text names a listed project (by slug or name) — NEVER infer one from the topic; the app has its own destination default. When unsure, omit.',
  'priority: ONLY from explicit words ("urgent", "high priority", "low priority", "p1") — NEVER from how important the task sounds. When unsure, omit.',
  'dueTime only when a time of day is stated (morning→09:00, noon→12:00, afternoon→14:00, evening→18:00, night/tonight→20:00); a time with no date means today.',
  'A bare weekday name means its next occurrence, counting today ("friday" said on a Friday = today); "next <weekday>" always means the following week\'s.',
  'recurrence only for explicit repetition ("every day", "weekly"); "every friday" → recurrence "weekly" with dueDate on that weekday\'s next occurrence (counting today).',
  'labels: only labels from KNOWN LABELS, or words used as labels verbatim in the text.',
].join(' ');

export function buildNlCaptureMessages({ text, date, projects = [], labels = [], now = new Date() } = {}) {
  const { iso, weekday } = localDateContext(date, now);
  const system = `${CAPTURE_SYSTEM_HEAD}\n\nToday is ${weekday}, ${iso} (the user's local date). Resolve relative dates ("tomorrow", "next friday", "in 3 days") against it.\n\n${groundingBlock(projects, labels)}`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: cleanNlText(text) },
  ];
}

// Coerce whatever the model produced into safe capture fields. Whitelisted
// keys, clamped enums, regex-validated dates/times; unknown projects/labels
// land in `dropped` so the preview can say "ignored: …". Total: garbage → null.
export function coerceNlCaptureFields(rawModelText, { projectSlugs = [], knownLabels = [], rawText = '' } = {}) {
  const obj = extractJsonObject(rawModelText);
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;

  const dropped = [];
  const fields = {};

  const title = typeof obj.title === 'string' ? obj.title.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE) : '';
  fields.title = title || cleanNlText(rawText);

  if (typeof obj.priority === 'string' && PRIORITIES.has(obj.priority.toLowerCase())) {
    fields.priority = obj.priority.toLowerCase();
  }
  if (typeof obj.dueDate === 'string' && isCalendarDate(obj.dueDate)) {
    fields.dueDate = obj.dueDate;
  }
  if (typeof obj.dueTime === 'string' && HHMM.test(obj.dueTime) && fields.dueDate) {
    fields.dueTime = obj.dueTime; // dueTime is only meaningful alongside a date
  }
  if (typeof obj.recurrence === 'string' && RECURRENCES.includes(obj.recurrence.toLowerCase())) {
    fields.recurrence = obj.recurrence.toLowerCase();
  }

  const slugs = new Set(projectSlugs.map((s) => String(s).toLowerCase()));
  if (typeof obj.project === 'string' && obj.project.trim()) {
    const slug = obj.project.trim().toLowerCase();
    if (slugs.has(slug)) fields.project = slug;
    else dropped.push({ field: 'project', value: obj.project.trim().slice(0, MAX_NAME) });
  }

  // Verbatim-label rule: keep a model label only when it is already known or
  // appears verbatim (case-insensitively) in the raw text — hallucinated
  // taxonomy is dropped, visibly.
  const known = new Set(knownLabels.map((l) => normalizeLabel(l)));
  const lowerRaw = String(rawText).toLowerCase();
  if (Array.isArray(obj.labels)) {
    const kept = [];
    for (const raw of obj.labels.slice(0, MAX_FIELD_LABELS)) {
      const label = normalizeLabel(raw).slice(0, MAX_LABEL);
      if (!label) continue;
      if (known.has(label) || lowerRaw.includes(label)) {
        if (!kept.includes(label)) kept.push(label);
      } else {
        dropped.push({ field: 'label', value: label });
      }
    }
    if (kept.length) fields.labels = kept;
  }

  return { fields, dropped };
}

// ---- NL → filter ------------------------------------------------------------

// The grammar, spelled for the model the way it is spelled for agents (the
// search_tasks MCP tool description) — keep the three grammar docs in sync:
// taskFilter.js header, mcp/tools/tasks.js description, and this cheatsheet.
export const FILTER_CHEATSHEET = [
  'Atoms: @label · #project (slug) · p1/p2/p3 (priority high/medium/low) · priority:high|medium|low ·',
  'status:high-priority|in-progress|planned|completed|notes · done · open · overdue ·',
  'due:today|tomorrow|soon|week|none|YYYY-MM-DD · is:snoozed · is:recurring · a bareword matches the title as a substring.',
  'Operators: juxtaposition or & = AND, | = OR, a leading - or ! on a term = NOT, ( ) group.',
].join(' ');

const FILTER_FEWSHOTS = [
  ['high priority in homelab due this week', '{"expr":"p1 & #homelab & due:week"}'],
  ['open overdue tasks that are not snoozed', '{"expr":"open & overdue & -is:snoozed"}'],
  ['things labelled waiting or blocked', '{"expr":"@waiting | @blocked"}'],
  ['recurring tasks I already finished', '{"expr":"is:recurring & done"}'],
];

export function buildNlFilterMessages({ text, date, projects = [], labels = [], now = new Date() } = {}) {
  const { iso, weekday } = localDateContext(date, now);
  const system = [
    'You translate one line of natural language into a task-filter expression for a task manager.',
    `The grammar: ${FILTER_CHEATSHEET}`,
    `Today is ${weekday}, ${iso} (the user's local date). Map relative phrases to due: atoms ("this week"→due:week, "today"→due:today, "no due date"→due:none, a specific day→due:YYYY-MM-DD).`,
    'Use #project slugs and @labels from the lists below. When the text clearly names something AS a project ("in the X project") that is not listed, still emit #x (slugified) — the app warns about unknown projects, which beats a silent title-text mismatch. A plain word that is not a listed tag is title text (bareword).',
    'If the input is already a valid filter expression, return it unchanged.',
    'Output ONLY {"expr":"..."} — no prose, no code fence.',
    '',
    groundingBlock(projects, labels),
    '',
    'Examples:',
    ...FILTER_FEWSHOTS.map(([q, a]) => `"${q}" → ${a}`),
  ].join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: cleanNlText(text) },
  ];
}

// Pull the expression out of whatever the model produced. Total: null on junk.
export function coerceNlFilterExpr(rawModelText) {
  const obj = extractJsonObject(rawModelText);
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const expr = typeof obj.expr === 'string' ? obj.expr.replace(/\s+/g, ' ').trim() : '';
  return expr || null;
}

// Term scanner mirroring the grammar tokenizer's boundaries: terms are maximal
// runs of non-space, non-operator chars; leading -/! sigils are negation.
function exprTerms(expr) {
  const terms = [];
  let cur = '';
  for (const ch of String(expr)) {
    if (/\s/.test(ch) || ch === '(' || ch === ')' || ch === '&' || ch === '|') {
      if (cur) { terms.push(cur); cur = ''; }
    } else {
      cur += ch;
    }
  }
  if (cur) terms.push(cur);
  return terms.map((t) => t.replace(/^[-!]+/, '')).filter(Boolean);
}

// Semantic lint for a (model-emitted or hand-edited) expression. parseTaskFilter
// accepts many atoms that silently match nothing (due:next-week, status:doing,
// #typo) — surface those as warnings instead of a mute "0 matches".
export function auditFilterExpr(expr, { projects = [], labels = [] } = {}) {
  const { ok, error } = parseTaskFilter(expr);
  const warnings = [];
  const known = new Set(labels.map((l) => normalizeLabel(l)));
  // Grounding entries are {slug, name} (no id), so membership is by slug or
  // slugified name — the same names #project accepts (projectResolver's keys),
  // checked directly rather than through its slug→id map.
  const knownSlugs = new Set();
  const projectWords = new Map(); // lowercase slug/name -> slug (bareword detection)
  for (const p of projects) {
    if (p?.slug) {
      const slug = String(p.slug).toLowerCase();
      knownSlugs.add(slug);
      projectWords.set(slug, slug);
    }
    if (p?.name) {
      const nameSlug = slugify(p.name);
      if (nameSlug) knownSlugs.add(nameSlug);
      projectWords.set(String(p.name).toLowerCase(), String(p.slug || nameSlug).toLowerCase());
    }
  }

  for (const term of exprTerms(expr)) {
    const lower = term.toLowerCase();
    if (term.startsWith('@')) {
      // Warn even with an empty grounding list — zero known labels means every
      // @label atom is guaranteed to match nothing (same rule as #project).
      const label = normalizeLabel(term);
      if (label && !known.has(label)) warnings.push(`@${label} is not a known label`);
    } else if (term.startsWith('#')) {
      const slug = term.slice(1).toLowerCase();
      if (slug && !knownSlugs.has(slug)) warnings.push(`#${slug} is not a project`);
    } else if (lower.startsWith('priority:')) {
      const arg = lower.slice('priority:'.length);
      if (!PRIORITIES.has(arg)) warnings.push(`priority:${arg} matches nothing — use high, medium, or low`);
    } else if (lower.startsWith('status:')) {
      const arg = lower.slice('status:'.length);
      if (!STATUSES.has(arg)) warnings.push(`status:${arg} matches nothing — statuses are ${[...STATUSES].join(', ')}`);
    } else if (lower.startsWith('due:')) {
      const arg = lower.slice('due:'.length);
      if (!DUE_ARGS.has(arg) && !ISO_DATE.test(arg)) warnings.push(`due:${arg} matches nothing — use today, tomorrow, soon, week, none, or YYYY-MM-DD`);
    } else if (lower.startsWith('is:')) {
      const arg = lower.slice('is:'.length);
      if (!IS_ARGS.has(arg)) warnings.push(`is:${arg} is not a filter — only is:snoozed and is:recurring`);
    } else if (!['p1', 'p2', 'p3', 'done', 'open', 'overdue'].includes(lower)) {
      // Bareword: legal (title substring) — but if it names a project or label,
      // the model probably meant the sigiled atom.
      const slug = projectWords.get(lower);
      if (slug) warnings.push(`"${term}" searches titles — did you mean #${slug}?`);
      else if (known.has(normalizeLabel(term))) warnings.push(`"${term}" searches titles — did you mean @${normalizeLabel(term)}?`);
    }
  }

  return { ok, parseError: ok ? null : error, warnings };
}
