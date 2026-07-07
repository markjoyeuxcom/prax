import { readFileSync } from 'node:fs';
import { dirname, basename, sep } from 'node:path';

// Pure resolver: precedence flag > env > .prax/project.json (walking up,
// with the pre-rename .moomora/project.json still honoured as a fallback) >
// cwd folder name > none. `readFile` is injected for testability (defaults to
// synchronous fs read).
export function detectProject({ flag, env, cwd = process.cwd(), readFile = (p) => readFileSync(p, 'utf8') } = {}) {
  if (flag && String(flag).trim()) return { project: String(flag).trim(), source: 'flag' };
  if (env && String(env).trim()) return { project: String(env).trim(), source: 'env' };

  let dir = cwd;
  while (true) {
    for (const marker of ['.prax', '.moomora']) {
      const candidate = `${dir}${dir.endsWith(sep) ? '' : sep}${marker}${sep}project.json`;
      try {
        const parsed = JSON.parse(readFile(candidate));
        if (parsed && typeof parsed.project === 'string' && parsed.project.trim()) {
          return { project: parsed.project.trim(), source: 'file' };
        }
      } catch {
        // not found / not readable / malformed — try the next marker / keep walking up
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const folder = basename(cwd);
  if (folder && folder !== sep && folder !== '') return { project: folder, source: 'folder' };
  return { project: null, source: 'none' };
}
