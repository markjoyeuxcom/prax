// Every place a Prax version is written down, in one list, so a release bump
// touches all of them (`npm run release:prepare -- <version>`) and the desktop
// release verifier can refuse a tag when any of them drifted. A site names the
// file, how to read its current value, and how to rewrite it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const IMAGE = 'ghcr.io/markjoyeuxcom/prax';

const SEMVER = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?`;

function jsonSite(file, description, setVersion) {
  return {
    file,
    description,
    read(text) { return JSON.parse(text).version; },
    write(text, version) {
      const data = JSON.parse(text);
      setVersion(data, version);
      return `${JSON.stringify(data, null, 2)}\n`;
    },
  };
}

// A single text site: `pattern` must match exactly once; group 1 is the version.
function textSite(file, description, pattern, render) {
  return {
    file,
    description,
    read(text) {
      const matches = [...text.matchAll(pattern)];
      if (matches.length !== 1) {
        throw new Error(`${file}: expected exactly one ${description}, found ${matches.length}`);
      }
      return matches[0][1];
    },
    write(text, version) {
      this.read(text);
      return text.replace(pattern, () => render(version));
    },
  };
}

export const RELEASE_SITES = [
  jsonSite('package.json', 'package version', (data, v) => { data.version = v; }),
  jsonSite('.claude-plugin/plugin.json', 'Claude Code plugin version', (data, v) => { data.version = v; }),
  {
    file: 'package-lock.json',
    description: 'lockfile root version',
    read(text) {
      const data = JSON.parse(text);
      const nested = data.packages?.['']?.version;
      if (nested !== data.version) throw new Error(`package-lock.json: root version ${data.version} differs from packages[""] ${nested}`);
      return data.version;
    },
    write(text, version) {
      // Textual replacement keeps npm's own formatting byte-for-byte elsewhere.
      const data = JSON.parse(text);
      const current = data.version;
      const pattern = new RegExp(`("version": ")${current.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(")`, 'g');
      let seen = 0;
      const out = text.replace(pattern, (m, a, b) => { seen += 1; return seen <= 2 ? `${a}${version}${b}` : m; });
      if (seen < 2) throw new Error('package-lock.json: could not find both root version fields');
      return out;
    },
  },
  textSite('src-tauri/Cargo.toml', 'desktop crate version', new RegExp(String.raw`^version = "(${SEMVER})"`, 'gm'), (v) => `version = "${v}"`),
  textSite('src-tauri/Cargo.lock', 'desktop lockfile entry for prax', new RegExp(String.raw`(?<=name = "prax"\nversion = ")(${SEMVER})(?=")`, 'g'), (v) => v),
  textSite('compose.image.yaml', 'published image tag', new RegExp(String.raw`${IMAGE.replace(/[.]/g, '\\.')}:v(${SEMVER})`, 'g'), (v) => `${IMAGE}:v${v}`),
  textSite('deploy/base/deployment.yaml', 'base manifest image tag', new RegExp(String.raw`${IMAGE.replace(/[.]/g, '\\.')}:v(${SEMVER})`, 'g'), (v) => `${IMAGE}:v${v}`),
  textSite('deploy/overlays/dev/kustomization.yaml', 'dev overlay newTag', new RegExp(String.raw`newTag: v(${SEMVER})`, 'g'), (v) => `newTag: v${v}`),
  textSite('deploy/overlays/staging/kustomization.yaml', 'staging overlay newTag', new RegExp(String.raw`newTag: v(${SEMVER})`, 'g'), (v) => `newTag: v${v}`),
  textSite('deploy/overlays/prod/kustomization.yaml', 'prod overlay newTag', new RegExp(String.raw`newTag: v(${SEMVER})`, 'g'), (v) => `newTag: v${v}`),
  textSite('README.md', 'published image example', new RegExp(String.raw`${IMAGE.replace(/[.]/g, '\\.')}:v(${SEMVER})`, 'g'), (v) => `${IMAGE}:v${v}`),
  textSite('docs/deployment.md', 'overlay pin statement', new RegExp(String.raw`Overlays are currently pinned to \x60v(${SEMVER})\x60`, 'g'), (v) => `Overlays are currently pinned to \`v${v}\``),
  textSite('docs/ROADMAP.md', 'current release statement', new RegExp(String.raw`\*\*Current release:\*\* \x60v(${SEMVER})\x60`, 'g'), (v) => `**Current release:** \`v${v}\``),
];

// Read every site; throw naming each one that disagrees with `version`.
export function assertReleaseSitesAgree(version, { root, read = (file) => readFileSync(join(root, file), 'utf8') } = {}) {
  const drift = [];
  for (const site of RELEASE_SITES) {
    let found;
    try {
      found = site.read(read(site.file));
    } catch (error) {
      drift.push(`${site.file}: ${error.message}`);
      continue;
    }
    if (found !== version) drift.push(`${site.file}: ${site.description} is ${found}`);
  }
  if (drift.length) {
    throw new Error(`Release version drift against ${version}:\n  ${drift.join('\n  ')}`);
  }
  return version;
}
