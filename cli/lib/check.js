// prax check — the cite-drift gate. Given what a change touched (a git diff
// or a list of files), find the memories whose code citations it broke.
//
// Recall already says, one hit at a time, when a memory's cited code moved on.
// That is too late: the memory rots the moment the code changes, and the
// person best placed to fix it is the one making the change. This runs where
// the change is reviewed (a merge-request pipeline, a pre-push hook) and fails
// only on drift THIS change introduced: a citation that held at the base and
// does not at the head. A citation that was already broken is reported as
// stale without failing, or one old rotten memory would block every change to
// its file.
//
// Pure of I/O: git and the file reads are injected (cli/lib/repoFiles.js
// provides them), and the client is the API client. Read-only by design — no
// writes to Prax and none to the checkout.

import { checkCitation, describeCitationStatus } from './codeRefs.js';
import { repositoryMismatch, trustLabel } from './recall.js';
import { symbolBlock } from './symbols.js';

// ---- input -------------------------------------------------------------------

// A C-quoted git path ("a/caf\303\251.js") back to text; git quotes paths with
// control characters, quotes or backslashes even with core.quotePath=false.
export function unquoteGitPath(raw) {
  const s = String(raw);
  if (!s.startsWith('"') || !s.endsWith('"') || s.length < 2) return s;
  const bytes = [];
  const body = s.slice(1, -1);
  const simple = { n: 10, t: 9, r: 13, b: 8, f: 12, a: 7, v: 11, '"': 34, '\\': 92 };
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch !== '\\') { bytes.push(...Buffer.from(ch, 'utf8')); continue; }
    const next = body[i + 1];
    if (/[0-7]/.test(next)) {
      bytes.push(parseInt(body.slice(i + 1, i + 4), 8));
      i += 3;
    } else {
      bytes.push(simple[next] ?? next.charCodeAt(0));
      i += 1;
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

function diffSidePath(raw, prefix) {
  const value = unquoteGitPath(String(raw).replace(/\t$/, ''));
  if (value === '/dev/null') return null;
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

// `a/X b/Y` from a `diff --git` header — only needed when a block has no
// ---/+++ lines (a pure rename, a mode change, a binary file). Unambiguous for
// quoted paths and for the common same-path case; otherwise split at " b/".
function headerPaths(header) {
  const quoted = /^("(?:[^"\\]|\\.)*"|\S+) ("(?:[^"\\]|\\.)*")$/.exec(header)
    || /^("(?:[^"\\]|\\.)*") (\S+)$/.exec(header);
  if (quoted && (quoted[1].startsWith('"') || quoted[2].startsWith('"'))) {
    return [diffSidePath(quoted[1], 'a/'), diffSidePath(quoted[2], 'b/')];
  }
  const half = (header.length - 5) / 2;
  if (Number.isInteger(half) && header.startsWith('a/') && header.slice(2, 2 + half) === header.slice(half + 5)) {
    const same = header.slice(2, 2 + half);
    return [same, same];
  }
  const split = header.indexOf(' b/');
  return split < 0 ? [null, null] : [diffSidePath(header.slice(0, split), 'a/'), diffSidePath(header.slice(split + 1), 'b/')];
}

// A zero-context unified diff (`git diff -U0 -M`) → one entry per file:
// { oldPath, newPath, status: added|deleted|modified|renamed, hunks } where a
// hunk is { oldStart, oldCount, newStart, newCount }. oldPath is null for an
// added file, newPath null for a deleted one.
export function parseUnifiedDiff(text) {
  const files = [];
  let current = null;
  for (const line of String(text ?? '').split('\n')) {
    if (line.startsWith('diff --git ')) {
      current = { oldPath: null, newPath: null, status: 'modified', hunks: [], header: line.slice(11) };
      files.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (m) {
        current.hunks.push({
          oldStart: Number(m[1]), oldCount: m[2] === undefined ? 1 : Number(m[2]),
          newStart: Number(m[3]), newCount: m[4] === undefined ? 1 : Number(m[4]),
        });
      }
      continue;
    }
    // Hunk bodies follow their header; a removed line reading "-- x" shows as
    // "--- x" and must not be taken for a file header.
    if (current.hunks.length) continue;
    if (line.startsWith('new file mode')) current.status = 'added';
    else if (line.startsWith('deleted file mode')) current.status = 'deleted';
    else if (line.startsWith('rename from ')) { current.status = 'renamed'; current.oldPath = unquoteGitPath(line.slice(12)); }
    else if (line.startsWith('rename to ')) current.newPath = unquoteGitPath(line.slice(10));
    else if (line.startsWith('copy to ')) { current.status = 'added'; current.newPath = unquoteGitPath(line.slice(8)); }
    else if (line.startsWith('--- ')) current.oldPath = diffSidePath(line.slice(4), 'a/') ?? current.oldPath;
    else if (line.startsWith('+++ ')) current.newPath = diffSidePath(line.slice(4), 'b/') ?? current.newPath;
  }
  return files.map(({ header, ...file }) => {
    const [a, b] = headerPaths(header);
    const out = { ...file, oldPath: file.oldPath ?? a, newPath: file.newPath ?? b };
    if (out.status === 'added') out.oldPath = null;
    if (out.status === 'deleted') out.newPath = null;
    return out;
  });
}

// A --files value or stdin: paths separated by newlines or commas. `./` and
// surrounding whitespace are dropped; blank entries are ignored.
export function parsePathList(text) {
  return [...new Set(String(text ?? '')
    .split(/[\n,]/)
    .map((p) => p.trim().replace(/^\.\//, ''))
    .filter(Boolean))];
}

// ---- touch rule -------------------------------------------------------------------

// The old-side hunks overlapping the 1-based range [start, end]. A deletion or
// modification covers its old lines; a pure insertion (-a,0) sits after old
// line a and changes the cited text only when it lands strictly inside it.
export function touchingHunks(hunks, start, end) {
  return (hunks || []).filter((h) => (h.oldCount > 0
    ? h.oldStart <= end && h.oldStart + h.oldCount - 1 >= start
    : h.oldStart >= start && h.oldStart < end));
}

function describeHunk(h) {
  if (h.oldCount === 0) return `insertion after line ${h.oldStart}`;
  return h.oldCount === 1 ? `line ${h.oldStart}` : `lines ${h.oldStart}-${h.oldStart + h.oldCount - 1}`;
}

const holds = (result) => result.status === 'current' || result.status === 'moved';

// ---- the check ------------------------------------------------------------------

// One touched citation's verdict. `drift` fails the check: the change broke a
// citation that held before it. `stale`: it was already broken at the base.
// `holds`: still true (in place, moved, or whitespace-only).
function evaluateDiff(ref, change, { readBase, readHead }) {
  const renamedAway = change.status === 'renamed' && change.oldPath === ref.path;
  const deleted = change.status === 'deleted' && change.oldPath === ref.path;
  const headPath = deleted ? null : (renamedAway ? change.newPath : ref.path);
  const baseText = readBase(ref.path);
  const before = checkCitation(ref, baseText);
  const baseline = baseText === null || baseText === undefined ? 'absent' : holds(before) ? 'held' : 'broken';

  let touched;
  if (!ref.startLine || renamedAway || deleted || baseline === 'absent') {
    touched = [];
  } else if (baseline === 'held') {
    touched = touchingHunks(change.hunks, before.startLine, before.endLine);
    if (!touched.length) return null;
  } else {
    // Already broken: its recorded lines, or the body of its symbol at base.
    touched = touchingHunks(change.hunks, ref.startLine, ref.endLine);
    const block = before.symbol?.line ? symbolBlock(baseText, before.symbol.line, ref.path) : null;
    if (!touched.length && block) touched = touchingHunks(change.hunks, block.startLine, block.endLine);
    if (!touched.length) return null;
  }

  const headText = headPath ? readHead(headPath) : null;
  const after = headText === null || headText === undefined
    ? { status: 'missing', startLine: ref.startLine ?? null, endLine: ref.endLine ?? null }
    : checkCitation({ ...ref, path: headPath }, headText);
  let verdict;
  if (holds(after) && !renamedAway) verdict = 'holds'; // including a change that repaired it
  else verdict = baseline === 'broken' ? 'stale' : 'drift';
  return {
    verdict, before, after, touched: touched.map(describeHunk),
    ...(renamedAway ? { renamedTo: change.newPath } : {}),
    ...(deleted ? { deleted: true } : {}),
  };
}

function evaluateFile(ref, { readHead }) {
  const text = readHead(ref.path);
  const after = text === null || text === undefined
    ? { status: 'missing', startLine: ref.startLine ?? null, endLine: ref.endLine ?? null }
    : checkCitation(ref, text);
  return { verdict: holds(after) ? 'holds' : 'drift', after, touched: [] };
}

function whatHappened(finding) {
  const { citation: ref, after } = finding;
  if (finding.renamedTo) return `renamed to ${finding.renamedTo}${holds(after) ? ' (content intact)' : ''}; the citation still names ${ref.path}`;
  if (finding.deleted) return `${ref.path} was deleted`;
  const note = describeCitationStatus(after, ref);
  if (note) return note;
  if (after.anchor === 'content') return 'whitespace changed; the content holds';
  return 'unchanged';
}

// Run the check. `changes` from parseUnifiedDiff (mode 'diff', with readBase
// and readHead) or file entries (mode 'files', readHead only). `checkout`
// identifies the repository ({ repoUrl, hasCommit }): a citation from another
// repository is counted as not checked, never reported. An explicit `project`
// vouches for its citations. Errors from the client propagate — the caller
// decides what an unreachable Prax means.
export async function runCheck(client, {
  mode, changes, readBase, readHead, checkout = null, project, range = null,
}) {
  const byOld = new Map();
  const byNew = new Map();
  for (const change of changes) {
    if (change.oldPath) byOld.set(change.oldPath, change);
    if (change.newPath) byNew.set(change.newPath, change);
  }
  const paths = [...new Set([...byOld.keys(), ...byNew.keys()])];
  const refs = paths.length ? await client.listCodeRefsByPath(paths, { project }) : [];

  const findings = [];
  const unchecked = [];
  let untouched = 0;
  for (const ref of refs) {
    const document = ref.document || {};
    const mismatch = project || !checkout ? null : repositoryMismatch(checkout, ref, document.projectRepoUrl);
    if (mismatch) { unchecked.push(mismatch); continue; }
    const change = byOld.get(ref.path) ?? byNew.get(ref.path);
    if (!change) continue;
    const outcome = mode === 'diff'
      ? evaluateDiff(ref, change, { readBase, readHead })
      : evaluateFile(ref, { readHead });
    if (!outcome) { untouched += 1; continue; }
    const citation = {
      id: ref.id, path: ref.path, startLine: ref.startLine ?? null, endLine: ref.endLine ?? null,
      symbol: ref.symbol ?? null, legacy: !ref.normalizedHash,
    };
    const finding = { ...outcome, document, citation };
    finding.note = whatHappened(finding);
    findings.push(finding);
  }
  const order = { drift: 0, stale: 1, holds: 2 };
  findings.sort((a, b) => order[a.verdict] - order[b.verdict]
    || String(a.citation.path).localeCompare(String(b.citation.path))
    || (a.citation.startLine ?? 0) - (b.citation.startLine ?? 0));
  const count = (verdict) => findings.filter((f) => f.verdict === verdict).length;
  const drift = count('drift');
  return {
    kind: 'check',
    mode,
    range,
    status: drift ? 'drift' : 'clean',
    changedFiles: changes.length,
    citations: refs.length,
    drift,
    stale: count('stale'),
    holds: count('holds'),
    untouched,
    unchecked: { count: unchecked.length, reasons: [...new Set(unchecked)] },
    findings,
  };
}

// The report when Prax could not be asked. Fail-open by default: exit 0 with
// this said out loud; --strict makes it exit 2.
export function skippedReport({ mode, range = null, changedFiles = 0, reason }) {
  return {
    kind: 'check', mode, range, status: 'skipped', reason, changedFiles,
    citations: 0, drift: 0, stale: 0, holds: 0, untouched: 0, unchecked: { count: 0, reasons: [] }, findings: [],
  };
}

// grep/diff convention: 0 clean (or skipped fail-open), 1 drift, 2 could not check.
export function checkExitCode(report, { strict = false } = {}) {
  if (report.status === 'drift') return 1;
  if (report.status === 'skipped') return strict ? 2 : 0;
  return 0;
}

// ---- output --------------------------------------------------------------------

const UNCHECKED = {
  'other-repository': 'cited in another repository',
  'commit-not-found': 'pinned at a commit this checkout does not have',
  'unknown-repository': 'the cited repository is not recorded',
};

function citationLabel(c) {
  if (!c.startLine) return c.path;
  return c.startLine === c.endLine ? `${c.path}:${c.startLine}` : `${c.path}:${c.startLine}-${c.endLine}`;
}

function uncheckedNote(report) {
  if (!report.unchecked.count) return '';
  const why = report.unchecked.reasons.map((r) => UNCHECKED[r] || r).join('; ');
  return `${report.unchecked.count} citation${report.unchecked.count === 1 ? '' : 's'} not checked (${why}).`;
}

export function formatCheck(report, now = new Date()) {
  if (report.status === 'skipped') return `prax check: skipped — ${report.reason}`;
  const lines = [];
  const scope = report.mode === 'diff' ? `the diff${report.range ? ` ${report.range}` : ''}` : 'the listed files';
  if (!report.findings.length) {
    lines.push(`No cited memories touched by ${scope} (${report.changedFiles} file${report.changedFiles === 1 ? '' : 's'}, ${report.citations} citation${report.citations === 1 ? '' : 's'} on them).`);
  } else {
    lines.push(`${report.drift} drifted, ${report.stale} already stale, ${report.holds} still hold — cited memories touched by ${scope}.`);
    for (const f of report.findings) {
      const doc = f.document;
      const where = [doc.projectSlug ? `in ${doc.projectSlug}` : '', trustLabel(doc, now)].filter(Boolean).join(' · ');
      const touched = f.touched?.length ? ` [touched: ${f.touched.join(', ')}]` : '';
      lines.push(`- ${f.verdict.toUpperCase()} ${doc.title || 'Untitled'} — ${doc.id}${where ? ` (${where})` : ''}`);
      lines.push(`    ${citationLabel(f.citation)}: ${f.note}${touched}`);
    }
  }
  const note = uncheckedNote(report);
  if (note) lines.push(note);
  if (report.drift) {
    lines.push('Refresh each drifted memory and re-cite it (prax remember "<title>" --body … --cite <path:lines>), or retire it (prax supersede <oldId> --with <newId>).');
  }
  return lines.join('\n');
}

// Markdown table cells: no pipes or newlines may break the row.
const cell = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');

// A merge-request comment body (Markdown). The pipeline posts it; this only
// writes it. Stable first line so a bot can find and update its own comment.
export function formatCheckComment(report, now = new Date()) {
  const lines = ['<!-- prax-check -->', '### Prax memory check', ''];
  if (report.status === 'skipped') {
    lines.push(`:warning: **Skipped** — ${report.reason}`, '', 'Cited memories were not checked for this change.');
    return lines.join('\n');
  }
  if (!report.findings.length) {
    lines.push(`:white_check_mark: No cited memories are touched by this change (${report.changedFiles} changed file${report.changedFiles === 1 ? '' : 's'}).`);
  } else if (!report.drift) {
    lines.push(`:white_check_mark: ${report.findings.length} cited memor${report.findings.length === 1 ? 'y is' : 'ies are'} touched, and every citation still holds.`);
  } else {
    lines.push(`:x: This change breaks the code cited by **${report.drift}** memor${report.drift === 1 ? 'y' : 'ies'}. Refresh or supersede ${report.drift === 1 ? 'it' : 'them'} before merging.`);
  }
  const table = (title, rows) => {
    if (!rows.length) return;
    lines.push('', `#### ${title}`, '', '| Memory | Project · trust | Citation | What happened |', '| --- | --- | --- | --- |');
    for (const f of rows) {
      const doc = f.document;
      const trust = [doc.projectSlug, trustLabel(doc, now)].filter(Boolean).join(' · ');
      const touched = f.touched?.length ? ` (touched: ${f.touched.join(', ')})` : '';
      lines.push(`| ${cell(doc.title || 'Untitled')} \`${cell(doc.id)}\` | ${cell(trust)} | \`${cell(citationLabel(f.citation))}\` | ${cell(f.note + touched)} |`);
    }
  };
  table('Drifted', report.findings.filter((f) => f.verdict === 'drift'));
  table('Already stale (not caused by this change)', report.findings.filter((f) => f.verdict === 'stale'));
  table('Still holds', report.findings.filter((f) => f.verdict === 'holds'));
  const note = uncheckedNote(report);
  if (note) lines.push('', note);
  if (report.drift || report.stale) {
    lines.push(
      '',
      '<details><summary>How to fix</summary>',
      '',
      '- If the memory is still true, update it and re-cite the current lines: `prax remember "<title>" --body "…" --cite <path>:<start>-<end>`.',
      '- If it is no longer true, write the replacement and retire the old one: `prax supersede <oldId> --with <newId>`.',
      '- `prax get <id>` shows the memory.',
      '',
      '</details>',
    );
  }
  return lines.join('\n');
}
