import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('tagged release waits for quality, container, and every smoke-tested desktop package', () => {
  const release = readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8');

  assert.match(release, /quality:\n[\s\S]*?npm run check[\s\S]*?npm test/);
  assert.match(release, /desktop:\n[\s\S]*?npm run desktop:verify -- --tag/);
  assert.match(release, /desktop:\n[\s\S]*?npm run desktop:smoke/);
  assert.match(release, /if-no-files-found: error/);
  assert.match(release, /container:\n[\s\S]*?needs: \[resolve, quality, desktop\]/);
  assert.match(release, /publish:\n[\s\S]*?needs: \[resolve, quality, container, desktop\]/);
  assert.match(release, /reject filename collisions[\s\S]*?source_count[\s\S]*?release_count/);
  assert.match(release, /sha256sum > SHA256SUMS/);
  assert.match(release, /softprops\/action-gh-release@v3/);
  assert.match(release, /files: release-files\/\*/);
});

test('desktop verification workflow executes the same runtime smoke outside releases', () => {
  const desktop = readFileSync(new URL('../../.github/workflows/desktop.yml', import.meta.url), 'utf8');

  assert.doesNotMatch(desktop, /tags:\s*\['v\*'\]/);
  assert.match(desktop, /pull_request:/);
  assert.match(desktop, /cargo test --manifest-path src-tauri\/Cargo.toml/);
  assert.match(desktop, /npm run desktop:verify/);
  assert.match(desktop, /npm run desktop:smoke/);
  assert.match(desktop, /if-no-files-found: error/);
});

test('Linux ARM64 builds native installers in both workflows with a distinct artifact', () => {
  for (const file of ['desktop.yml', 'release.yml']) {
    const workflow = readFileSync(new URL('../../.github/workflows/' + file, import.meta.url), 'utf8');
    const entries = workflow.match(/^          - name:.*(?:\n(?!          - name:|    runs-on:|    name:)[^\n]*)*/gm) || [];
    const arm = entries.find(entry => entry.startsWith('          - name: Linux ARM64\n'));
    assert.ok(arm, file + ' must build Linux ARM64');
    assert.match(arm, /platform: ubuntu-24\.04-arm/);
    assert.match(arm, /artifact: prax-linux-arm64/);
    assert.match(arm, /args: --bundles deb,appimage/);
    assert.match(arm, /bundle\/deb\/\*\.deb/);
    assert.match(arm, /bundle\/appimage\/\*\.AppImage/);
    const artifacts = entries.map(entry => entry.match(/artifact: (\S+)/)?.[1]);
    assert.equal(new Set(artifacts).size, entries.length, file + ' must not overwrite another platform artifact');
    assert.equal(entries.length, 3, file + ' builds Apple Silicon, Linux x64 and Linux ARM64');
  }
});
