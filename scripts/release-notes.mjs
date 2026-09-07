#!/usr/bin/env node
// Assemble the GitLab release body for a tag from CHANGELOG.md: the container
// image line, the desktop package guidance (installers are unsigned), the list
// of packages the pipeline actually attached — naming any supported platform it
// could not build, so a reader never assumes a missing package exists — and the
// tagged version's changelog section. A tag whose version has no changelog
// section fails, so a release cannot ship without notes.
//
//   node scripts/release-notes.mjs --tag v0.21.0-rc.1 [--image registry.gitlab.com/markjoyeuxcom/apps/prax] [--assets-dir release-assets]
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { IMAGE } from './release-sites.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TAG = /^v(\d+\.\d+\.\d+)(?:-([0-9A-Za-z.-]+))?$/;

// The supported desktop platforms and how their package files are named.
export const PLATFORMS = [
  { name: 'macOS Apple Silicon', files: [/\.dmg$/], hand: 'built and smoke-tested on a Mac (`npm run desktop:build`, `npm run desktop:smoke`)' },
  { name: 'Linux x64', files: [/_amd64\.deb$/, /_amd64\.AppImage$/], hand: 'built on an x64 Linux machine' },
  { name: 'Linux ARM64', files: [/_arm64\.deb$/, /_aarch64\.AppImage$/], hand: 'built on an ARM64 Linux machine' },
];

export function parseTag(tag) {
  const match = String(tag || '').match(TAG);
  if (!match) throw new Error(`Tag must be vMAJOR.MINOR.PATCH with an optional prerelease suffix, got "${tag}"`);
  return { version: match[1], prerelease: match[2] || null };
}

// The body of `## [version] - date` up to the next `## ` heading or the link footer.
export function changelogSection(text, version) {
  const lines = text.split('\n');
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const start = lines.findIndex((line) => new RegExp(`^## \\[${escaped}\\]`).test(line));
  if (start === -1) throw new Error(`CHANGELOG.md has no "## [${version}]" section; run npm run release:prepare -- ${version} first`);
  let end = lines.findIndex((line, index) => index > start && (/^## /.test(line) || /^\[[^\]]+\]: /.test(line)));
  if (end === -1) end = lines.length;
  const body = lines.slice(start + 1, end).join('\n').trim();
  if (!body) throw new Error(`CHANGELOG.md section "## [${version}]" is empty`);
  return body;
}

// Which supported platforms the attached files cover, and which are missing.
export function packageCoverage(assets) {
  const names = (assets || []).filter((name) => name !== 'SHA256SUMS');
  return PLATFORMS.map((platform) => ({
    name: platform.name,
    hand: platform.hand,
    files: names.filter((name) => platform.files.some((pattern) => pattern.test(name))),
    complete: platform.files.every((pattern) => names.some((name) => pattern.test(name))),
  }));
}

export function packagesSection(assets) {
  const coverage = packageCoverage(assets);
  const lines = ['## Packages attached by the pipeline', ''];
  for (const platform of coverage) {
    if (platform.complete) lines.push(`- **${platform.name}**: ${platform.files.map((f) => `\`${f}\``).join(', ')}`);
    else lines.push(`- **${platform.name}**: not built by this pipeline; it is ${platform.hand} and attached to this release afterwards. If it is not listed above, it is still on its way.`);
  }
  if ((assets || []).includes('SHA256SUMS')) lines.push('- `SHA256SUMS` covers every file the pipeline attached.');
  return lines.join('\n');
}

export function releaseNotes({ changelog, tag, image = IMAGE, assets = null }) {
  const { version, prerelease } = parseTag(tag);
  const section = changelogSection(changelog, version);
  const candidate = prerelease
    ? `This is a release candidate (\`${prerelease}\`) for ${version}: it is published as a prerelease and the container is not tagged \`latest\`.\n\n`
    : '';
  const packages = assets ? `${packagesSection(assets)}\n\n` : '';
  return `${candidate}## Container

\`\`\`text
${image}:${tag}
\`\`\`

## Desktop packages

The packages listed below were built and smoke-tested by the pipeline and are attached with
\`SHA256SUMS\`. A supported platform that the pipeline could not build (GitLab's hosted ARM64 and
macOS runners are not available on every plan) is built on that platform by hand and attached to
this release separately. **All installers are unsigned and not notarized**: verify each download
against its checksum before installing, and expect macOS to ask for approval under System
Settings ▸ Privacy & Security the first time the app opens. Back up \`prax.db\`, quit Prax, then
install the new package over the application; the OS app-data directory is preserved. See
\`docs/desktop/BUILD.md\` for the backup, update and rollback steps.

${packages}## Changes in ${version}

${section}
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    let tag = null;
    let image = IMAGE;
    let assetsDir = null;
    for (let i = 0; i < args.length; i += 1) {
      if (args[i] === '--tag') tag = args[++i];
      else if (args[i] === '--image') image = args[++i];
      else if (args[i] === '--assets-dir') assetsDir = args[++i];
      else throw new Error(`Unknown option: ${args[i]}`);
    }
    if (!tag) throw new Error('Usage: release-notes --tag vMAJOR.MINOR.PATCH[-pre] [--image <name>] [--assets-dir <dir>]');
    const assets = assetsDir ? readdirSync(assetsDir).sort() : null;
    process.stdout.write(releaseNotes({ changelog: readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), tag, image, assets }));
  } catch (error) {
    console.error(`[release-notes] ${error.message}`);
    process.exitCode = 1;
  }
}
