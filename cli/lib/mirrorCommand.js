// `prax mirror` — its flag grammar and dispatch, kept here so cli/prax.js only
// spreads the flags in and hands the command over.
//   prax mirror [--out <dir>] [--check] [--force]
//   prax mirror import [dir] [--trust-verifier <a,b>]
//   prax mirror --agents-block [--file <path>] [--type a,b] [--tag a,b] [--max-chars n] [--print | --remove]
import { isAbsolute, join, resolve } from 'node:path';
import { checkCommandArgs, CliUsageError, flagValue, positiveIntFlag } from './cliArgs.js';
import { repoRoot } from './repoFiles.js';
import { DEFAULT_MIRROR_DIR } from './mirrorFormat.js';
import { fetchMirrorDocuments, formatMirrorReport, writeMirror } from './mirror.js';
import { confirmClaims, formatImportReport, importMirror, trustedVerifiers } from './mirrorImport.js';
import {
  AGENTS_BLOCK_MARKER, compileAgentsBlock, DEFAULT_BLOCK_MAX_CHARS, DEFAULT_BLOCK_TAGS, DEFAULT_BLOCK_TYPES,
  defaultInstructionFile, MIN_BLOCK_MAX_CHARS, selectBlockDocuments,
} from './agentsBlock.js';
import { editManagedBlock } from './managedBlock.js';

export const MIRROR_VALUE_FLAGS = ['out', 'file', 'trust-verifier', 'max-chars'];
export const MIRROR_BOOLEAN_FLAGS = ['check', 'force', 'agents-block', 'print', 'remove'];
export const MIRROR_USAGE = 'prax mirror [--out <dir>] [--check] [--force] | prax mirror import [dir] [--trust-verifier <a,b>] | prax mirror --agents-block [--file <path>] [--type a,b] [--tag a,b] [--max-chars <n>] [--print | --remove]';
export const MIRROR_HELP = [
  '  prax mirror [--project <slug>] [--out <dir>] [--check] [--force] [--json]',
  '  prax mirror import [dir] [--project <slug>] [--trust-verifier <name,...>] [--json]',
  '  prax mirror --agents-block [--project <slug>] [--file <path>] [--type a,b] [--tag a,b] [--max-chars <n>] [--print | --remove] [--json]',
].join('\n');
// The top-level command spec for cli/prax.js; the forms are checked below.
export const MIRROR_COMMAND = {
  flags: [...MIRROR_VALUE_FLAGS, ...MIRROR_BOOLEAN_FLAGS, 'type', 'tag'],
  max: 2,
  usage: MIRROR_USAGE,
};

const GLOBAL = ['project', 'url', 'agent', 'json', 'help'];
const FORMS = {
  write: { flags: ['out', 'check', 'force'], max: 0, usage: 'prax mirror [--project <slug>] [--out <dir>] [--check] [--force] [--json]' },
  import: { flags: ['trust-verifier'], max: 1, usage: 'prax mirror import [dir] [--project <slug>] [--trust-verifier <name,...>] [--json]' },
  block: { flags: ['agents-block', 'file', 'type', 'tag', 'max-chars', 'print', 'remove'], max: 0, usage: 'prax mirror --agents-block [--project <slug>] [--file <path>] [--type a,b] [--tag a,b] [--max-chars <n>] [--print | --remove] [--json]' },
};

function list(value) {
  return value === undefined ? undefined : value.split(',').map((item) => item.trim()).filter(Boolean);
}

function base(cwd) {
  return repoRoot(cwd) || cwd;
}

// `resolveProject()` resolves the project the way every project command does.
export async function runMirror({
  positionals, flags, client, out, resolveProject, cwd = process.cwd(), env = process.env,
  input = process.stdin, output = process.stdout,
}) {
  const words = positionals.slice(1);
  const form = flags['agents-block'] ? 'block' : words[0] === 'import' ? 'import' : 'write';
  const spec = FORMS[form];
  const rest = form === 'import' ? words.slice(1) : words;
  if (form === 'write' && words.length) {
    throw new CliUsageError(`mirror: unknown subcommand "${words[0]}".\nUsage: ${MIRROR_USAGE}`);
  }
  checkCommandArgs(form === 'write' ? 'mirror' : form === 'import' ? 'mirror import' : 'mirror --agents-block',
    { flags, positionals: rest }, { allowed: [...GLOBAL, ...spec.flags], max: spec.max, usage: spec.usage });

  if (form === 'block') {
    if (flags.print && flags.remove) throw new CliUsageError('give --print or --remove, not both.');
    const maxChars = positiveIntFlag(flags, 'max-chars') ?? DEFAULT_BLOCK_MAX_CHARS;
    if (maxChars < MIN_BLOCK_MAX_CHARS) throw new CliUsageError(`--max-chars must be at least ${MIN_BLOCK_MAX_CHARS}.`);
    const fileFlag = flagValue(flags, 'file');
    const file = fileFlag ? resolve(cwd, fileFlag) : defaultInstructionFile(base(cwd));
    if (flags.remove) {
      const result = editManagedBlock(file, { mode: 'remove', name: AGENTS_BLOCK_MARKER });
      out(flags.json ? result : result.action === 'removed' ? `Removed the compiled Prax block from ${file}.` : `No compiled Prax block in ${file}.`);
      return;
    }
    const types = list(flagValue(flags, 'type')) ?? (flags.tag !== undefined ? [] : DEFAULT_BLOCK_TYPES);
    const tags = list(flagValue(flags, 'tag')) ?? (flags.type !== undefined ? [] : DEFAULT_BLOCK_TAGS);
    const { project } = await resolveProject();
    const selected = selectBlockDocuments(await fetchMirrorDocuments(client, project), { types, tags });
    const body = compileAgentsBlock({ project, documents: selected, types, tags, maxChars });
    if (flags.print) { out(flags.json ? { project, documents: selected.length, block: body } : body); return; }
    const result = editManagedBlock(file, { mode: 'write', body, name: AGENTS_BLOCK_MARKER });
    out(flags.json
      ? { ...result, project, documents: selected.length, characters: body.length }
      : `${result.action === 'unchanged' ? 'Compiled Prax block already current in' : `Compiled Prax block ${result.action} in`} ${file} (${selected.length} verified document${selected.length === 1 ? '' : 's'} from ${project}).`);
    return;
  }

  if (form === 'import') {
    const dirArg = rest[0] ?? DEFAULT_MIRROR_DIR;
    const dir = isAbsolute(dirArg) ? dirArg : (rest[0] ? resolve(cwd, dirArg) : join(base(cwd), dirArg));
    const trusted = trustedVerifiers({ flag: flagValue(flags, 'trust-verifier'), env });
    // Import files documents into the project, creating it when it is new
    // (as `prax remember` does), so a fresh library can take a mirror.
    // The mirror carries the project's own overview card (when it has one):
    // no seeded starter beside it.
    const project = await client.ensureProject((await resolveProject({ write: true })).project, { overview: false });
    const report = await importMirror(client, {
      dir, project, trusted, confirm: (claims) => confirmClaims(claims, { input, output }),
    });
    out(flags.json ? report : formatImportReport(report, { dir, project }));
    if (report.failed.length) process.exitCode = 1;
    return;
  }

  const outFlag = flagValue(flags, 'out');
  const dir = outFlag ? resolve(cwd, outFlag) : join(base(cwd), DEFAULT_MIRROR_DIR);
  const { project } = await resolveProject();
  const documents = await fetchMirrorDocuments(client, project);
  const result = writeMirror({ dir, project, documents, check: Boolean(flags.check), force: Boolean(flags.force) });
  const { writes, deletes, readme, index, interimIndex, ...summary } = result;
  out(flags.json ? { dir, project, ...summary } : formatMirrorReport(result, { dir, check: Boolean(flags.check) }));
  if (flags.check && result.stale) process.exitCode = 1;
}
