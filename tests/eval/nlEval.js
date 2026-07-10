// NL prompt eval runner (Tier-3 #8). Feeds the pinned fixture phrases through
// the REAL prompt builders + coercion pipeline against a caller-supplied chat,
// and scores the results with pure comparators (unit-tested in
// tests/backend/nlEval.test.js). The chat is injected so the CI suite can
// exercise the runner with a scripted model while `npm run eval:nl` uses a
// real env-configured backend.

import {
  buildNlCaptureMessages, coerceNlCaptureFields,
  buildNlFilterMessages, coerceNlFilterExpr, auditFilterExpr,
} from '../../server/nlParse.js';

const CAPTURE_FIELDS = ['title', 'priority', 'dueDate', 'dueTime', 'recurrence', 'project', 'labels'];

// A typo'd expectation key ("duedate", "warningsIncludes") would otherwise be
// silently ignored and the fixture would pass vacuously — throw at authoring
// time instead.
const CAPTURE_EXPECT_KEYS = new Set(['title', 'titleIncludes', 'priority', 'dueDate', 'dueTime', 'recurrence', 'project', 'labelsSubsetOf']);
const FILTER_EXPECT_KEYS = new Set(['expr', 'exprIncludes', 'valid', 'warnings', 'warningsInclude']);

function assertKnownKeys(expect, known, kind) {
  for (const key of Object.keys(expect)) {
    if (!known.has(key)) throw new Error(`unknown ${kind} expectation key "${key}" — typo in the fixture?`);
  }
}

// Compare coerced capture fields against a fixture expectation. Returns a list
// of problem strings — empty means pass. Rules: `title` lowercased-exact,
// `titleIncludes` lowercased substring, `labelsSubsetOf` allows any subset
// (including none); every other actual field must be expected EXACTLY, and any
// actual field with no expectation is an over-inference failure.
export function compareCaptureFields(actual, expect) {
  assertKnownKeys(expect, CAPTURE_EXPECT_KEYS, 'capture');
  const problems = [];
  if (!actual || typeof actual !== 'object') return ['no fields parsed'];

  const title = String(actual.title ?? '').toLowerCase();
  if (expect.title !== undefined && title !== expect.title.toLowerCase()) {
    problems.push(`title "${actual.title}" ≠ "${expect.title}"`);
  }
  if (expect.titleIncludes !== undefined && !title.includes(expect.titleIncludes.toLowerCase())) {
    problems.push(`title "${actual.title}" missing "${expect.titleIncludes}"`);
  }

  for (const field of ['priority', 'dueDate', 'dueTime', 'recurrence', 'project']) {
    if (expect[field] !== undefined && actual[field] !== expect[field]) {
      problems.push(`${field} "${actual[field] ?? '—'}" ≠ "${expect[field]}"`);
    }
  }

  if (expect.labelsSubsetOf !== undefined) {
    const allowed = new Set(expect.labelsSubsetOf);
    for (const label of actual.labels || []) {
      if (!allowed.has(label)) problems.push(`label "${label}" outside allowed subset`);
    }
  }

  // Over-inference catcher: any actual field the fixture did not expect fails.
  for (const field of CAPTURE_FIELDS) {
    const value = actual[field];
    if (value === undefined || value === null) continue;
    if (field === 'title') continue; // always present by design
    if (field === 'labels') {
      if ((value.length ?? 0) > 0 && expect.labelsSubsetOf === undefined) {
        problems.push(`unexpected labels [${value.join(', ')}]`);
      }
      continue;
    }
    if (expect[field] === undefined) problems.push(`unexpected ${field} "${value}" (inferred, not stated)`);
  }

  return problems;
}

// Compare an emitted filter expression + audit against a fixture expectation.
export function compareFilterResult({ expr, audit }, expect) {
  assertKnownKeys(expect, FILTER_EXPECT_KEYS, 'filter');
  const problems = [];
  if (!expr) return ['no expression extracted'];
  if (expect.expr !== undefined && expr !== expect.expr) {
    problems.push(`expr "${expr}" ≠ "${expect.expr}"`);
  }
  if (expect.exprIncludes !== undefined && !expr.includes(expect.exprIncludes)) {
    problems.push(`expr "${expr}" missing "${expect.exprIncludes}"`);
  }
  if (expect.valid !== undefined && audit.ok !== expect.valid) {
    problems.push(`valid ${audit.ok} ≠ ${expect.valid}${audit.parseError ? ` (${audit.parseError})` : ''}`);
  }
  if (expect.warnings !== undefined && audit.warnings.length !== expect.warnings) {
    problems.push(`${audit.warnings.length} warnings ≠ ${expect.warnings}: [${audit.warnings.join(' · ')}]`);
  }
  if (expect.warningsInclude !== undefined && !audit.warnings.some((w) => w.includes(expect.warningsInclude))) {
    problems.push(`warnings [${audit.warnings.join(' · ')}] missing "${expect.warningsInclude}"`);
  }
  return problems;
}

// Run every fixture case through prompt → chat → coercion → comparator.
// Sequential on purpose: local backends (ollama/llama.cpp) serve one request
// well, and eval readability beats wall-clock here.
export async function runNlEval(chat, { date, grounding, captureCases = [], filterCases = [] }) {
  const results = [];

  for (const c of captureCases) {
    const messages = buildNlCaptureMessages({ text: c.text, date, projects: grounding.projects, labels: grounding.labels });
    let problems;
    let detail = '';
    try {
      const { text: out } = await chat.complete(messages, { temperature: 0, maxTokens: 300 });
      const parsed = coerceNlCaptureFields(out, {
        projectSlugs: grounding.projects.map((p) => p.slug),
        knownLabels: grounding.labels,
        rawText: c.text,
      });
      problems = parsed ? compareCaptureFields(parsed.fields, c.expect) : ['model output was not parseable JSON'];
      detail = parsed ? JSON.stringify(parsed.fields) : String(out).slice(0, 120);
    } catch (err) {
      problems = [`chat error: ${err?.message || err}`];
    }
    results.push({ kind: 'capture', name: c.name, text: c.text, pass: problems.length === 0, problems, detail });
  }

  for (const c of filterCases) {
    const messages = buildNlFilterMessages({ text: c.text, date, projects: grounding.projects, labels: grounding.labels });
    let problems;
    let detail = '';
    try {
      const { text: out } = await chat.complete(messages, { temperature: 0, maxTokens: 200 });
      const expr = coerceNlFilterExpr(out);
      const audit = expr ? auditFilterExpr(expr, grounding) : { ok: false, parseError: null, warnings: [] };
      problems = compareFilterResult({ expr, audit }, c.expect);
      detail = expr ? `${expr}${audit.warnings.length ? `  ⚠ ${audit.warnings.join(' · ')}` : ''}` : String(out).slice(0, 120);
    } catch (err) {
      problems = [`chat error: ${err?.message || err}`];
    }
    results.push({ kind: 'filter', name: c.name, text: c.text, pass: problems.length === 0, problems, detail });
  }

  const passed = results.filter((r) => r.pass).length;
  return { results, passed, total: results.length };
}
