import { readFileSync } from 'node:fs';
import { dirname, basename, sep } from 'node:path';

function inDir(dir, name) {
  return `${dir}${dir.endsWith(sep) ? '' : sep}${name}`;
}

// Whether `dir` is the top of a repository or worktree: a `.git` directory
// with a config, or a `.git` pointer file (`gitdir: …`) — the boundary
// detectRepoUrl stops at.
function isRepoRoot(dir, readFile) {
  const gitPath = inDir(dir, '.git');
  try {
    readFile(`${gitPath}${sep}config`);
    return true;
  } catch {
    // not a .git directory with a config — try the pointer-file form
  }
  try {
    return /^gitdir:/m.test(String(readFile(gitPath)));
  } catch {
    return false;
  }
}

// Pure resolver: precedence flag > env > .prax/project.json (walking up,
// with the pre-rename .moomora/project.json still honoured as a fallback) >
// folder name > none. `readFile` is injected for testability (defaults to
// synchronous fs read).
//
// A marker speaks for the repository it sits in. Inside a repository, a
// marker found ABOVE its root (a parent workspace folder, $HOME) comes back
// as source 'outer-file', which the caller ranks below a registered
// git-remote match: a folder of checkouts must not pull a registered
// repository into the wrong project. The folder guess is the repository
// root's name, never a subfolder's — running from repo/docs must not name
// (and so create) a project called "docs".
export function detectProject({ flag, env, cwd = process.cwd(), readFile = (p) => readFileSync(p, 'utf8') } = {}) {
  if (flag && String(flag).trim()) return { project: String(flag).trim(), source: 'flag' };
  if (env && String(env).trim()) return { project: String(env).trim(), source: 'env' };

  let dir = cwd;
  let repoRoot = null;
  while (true) {
    for (const marker of ['.prax', '.moomora']) {
      const candidate = inDir(dir, `${marker}${sep}project.json`);
      try {
        const parsed = JSON.parse(readFile(candidate));
        if (parsed && typeof parsed.project === 'string' && parsed.project.trim()) {
          return { project: parsed.project.trim(), source: repoRoot ? 'outer-file' : 'file' };
        }
      } catch {
        // not found / not readable / malformed — try the next marker / keep walking up
      }
    }
    if (!repoRoot && isRepoRoot(dir, readFile)) repoRoot = dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const folder = basename(repoRoot || cwd);
  if (folder && folder !== sep && folder !== '') return { project: folder, source: 'folder' };
  return { project: null, source: 'none' };
}

// Find the `origin` remote URL of the repository containing cwd — pure fs (no
// git binary): walk up looking for `.git`, read its config, and parse the
// `[remote "origin"] url` line. Handles the worktree/submodule case where
// `.git` is a FILE containing `gitdir: <path>`. Returns the RAW url
// (normalization happens at match time) or null. readFile is injected like
// detectProject's, so tests need no real repo.
//
// The first `.git` found is the REPO BOUNDARY, exactly as git treats it: a
// repository with no `origin` ends the search with null — it must NOT inherit
// the origin of an enclosing repository (a fresh `git init` under a
// dotfiles-managed $HOME would otherwise resolve to the dotfiles project).
export function detectRepoUrl({ cwd = process.cwd(), readFile = (p) => readFileSync(p, 'utf8') } = {}) {
  let dir = cwd;
  while (true) {
    const gitPath = `${dir}${dir.endsWith(sep) ? '' : sep}.git`;
    // `.git` directory: its config is this repo's config — boundary reached,
    // origin or not.
    try {
      return parseOriginUrl(readFile(`${gitPath}${sep}config`));
    } catch {
      // not a .git dir with a config — try the pointer-file form
    }
    try {
      const pointer = String(readFile(gitPath)).match(/^gitdir:\s*(.+?)\s*$/m);
      if (pointer) {
        // Pointer paths use forward slashes even on Windows — work
        // slash-agnostic (node's fs accepts '/' everywhere).
        let gitdir = pointer[1].replace(/\\/g, '/');
        const absolute = /^([a-zA-Z]:)?\//.test(gitdir);
        if (!absolute) gitdir = `${dir}/${gitdir}`;
        // Submodules (`.git/modules/<sub>`, including inside linked worktrees)
        // carry their OWN config at the gitdir; plain linked worktrees do not
        // (verified: worktrees/<wt>/ has HEAD/commondir/index but no config) —
        // theirs is the shared config in the `.git` above `worktrees/`.
        try {
          return parseOriginUrl(readFile(`${gitdir}/config`));
        } catch {
          // no per-gitdir config — the linked-worktree case
        }
        const marker = '/.git/worktrees/';
        const idx = gitdir.lastIndexOf(marker);
        if (idx !== -1) {
          try {
            return parseOriginUrl(readFile(`${gitdir.slice(0, idx + '/.git'.length)}/config`));
          } catch {
            // unreadable shared config
          }
        }
        return null; // a gitdir pointer is a repo boundary even when unresolvable
      }
    } catch {
      // .git isn't a readable file either — keep walking up
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// Minimal INI scan of a git config: the first `url = …` inside [remote "origin"].
function parseOriginUrl(configText) {
  let inOrigin = false;
  for (const line of String(configText).split('\n')) {
    const section = line.match(/^\s*\[(.+?)\]\s*$/);
    if (section) {
      inOrigin = /^remote\s+"origin"$/.test(section[1].trim());
      continue;
    }
    if (!inOrigin) continue;
    const url = line.match(/^\s*url\s*=\s*(.+?)\s*$/);
    if (url) return url[1];
  }
  return null;
}
