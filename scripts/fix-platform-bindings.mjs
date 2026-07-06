// This working tree is shared between macOS and a Linux VM (OrbStack), but
// npm installs native binding packages only for the platform that ran the
// install — so `@tauri-apps/cli` and `esbuild` break on whichever OS didn't
// install last (npm/cli#4828 makes it flakier still).
//
// This script installs the binding packages for BOTH platforms, additively
// and --no-save (package.json/lockfile untouched). Run it after any
// `npm install`/`npm ci` when the other OS complains about a missing
// native binding:
//
//   npm run fix:bindings

import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const tauriVersion = require('@tauri-apps/cli/package.json').version;
const esbuildVersion = require('esbuild/package.json').version;

// The two platforms this repo is developed on. Extend if a new machine joins.
const bindings = [
  `@tauri-apps/cli-darwin-arm64@${tauriVersion}`,
  `@tauri-apps/cli-linux-arm64-gnu@${tauriVersion}`,
  `@esbuild/darwin-arm64@${esbuildVersion}`,
  `@esbuild/linux-arm64@${esbuildVersion}`,
];

// --force lets npm install the foreign-platform packages (EBADPLATFORM is the
// point); --no-save keeps the manifests clean.
const cmd = `npm install --no-save --force --ignore-scripts --no-audit --no-fund ${bindings.join(' ')}`;
console.log(`[fix-platform-bindings] ${cmd}`);
execSync(cmd, { stdio: 'inherit' });

for (const pkg of bindings) {
  const name = pkg.slice(0, pkg.lastIndexOf('@'));
  try {
    require.resolve(`${name}/package.json`);
    console.log(`[fix-platform-bindings] ok: ${name}`);
  } catch {
    console.warn(`[fix-platform-bindings] MISSING after install: ${name}`);
    process.exitCode = 1;
  }
}
