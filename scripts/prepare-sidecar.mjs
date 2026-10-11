// Stage the Prax desktop sidecar (docs/desktop/BUILD.md):
//   src-tauri/resources/app/   — the Fastify server, static frontend, MCP
//                                server, CLI, the agent-skills pack (so a
//                                dmg-only machine can run skills/install.sh
//                                without a checkout) and production node_modules
//   src-tauri/binaries/        — the Node runtime, renamed to the Tauri
//                                sidecar convention prax-server-<target-triple>
//
// Runs as Tauri's beforeDevCommand/beforeBuildCommand, and standalone via
// `npm run prepare:sidecar`. The Rust shell spawns
//   prax-server <resources>/app/server/index.js
// so the backend ships as plain files, with Node's built-in node:sqlite.
// Dependencies may include native prebuilds; only this host target is staged.

import { cpSync, chmodSync, copyFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pruneSidecarDependencies, foreignRuntimeDependencies } from './sidecar-dependencies.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const staging = join(root, 'src-tauri', 'resources', 'app');
const binaries = join(root, 'src-tauri', 'binaries');

function targetTriple() {
  const { platform, arch } = process;
  const key = `${platform}/${arch}`;
  const triples = {
    'darwin/arm64': 'aarch64-apple-darwin',
    'darwin/x64': 'x86_64-apple-darwin',
    'win32/x64': 'x86_64-pc-windows-msvc',
    'win32/arm64': 'aarch64-pc-windows-msvc',
    'linux/x64': 'x86_64-unknown-linux-gnu',
    'linux/arm64': 'aarch64-unknown-linux-gnu',
  };
  const triple = triples[key];
  if (!triple) throw new Error(`No sidecar target triple mapped for ${key}`);
  return triple;
}

console.log('[prepare-sidecar] staging server payload…');
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
// Tauri copies resources into target/<profile>/resources on every build but
// never removes a file deleted from the source, so a local build would keep
// shipping it (desktop:verify reports it as "not in source"). Clearing those
// copies makes the build recopy exactly the staged payload.
for (const profile of ['debug', 'release']) {
  rmSync(join(root, 'src-tauri', 'target', profile, 'resources', 'app'), { recursive: true, force: true });
}

for (const dir of ['server', 'public', 'mcp', 'cli', 'skills']) {
  cpSync(join(root, dir), join(staging, dir), { recursive: true });
}
copyFileSync(join(root, 'package.json'), join(staging, 'package.json'));
copyFileSync(join(root, 'package-lock.json'), join(staging, 'package-lock.json'));
mkdirSync(join(staging, 'scripts'), { recursive: true });
for (const file of ['restore-database.js', 'backup-database.js']) {
  copyFileSync(join(root, 'scripts', file), join(staging, 'scripts', file));
}

console.log('[prepare-sidecar] installing production dependencies…');
execSync('npm ci --omit=dev --ignore-scripts --no-audit --no-fund', {
  cwd: staging,
  stdio: 'inherit',
});
rmSync(join(staging, 'package-lock.json'));
const removed = pruneSidecarDependencies(join(staging, 'node_modules'));
console.log(`[prepare-sidecar] removed ${removed} non-runtime dependency directories`);

console.log('[prepare-sidecar] staging the Node runtime as the sidecar binary…');
rmSync(binaries, { recursive: true, force: true });
mkdirSync(binaries, { recursive: true });
const suffix = process.platform === 'win32' ? '.exe' : '';
const sidecar = join(binaries, `prax-server-${targetTriple()}${suffix}`);
copyFileSync(process.execPath, sidecar);
if (process.platform !== 'win32') chmodSync(sidecar, 0o755);

// Copying the Node binary copies its dynamic linkage too. A runtime that needs
// libraries from the build machine (a Homebrew Node wants
// @rpath/libnode.<abi>.dylib and its Cellar dependencies) produces a package
// that aborts on the user's Mac before the server writes a single log line.
if (process.platform === 'darwin') {
  const foreign = foreignRuntimeDependencies(execSync(`otool -L ${JSON.stringify(sidecar)}`, { encoding: 'utf8' }));
  if (foreign.length > 0) {
    throw new Error(
      `The staged Node runtime is not self-contained: ${process.execPath} needs ${foreign.join(', ')}, ` +
        'which a user\'s Mac will not have. Build with an official nodejs.org distribution, not a Homebrew one.',
    );
  }
}

if (!existsSync(join(staging, 'node_modules', 'fastify'))) {
  throw new Error('staging looks incomplete: fastify missing from node_modules');
}
console.log(`[prepare-sidecar] done — payload at ${staging}`);
console.log(`[prepare-sidecar]        sidecar at ${sidecar}`);
