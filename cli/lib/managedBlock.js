// A marked block inside a person's instruction file (AGENTS.md, CLAUDE.md, …),
// added, refreshed or removed without touching anything else. This is the
// routine skills/install.sh embeds as `edit_instructions`, parameterised by the
// marker name so the compiled Library block (`prax mirror --agents-block`)
// keeps its own marker pair; tests/cli/agentsBlock.test.js holds the two to
// identical results. Rules, as there:
//   - exactly one start/end pair, each on its own line, start before end; a
//     malformed or duplicated pair refuses the edit and leaves the file as is;
//   - other managed blocks (the skills' prax-memory block and the compiled
//     prax-library block share files) are never touched: a block whose span
//     holds any other marker-shaped line (nested or interleaved blocks) and a
//     body holding marker-shaped text both refuse, since either would let one
//     edit replace or delete part of another block;
//   - removal also takes the blank line the writer put before the block when
//     what follows is a blank line or the end of the file, so adding and
//     removing blocks in any order gives the original bytes back;
//   - a symlinked file is edited at its target (the link stays a link) and the
//     file mode is kept; a new file is private (0600);
//   - the write is atomic (temporary file + rename) and refuses when the file
//     changed while it was being prepared;
//   - an unchanged result is not written at all.
import { existsSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export class ManagedBlockError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ManagedBlockError';
  }
}

// Any managed-block marker line, whatever its name.
const ANY_MARKER_RE = /<!-- [a-z][a-z0-9-]*:(start|end) -->/;

// Whether the block spanning [from, to) holds another block's marker, or sits
// between another block's start and end (nested in it). A lone marker of a
// malformed other block outside the span is not an overlap: that block's own
// editor refuses it, and this one leaves it as it is.
function overlapsAnotherBlock(text, name, from, to) {
  if (ANY_MARKER_RE.test(text.slice(from, to))) return true;
  const others = [...text.matchAll(/<!-- ([a-z][a-z0-9-]*):(start|end) -->/g)].filter((m) => m[1] !== name);
  return others.some((s) => s[2] === 'start' && s.index < from
    && others.some((e) => e[1] === s[1] && e[2] === 'end' && e.index >= to));
}

export function blockMarkers(name) {
  if (!/^[a-z][a-z0-9-]*$/.test(String(name))) throw new Error(`invalid marker name "${name}"`);
  return { start: `<!-- ${name}:start -->`, end: `<!-- ${name}:end -->` };
}

// The pure edit: the file text after writing (`body`) or removing the block.
// Throws ManagedBlockError for malformed markers.
export function applyManagedBlock(before, { mode, body = '', name, file = 'the file' }) {
  const { start, end } = blockMarkers(name);
  const markers = [...before.matchAll(new RegExp(`<!-- ${name}:(start|end) -->`, 'g'))];
  if (mode === 'remove' && !markers.length) return before;
  const [a, b] = markers;
  if (markers.length && (markers.length !== 2 || a[1] !== 'start' || b[1] !== 'end'
      || (a.index && before[a.index - 1] !== '\n') || before[a.index + start.length] !== '\n'
      || before[b.index - 1] !== '\n'
      || (b.index + end.length < before.length && before[b.index + end.length] !== '\n'))) {
    throw new ManagedBlockError(`Malformed ${name} markers in ${file}; file left unchanged`);
  }
  if (markers.length && overlapsAnotherBlock(before, name, a.index + start.length, b.index)) {
    throw new ManagedBlockError(`The ${name} block in ${file} overlaps another managed block; file left unchanged`);
  }
  if (mode === 'write' && ANY_MARKER_RE.test(body)) {
    throw new ManagedBlockError(`The new ${name} block holds marker-shaped text; ${file} left unchanged`);
  }
  if (mode === 'remove') {
    // The block and its own line ending, plus the blank line the writer put
    // before it when a blank line or the end of the file follows (another
    // block written after this one starts with its own separator).
    const tail = b.index + end.length + (before[b.index + end.length] === '\n' ? 1 : 0);
    let head = before.slice(0, a.index);
    let rest = before.slice(tail);
    if (head.endsWith('\n\n') && (rest === '' || rest.startsWith('\n'))) head = head.slice(0, -1);
    else if (head === '' && rest.startsWith('\n')) rest = rest.slice(1);
    return head + rest;
  }
  const block = `${start}\n${body}\n${end}`;
  return markers.length
    ? before.slice(0, a.index) + block + before.slice(b.index + end.length)
    : `${before}${before ? '\n' : ''}${block}\n`;
}

// Edit the file. Returns { action: 'added'|'updated'|'removed'|'unchanged'|'absent', path }.
export function editManagedBlock(file, { mode, body = '', name }) {
  if (mode !== 'write' && mode !== 'remove') throw new Error(`unknown mode ${mode}`);
  if (mode === 'remove' && !existsSync(file)) return { action: 'absent', path: file };
  const path = existsSync(file) ? realpathSync(file) : file;
  const before = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const hadBlock = before.includes(blockMarkers(name).start);
  const after = applyManagedBlock(before, { mode, body, name, file });
  if (after === before) return { action: mode === 'remove' ? 'absent' : 'unchanged', path };
  const temporary = `${path}.prax-tmp.${randomUUID()}`;
  try {
    writeFileSync(temporary, after, { flag: 'wx', mode: existsSync(path) ? statSync(path).mode & 0o777 : 0o600 });
    if ((existsSync(path) ? readFileSync(path, 'utf8') : '') !== before) {
      throw new ManagedBlockError(`Instructions changed during update: ${file}`);
    }
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
  return { action: mode === 'remove' ? 'removed' : hadBlock ? 'updated' : 'added', path };
}
