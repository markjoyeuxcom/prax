// Working-tree access for code citations. Separated from codeRefs.js so that
// module stays pure and testable; everything here touches the filesystem or git.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, sep } from 'node:path';

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
