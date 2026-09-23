import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertReleaseSitesAgree } from './release-sites.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function targetTriple(platform = process.platform, arch = process.arch) {
  const triple = {
    'darwin/arm64': 'aarch64-apple-darwin',
    'darwin/x64': 'x86_64-apple-darwin',
    'win32/x64': 'x86_64-pc-windows-msvc',
    'win32/arm64': 'aarch64-pc-windows-msvc',
    'linux/x64': 'x86_64-unknown-linux-gnu',
    'linux/arm64': 'aarch64-unknown-linux-gnu',
  }[`${platform}/${arch}`];
  if (!triple) throw new Error(`No supported desktop target for ${platform}/${arch}`);
  return triple;
}

export function expectedSidecarName(platform = process.platform, arch = process.arch) {
  return `prax-server-${targetTriple(platform, arch)}${platform === 'win32' ? '.exe' : ''}`;
}

export function parseReleaseArgs(args) {
  const parsed = { tag: null, requirePrepared: false, requireBuilt: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--tag') parsed.tag = args[++index] || null;
    else if (arg === '--require-prepared') parsed.requirePrepared = true;
    else if (arg === '--require-built') parsed.requireBuilt = true;
    else throw new Error(`Unknown desktop release verification option: ${arg}`);
  }
  if (args.includes('--tag') && !parsed.tag) throw new Error('--tag requires vMAJOR.MINOR.PATCH');
  return parsed;
}

export function assertVersionAgreement({ packageVersion, cargoText, tauriConfig, tag = null }) {
  const cargoVersion = cargoText.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  if (!cargoVersion) throw new Error('Could not read the desktop Cargo package version');
  if (tauriConfig.version !== '../package.json') {
    throw new Error('Tauri must resolve its version from ../package.json');
  }
  if (cargoVersion !== packageVersion) {
    throw new Error(`Desktop version drift: package.json=${packageVersion}, Cargo.toml=${cargoVersion}`);
  }
  // A release candidate is the same version with a prerelease suffix
  // (v0.21.0-rc.1); its release notes say it is a candidate.
  if (tag && tag !== `v${packageVersion}` && !tag.startsWith(`v${packageVersion}-`)) {
    throw new Error(`Release tag ${tag} does not match package version v${packageVersion}`);
  }
  return packageVersion;
}

function requirePath(path, description) {
  if (!existsSync(path)) throw new Error(`Missing ${description}: ${path}`);
}

// What the desktop payload must contain, relative to resources/app.
const PAYLOAD_FILES = [
  ['server/index.js', 'Fastify entry point'],
  ['server/desktopLifecycle.js', 'desktop lifecycle'],
  ['server/cliEntrypoint.js', 'CLI entrypoint handling'],
  ['server/workspaceBackup.js', 'workspace backup endpoint'],
  ['scripts/restore-database.js', 'checksum-guarded restore command'],
  ['scripts/backup-database.js', 'online backup command'],
  ['public/starter-content/workspace-restore.md', 'workspace restore guide'],
  ['public/index.html', 'frontend'],
  ['package.json', 'package manifest'],
  // A dmg-only machine gets its CLI, MCP server and agent skills from the
  // bundle: skills/install.sh installs from here and its --cli/--mcp flags
  // point at these files.
  ['cli/prax.js', 'prax CLI'],
  ['mcp/server.js', 'MCP server'],
  ['skills/install.sh', 'agent-skills installer'],
  ['skills/prax-recall/SKILL.md', 'prax-recall skill'],
  ['skills/prax-remember/SKILL.md', 'prax-remember skill'],
];

// The source prepare-sidecar copies into the payload, verbatim.
export const PAYLOAD_SOURCES = Object.freeze({
  directories: ['server', 'public', 'mcp', 'cli', 'skills'],
  files: ['package.json', 'scripts/restore-database.js', 'scripts/backup-database.js'],
});

function verifyPayloadContents(app, packageJson, label) {
  for (const [relative, description] of PAYLOAD_FILES) requirePath(join(app, relative), `${label} ${description}`);

  const payloadPackage = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'));
  if (payloadPackage.version !== packageJson.version) {
    throw new Error(`${label} version drift: expected ${packageJson.version}, found ${payloadPackage.version}`);
  }
  for (const dependency of Object.keys(packageJson.dependencies || {})) {
    requirePath(join(app, 'node_modules', ...dependency.split('/'), 'package.json'), `${label} production dependency ${dependency}`);
  }
  for (const devOnly of ['@tauri-apps', '@playwright', 'esbuild']) {
    if (existsSync(join(app, 'node_modules', devOnly))) {
      throw new Error(`Development-only package leaked into the ${label}: ${devOnly}`);
    }
  }
}

function listFiles(directory, prefix = '') {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...listFiles(join(directory, entry.name), relative));
    else files.push(relative);
  }
  return files;
}

function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

// The payload a build bundled must be the checkout's current source, file for
// file: prepare-sidecar re-stages it on every build, so anything else means the
// package was assembled from a stale or foreign staging directory.
export function comparePayloadToSource(app, sourceRoot = root, label = 'payload') {
  const problems = [];
  const expected = new Set();
  for (const directory of PAYLOAD_SOURCES.directories) {
    for (const file of listFiles(join(sourceRoot, directory))) expected.add(`${directory}/${file}`);
  }
  for (const file of PAYLOAD_SOURCES.files) expected.add(file);
  for (const file of expected) {
    const bundled = join(app, file);
    if (!existsSync(bundled)) problems.push(`missing ${file}`);
    else if (digest(bundled) !== digest(join(sourceRoot, file))) problems.push(`differs from source: ${file}`);
  }
  for (const directory of PAYLOAD_SOURCES.directories) {
    if (!existsSync(join(app, directory))) continue;
    for (const file of listFiles(join(app, directory))) {
      if (!expected.has(`${directory}/${file}`)) problems.push(`not in source: ${directory}/${file}`);
    }
  }
  if (problems.length) {
    const shown = problems.slice(0, 10).join('; ');
    throw new Error(`The ${label} is not the current source (${problems.length} difference(s): ${shown}${problems.length > 10 ? '; …' : ''}). Rebuild with npm run desktop:build.`);
  }
  return expected.size;
}

function sidecarVersion(path) {
  return execFileSync(path, ['--version'], { encoding: 'utf8', timeout: 30_000 }).trim();
}

function findFile(directory, name, depth = 6) {
  if (depth < 0 || !existsSync(directory)) return null;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isFile() && entry.name === name) return path;
  }
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== 'node_modules') {
      const found = findFile(join(directory, entry.name), name, depth - 1);
      if (found) return found;
    }
  }
  return null;
}

// Every `resources/app` payload a bundle format produced under
// target/release/bundle (macOS Prax.app, the .deb's data tree, an AppDir).
function findBundledPayloads(directory, depth = 7) {
  if (depth < 0 || !existsSync(directory)) return [];
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue;
    const path = join(directory, entry.name);
    if (entry.name === 'app' && basename(directory) === 'resources' && existsSync(join(path, 'server', 'index.js'))) found.push(path);
    else found.push(...findBundledPayloads(path, depth - 1));
  }
  return found;
}

// The payloads `tauri build` actually produced, after its beforeBuildCommand
// re-staged src-tauri/resources/app: the copy beside the release binary (what
// the unbundled binary and desktop:smoke run) and the copy inside every bundle
// it made. Each must carry the current source and a working sidecar runtime.
export function builtPayloads({ tauriDir = join(root, 'src-tauri'), platform = process.platform } = {}) {
  const release = join(tauriDir, 'target', 'release');
  const suffix = platform === 'win32' ? '.exe' : '';
  const payloads = [{
    label: 'release build payload',
    app: join(release, 'resources', 'app'),
    sidecar: join(release, `prax-server${suffix}`),
    binary: join(release, `prax${suffix}`),
  }];
  const bundles = join(release, 'bundle');
  for (const app of findBundledPayloads(bundles)) {
    // The bundle root: bundle/<format>/<name>, e.g. macos/Prax.app.
    const parts = relative(bundles, app).split(sep);
    const bundleRoot = join(bundles, parts[0], parts[1]);
    payloads.push({
      label: `${parts[0]} bundle payload (${parts[1]})`,
      app,
      sidecar: findFile(bundleRoot, `prax-server${suffix}`),
    });
  }
  return payloads;
}

export function verifyBuiltPayloads({ tauriDir = join(root, 'src-tauri'), sourceRoot = root, packageJson, platform = process.platform,
  expectedRuntime = null, readVersion = sidecarVersion } = {}) {
  const payloads = builtPayloads({ tauriDir, platform });
  requirePath(payloads[0].binary, 'release desktop binary (run npm run desktop:build first)');
  if (platform === 'darwin' && existsSync(join(tauriDir, 'target', 'release', 'bundle', 'macos'))
    && !payloads.some((payload) => payload.label.startsWith('macos bundle'))) {
    throw new Error('The macOS bundle directory exists but holds no Prax.app payload');
  }
  const results = [];
  for (const payload of payloads) {
    requirePath(payload.app, payload.label);
    verifyPayloadContents(payload.app, packageJson, payload.label);
    const files = comparePayloadToSource(payload.app, sourceRoot, payload.label);
    if (!payload.sidecar || !existsSync(payload.sidecar)) throw new Error(`Missing sidecar runtime for the ${payload.label}`);
    const runtime = readVersion(payload.sidecar);
    const major = Number(String(runtime).match(/^v(\d+)\./)?.[1]);
    const minimum = Number(String(packageJson.engines?.node || '').match(/\d+/)?.[0]);
    if (!major || (minimum && major < minimum)) {
      throw new Error(`The ${payload.label} sidecar runs Node ${runtime}; Prax needs ${packageJson.engines?.node}`);
    }
    if (expectedRuntime && runtime !== expectedRuntime) {
      throw new Error(`The ${payload.label} sidecar is Node ${runtime}, but the staged runtime is ${expectedRuntime}`);
    }
    results.push({ label: payload.label, files, runtime });
  }
  return results;
}

export function verifyDesktopRelease({ tag = null, requirePrepared = false, requireBuilt = false } = {}) {
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const tauriConfig = JSON.parse(readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  const cargoText = readFileSync(join(root, 'src-tauri', 'Cargo.toml'), 'utf8');
  const version = assertVersionAgreement({
    packageVersion: packageJson.version,
    cargoText,
    tauriConfig,
    tag,
  });
  // Every other place the version is written (plugin manifest, published image
  // references, deploy overlays, docs) must agree too, or the release ships
  // pointing at the previous version somewhere.
  assertReleaseSitesAgree(version, { root });

  const minimumNodeMajor = Number(String(packageJson.engines?.node || '').match(/\d+/)?.[0]);
  if (!minimumNodeMajor || Number(process.versions.node.split('.')[0]) < minimumNodeMajor) {
    throw new Error(`Desktop staging requires ${packageJson.engines?.node}; running ${process.version}`);
  }

  for (const icon of tauriConfig.bundle?.icon || []) {
    requirePath(join(root, 'src-tauri', icon), 'configured desktop icon');
  }
  requirePath(join(root, 'src-tauri', 'splash', 'index.html'), 'bundled recovery page');
  requirePath(join(root, 'src-tauri', 'splash', 'splash.js'), 'bundled recovery behavior');

  const staging = join(root, 'src-tauri', 'resources', 'app');
  const binaries = join(root, 'src-tauri', 'binaries');
  const expectedSidecar = join(binaries, expectedSidecarName());
  // The staged inputs of a build. `tauri build` deletes and re-stages them in
  // its beforeBuildCommand, so this check proves nothing about a package; it
  // is a quick look before building. --require-built checks what shipped.
  if (requirePrepared) {
    verifyPayloadContents(staging, packageJson, 'staged sidecar payload');
    const expected = expectedSidecarName();
    requirePath(expectedSidecar, 'platform sidecar runtime');
    const actual = readdirSync(binaries).filter(name => name.startsWith('prax-server-'));
    if (actual.length !== 1 || actual[0] !== expected) {
      throw new Error(`Sidecar directory must contain only ${expected}; found ${actual.join(', ') || 'none'}`);
    }
  }

  let built = null;
  if (requireBuilt) {
    built = verifyBuiltPayloads({
      packageJson,
      // The runtime prepare-sidecar staged for this build, when still present.
      expectedRuntime: existsSync(expectedSidecar) ? sidecarVersion(expectedSidecar) : null,
    });
  }

  return { version, target: targetTriple(), prepared: requirePrepared, built };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = verifyDesktopRelease(parseReleaseArgs(process.argv.slice(2)));
    console.log(`[desktop-release] verified Prax v${result.version} for ${result.target}${result.prepared ? ' with staged payload' : ''}`);
    for (const payload of result.built || []) {
      console.log(`[desktop-release] built: ${payload.label} carries the current source (${payload.files} files) and Node ${payload.runtime}`);
    }
  } catch (error) {
    console.error(`[desktop-release] ${error.message}`);
    process.exitCode = 1;
  }
}
