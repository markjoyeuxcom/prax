import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cutChangelog, mergeSubsections, parseArgs } from '../../scripts/prepare-release.mjs';
import { changelogSection, parseTag, releaseNotes } from '../../scripts/release-notes.mjs';
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
  const out = cutChangelog(SAMPLE, '0.21.0', '2026-09-06', { repo: 'https://github.com/markjoyeuxcom/prax' });
  assert.match(out, /^## \[Unreleased\]\n\n## \[0\.21\.0\] - 2026-09-06\n\n### Added\n\n- One addition\.\n\n### Fixed\n\n- One fix\.\n\n- A second fix under a duplicate heading\.\n\n## \[0\.20\.0\] - 2026-06-11/m);
  assert.equal((out.match(/^### Fixed$/gm) || []).length, 1, 'the two Fixed headings merged into one');
  assert.match(out, /^\[Unreleased\]: https:\/\/github\.com\/markjoyeuxcom\/prax\/compare\/v0\.21\.0\.\.\.HEAD$/m);
  assert.match(out, /^\[0\.21\.0\]: https:\/\/github\.com\/markjoyeuxcom\/prax\/compare\/v0\.20\.0\.\.\.v0\.21\.0$/m);
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
  const notes = releaseNotes({ changelog, tag: 'v0.21.0-rc.1', image: 'ghcr.io/markjoyeuxcom/prax' });
  assert.match(notes, /^This is a release candidate \(`rc\.1`\) for 0\.21\.0/);
  assert.match(notes, /ghcr\.io\/markjoyeuxcom\/prax:v0\.21\.0-rc\.1/);
  assert.match(notes, /\*\*They are unsigned and not notarized\*\*/);
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
  assert.equal(IMAGE, 'ghcr.io/markjoyeuxcom/prax');
});
