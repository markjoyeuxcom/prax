#!/usr/bin/env node
// Assemble the GitLab release body for a tag from CHANGELOG.md: the container
// image line, the desktop package guidance (installers are unsigned), and the
// tagged version's changelog section. A tag whose version has no changelog
// section fails, so a release cannot ship without notes.
//
//   node scripts/release-notes.mjs --tag v0.21.0-rc.1 [--image registry.gitlab.com/markjoyeuxcom/apps/prax]
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { IMAGE } from './release-sites.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TAG = /^v(\d+\.\d+\.\d+)(?:-([0-9A-Za-z.-]+))?$/;

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

export function releaseNotes({ changelog, tag, image = IMAGE }) {
  const { version, prerelease } = parseTag(tag);
  const section = changelogSection(changelog, version);
  const candidate = prerelease
    ? `This is a release candidate (\`${prerelease}\`) for ${version}: it is published as a prerelease and the container is not tagged \`latest\`.\n\n`
    : '';
  return `${candidate}## Container

\`\`\`text
${image}:${tag}
\`\`\`

## Desktop packages

Linux x64/ARM64 installers (\`.deb\`, \`.AppImage\`) are built, smoke-tested and attached by the
pipeline with \`SHA256SUMS\`. The macOS Apple Silicon \`.dmg\` is built and smoke-tested on a Mac
and attached to this release separately; if it is not listed yet, it is still on its way.
**All installers are unsigned and not notarized**: verify each download against its checksum
before installing, and expect macOS to ask for approval under System Settings ▸ Privacy & Security
the first time the app opens. Back up \`prax.db\`, quit Prax, then install the new package over
the application; the OS app-data directory is preserved. See \`docs/desktop/BUILD.md\` for the
backup, update and rollback steps.

## Changes in ${version}

${section}
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    let tag = null;
    let image = IMAGE;
    for (let i = 0; i < args.length; i += 1) {
      if (args[i] === '--tag') tag = args[++i];
      else if (args[i] === '--image') image = args[++i];
      else throw new Error(`Unknown option: ${args[i]}`);
    }
    if (!tag) throw new Error('Usage: release-notes --tag vMAJOR.MINOR.PATCH[-pre] [--image <name>]');
    process.stdout.write(releaseNotes({ changelog: readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), tag, image }));
  } catch (error) {
    console.error(`[release-notes] ${error.message}`);
    process.exitCode = 1;
  }
}
