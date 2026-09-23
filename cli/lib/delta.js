// cli/lib/delta.js — the since-last-session memory delta: what changed in
// memory (created, updated, verified, superseded, deprecated, archived) since
// this agent's last delta, or since an explicit instant. Pure of I/O apart
// from the injected client; shared by `prax recall --since-last-session` and
// the prax-recall skill.
//
// The marker is "the end of the last delta this agent read" and moves only
// after a --since-last-session delta has been printed (recordDelta), so the
// delta is a lossless change feed: plain recalls never move it, and an
// explicit --since never does either.
// See docs/superpowers/specs/2026-09-23-budgeted-context-and-brief-design.md.
import { compactLine, fillOrder, isRetired } from './budget.js';
import {
  budgetSummary, checkCitations, createRepoUrlLookup, memoryEntryFull, renderBudgeted,
} from './recall.js';

const ISO_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

// Canonical ISO for --since, or null when it is not an ISO-8601 date/date-time.
export function parseSince(value) {
  const text = String(value ?? '').trim();
  if (!ISO_RE.test(text)) return null;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export class DeltaError extends Error {}

export async function memoryDelta(client, {
  since, sinceLastSession = false, project, limit, checkout,
} = {}) {
  if (Boolean(since) === Boolean(sinceLastSession)) throw new DeltaError('give exactly one of --since <iso> or --since-last-session.');
  if (sinceLastSession && !client.agent) {
    throw new DeltaError('--since-last-session needs an agent id: pass --agent <id> or set PRAX_AGENT.');
  }
  let res;
  try {
    res = await client.memoryChanges({ since, sinceLastSession, project, limit });
  } catch (err) {
    if (err && err.status === 404) err.message = `this Prax predates the memory delta (GET /api/library/changes answered 404). ${err.message}`;
    throw err;
  }
  const repoUrlOf = createRepoUrlLookup(client);
  const items = await Promise.all((res.items || []).map(async (item) => {
    // A retired row's claim is no longer current memory: nothing to check.
    if (isRetired(item)) return { ...item, citations: [], citationCheck: null };
    const { citations, citationCheck } = await checkCitations(client, item, checkout, repoUrlOf);
    return { ...item, citations, citationCheck };
  }));
  // Newest change first within a tier; the fill order puts verified, then
  // cited-and-unchanged, then the rest by the time of the change.
  const byChange = items.slice().sort((a, b) => String(b.changedAt).localeCompare(String(a.changedAt)));
  return {
    kind: 'delta',
    agent: res.agent ?? client.agent ?? null,
    project: res.project ?? null,
    baseline: res.baseline,
    since: res.since ?? null,
    until: res.until,
    page: res.page ?? null,
    items: fillOrder(byChange, { recencyOf: (item) => item.changedAt }),
  };
}

// Advance the agent's marker to the end of the delta it just read. Only for a
// --since-last-session delta; fail-soft (the next delta repeats the changes).
export async function recordDelta(client, result, { project } = {}) {
  if (!result || result.baseline === 'explicit' || !result.until) return { marked: false };
  try {
    await client.advanceRecallMarker({ project, at: result.until });
    return { marked: true };
  } catch (err) {
    return { marked: false, error: err };
  }
}

const scopeOf = (result) => (result.project?.slug ? `project ${result.project.slug}` : 'all projects');

function changeFacts(item) {
  const facts = item.changes?.length ? [`changed: ${item.changes.join(', ')}`] : [];
  if (item.supersededBy?.length) facts.push(`superseded by ${item.supersededBy.join(', ')}`);
  return facts;
}

export function planDelta(result, budget, now = new Date()) {
  const lines = [];
  const window = `${result.since ?? '—'} → ${result.until}`;
  if (result.baseline === 'none') {
    lines.push(`No earlier delta recorded for agent "${result.agent}" (${scopeOf(result)}); baseline set at ${result.until} — the next --since-last-session starts here. Use --since <iso> or --recent to look back.`);
  } else {
    const source = result.baseline === 'marker' ? `since the last delta for ${result.agent}` : 'since --since';
    lines.push(`# Memory changes ${source} (${scopeOf(result)})`);
    lines.push(`_Window: ${window} · ${result.items.length} change${result.items.length === 1 ? '' : 's'}_`);
    if (result.page?.hasMore) {
      lines.push(`(${result.page.returned} of ${result.page.total} changes shown, oldest first — run the delta again for the rest)`);
    }
    if (!result.items.length) lines.push('No memory changed in this window.');
    lines.push('(unverifications and permanent deletions are not tracked by the delta)');
  }
  const items = result.items || [];
  const entries = items.map((item, i) => {
    const extra = changeFacts(item);
    const compact = compactLine(item, { extra });
    return {
      // Retired rows are no longer current memory: their line says what
      // happened and what replaced them, never their old body as if current.
      full: isRetired(item) ? `${compact}\n` : memoryEntryFull(item, i, now, { extra }),
      compact,
      unverified: !item.verified,
    };
  });
  let rendered = renderBudgeted({ fixedLines: lines, entries, budget });
  // Entries the budget left out were never seen, so the feed must not move
  // past them: the marker stays, and the block says so.
  const holdMarker = result.baseline === 'marker' && rendered.plan.omitted.total > 0;
  if (holdMarker) {
    rendered = renderBudgeted({
      fixedLines: lines,
      entries,
      budget,
      footerLines: ['(marker not advanced: changes were left out by the budget, so the next --since-last-session repeats this window)'],
    });
  }
  const { text, used, plan } = rendered;
  return {
    text,
    advance: result.baseline !== 'explicit' && plan.omitted.total === 0,
    summary: Number.isFinite(budget) ? budgetSummary(items, budget, used, plan) : null,
  };
}

export function formatDelta(result, { budget, now = new Date() } = {}) {
  return planDelta(result, budget ?? Infinity, now).text;
}
