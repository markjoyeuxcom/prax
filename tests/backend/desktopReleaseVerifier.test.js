import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  PAYLOAD_SOURCES,
  assertVersionAgreement,
  expectedSidecarName,
  parseReleaseArgs,
  targetTriple,
  verifyBuiltPayloads,
  verifyDesktopRelease,
} from '../../scripts/verify-desktop-release.mjs';

test('desktop release versions are one source of truth and tags are exact', () => {
  const input = {
    packageVersion: '0.20.0',
    cargoText: '[package]\nversion = "0.20.0"\n',
    tauriConfig: { version: '../package.json' },
    tag: 'v0.20.0',
  };
  assert.equal(assertVersionAgreement(input), '0.20.0');
  assert.equal(assertVersionAgreement({ ...input, tag: 'v0.20.0-rc.1' }), '0.20.0', 'a release candidate tag carries the same version');
  assert.throws(() => assertVersionAgreement({ ...input, tag: 'v0.20.1' }), /does not match/);
  assert.throws(() => assertVersionAgreement({ ...input, tag: 'v0.20.01' }), /does not match/);
  assert.throws(() => assertVersionAgreement({ ...input, cargoText: 'version = "0.19.0"' }), /version drift/);
  assert.throws(() => assertVersionAgreement({ ...input, tauriConfig: { version: '0.20.0' } }), /resolve its version/);
});

test('desktop release argument and target contracts reject ambiguity', () => {
  assert.deepEqual(parseReleaseArgs(['--tag', 'v0.20.0', '--require-prepared']), {
    tag: 'v0.20.0',
    requirePrepared: true,
    requireBuilt: false,
  });
  assert.throws(() => parseReleaseArgs(['--tag']), /requires/);
  assert.throws(() => parseReleaseArgs(['--mystery']), /Unknown/);
  assert.equal(targetTriple('linux', 'x64'), 'x86_64-unknown-linux-gnu');
  assert.equal(targetTriple('linux', 'arm64'), 'aarch64-unknown-linux-gnu');
  assert.equal(expectedSidecarName('linux', 'arm64'), 'prax-server-aarch64-unknown-linux-gnu');
  assert.equal(expectedSidecarName('win32', 'x64'), 'prax-server-x86_64-pc-windows-msvc.exe');
  assert.throws(() => targetTriple('freebsd', 'x64'), /No supported desktop target/);
});

test('checked-in desktop release inputs agree before payload staging', () => {
  const result = verifyDesktopRelease();
  assert.match(result.version, /^\d+\.\d+\.\d+/);
  assert.equal(result.prepared, false);
  assert.equal(result.built, null);
});

// A fake checkout and a fake `tauri build` output: target/release holds the
// binary, its sidecar and resources/app; bundles hold their own copies.
function builtFixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'prax-built-payload-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const source = join(base, 'source');
  const packageJson = { version: '1.2.3', engines: { node: '>=24' }, dependencies: { fastify: '^5', '@fastify/static': '^10' } };
  const files = {
    'server/index.js': 'server', 'server/desktopLifecycle.js': 'lifecycle', 'server/cliEntrypoint.js': 'cli entry',
    'server/workspaceBackup.js': 'backup', 'server/migrations/0001_init.sql': 'create table a(x);',
    'scripts/restore-database.js': 'restore', 'scripts/backup-database.js': 'backup cli',
    'public/index.html': '<!doctype html>', 'public/starter-content/workspace-restore.md': '# Restore',
    'cli/prax.js': 'cli', 'mcp/server.js': 'mcp', 'skills/install.sh': '#!/bin/sh',
    'skills/prax-recall/SKILL.md': 'recall', 'skills/prax-remember/SKILL.md': 'remember',
    'package.json': JSON.stringify(packageJson),
  };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(source, path)), { recursive: true });
    writeFileSync(join(source, path), content);
  }
  const stage = (app) => {
    for (const directory of PAYLOAD_SOURCES.directories) cpSync(join(source, directory), join(app, directory), { recursive: true });
    for (const file of PAYLOAD_SOURCES.files) {
      mkdirSync(dirname(join(app, file)), { recursive: true });
      cpSync(join(source, file), join(app, file));
    }
    for (const dependency of Object.keys(packageJson.dependencies)) {
      mkdirSync(join(app, 'node_modules', ...dependency.split('/')), { recursive: true });
      writeFileSync(join(app, 'node_modules', ...dependency.split('/'), 'package.json'), '{}');
    }
  };
  const tauriDir = join(base, 'src-tauri');
  const release = join(tauriDir, 'target', 'release');
  stage(join(release, 'resources', 'app'));
  writeFileSync(join(release, 'prax'), 'binary');
  writeFileSync(join(release, 'prax-server'), 'node');
  const verify = (options = {}) => verifyBuiltPayloads({
    tauriDir, sourceRoot: source, packageJson, platform: 'darwin', readVersion: () => 'v24.21.0', ...options,
  });
  return { release, stage, verify };
}

test('desktop:verify checks the payload tauri build produced, against the current source', (t) => {
  assert.deepEqual(parseReleaseArgs(['--require-built']), { tag: null, requirePrepared: false, requireBuilt: true });
  const fixture = builtFixture(t);
  const [payload] = fixture.verify();
  assert.equal(payload.label, 'release build payload');
  assert.equal(payload.runtime, 'v24.21.0');
  assert.ok(payload.files >= 15);

  // What `tauri build` bundled is what counts, not src-tauri/resources/app.
  const app = join(fixture.release, 'resources', 'app');
  writeFileSync(join(app, 'server', 'index.js'), 'stale build');
  assert.throws(() => fixture.verify(), /release build payload is not the current source .*differs from source: server\/index\.js/);
  writeFileSync(join(app, 'server', 'index.js'), 'server');
  writeFileSync(join(app, 'server', 'leftover.js'), 'old');
  assert.throws(() => fixture.verify(), /not in source: server\/leftover\.js/);
  rmSync(join(app, 'server', 'leftover.js'));
  rmSync(join(app, 'server', 'migrations', '0001_init.sql'));
  assert.throws(() => fixture.verify(), /missing server\/migrations\/0001_init\.sql/);
});

test('desktop:verify checks every bundle the build made, with its own sidecar', (t) => {
  const fixture = builtFixture(t);
  const mac = join(fixture.release, 'bundle', 'macos', 'Prax.app', 'Contents');
  fixture.stage(join(mac, 'Resources', 'resources', 'app'));
  mkdirSync(join(mac, 'MacOS'), { recursive: true });
  writeFileSync(join(mac, 'MacOS', 'prax-server'), 'node');
  const deb = join(fixture.release, 'bundle', 'deb', 'Prax_1.2.3_amd64', 'data', 'usr');
  fixture.stage(join(deb, 'lib', 'Prax', 'resources', 'app'));
  mkdirSync(join(deb, 'bin'), { recursive: true });
  writeFileSync(join(deb, 'bin', 'prax-server'), 'node');
  const labels = fixture.verify().map((payload) => payload.label).sort();
  assert.deepEqual(labels, ['deb bundle payload (Prax_1.2.3_amd64)', 'macos bundle payload (Prax.app)', 'release build payload']);

  writeFileSync(join(mac, 'Resources', 'resources', 'app', 'mcp', 'server.js'), 'stale');
  assert.throws(() => fixture.verify(), /macos bundle payload \(Prax\.app\) is not the current source/);
  writeFileSync(join(mac, 'Resources', 'resources', 'app', 'mcp', 'server.js'), 'mcp');
  rmSync(join(deb, 'bin', 'prax-server'));
  assert.throws(() => fixture.verify(), /Missing sidecar runtime for the deb bundle payload/);
});

test('desktop:verify refuses a missing build, a wrong runtime and leaked development packages', (t) => {
  const fixture = builtFixture(t);
  assert.throws(() => fixture.verify({ readVersion: () => 'v22.1.0' }), /runs Node v22\.1\.0; Prax needs >=24/);
  assert.throws(() => fixture.verify({ expectedRuntime: 'v24.9.0' }), /sidecar is Node v24\.21\.0, but the staged runtime is v24\.9\.0/);
  mkdirSync(join(fixture.release, 'resources', 'app', 'node_modules', 'esbuild'), { recursive: true });
  assert.throws(() => fixture.verify(), /Development-only package leaked into the release build payload: esbuild/);
  rmSync(join(fixture.release, 'prax'));
  assert.throws(() => fixture.verify(), /Missing release desktop binary \(run npm run desktop:build first\)/);
});
