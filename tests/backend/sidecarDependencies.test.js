import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pruneSidecarDependencies } from '../../scripts/sidecar-dependencies.mjs';

test('staging removes foreign binaries and development fixtures without losing host or runtime files', () => {
  const root = mkdtempSync(join(tmpdir(), 'prax prebuilds '));
  const excluded = [
    'bare-fs/prebuilds/android-ia32/addon.bare',
    'bare-fs/prebuilds/linux-arm64/addon.bare',
    '@scope/addon/node_modules/nested/prebuilds/darwin-arm64/addon.node',
    '@fastify/send/test/fixtures/snow ☃',
  ];
  const retained = [
    'bare-fs/prebuilds/linux-x64/addon.bare',
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
    assert.equal(pruneSidecarDependencies(root, { platform: 'linux', arch: 'x64' }), 4);
    for (const file of excluded) assert.equal(existsSync(join(root, file)), false, file);
    for (const file of retained) assert.equal(readFileSync(join(root, file), 'utf8'), file);
    assert.equal(pruneSidecarDependencies(root, { platform: 'linux', arch: 'x64' }), 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
