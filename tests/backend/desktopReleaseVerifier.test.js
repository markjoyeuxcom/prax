import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertVersionAgreement,
  expectedSidecarName,
  parseReleaseArgs,
  targetTriple,
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
  assert.throws(() => assertVersionAgreement({ ...input, tag: 'v0.20.1' }), /does not match/);
  assert.throws(() => assertVersionAgreement({ ...input, cargoText: 'version = "0.19.0"' }), /version drift/);
  assert.throws(() => assertVersionAgreement({ ...input, tauriConfig: { version: '0.20.0' } }), /resolve its version/);
});

test('desktop release argument and target contracts reject ambiguity', () => {
  assert.deepEqual(parseReleaseArgs(['--tag', 'v0.20.0', '--require-prepared']), {
    tag: 'v0.20.0',
    requirePrepared: true,
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
});
