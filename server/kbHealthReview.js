// KB-health AI review (Tier-2 #5, increment 2) — pure builders + parsers for the
// on-demand "Scan with AI" pass: contradiction detection over embedding-picked
// document pairs, and coverage-gap detection from a trust-aware digest. All IO
// (chat, embeddings, DB) lives in the route; everything here is pure + total
// (bad model output degrades to "no finding", never throws). Design:
// docs/superpowers/specs/2026-07-09-kb-health-ai-design.md.

// ---- cost caps (worst case = MAX_PAIRS + 1 = 13 model calls per scan) -------
export const MAX_SEED_DOCS = 40;          // findSimilarDocuments cosine passes
export const NEIGHBORS_PER_SEED = 3;
export const CONTRADICTION_MIN_SIM = 0.80; // same-topic floor (precision)
export const CONTRADICTION_MAX_SIM = 0.995; // near-dup ceiling (dupes ≠ conflicts)
export const MAX_PAIRS = 12;              // hard cap on contradiction model calls
export const PAIR_DOC_CHARS = 1500;
export const CONTRADICTION_MAXTOKENS = 400;
export const GAP_MAX_DOCS = 120;
export const GAP_MAX_TASKS = 40;
export const GAP_DIGEST_CHARS = 4000;
export const GAP_MAXTOKENS = 700;
export const GAP_MAX = 5;

// ---- shared defensive helpers ----------------------------------------------

export const clampStr = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

// First balanced {...} object in the text, tolerating ```json fences + prose.
// First balanced `open…close` region, STRING-AWARE so a brace/bracket inside a
// JSON string value (e.g. a runbook quote `kubectl patch -p '{"x":1}'`) does not
// prematurely close the scan. Prefers a ```json fence only when it contains the
// opener, else scans the whole text (so trailing JSON after an unrelated fence
// still parses).
function firstBalanced(text, open, close) {
  const s = String(text ?? '');
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced && fenced[1].includes(open) ? fenced[1] : s;
  const start = body.indexOf(open);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < body.length; i += 1) {
    const c = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth += 1;
    else if (c === close && (depth -= 1) === 0) {
      try { return JSON.parse(body.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

export function extractJsonObject(text) {
  const v = firstBalanced(text, '{', '}');
  return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
}

// First balanced [...] array (fallback when the model returns a bare array
// instead of the requested {gaps:[...]} object). Tolerant of fences/prose/strings.
export function extractJsonArray(text) {
  const v = firstBalanced(text, '[', ']');
  return Array.isArray(v) ? v : null;
}

// ---- contradiction candidate selection (pure) ------------------------------

export function pairKey(x, y) {
  return [x, y].sort().join('|');
}

// Collapse directed neighbour rows into a deduped, thresholded, ranked, capped
// set of undirected pairs, materializing each side's full doc from `byId`.
export function selectContradictionPairs(rawPairs, byId, { minSim = CONTRADICTION_MIN_SIM, maxSim = CONTRADICTION_MAX_SIM, maxPairs = MAX_PAIRS } = {}) {
  const best = new Map();
  for (const p of Array.isArray(rawPairs) ? rawPairs : []) {
    const aId = p?.aId;
    const bId = p?.bId;
    const sim = Number(p?.similarity);
    if (!aId || !bId || aId === bId) continue;
    if (!byId.has(aId) || !byId.has(bId)) continue;
    if (!(sim >= minSim) || sim >= maxSim) continue;
    const key = pairKey(aId, bId);
    const prev = best.get(key);
    if (!prev || sim > prev.similarity) best.set(key, { aId, bId, similarity: sim });
  }
  return [...best.values()]
    .sort((x, y) => y.similarity - x.similarity)
    .slice(0, maxPairs)
    .map(({ aId, bId, similarity }) => {
      const [lo, hi] = [aId, bId].sort();
      return { a: byId.get(lo), b: byId.get(hi), similarity };
    });
}

// ---- contradiction judgment (pure prompt + parse) --------------------------

const CONTRADICTION_SYSTEM = [
  'You are a meticulous technical reviewer auditing an SRE knowledge base for CONTRADICTIONS.',
  'You are given exactly two documents, A and B, that cover a similar topic. Decide whether they give',
  'DIRECTLY CONFLICTING guidance or state INCOMPATIBLE facts about the SAME subject — statements that',
  'cannot both be true, or cannot both be followed safely, at the same time. Judge ONLY what is written',
  'in A and B. Do not use outside knowledge and do not infer a conflict the text does not state. The',
  'following are NOT contradictions — answer false for every one of them: the documents cover different',
  'topics, systems, or components; one is general and the other is specific; one simply adds steps,',
  'detail, or caveats the other omits; they describe different environments, versions, or time periods',
  "without claiming the other is wrong; they differ only in wording, ordering, formatting, or emphasis;",
  'one is merely older. Require a concrete conflict, for example: A says to always do X while B says to',
  'never do X; A gives one threshold or command for a metric and B gives a different one for the SAME',
  'metric; A calls a step safe while B calls the same step destructive. When you are not HIGHLY',
  'CONFIDENT that the two statements cannot both hold, answer false — precision matters far more than',
  'catching every case. If contradicts is true you MUST copy the single most conflicting sentence',
  'VERBATIM from each document into quoteA and quoteB (exact substring, no paraphrase, no ellipsis).',
  'Set severity to "high" only when following both as written could cause an operational error',
  '(conflicting commands, thresholds, or safety guidance); otherwise "low". Respond with ONE JSON object',
  'and NOTHING else — no code fence, no commentary — exactly: {"contradicts": boolean, "severity":',
  '"high"|"low", "issue": string, "quoteA": string, "quoteB": string}. Keep issue under 160 characters.',
  'If contradicts is false, use empty strings for issue, quoteA, quoteB.',
].join(' ');

export function buildContradictionMessages(a, b, { docChars = PAIR_DOC_CHARS } = {}) {
  const clip = (s) => (String(s ?? '').length > docChars ? `${String(s).slice(0, docChars)}\n…(truncated)` : String(s ?? ''));
  const label = (d) => `"${d?.title ?? 'Untitled'}" (${d?.documentType || 'note'} · ${d?.verified ? 'verified' : 'UNVERIFIED'})`;
  const user = `DOCUMENT A — ${label(a)}:\n\n${clip(a?.body)}\n\n---\n\nDOCUMENT B — ${label(b)}:\n\n${clip(b?.body)}\n\n---\n\nDo A and B contradict each other? Reply with the JSON object only.`;
  return [{ role: 'system', content: CONTRADICTION_SYSTEM }, { role: 'user', content: user }];
}

export function parseContradiction(text) {
  const o = extractJsonObject(text);
  if (!o || typeof o !== 'object') return null;
  const contradicts = o.contradicts === true || String(o.contradicts).toLowerCase() === 'true';
  if (!contradicts) return { contradicts: false };
  return {
    contradicts: true,
    severity: o.severity === 'high' ? 'high' : 'low',
    issue: clampStr(o.issue, 160),
    quoteA: clampStr(o.quoteA, 300),
    quoteB: clampStr(o.quoteB, 300),
  };
}

// The precision gate: a cited sentence must appear verbatim (modulo whitespace/
// case) in the doc, or the whole finding is dropped as a fabrication.
const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
export function quoteIsGrounded(body, quote) {
  const q = norm(quote);
  return q.length >= 12 && norm(body).includes(q);
}

// ---- coverage gaps (pure digest + prompt + parse) --------------------------

export function buildGapDigest(docs, openTasks, { maxDocs = GAP_MAX_DOCS, maxTasks = GAP_MAX_TASKS, maxChars = GAP_DIGEST_CHARS } = {}) {
  const docList = (Array.isArray(docs) ? docs : []).slice(0, maxDocs);
  // dedupe task titles case-insensitively
  const seen = new Set();
  const taskTitles = [];
  for (const t of Array.isArray(openTasks) ? openTasks : []) {
    const title = String(t?.title ?? '').trim();
    if (!title) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    taskTitles.push(title);
    if (taskTitles.length >= maxTasks) break;
  }

  // Give each section its OWN budget so a large doc index can't starve the open-
  // task themes the gap prompt is told to ground on. Reserve ~a third for tasks.
  const take = (lines, budget) => {
    const out = [];
    let dropped = 0;
    let left = budget;
    for (const line of lines) {
      if (left - line.length - 1 > 0) { out.push(line); left -= line.length + 1; }
      else dropped += 1;
    }
    if (dropped) out.push(`…(${dropped} more)`);
    return out;
  };
  const taskBudget = taskTitles.length ? Math.floor(maxChars / 3) : 0;
  const docLines = take(docList.map((d) => `- ${d?.title ?? 'Untitled'} · ${d?.documentType || 'note'} · ${d?.verified ? 'verified' : 'unverified'}`), maxChars - taskBudget);
  const taskLines = taskTitles.length ? take(taskTitles.map((t) => `- ${t}`), taskBudget) : ['- (no open tasks)'];
  return `EXISTING DOCUMENTS (title · type · trust):\n${docLines.join('\n')}\n\nOPEN-TASK THEMES:\n${taskLines.join('\n')}`;
}

const GAP_SYSTEM = [
  'You are auditing an SRE knowledge base for COVERAGE GAPS — operational topics the team clearly works',
  'on but has little or no documentation for. You are given (1) an index of the documents that already',
  "exist (title · type · trust) and (2) themes drawn from the team's open tasks. Identify topics the open",
  'work implies the team needs a runbook or note for, but which the document index does not already',
  'cover. Ground EVERY gap in the material provided: name the open-task theme or the near-miss index',
  'entry that points at it. Do not invent topics that neither the index nor the tasks mention. Do not',
  'report a topic an existing document already covers. Prefer precision: propose at most 5 gaps, most',
  'important first, and if coverage already looks adequate return an empty list. Respond with ONE JSON',
  'object and NOTHING else — no code fence, no commentary: {"gaps": [{"topic": string, "rationale":',
  'string, "evidence": string}]}. Keep topic under 60 characters and rationale under 160.',
].join(' ');

export function buildGapMessages(digest) {
  return [{ role: 'system', content: GAP_SYSTEM }, { role: 'user', content: `${digest}\n\nList the coverage gaps as JSON.` }];
}

export function parseGaps(text, { max = GAP_MAX } = {}) {
  const o = extractJsonObject(text);
  // Primary shape is {gaps:[...]}; fall back to a bare [...] array.
  const arr = Array.isArray(o?.gaps) ? o.gaps : (extractJsonArray(text) || []);
  const out = [];
  for (const e of arr) {
    const topic = clampStr(e?.topic, 60);
    if (!topic) continue;
    out.push({ topic, rationale: clampStr(e?.rationale, 160), evidence: clampStr(e?.evidence, 200) });
    if (out.length >= max) break;
  }
  return out;
}
