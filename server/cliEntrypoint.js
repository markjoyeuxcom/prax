import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Node canonicalizes the module URL but can retain a symlink in argv[1].
// Compare actual files so CLI commands cannot silently become import-only.
export function isDirectInvocation(moduleUrl, argv = process.argv) {
  if (!argv[1]) return false;
  try { return realpathSync(argv[1]) === realpathSync(fileURLToPath(moduleUrl)); }
  catch { return false; }
}
