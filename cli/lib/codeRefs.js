// Code-pinned memory — tie a claim to the code it describes.
//
// A memory asserts something about a system. Nothing currently connects that
// sentence to the file it describes, so the only way to learn it has rotted is
// for a person to notice. Pinning the claim to a file range and a content hash
// makes staleness a question the repository can answer: deterministic, free,
// and not something a hosted memory service can replicate, because it is not
// sitting next to the checkout.
//
// The store keeps a HASH, never the source. That keeps code out of the
// knowledge base and keeps citations small — and the `moved` check below shows
// a hash is enough to re-find relocated code.

import { createHash } from 'node:crypto';
import { citationSymbol, locateSymbol } from './symbols.js';

const CITATION_RE = /^(?<path>.+?)(?::(?<start>\d+)(?:-(?<end>\d+))?)?$/;

export class CitationError extends Error {}

// "server/config.js" | "server/config.js:12" | "server/config.js:12-36"
export function parseCitation(spec) {
  const raw = String(spec ?? '').trim();
  if (!raw) throw new CitationError('a citation needs a repository-relative path, e.g. server/config.js:12-36');

  const match = CITATION_RE.exec(raw);
  if (!match) throw new CitationError(`could not read the citation "${raw}"`);
  const { path, start, end } = match.groups;

  // Citations are repository-relative by construction: they are re-resolved in
  // whatever checkout is doing the checking, so an absolute or escaping path
  // would be meaningless there (and is a traversal waiting to happen).
  if (path.startsWith('/') || path.split('/').includes('..')) {
    throw new CitationError(`citation path must be relative to the repository root, got "${path}"`);
  }

  if (start === undefined) return { path, startLine: null, endLine: null };
  const startLine = Number(start);
  const endLine = end === undefined ? startLine : Number(end);
  if (startLine < 1) throw new CitationError('a citation line number starts at 1');
  if (endLine < startLine) throw new CitationError(`citation end line ${endLine} is before start line ${startLine}`);
  return { path, startLine, endLine };
}

function toLines(text) {
  // Normalise line endings so the same code checked out on Windows is not
  // reported as changed. Nothing else about the source is touched.
  return String(text).replace(/\r\n/g, '\n').split('\n');
}

// Inclusive, 1-based. null when the range runs past the end of the file: a
// citation that no longer fits its file has not "matched a shorter slice", it
// has stopped being answerable at that location.
export function sliceLines(text, startLine, endLine) {
  if (text === null || text === undefined) return null;
  const lines = toLines(text);
  if (!startLine) return lines.join('\n');
  if (endLine > lines.length) return null;
  return lines.slice(startLine - 1, endLine).join('\n');
}

export function hashCitation(text) {
  return createHash('sha256').update(toLines(text).join('\n'), 'utf8').digest('hex');
}

// The moved scan's budget, in lines hashed. Every candidate window costs its
// span, so an unbounded scan is quadratic: a 4000-line citation in a 40k-line
// file hashed ~150M lines (5.5 s) on every recall. Windows are tried nearest
// the recorded location first (line drift is usually small), and the scan
// stops when the budget is spent.
export const MOVED_SCAN_BUDGET_LINES = 1_000_000;

// The content-hash scan's budget, in line steps. Each step feeds one line to
// an incremental hash and finalises a copy (~0.35 µs): 250k steps is ~70 ms,
// spent only when a citation neither matches nor moved by its line hash.
export const CONTENT_SCAN_BUDGET_STEPS = 250_000;

// sha256 of lines[from..from+span) joined by '\n' — hashCitation's value for
// that window without building the joined string.
function hashWindow(lines, from, span) {
  const hash = createHash('sha256');
  for (let i = from; i < from + span; i += 1) {
    if (i > from) hash.update('\n', 'utf8');
    hash.update(lines[i], 'utf8');
  }
  return hash.digest('hex');
}

// The second anchor: sha256 of the cited text with ALL whitespace removed,
// newlines included. Re-indenting, trailing spaces, blank lines and a
// formatter re-wrapping a call across lines leave it unchanged — a difference
// that is only whitespace is not a different claim.
const stripWhitespace = (text) => String(text).replace(/\s+/g, '');
export function hashNormalized(text) {
  return createHash('sha256').update(stripWhitespace(text), 'utf8').digest('hex');
}
// A citation of blank lines only: its content hash matches every blank window.
const EMPTY_NORMALIZED_HASH = hashNormalized('');

// All three anchors for the cited lines of `text` (1-based, inclusive; null
// bounds = the whole file). The symbol is a heuristic name (cli/lib/symbols.js).
export function computeAnchors(text, startLine, endLine, path) {
  const cited = sliceLines(text, startLine, endLine);
  if (cited === null) return null;
  return {
    contentHash: hashCitation(cited),
    normalizedHash: hashNormalized(cited),
    symbol: startLine ? citationSymbol(text, startLine, endLine, path) : null,
  };
}

// Find content whose whitespace-free hash is `target`, nearest `origin`
// first. Windows start on non-blank lines and grow up to `maxSpan` lines (a
// reformat can wrap a call over more lines, or join it onto fewer); a copy of
// the running hash is finalised at each non-blank line, so one start costs one
// pass. Returns the 1-based range, or { complete } when nothing matched.
function scanContent(lines, target, origin, maxSpan, budget) {
  const stripped = lines.map(stripWhitespace);
  const last = lines.length - 1;
  let spent = 0;
  for (let distance = 0; origin - distance >= 0 || origin + distance <= last; distance += 1) {
    for (const from of distance === 0 ? [origin] : [origin - distance, origin + distance]) {
      if (from < 0 || from > last || stripped[from] === '') continue;
      if (spent >= budget) return { complete: false };
      const hash = createHash('sha256');
      for (let end = from; end <= Math.min(last, from + maxSpan - 1); end += 1) {
        spent += 1;
        if (stripped[end] === '') continue;
        hash.update(stripped[end], 'utf8');
        if (hash.copy().digest('hex') === target) return { startLine: from + 1, endLine: end + 1 };
      }
    }
  }
  return { complete: true };
}

// current | moved | changed | missing, trying the anchors in order: the line
// hash at the recorded range, the line hash over equal-length windows, the
// content (whitespace-free) hash over variable windows, then the symbol.
//
// `moved` exists because line numbers drift: inserting two imports at the top
// of a file would otherwise report every citation below them as stale, and a
// staleness signal that cries wolf is one people learn to ignore. Equal-length
// windows are re-hashed to re-find the cited content, so a pure relocation is
// reported as exactly that. When a budget ran out before every window was
// tried, a `changed` result says so (`searched: 'nearby'`): the code may have
// moved further away than was looked.
//
// A result the line hash settled has the same shape it always had. A content
// match adds `anchor: 'content'` (whitespace changed; the claim holds). A
// changed citation with a recorded symbol adds `symbol: { name, line }`: where
// its enclosing definition is now, or `line: null` when it is gone. A symbol
// never makes a changed citation hold — it only says where to look.
//
// Legacy citations (no normalizedHash/symbol, pinned before migration 0039)
// are checked with the line hash alone.
export function checkCitation(ref, currentText, {
  budgetLines = MOVED_SCAN_BUDGET_LINES, contentBudget = CONTENT_SCAN_BUDGET_STEPS,
} = {}) {
  const { startLine, endLine, contentHash, normalizedHash, symbol, path } = ref;
  if (currentText === null || currentText === undefined) {
    return { status: 'missing', startLine: startLine ?? null, endLine: endLine ?? null };
  }

  const atRecordedRange = sliceLines(currentText, startLine, endLine);
  if (atRecordedRange !== null && hashCitation(atRecordedRange) === contentHash) {
    return { status: 'current', startLine: startLine ?? null, endLine: endLine ?? null };
  }

  // A whole-file citation cannot have moved — it either matches or it does not.
  if (!startLine) {
    if (normalizedHash && hashNormalized(currentText) === normalizedHash) {
      return { status: 'current', startLine: null, endLine: null, anchor: 'content' };
    }
    return { status: 'changed', startLine: null, endLine: null };
  }

  const span = endLine - startLine + 1;
  const lines = toLines(currentText);
  let complete = true;

  // 2. The line hash over equal-length windows.
  const lastFirst = lines.length - span; // 0-based index of the last possible window
  if (lastFirst >= 0) {
    const origin = Math.min(Math.max(startLine - 1, 0), lastFirst);
    const windows = Math.max(1, Math.floor(budgetLines / span));
    let tried = 0;
    // origin, origin-1, origin+1, origin-2, … within [0, lastFirst].
    for (let distance = 0; tried < windows && (origin - distance >= 0 || origin + distance <= lastFirst); distance += 1) {
      for (const from of distance === 0 ? [origin] : [origin - distance, origin + distance]) {
        if (from < 0 || from > lastFirst || tried >= windows) continue;
        tried += 1;
        if (hashWindow(lines, from, span) === contentHash) {
          return { status: 'moved', startLine: from + 1, endLine: from + span };
        }
      }
    }
    complete = tried >= lastFirst + 1;
  }

  // 3. The content hash: the same code, reformatted, here or elsewhere.
  if (normalizedHash && normalizedHash !== EMPTY_NORMALIZED_HASH && lines.length) {
    const origin = Math.min(Math.max(startLine - 1, 0), lines.length - 1);
    const found = scanContent(lines, normalizedHash, origin, 2 * span + 10, contentBudget);
    if (found.startLine) {
      const inPlace = found.startLine === startLine && found.endLine === endLine;
      return { status: inPlace ? 'current' : 'moved', startLine: found.startLine, endLine: found.endLine, anchor: 'content' };
    }
    complete = complete && found.complete;
  }

  // 4. The symbol: the content changed, but where does its definition live now?
  const result = { status: 'changed', startLine, endLine };
  if (!complete) result.searched = 'nearby';
  if (symbol) result.symbol = { name: symbol, line: locateSymbol(lines, symbol, startLine, path) };
  return result;
}

// Pin a citation against the working tree: read the cited lines, hash them, and
// note the commit they were taken at. Injected I/O so this stays testable and
// so the skill bundle can reuse it.
export function resolveCitation(spec, { readFile, headSha = null } = {}) {
  const { path, startLine, endLine } = parseCitation(spec);
  const text = readFile(path);
  if (text === null || text === undefined) {
    throw new CitationError(`cannot cite ${path}: not found from here (paths are relative to the repository root)`);
  }
  const cited = sliceLines(text, startLine, endLine);
  if (cited === null) {
    const total = toLines(text).length;
    throw new CitationError(`cannot cite ${path} lines ${startLine}-${endLine}: the file has only ${total}`);
  }
  const { contentHash, normalizedHash, symbol } = computeAnchors(text, startLine, endLine, path);
  return { path, startLine, endLine, contentHash, normalizedHash, symbol, commitSha: headSha };
}

// One short clause for a recall label. Empty when the citation still holds:
// a staleness signal that fires on every hit is one people stop reading.
export function describeCitationStatus(result, ref) {
  const path = ref?.path || 'cited code';
  switch (result?.status) {
    case 'changed': {
      const hints = [];
      if (result.searched === 'nearby') hints.push('a move far from the cited lines was not searched');
      if (result.symbol?.name) {
        hints.push(result.symbol.line
          ? `${result.symbol.name} is now at line ${result.symbol.line}`
          : `${result.symbol.name} is gone`);
      }
      return `${path} changed since this was written${hints.length ? ` (${hints.join('; ')})` : ''}`;
    }
    case 'missing':
      return `${path} is gone`;
    case 'moved':
      return `moved to ${path}:${result.startLine}-${result.endLine}${result.anchor === 'content' ? ' (whitespace changed)' : ''}`;
    default:
      return '';
  }
}
