// A marked block inside a person's instruction file (AGENTS.md, CLAUDE.md, …),
// added, refreshed or removed without touching anything else. This is the
// routine skills/install.sh embeds as `edit_instructions`, parameterised by the
// marker name so the compiled Library block (`prax mirror --agents-block`)
// keeps its own marker pair; tests/cli/agentsBlock.test.js holds the two to
// identical results. Rules, as there:
//   - exactly one start/end pair, each on its own line, start before end; a
//     malformed or duplicated pair refuses the edit and leaves the file as is;
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
  if (mode === 'remove') {
    // The block and its own line ending; when it closed the file, also the
    // blank line the writer put before it.
    const tail = b.index + end.length + (before[b.index + end.length] === '\n' ? 1 : 0);
    let after = before.slice(0, a.index) + before.slice(tail);
    if (tail === before.length && after.endsWith('\n\n')) after = after.slice(0, -1);
    return after;
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
