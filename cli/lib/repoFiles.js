// Working-tree access for code citations. Separated from codeRefs.js so that
// module stays pure and testable; everything here touches the filesystem or git.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, sep } from 'node:path';
import { detectRepoUrl } from './detectProject.js';

// The repository root for the current directory, or null outside a checkout.
// Citations are stored repository-relative so they resolve in ANY clone, not
// just the one that wrote them.
export function repoRoot(cwd = process.cwd()) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null;
  } catch {
    return null;
  }
}

export function headSha(cwd = process.cwd()) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null;
  } catch {
    return null;
  }
}

// A reader bound to one repository root, or null when there is no checkout here
// — recall treats a missing reader as "cannot say", never as "nothing wrong".
// Paths that escape the root read as absent rather than reaching outside it.
export function createRepoReader(root = repoRoot()) {
  if (!root) return null;
  const base = resolve(root);
  return function readRepoFile(path) {
    const full = resolve(base, path);
    if (full !== base && !full.startsWith(base + sep)) return null;
    try {
      return readFileSync(full, 'utf8');
    } catch {
      return null;
    }
  };
}

// Whether a commit object exists in the repository at `root`. A citation's
// commitSha is where it was pinned; finding it here means this checkout
// shares that history (the same repository, a clone or a worktree of it).
export function hasCommit(sha, root = repoRoot()) {
  if (!root || !/^[0-9a-f]{7,64}$/i.test(String(sha || ''))) return false;
  try {
    execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], {
      cwd: root, stdio: ['ignore', 'ignore', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

// The checkout recall checks citations against: a reader bound to the
// repository root plus what identifies the repository (its origin URL and a
// commit lookup), so a citation from another repository is reported as not
// checked instead of as gone or changed. Null outside a checkout.
export function createCheckout(root = repoRoot()) {
  if (!root) return null;
  return {
    root,
    readFile: createRepoReader(root),
    repoUrl: detectRepoUrl({ cwd: root }),
    hasCommit: (sha) => hasCommit(sha, root),
  };
}

// ---- prax check: git diff access ---------------------------------------------
// Every call pins the output format, so a user's diff configuration (noprefix,
// external drivers, textconv, quoted paths) cannot change what is parsed.

export class GitError extends Error {}

const GIT_MAX_BUFFER = 512 * 1024 * 1024;

function git(args, root) {
  try {
    return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
      cwd: root, encoding: 'utf8', maxBuffer: GIT_MAX_BUFFER, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const detail = String(err?.stderr || err?.message || '').trim().split('\n')[0];
    throw new GitError(`git ${args[0]} failed${detail ? `: ${detail}` : ''}`);
  }
}

function commitOf(rev, root) {
  if (!rev || rev.startsWith('-')) throw new GitError(`not a revision: "${rev}"`);
  try {
    return git(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], root).trim();
  } catch {
    throw new GitError(`unknown revision "${rev}" (in CI, fetch enough history: GIT_DEPTH 0, or fetch the base commit)`);
  }
}

// `A...B`: the merge base of A and B against B. `A..B`: A against B. `A`: A
// against the working tree (head null). An empty side means HEAD, as in git.
export function resolveDiffRange(range, root = repoRoot()) {
  const spec = String(range ?? '').trim();
  if (!spec) throw new GitError('--diff needs a range such as origin/main...HEAD');
  if (spec.includes('...')) {
    const [a, b] = spec.split('...');
    const head = commitOf(b || 'HEAD', root);
    const left = commitOf(a || 'HEAD', root);
    const base = git(['merge-base', left, head], root).trim();
    if (!base) throw new GitError(`no merge base between "${a || 'HEAD'}" and "${b || 'HEAD'}"`);
    return { base, head };
  }
  if (spec.includes('..')) {
    const [a, b] = spec.split('..');
    return { base: commitOf(a || 'HEAD', root), head: commitOf(b || 'HEAD', root) };
  }
  return { base: commitOf(spec, root), head: null };
}

// The zero-context unified diff between two commits (head null = the working
// tree), with rename detection.
export function gitDiff({ base, head }, root = repoRoot()) {
  return git([
    'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--unified=0', '-M',
    '--src-prefix=a/', '--dst-prefix=b/', base, ...(head ? [head] : []), '--',
  ], root);
}

// A file's text at a commit, or null when it does not exist there.
export function readAtRevision(rev, path, root = repoRoot()) {
  if (!rev || !path) return null;
  try {
    return execFileSync('git', ['cat-file', 'blob', `${rev}:${path}`], {
      cwd: root, encoding: 'utf8', maxBuffer: GIT_MAX_BUFFER, stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}
