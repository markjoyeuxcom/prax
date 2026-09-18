import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const platforms = new Set(['aix', 'android', 'darwin', 'freebsd', 'haiku', 'ios', 'linux', 'openbsd', 'sunos', 'win32']);

// npm packages may carry native prebuilds for every target. Desktop packagers
// inspect those binaries, including unused dependencies for other runtimes.
export function pruneSidecarDependencies(root, { platform = process.platform, arch = process.arch } = {}) {
  let removed = 0;
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue; // Never follow dependency symlinks.
      const path = join(directory, entry.name);
      if (entry.name !== 'prebuilds') { walk(path); continue; }
      for (const target of readdirSync(path, { withFileTypes: true })) {
        if (!target.isDirectory()) continue;
        const [targetPlatform, architectures] = target.name.split('-');
        // Preserve unfamiliar layouts instead of guessing at their meaning.
        if (!platforms.has(targetPlatform) || !architectures) continue;
        const hostArchitecture = architectures === 'universal' || architectures.split('+').includes(arch);
        if (targetPlatform !== platform || !hostArchitecture) {
          rmSync(join(path, target.name), { recursive: true, force: true });
          removed += 1;
        }
      }
    }
  }
  walk(root);
  // @fastify/send ships development fixtures, including a filename outside
  // the MSI code page. Its runtime entry and exports do not use this tree.
  const sendTests = join(root, '@fastify', 'send', 'test');
  if (existsSync(sendTests)) {
    rmSync(sendTests, { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

// macOS ships the sidecar as a verbatim copy of the build machine's Node
// binary, so that binary has to keep working on a Mac that has nothing but
// macOS on it. An official nodejs.org build links only against /usr/lib and
// /System; a Homebrew one links against @rpath/libnode.<abi>.dylib and a dozen
// Cellar dylibs, so a .dmg built with one ships a sidecar that aborts with
// "Library not loaded" everywhere but the build machine. Only the packaged
// runtime smoke notices, and only if it runs — hence the check at staging.
export function foreignRuntimeDependencies(otoolOutput) {
  return otoolOutput
    .split('\n')
    .slice(1) // The first line names the file that was inspected, not a dependency.
    .map(line => line.trim().split(' ')[0])
    .filter(Boolean)
    .filter(path => !path.startsWith('/usr/lib/') && !path.startsWith('/System/'));
}
