#!/usr/bin/env node
// Cut a release: rename CHANGELOG's [Unreleased] section to the new version,
// merge duplicated subsection headings, start a fresh [Unreleased], and write
// the version into every site listed in scripts/release-sites.mjs. The desktop
// release verifier refuses a tag when any of those sites disagree, so this is
// the only supported way to bump.
//
//   npm run release:prepare -- 0.21.0 [--date 2026-09-06] [--dry-run]
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RELEASE_SITES, assertReleaseSitesAgree } from './release-sites.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_URL = 'https://gitlab.com/markjoyeuxcom/apps/prax';
// Keep a Changelog's subsection order; anything else keeps first-seen order after these.
export const CHANGELOG_ORDER = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security'];
const RELEASE_VERSION = /^\d+\.\d+\.\d+$/;

export function parseArgs(argv) {
  const parsed = { version: null, date: null, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--date') parsed.date = argv[++i] || null;
    else if (arg === '--dry-run') parsed.dryRun = true;
    else if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
    else if (parsed.version) throw new Error(`Unexpected argument: ${arg}`);
    else parsed.version = arg.replace(/^v/, '');
  }
  if (!parsed.version) throw new Error('Usage: prepare-release <version> [--date YYYY-MM-DD] [--dry-run]');
  if (!RELEASE_VERSION.test(parsed.version)) {
    throw new Error(`Version must be MAJOR.MINOR.PATCH (a release candidate is a git tag such as v${parsed.version}-rc.1, not a version cut)`);
  }
  if (parsed.date && !/^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) throw new Error('--date must be YYYY-MM-DD');
  return parsed;
}

// Split a version section body into { heading -> [entry blocks] }, merging repeats.
export function mergeSubsections(body) {
  const groups = new Map();
  let current = null;
  let buffer = [];
  const flush = () => {
    if (current === null) return;
    const text = buffer.join('\n').trim();
    if (text) groups.set(current, [...(groups.get(current) || []), text]);
    buffer = [];
  };
  for (const line of body.split('\n')) {
    const heading = line.match(/^### (.+?)\s*$/);
    if (heading) {
      flush();
      current = heading[1];
      continue;
    }
    if (current === null) {
      if (line.trim()) throw new Error(`Changelog entry outside any ### subsection: ${line.trim()}`);
      continue;
    }
    buffer.push(line);
  }
  flush();
  const ordered = [
    ...CHANGELOG_ORDER.filter((name) => groups.has(name)),
    ...[...groups.keys()].filter((name) => !CHANGELOG_ORDER.includes(name)),
  ];
  return ordered.map((name) => `### ${name}\n\n${groups.get(name).join('\n\n')}`).join('\n\n');
}

export function cutChangelog(text, version, date, { repo = REPO_URL } = {}) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => /^## \[Unreleased\]\s*$/.test(line));
  if (start === -1) throw new Error('CHANGELOG.md has no "## [Unreleased]" section');
  let end = lines.findIndex((line, index) => index > start && /^## \[/.test(line));
  if (end === -1) end = lines.findIndex((line, index) => index > start && /^\[[^\]]+\]: /.test(line));
  if (end === -1) end = lines.length;
  const body = lines.slice(start + 1, end).join('\n');
  const merged = mergeSubsections(body);
  if (!merged) throw new Error('CHANGELOG.md [Unreleased] has no entries; nothing to release');

  const head = lines.slice(0, start).join('\n');
  const tail = lines.slice(end).join('\n');
  let out = `${head}\n## [Unreleased]\n\n## [${version}] - ${date}\n\n${merged}\n\n${tail}`;

  // Reference links: [Unreleased] compares from the new tag; the new version
  // compares from the previous tag the old [Unreleased] link named.
  const unreleasedLink = out.match(/^\[Unreleased\]: (\S+)\/compare\/v([^.\s]+(?:\.[^.\s]+)*)\.\.\.HEAD\s*$/m);
  if (unreleasedLink) {
    const previous = unreleasedLink[2];
    out = out.replace(
      unreleasedLink[0],
      `[Unreleased]: ${repo}/-/compare/v${version}...HEAD\n[${version}]: ${repo}/-/compare/v${previous}...v${version}`,
    );
  } else {
    out = `${out.replace(/\s*$/, '')}\n\n[Unreleased]: ${repo}/-/compare/v${version}...HEAD\n[${version}]: ${repo}/-/tags/v${version}\n`;
  }
  return out;
}

export function prepareRelease({ version, date, dryRun = false, base = root } = {}) {
  const day = date || new Date().toISOString().slice(0, 10);
  const changes = [];
  const changelogPath = join(base, 'CHANGELOG.md');
  const changelog = cutChangelog(readFileSync(changelogPath, 'utf8'), version, day);
  changes.push({ file: 'CHANGELOG.md', text: changelog, description: `cut [${version}] - ${day}` });
  for (const site of RELEASE_SITES) {
    const path = join(base, site.file);
    const before = readFileSync(path, 'utf8');
    const after = site.write(before, version);
    if (after !== before) changes.push({ file: site.file, text: after, description: site.description });
  }
  if (!dryRun) {
    for (const change of changes) writeFileSync(join(base, change.file), change.text);
    assertReleaseSitesAgree(version, { root: base });
  }
  return { version, date: day, changed: changes.map((c) => `${c.file} (${c.description})`) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { version, date, dryRun } = parseArgs(process.argv.slice(2));
    const result = prepareRelease({ version, date, dryRun });
    console.log(`[release] ${dryRun ? 'would prepare' : 'prepared'} v${result.version} (${result.date}):`);
    for (const line of result.changed) console.log(`  ${line}`);
    if (!dryRun) console.log(`[release] next: review the diff, commit "chore: prepare v${result.version} release", merge, then tag v${result.version}-rc.1 to exercise the release workflow before v${result.version}.`);
  } catch (error) {
    console.error(`[release] ${error.message}`);
    process.exitCode = 1;
  }
}
