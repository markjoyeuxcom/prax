import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
  const parsed = { tag: null, requirePrepared: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--tag') parsed.tag = args[++index] || null;
    else if (arg === '--require-prepared') parsed.requirePrepared = true;
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
  // (v0.21.0-rc.1); the workflow marks it as a prerelease and skips `latest`.
  if (tag && tag !== `v${packageVersion}` && !tag.startsWith(`v${packageVersion}-`)) {
    throw new Error(`Release tag ${tag} does not match package version v${packageVersion}`);
  }
  return packageVersion;
}

function requirePath(path, description) {
  if (!existsSync(path)) throw new Error(`Missing ${description}: ${path}`);
}

export function verifyDesktopRelease({ tag = null, requirePrepared = false } = {}) {
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
  if (requirePrepared) {
    for (const [relative, description] of [
      ['server/index.js', 'staged Fastify entry point'],
      ['server/desktopLifecycle.js', 'staged desktop lifecycle'],
      ['public/index.html', 'staged frontend'],
      ['package.json', 'staged package manifest'],
      // A dmg-only machine gets its CLI, MCP server and agent skills from the
      // bundle: skills/install.sh installs from here and its --cli/--mcp
      // flags point at these files.
      ['cli/prax.js', 'staged prax CLI'],
      ['mcp/server.js', 'staged MCP server'],
      ['skills/install.sh', 'staged agent-skills installer'],
      ['skills/prax-recall/SKILL.md', 'staged prax-recall skill'],
      ['skills/prax-remember/SKILL.md', 'staged prax-remember skill'],
    ]) requirePath(join(staging, relative), description);

    const stagedPackage = JSON.parse(readFileSync(join(staging, 'package.json'), 'utf8'));
    if (stagedPackage.version !== packageJson.version) {
      throw new Error(`Staged sidecar version drift: expected ${packageJson.version}, found ${stagedPackage.version}`);
    }

    for (const dependency of Object.keys(packageJson.dependencies || {})) {
      requirePath(join(staging, 'node_modules', ...dependency.split('/'), 'package.json'), `production dependency ${dependency}`);
    }
    for (const devOnly of ['@tauri-apps', '@playwright', 'esbuild']) {
      if (existsSync(join(staging, 'node_modules', devOnly))) {
        throw new Error(`Development-only package leaked into the sidecar payload: ${devOnly}`);
      }
    }

    const expected = expectedSidecarName();
    requirePath(join(binaries, expected), 'platform sidecar runtime');
    const actual = readdirSync(binaries).filter(name => name.startsWith('prax-server-'));
    if (actual.length !== 1 || actual[0] !== expected) {
      throw new Error(`Sidecar directory must contain only ${expected}; found ${actual.join(', ') || 'none'}`);
    }
  }

  return { version, target: targetTriple(), prepared: requirePrepared };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = verifyDesktopRelease(parseReleaseArgs(process.argv.slice(2)));
    console.log(`[desktop-release] verified Prax v${result.version} for ${result.target}${result.prepared ? ' with staged payload' : ''}`);
  } catch (error) {
    console.error(`[desktop-release] ${error.message}`);
    process.exitCode = 1;
  }
}
