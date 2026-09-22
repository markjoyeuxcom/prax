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

// current | moved | changed | missing.
//
// `moved` exists because line numbers drift: inserting two imports at the top
// of a file would otherwise report every citation below them as stale, and a
// staleness signal that cries wolf is one people learn to ignore. Equal-length
// windows are re-hashed to re-find the cited content, so a pure relocation is
// reported as exactly that. When the budget ran out before every window was
// tried, a `changed` result says so (`searched: 'nearby'`): the code may have
// moved further away than was looked.
export function checkCitation(ref, currentText, { budgetLines = MOVED_SCAN_BUDGET_LINES } = {}) {
  const { startLine, endLine, contentHash } = ref;
  if (currentText === null || currentText === undefined) {
    return { status: 'missing', startLine: startLine ?? null, endLine: endLine ?? null };
  }

  const atRecordedRange = sliceLines(currentText, startLine, endLine);
  if (atRecordedRange !== null && hashCitation(atRecordedRange) === contentHash) {
    return { status: 'current', startLine: startLine ?? null, endLine: endLine ?? null };
  }

  // A whole-file citation cannot have moved — it either matches or it does not.
  if (!startLine) return { status: 'changed', startLine: null, endLine: null };

  const span = endLine - startLine + 1;
  const lines = toLines(currentText);
  const lastFirst = lines.length - span; // 0-based index of the last possible window
  if (lastFirst < 0) return { status: 'changed', startLine, endLine };
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
  const complete = tried >= lastFirst + 1;
  return complete
    ? { status: 'changed', startLine, endLine }
    : { status: 'changed', startLine, endLine, searched: 'nearby' };
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
  return { path, startLine, endLine, contentHash: hashCitation(cited), commitSha: headSha };
}

// One short clause for a recall label. Empty when the citation still holds:
// a staleness signal that fires on every hit is one people stop reading.
export function describeCitationStatus(result, ref) {
  const path = ref?.path || 'cited code';
  switch (result?.status) {
    case 'changed':
      return result.searched === 'nearby'
        ? `${path} changed since this was written (a move far from the cited lines was not searched)`
        : `${path} changed since this was written`;
    case 'missing':
      return `${path} is gone`;
    case 'moved':
      return `moved to ${path}:${result.startLine}-${result.endLine}`;
    default:
      return '';
  }
}
