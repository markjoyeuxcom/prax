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

// current | moved | changed | missing.
//
// `moved` exists because line numbers drift: inserting two imports at the top
// of a file would otherwise report every citation below them as stale, and a
// staleness signal that cries wolf is one people learn to ignore. Equal-length
// windows are re-hashed to re-find the cited content, so a pure relocation is
// reported as exactly that.
export function checkCitation(ref, currentText) {
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
  for (let first = 1; first + span - 1 <= lines.length; first += 1) {
    const window = lines.slice(first - 1, first + span - 1).join('\n');
    if (hashCitation(window) === contentHash) {
      return { status: 'moved', startLine: first, endLine: first + span - 1 };
    }
  }
  return { status: 'changed', startLine, endLine };
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
      return `${path} changed since this was written`;
    case 'missing':
      return `${path} is gone`;
    case 'moved':
      return `moved to ${path}:${result.startLine}-${result.endLine}`;
    default:
      return '';
  }
}
