import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cutChangelog, mergeSubsections, parseArgs } from '../../scripts/prepare-release.mjs';
import { changelogSection, packageCoverage, parseTag, releaseNotes } from '../../scripts/release-notes.mjs';
import { RELEASE_SITES, assertReleaseSitesAgree, IMAGE } from '../../scripts/release-sites.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const SAMPLE = `# Changelog

## [Unreleased]

### Fixed

- One fix.

### Added

- One addition.

### Fixed

- A second fix under a duplicate heading.

## [0.20.0] - 2026-06-11

### Added

- Older.

[Unreleased]: https://github.com/old/name/compare/v0.20.0...HEAD
[0.20.0]: https://github.com/old/name/compare/v0.19.2...v0.20.0
`;

test('cutChangelog renames Unreleased, merges duplicate headings in Keep a Changelog order, and rewires the links', () => {
  const out = cutChangelog(SAMPLE, '0.21.0', '2026-09-06', { repo: 'https://gitlab.com/markjoyeuxcom/apps/prax' });
  assert.match(out, /^## \[Unreleased\]\n\n## \[0\.21\.0\] - 2026-09-06\n\n### Added\n\n- One addition\.\n\n### Fixed\n\n- One fix\.\n\n- A second fix under a duplicate heading\.\n\n## \[0\.20\.0\] - 2026-06-11/m);
  assert.equal((out.match(/^### Fixed$/gm) || []).length, 1, 'the two Fixed headings merged into one');
  assert.match(out, /^\[Unreleased\]: https:\/\/gitlab\.com\/markjoyeuxcom\/apps\/prax\/-\/compare\/v0\.21\.0\.\.\.HEAD$/m);
  assert.match(out, /^\[0\.21\.0\]: https:\/\/gitlab\.com\/markjoyeuxcom\/apps\/prax\/-\/compare\/v0\.20\.0\.\.\.v0\.21\.0$/m);
  assert.match(out, /^\[0\.20\.0\]: https:\/\/github\.com\/old\/name\/compare\/v0\.19\.2\.\.\.v0\.20\.0$/m, 'older links are left alone');
});

test('cutChangelog refuses an empty Unreleased section and a missing heading', () => {
  assert.throws(() => cutChangelog('# C\n\n## [Unreleased]\n\n## [0.1.0] - 2026-01-01\n\n### Added\n\n- x\n', '0.2.0', '2026-01-02'), /no entries/);
  assert.throws(() => cutChangelog('# C\n\n## [0.1.0] - 2026-01-01\n', '0.2.0', '2026-01-02'), /no "## \[Unreleased\]"/);
});

test('mergeSubsections keeps unknown headings after the standard ones and rejects stray entries', () => {
  const merged = mergeSubsections('### Notes\n\n- n\n\n### Removed\n\n- r\n\n### Added\n\n- a\n');
  assert.equal(merged, '### Added\n\n- a\n\n### Removed\n\n- r\n\n### Notes\n\n- n');
  assert.throws(() => mergeSubsections('- stray\n### Added\n- a'), /outside any ### subsection/);
});

test('parseArgs accepts a plain version and refuses prerelease versions and bad dates', () => {
  assert.deepEqual(parseArgs(['0.21.0', '--date', '2026-09-06']), { version: '0.21.0', date: '2026-09-06', dryRun: false });
  assert.deepEqual(parseArgs(['v0.21.0', '--dry-run']), { version: '0.21.0', date: null, dryRun: true });
  assert.throws(() => parseArgs(['0.21.0-rc.1']), /release candidate is a git tag/);
  assert.throws(() => parseArgs(['0.21.0', '--date', 'today']), /YYYY-MM-DD/);
  assert.throws(() => parseArgs([]), /Usage/);
});

test('release notes name the container tag, state that installers are unsigned, and embed the changelog section', () => {
  const changelog = cutChangelog(SAMPLE, '0.21.0', '2026-09-06');
  const notes = releaseNotes({ changelog, tag: 'v0.21.0-rc.1', image: 'registry.gitlab.com/markjoyeuxcom/apps/prax' });
  assert.match(notes, /^This is a release candidate \(`rc\.1`\) for 0\.21\.0/);
  assert.match(notes, /registry\.gitlab\.com\/markjoyeuxcom\/apps\/prax:v0\.21\.0-rc\.1/);
  assert.match(notes, /\*\*All installers are unsigned and not notarized\*\*/);
  assert.match(notes, /## Changes in 0\.21\.0\n\n### Added\n\n- One addition\./);
  assert.doesNotMatch(notes, /Older\./, 'only the tagged version\'s section is included');
  assert.doesNotMatch(releaseNotes({ changelog, tag: 'v0.21.0' }), /release candidate/);
  assert.throws(() => releaseNotes({ changelog, tag: 'v0.22.0' }), /no "## \[0\.22\.0\]" section/);
  assert.throws(() => parseTag('0.21.0'), /Tag must be/);
  assert.equal(changelogSection(changelog, '0.20.0'), '### Added\n\n- Older.');
});

test('every release site reads the checked-in version and can be rewritten to a new one', () => {
  const current = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  for (const site of RELEASE_SITES) {
    const text = readFileSync(join(root, site.file), 'utf8');
    assert.equal(site.read(text), current, `${site.file} reads the current version`);
    const bumped = site.write(text, '9.9.9');
    assert.equal(site.read(bumped), '9.9.9', `${site.file} rewrites to the new version`);
    assert.notEqual(bumped, text);
  }
  assert.equal(assertReleaseSitesAgree(current, { root }), current);
});

test('assertReleaseSitesAgree names every drifted site', () => {
  const texts = new Map(RELEASE_SITES.map((site) => [site.file, readFileSync(join(root, site.file), 'utf8')]));
  const drifted = RELEASE_SITES.find((site) => site.file === 'compose.image.yaml');
  texts.set('compose.image.yaml', drifted.write(texts.get('compose.image.yaml'), '0.0.1'));
  const current = JSON.parse(texts.get('package.json')).version;
  assert.throws(
    () => assertReleaseSitesAgree(current, { read: (file) => texts.get(file) }),
    (error) => error.message.includes('compose.image.yaml: published image tag is 0.0.1') && !error.message.includes('package.json'),
  );
  assert.equal(IMAGE, 'registry.gitlab.com/markjoyeuxcom/apps/prax');
});

test('the current changelog section, which becomes the release body, carries no GitHub-era commands', () => {
  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const notes = releaseNotes({ changelog, tag: `v${version}` });
  const staleClaims = ['allowed to fail on tags', 'by hand and attached', 'Linux x64 or ARM64', 'built on an ARM64 Linux machine'];
  for (const stale of ['gh api', 'gh auth', 'ghcr.io', 'marketplace add markjoyeuxcom/prax', 'GitHub release body', 'github.com/markjoyeuxcom', ...staleClaims]) {
    assert.doesNotMatch(notes, new RegExp(stale.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `release body must not tell readers to use "${stale}"`);
  }
  // The pipeline publishes no image, so the body must not promise one.
  assert.doesNotMatch(notes, /## Container|registry\.gitlab\.com/);
});

test('release notes carry a container section only when an image is named explicitly', () => {
  const changelog = cutChangelog(SAMPLE, '0.21.0', '2026-09-06');
  const without = releaseNotes({ changelog, tag: 'v0.21.0' });
  assert.doesNotMatch(without, /## Container/);
  const withImage = releaseNotes({ changelog, tag: 'v0.21.0', image: 'example.test/prax' });
  assert.match(withImage, /## Container\n\n```text\nexample\.test\/prax:v0\.21\.0\n```/);
  const rc = releaseNotes({ changelog, tag: 'v0.21.0-rc.1' });
  assert.match(rc, /release candidate \(`rc\.1`\) for 0\.21\.0, not the final 0\.21\.0 release\. GitLab lists it like any other release\./, 'without an image the rc note says nothing about a latest tag');
  // release-cli sets no prerelease flag, so the notes must not claim one.
  assert.doesNotMatch(rc, /published as a prerelease/);
});

test('release notes list exactly the packages the pipeline attached and name every platform it could not build', () => {
  const changelog = cutChangelog(SAMPLE, '0.21.0', '2026-09-06');
  const assets = ['Prax_0.21.0_amd64.AppImage', 'Prax_0.21.0_amd64.deb', 'SHA256SUMS'];
  const notes = releaseNotes({ changelog, tag: 'v0.21.0-rc.3', assets });
  assert.match(notes, /## Packages attached by the pipeline\n\n- \*\*macOS Apple Silicon\*\*: not built by this pipeline; it is built and smoke-tested on a Mac/);
  assert.match(notes, /- \*\*Linux x64\*\*: `Prax_0\.21\.0_amd64\.AppImage`, `Prax_0\.21\.0_amd64\.deb`/);
  assert.doesNotMatch(notes, /Linux ARM64/, 'Linux ARM64 is no longer a supported package');
  assert.match(notes, /`SHA256SUMS` covers every file the pipeline attached/);
  const full = releaseNotes({ changelog, tag: 'v0.21.0', assets: [...assets, 'Prax_0.21.0_aarch64.dmg', 'Prax-macos-arm64.app.tar.gz'] });
  assert.doesNotMatch(full, /not built by this pipeline/);
  assert.match(full, /- \*\*macOS Apple Silicon\*\*: `Prax_0\.21\.0_aarch64\.dmg`, `Prax-macos-arm64\.app\.tar\.gz`/, 'every attached macOS file is named');
  assert.match(releaseNotes({ changelog, tag: 'v0.21.0', assets: [...assets, 'Prax_0.21.0_aarch64.dmg'] }), /\*\*macOS Apple Silicon\*\*: not built by this pipeline/, 'a dmg without its app tarball is not a complete macOS build');
  assert.equal(packageCoverage(assets).filter((p) => p.complete).map((p) => p.name).join(), 'Linux x64');
  assert.doesNotMatch(releaseNotes({ changelog, tag: 'v0.21.0' }), /## Packages attached/, 'no assets list without an assets directory');
});
