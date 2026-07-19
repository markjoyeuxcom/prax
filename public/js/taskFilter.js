// The shared task-filter grammar — ONE pure predicate compiler evaluated on
// BOTH sides: the client smart views (over the already-loaded state.tasks) and
// the search_tasks MCP tool (over fetched tasks). Because it is one function,
// human and agent filters are identical by construction and the grammar never
// becomes a wire contract (no migrations, no frozen-list churn).
//
// It must stay DOM-free: depends only on Date, dueFlags.js, dateHelpers.js, and
// labels.js — all pure — so mcp/ can import it across the tree.
//
// Grammar (highest → lowest precedence):
//   ( )                 grouping
//   -term  !term        negation (only as a leading sigil on a term)
//   a b   a & b         AND (juxtaposition or explicit &)
//   a | b               OR
// Atoms:
//   @label              task carries the (normalized) label
//   #project            task's project resolves to that slug/slugified-name
//   p1|p2|p3            priority high|medium|low
//   priority:high|…     priority
//   status:<api>        exact API status (planned/in-progress/completed/…)
//   done | open         completed / not-completed
//   overdue             due date is before today
//   due:today|tomorrow|soon|week|none|YYYY-MM-DD
//   is:snoozed|is:recurring
//   stale:<days>        open, not snoozed, untouched (updatedAt) for >= days
//   deferrals:<n>       consciously pushed (deferral_count) at least n times
//   <bareword>          case-insensitive title substring (preserves `q` search)
//
// parseTaskFilter(expr, { partial }) -> { ok, predicate, error }; it NEVER
// throws. predicate(task, ctx) takes an API-shaped task and
// ctx = { now, resolveProjectId(slugOrName) -> id|null }.

import { dueBucket } from './dueFlags.js';
import { isoDate, addDays } from './dateHelpers.js';
import { normalizeLabel } from './labels.js';

const PRIORITY_BY_PN = { p1: 'high', p2: 'medium', p3: 'low' };
const PRIORITIES = new Set(['high', 'medium', 'low']);

// ---- tokenizer --------------------------------------------------------------
// A token is one of: '(' ')' '&' '|' 'not' or a term string. A '-'/'!' is a NOT
// operator only at a term-start position and immediately before a term char;
// inside a term (cert-rotation, 2026-07-15) it is literal.
const OPERATOR_CHARS = new Set(['(', ')', '&', '|']);

function isTermChar(ch) {
  return ch !== undefined && !/\s/.test(ch) && !OPERATOR_CHARS.has(ch);
}

function tokenize(expr) {
  const s = String(expr ?? '');
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) { i += 1; continue; }
    if (ch === '(') { tokens.push({ type: 'lparen' }); i += 1; continue; }
    if (ch === ')') { tokens.push({ type: 'rparen' }); i += 1; continue; }
    if (ch === '&') { tokens.push({ type: 'and' }); i += 1; continue; }
    if (ch === '|') { tokens.push({ type: 'or' }); i += 1; continue; }
    if ((ch === '-' || ch === '!') && isTermChar(s[i + 1]) && s[i + 1] !== '-' && s[i + 1] !== '!') {
      tokens.push({ type: 'not' }); i += 1; continue;
    }
    let term = '';
    while (i < s.length && isTermChar(s[i])) { term += s[i]; i += 1; }
    tokens.push({ type: 'term', value: term });
  }
  return tokens;
}

// ---- atom compilation -------------------------------------------------------
function matchDue(task, ctx, arg) {
  const bucket = dueBucket(task.dueDate, { now: ctx.now });
  if (arg === 'today') return bucket === 'today';
  if (arg === 'tomorrow') return task.dueDate === isoDate(addDays(ctx.now, 1));
  if (arg === 'soon') return bucket === 'today' || bucket === 'soon';
  if (arg === 'none') return bucket === 'none';
  if (arg === 'week') {
    return Boolean(task.dueDate) && task.dueDate >= isoDate(ctx.now) && task.dueDate <= isoDate(addDays(ctx.now, 7));
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(arg)) return task.dueDate === arg;
  return false; // unknown due:arg matches nothing (never throws)
}

// A term string -> predicate(task, ctx). Unknown/odd atoms compile to a
// match-nothing (or title-substring) predicate rather than erroring.
function compileTerm(raw) {
  const value = raw;
  const lower = value.toLowerCase();

  if (value[0] === '@') {
    const label = normalizeLabel(value);
    return (task) => Array.isArray(task.labels) && task.labels.includes(label);
  }
  if (value[0] === '#') {
    const slug = value.slice(1).toLowerCase();
    return (task, ctx) => {
      const id = ctx.resolveProjectId ? ctx.resolveProjectId(slug) : null;
      return id != null && task.projectId === id;
    };
  }
  if (PRIORITY_BY_PN[lower]) {
    const prio = PRIORITY_BY_PN[lower];
    return (task) => task.priority === prio;
  }
  if (lower.startsWith('priority:')) {
    const prio = lower.slice('priority:'.length);
    return PRIORITIES.has(prio) ? (task) => task.priority === prio : () => false;
  }
  if (lower.startsWith('status:')) {
    const st = lower.slice('status:'.length);
    return (task) => task.status === st;
  }
  if (lower === 'done') return (task) => task.status === 'completed';
  if (lower === 'open') return (task) => task.status !== 'completed';
  if (lower === 'overdue') return (task, ctx) => dueBucket(task.dueDate, { now: ctx.now }) === 'overdue';
  if (lower.startsWith('due:')) {
    const arg = lower.slice('due:'.length);
    return (task, ctx) => matchDue(task, ctx, arg);
  }
  if (lower === 'is:snoozed') return (task, ctx) => Boolean(task.deferredUntil) && new Date(task.deferredUntil) > ctx.now;
  if (lower === 'is:recurring') return (task) => task.recurrence != null;
  if (lower.startsWith('stale:')) {
    const days = Number(lower.slice('stale:'.length));
    if (!Number.isInteger(days) || days < 1) return () => false;
    return (task, ctx) => {
      if (task.status === 'completed') return false;
      if (task.deferredUntil && new Date(task.deferredUntil) > ctx.now) return false;
      if (!task.updatedAt) return false;
      const touched = new Date(task.updatedAt);
      return !Number.isNaN(touched.getTime()) && (ctx.now - touched) >= days * 86_400_000;
    };
  }
  if (lower.startsWith('deferrals:')) {
    const min = Number(lower.slice('deferrals:'.length));
    if (!Number.isInteger(min) || min < 1) return () => false;
    return (task) => (Number(task.deferralCount) || 0) >= min;
  }

  // Bareword: case-insensitive title substring (keeps the old `q` semantics).
  return (task) => String(task.title || '').toLowerCase().includes(lower);
}

// ---- recursive-descent parser (tokens -> predicate) -------------------------
const AND = (a, b) => (t, c) => a(t, c) && b(t, c);
const OR = (a, b) => (t, c) => a(t, c) || b(t, c);
const NOT = (a) => (t, c) => !a(t, c);

function startsFactor(tok) {
  return tok && (tok.type === 'term' || tok.type === 'lparen' || tok.type === 'not');
}

// Returns { predicate } or throws a plain Error (caught by tryParse).
function parseTokens(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseOr() {
    let left = parseAnd();
    while (peek() && peek().type === 'or') {
      next();
      const right = parseAnd();
      left = OR(left, right);
    }
    return left;
  }
  function parseAnd() {
    let left = parseNot();
    while (peek() && (peek().type === 'and' || startsFactor(peek()))) {
      if (peek().type === 'and') next();
      const right = parseNot();
      left = AND(left, right);
    }
    return left;
  }
  function parseNot() {
    if (peek() && peek().type === 'not') { next(); return NOT(parseNot()); }
    return parseAtom();
  }
  function parseAtom() {
    const tok = peek();
    if (!tok) throw new Error('unexpected end of filter');
    if (tok.type === 'lparen') {
      next();
      const inner = parseOr();
      if (!peek() || peek().type !== 'rparen') throw new Error('missing )');
      next();
      return inner;
    }
    if (tok.type === 'term') { next(); return compileTerm(tok.value); }
    throw new Error(`unexpected "${tok.type === 'or' ? '|' : tok.type === 'and' ? '&' : tok.type}"`);
  }

  const predicate = parseOr();
  if (pos < tokens.length) throw new Error('trailing input in filter');
  return predicate;
}

function tryParse(tokens) {
  try {
    return { ok: true, predicate: parseTokens(tokens) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

const MATCH_ALL = () => true;

export function parseTaskFilter(expr, { partial = false } = {}) {
  const tokens = tokenize(expr);
  if (tokens.length === 0) return { ok: true, predicate: MATCH_ALL, error: null };

  const strict = tryParse(tokens);
  if (strict.ok) return { ok: true, predicate: strict.predicate, error: null };
  if (!partial) return { ok: false, predicate: null, error: strict.error };

  // Partial (live typing): filter by the longest valid prefix so the list never
  // empties mid-keystroke; still report ok:false so the UI can show the hint.
  for (let n = tokens.length - 1; n >= 1; n -= 1) {
    const attempt = tryParse(tokens.slice(0, n));
    if (attempt.ok) return { ok: false, predicate: attempt.predicate, error: strict.error };
  }
  return { ok: false, predicate: MATCH_ALL, error: strict.error };
}

// Build a resolveProjectId(slugOrName) from a projects array — matches a
// project's slug or its slugified name. Used by the client (state.projects) and
// the MCP handler (fetched projects) so #project resolves identically on both.
export function projectResolver(projects) {
  const bySlug = new Map();
  for (const p of Array.isArray(projects) ? projects : []) {
    if (p.slug) bySlug.set(String(p.slug).toLowerCase(), p.id);
    if (p.name) bySlug.set(slugify(p.name), p.id);
  }
  return (slugOrName) => bySlug.get(String(slugOrName || '').toLowerCase()) ?? null;
}

// How #project matches a project name — exported so other layers (e.g. the
// NL-parse audit) resolve names to slugs identically.
export function slugify(name) {
  return String(name || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
