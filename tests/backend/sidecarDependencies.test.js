import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pruneSidecarDependencies, foreignRuntimeDependencies } from '../../scripts/sidecar-dependencies.mjs';

for (const arch of ['x64', 'arm64']) test('staging preserves Linux ' + arch + ' binaries and runtime files', () => {
  const foreignArch = arch === 'x64' ? 'arm64' : 'x64';
  const root = mkdtempSync(join(tmpdir(), 'prax prebuilds '));
  const excluded = [
    'bare-fs/prebuilds/android-ia32/addon.bare',
    `bare-fs/prebuilds/linux-${foreignArch}/addon.bare`,
    '@scope/addon/node_modules/nested/prebuilds/darwin-arm64/addon.node',
    '@fastify/send/test/fixtures/snow ☃',
  ];
  const retained = [
    `bare-fs/prebuilds/linux-${arch}/addon.bare`,
    '@scope/addon/node_modules/nested/prebuilds/linux-x64+arm64/addon.node',
    'bare-fs/prebuilds/README.md',
    'bare-fs/index.js',
    'ordinary/android-ia32/data.json',
    '@fastify/send/index.js',
  ];
  try {
    for (const file of [...excluded, ...retained]) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), file);
    }
    assert.equal(pruneSidecarDependencies(root, { platform: 'linux', arch }), 4);
    for (const file of excluded) assert.equal(existsSync(join(root, file)), false, file);
    for (const file of retained) assert.equal(readFileSync(join(root, file), 'utf8'), file);
    assert.equal(pruneSidecarDependencies(root, { platform: 'linux', arch }), 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// A Homebrew Node built the macOS package once: the sidecar is a verbatim copy
// of the build machine's `node`, so the .dmg shipped a binary that aborted with
// `dyld: Library not loaded: @rpath/libnode.137.dylib` on every Mac but the
// builder's. Only the packaged-runtime smoke caught it, and only because it
// runs the binary. prepare-sidecar refuses such a runtime at staging now.
test('a sidecar runtime may depend on macOS itself and nothing else', () => {
  const official = `/tmp/node:
	/usr/lib/libc++.1.dylib (compatibility version 1.0.0, current version 1800.101.0)
	/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1351.0.0)
	/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation (compatibility version 150.0.0, current version 3038.1.255)
`;
  assert.deepEqual(foreignRuntimeDependencies(official), []);

  const homebrew = `/tmp/node:
	@rpath/libnode.137.dylib (compatibility version 0.0.0, current version 0.0.0)
	/usr/lib/libz.1.dylib (compatibility version 1.0.0, current version 1.2.12)
	/opt/homebrew/opt/icu4c@78/lib/libicuuc.78.dylib (compatibility version 78.0.0, current version 78.1.0)
`;
  assert.deepEqual(foreignRuntimeDependencies(homebrew), [
    '@rpath/libnode.137.dylib',
    '/opt/homebrew/opt/icu4c@78/lib/libicuuc.78.dylib',
  ]);

  // The inspected file's own path is a heading, not a dependency, even when it
  // lives somewhere that would otherwise be rejected.
  assert.deepEqual(foreignRuntimeDependencies('/opt/homebrew/bin/node:\n\t/usr/lib/libSystem.B.dylib (x)\n'), []);
});
