// cli/lib/budget.js — the one fill order and compaction for budgeted memory
// (docs/design/budgeted-context-and-brief.md).
// Shared by `prax recall --budget`, `prax context --budget`, the since-last-
// session delta and `prax brief`, so there is one ranking, not several.
//
// Pure: no I/O. Deterministic: the same candidates and budget always give the
// same block. No model is involved, so compaction can never paraphrase away a
// trust label: every entry starts on a line carrying its trust chip, and a
// compacted entry is exactly that one line.

// tokens ≈ ceil(characters / 4), over the exact text printed. A heuristic, not
// a tokenizer: prose runs close to it, code and non-Latin scripts run above.
export const CHARS_PER_TOKEN = 4;
export const TOKEN_ESTIMATE = 'chars/4';
export const FILL_TIERS = Object.freeze(['verified', 'cited-unchanged', 'recent']);

const FIRST_LINE_CHARS = 120;
export const LEAD_EXCERPT_CHARS = 800;
export const EXCERPT_CHARS = 240;

export function estimateTokens(text) {
  return Math.ceil(String(text ?? '').length / CHARS_PER_TOKEN);
}

const statusOf = (doc) => doc?.status || 'active';
const isRetired = (doc) => Boolean(doc?.archivedAt) || statusOf(doc) !== 'active';

// The trust chip every entry line starts with. Retired rows (only the delta
// shows them) say what they are instead of their old verification.
export function trustChip(doc) {
  if (!doc) return '[trust unknown]';
  if (doc.archivedAt) return '[archived]';
  const status = statusOf(doc);
  if (status !== 'active') return `[${status}]`;
  return doc.verified ? '[verified]' : '[unverified]';
}

// Every citation checked in this checkout and still matching at its pinned
// lines. A moved, changed, missing or unchecked citation does not qualify.
export function citedAndUnchanged(item) {
  const citations = Array.isArray(item?.citations) ? item.citations : [];
  if (!citations.length) return false;
  // Any citation left unchecked (another repository, no checkout, unreadable)
  // means the claim's ground was not confirmed here.
  const check = item.citationCheck;
  if (check && (check.reason || check.unchecked)) return false;
  return citations.every((c) => c && c.status === 'current');
}

// 0 = verified (active), 1 = cited-and-unchanged, 2 = recent (everything else).
export function fillTier(item) {
  if (isRetired(item)) return 2;
  if (item?.verified) return 0;
  if (citedAndUnchanged(item)) return 1;
  return 2;
}

// Stable fill order: tiers 0 and 1 keep retrieval order; tier 2 is newest
// first (retrieval order breaks ties, and an undated row sorts last — an
// unknown age never reads as fresh). Returns new objects carrying `tier`.
export function fillOrder(items, { recencyOf = (item) => item?.updatedAt } = {}) {
  const list = (Array.isArray(items) ? items : []).map((item, rank) => ({
    item, rank, tier: fillTier(item), at: String(recencyOf(item) || ''),
  }));
  list.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.tier === 2 && a.at !== b.at) {
      if (!a.at) return 1;
      if (!b.at) return -1;
      return a.at < b.at ? 1 : -1;
    }
    return a.rank - b.rank;
  });
  return list.map(({ item, tier }) => ({ ...item, tier: FILL_TIERS[tier] }));
}

// The body's first line worth reading: first non-blank line that is not the
// title itself, with Markdown heading/list/quote markers stripped, cut at 120.
export function firstLine(body, title = '', max = FIRST_LINE_CHARS) {
  const heading = String(title || '').replace(/\s+/g, ' ').trim().toLowerCase();
  for (const raw of String(body || '').split(/\r?\n/)) {
    const line = raw
      .replace(/^\s*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s*)/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!line || /^[-*_=]{3,}$/.test(line)) continue;
    if (heading && line.toLowerCase() === heading) continue;
    return line.length <= max ? line : `${line.slice(0, max).trimEnd()}…`;
  }
  return '';
}

// A body excerpt: whitespace kept, trimmed to `chars`.
export function excerpt(body, chars) {
  const text = String(body || '').trim();
  return text.length <= chars ? text : `${text.slice(0, chars).trimEnd()}…`;
}

const oneLine = (text) => String(text || '').replace(/\s+/g, ' ').trim();

// The compact form: exactly one line with the chip, title, type, id (plus
// any `extra` facts, such as a delta's change) and the body's first line.
export function compactLine(doc, { extra = [] } = {}) {
  const title = oneLine(doc?.title) || 'Untitled';
  const lead = firstLine(doc?.body ?? doc?.snippet ?? doc?.text, doc?.title);
  const facts = [doc?.documentType || 'note', doc?.id, ...extra.map(oneLine)].filter(Boolean).join(' · ');
  return `- ${trustChip(doc)} ${title} (${facts})${lead ? ` — ${lead}` : ''}`;
}

export { oneLine };

// The omission line: never silent, always counts the unverified left out.
export function omissionLine({ total, unverified }) {
  if (!total) return '';
  const extra = unverified > 0 ? ` (${unverified} unverified)` : '';
  return `_${total} more left out by the budget${extra} — raise --budget, or prax get <id>._`;
}

// The line that says what the budget did. Always printed.
export function budgetLine({ tokens, used, total, shown }) {
  const over = used > tokens ? ' — exceeded by the disclosure lines, which are never dropped' : '';
  return `(budget: ~${used} of ${tokens} tokens, ${TOKEN_ESTIMATE} · ${shown} of ${total} shown · fill: verified → cited-unchanged → recent${over})`;
}

// Plan which entries print and in which form.
//   entries: in fill order, each { full, compact, unverified, group?, header? }
//            (`full`/`compact` are the exact text blocks; `header` is printed
//            once before the first included entry of its `group`).
//   fixed:   text that always prints (headers, disclosures, the budget line).
// Returns { forms: ['full'|'compact'|null per entry], used, omitted }.
// Without a finite budget every entry prints in full.
export function planBudget(entries, { budget, fixed = '' } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const cost = (text) => (text === undefined || text === null ? 0 : estimateTokens(`${text}\n`));
  const fixedCost = cost(fixed);
  const seen = new Set();
  const headerCost = (entry) => (entry.group !== undefined && !seen.has(entry.group) ? cost(entry.header) : 0);
  const unverifiedTotal = list.filter((e) => e.unverified).length;

  if (!Number.isFinite(budget)) {
    let used = fixedCost;
    for (const entry of list) { used += headerCost(entry) + cost(entry.full); seen.add(entry.group); }
    return { forms: list.map(() => 'full'), used, omitted: { total: 0, unverified: 0 } };
  }

  // Everything in full, when it fits, needs no reserve for an omission line.
  let all = fixedCost;
  for (const entry of list) { all += headerCost(entry) + cost(entry.full); seen.add(entry.group); }
  seen.clear();
  if (all <= budget) return { forms: list.map(() => 'full'), used: all, omitted: { total: 0, unverified: 0 } };

  // Room for the worst-case omission line, while anything may be left out.
  const reserve = cost(omissionLine({ total: list.length, unverified: unverifiedTotal }));
  const forms = [];
  let used = fixedCost;
  let compactOnly = false;
  let stopped = false;
  list.forEach((entry, index) => {
    if (stopped) { forms.push(null); return; }
    const last = index === list.length - 1;
    const room = (text) => used + headerCost(entry) + cost(text) + (last ? 0 : reserve) <= budget;
    if (!compactOnly && room(entry.full)) {
      used += headerCost(entry) + cost(entry.full);
      seen.add(entry.group);
      forms.push('full');
      return;
    }
    compactOnly = true;
    if (room(entry.compact)) {
      used += headerCost(entry) + cost(entry.compact);
      seen.add(entry.group);
      forms.push('compact');
      return;
    }
    stopped = true;
    forms.push(null);
  });
  const left = list.filter((_, i) => forms[i] === null);
  const omitted = { total: left.length, unverified: left.filter((e) => e.unverified).length };
  if (omitted.total) used += cost(omissionLine(omitted));
  return { forms, used, omitted };
}

export { isRetired };
