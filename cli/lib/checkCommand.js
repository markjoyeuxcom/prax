// `prax check` wiring: read the change (git diff, --files or stdin), run the
// pure check (cli/lib/check.js) against the API, print, and decide the exit
// code. Kept out of cli/prax.js so the command is one self-contained branch
// there.
//
// Exit codes (grep/diff convention): 0 clean, or skipped fail-open; 1 drift;
// 2 the check could not run (usage, git, API error, or unreachable under
// --strict). Read-only: GET requests only, nothing written anywhere.

import {
  runCheck, skippedReport, checkExitCode, formatCheck, formatCheckComment,
  parseUnifiedDiff, parsePathList,
} from './check.js';
import {
  repoRoot, createCheckout, resolveDiffRange, gitDiff, readAtRevision,
} from './repoFiles.js';
import { PraxUnavailableError } from './apiClient.js';

export const CHECK_USAGE = 'prax check [--diff <range> | --files <a,b,…>] [--project <slug>] [--comment] [--strict] [--json]   (or: git diff --name-only <range> | prax check)';

// An error that ends `prax check` with exit 2 ("could not check"), keeping 1
// for drift alone.
export function checkFailure(message) {
  return Object.assign(new Error(message), { exitCode: 2 });
}

async function readAll(stream) {
  let text = '';
  stream.setEncoding('utf8');
  for await (const chunk of stream) text += chunk;
  return text;
}

// Why Prax could not be asked, when that is fail-open material: unreachable
// (connection refused, DNS, timeout) or a server that predates the by-path
// citation route. null for every other failure, which is exit 2.
export function skipReason(err, base) {
  if (err instanceof PraxUnavailableError || err?.name === 'PraxUnavailableError') {
    const how = err.timedOut ? ' (timed out)' : '';
    return `Prax is not reachable${base ? ` at ${base}` : ''}${how}; cited memories were not checked`;
  }
  if (err?.status === 404) {
    return `the Prax instance${base ? ` at ${base}` : ''} predates prax check (no citation lookup route); cited memories were not checked`;
  }
  return null;
}

export async function checkCommand({
  flags, client, stdin = process.stdin, stdout = process.stdout, stderr = process.stderr, cwd = process.cwd(),
}) {
  const diff = flags.diff;
  const files = flags.files;
  if (diff !== undefined && files !== undefined) throw checkFailure(`give one input: --diff or --files.\nUsage: ${CHECK_USAGE}`);
  if (flags.comment && flags.json) throw checkFailure(`--comment and --json are two output formats; give one.\nUsage: ${CHECK_USAGE}`);

  const root = repoRoot(cwd);
  if (!root) throw checkFailure('prax check runs inside a git checkout: citations are repository-relative.');

  let mode;
  let range = null;
  let changes;
  let readBase = () => null;
  let readHead;
  const workingTree = createCheckout(root);
  try {
    if (diff !== undefined) {
      mode = 'diff';
      range = String(diff);
      const revs = resolveDiffRange(range, root);
      changes = parseUnifiedDiff(gitDiff(revs, root));
      readBase = (path) => readAtRevision(revs.base, path, root);
      readHead = revs.head ? (path) => readAtRevision(revs.head, path, root) : workingTree.readFile;
    } else {
      mode = 'files';
      let text = files;
      if (text === undefined) {
        if (stdin.isTTY) throw checkFailure(`nothing to check: pass --diff <range>, --files <list>, or pipe paths on stdin.\nUsage: ${CHECK_USAGE}`);
        text = await readAll(stdin);
      }
      const paths = parsePathList(text);
      if (paths.some((p) => p.startsWith('/') || p.split('/').includes('..'))) {
        throw checkFailure('--files paths must be relative to the repository root.');
      }
      changes = paths.map((path) => ({ oldPath: path, newPath: path, status: 'modified', hunks: [] }));
      readHead = workingTree.readFile;
    }
  } catch (err) {
    if (err.exitCode) throw err;
    throw checkFailure(err.message);
  }

  const project = flags.project || undefined;
  let report;
  try {
    report = await runCheck(client, {
      mode, changes, readBase, readHead, checkout: workingTree, project, range,
    });
  } catch (err) {
    const reason = skipReason(err, client.base || (client.candidates || []).join(' or '));
    if (!reason) throw checkFailure(err.message);
    report = skippedReport({ mode, range, changedFiles: changes.length, reason });
    stderr.write(`prax check: skipped — ${reason}${flags.strict ? '' : ' (exit 0: fail-open; pass --strict to fail instead)'}\n`);
  }

  const write = (text) => stdout.write(`${text}\n`);
  if (flags.json) write(JSON.stringify(report, null, 2));
  else if (flags.comment) write(formatCheckComment(report));
  else if (report.status !== 'skipped') write(formatCheck(report));
  return checkExitCode(report, { strict: Boolean(flags.strict) });
}
