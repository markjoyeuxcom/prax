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
