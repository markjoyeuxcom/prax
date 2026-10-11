import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The GitHub Actions workflows are the distribution gate (docs/desktop/BUILD.md).
// These pins keep a release from being created without its quality gate and
// both supported desktop packages with their runtime smoke, keep every job on
// a GitHub-hosted runner with a pinned image (no self-hosted machine, no
// `-latest` that moves under a release), and keep the desktop builds off pull
// requests unless someone asks for them.

const read = (name) => readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8');
const ci = read('ci.yml');
const desktop = read('desktop.yml');
const build = read('desktop-build.yml');
const release = read('release.yml');
const all = { 'ci.yml': ci, 'desktop.yml': desktop, 'desktop-build.yml': build, 'release.yml': release };

// The body of one job under `jobs:` (two-space indent) up to the next job.
function job(workflow, name) {
  const match = workflow.match(new RegExp(`^  ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\n([\\s\\S]*?)(?=^  [\\w-]+:|(?![\\s\\S]))`, 'm'));
  assert.ok(match, `the workflow must define the ${name} job`);
  return match[1];
}

test('every workflow runs on pinned GitHub-hosted images only, with no container image anywhere', () => {
  for (const [file, text] of Object.entries(all)) {
    assert.doesNotMatch(text, /self-hosted/, `${file} uses no self-hosted runner`);
    assert.doesNotMatch(text, /runs-on:.*-latest/, `${file} pins its runner images: -latest moves under a release`);
    for (const [, image] of text.matchAll(/runs-on: (.+)/g)) {
      assert.match(image, /^(ubuntu-24\.04|macos-15)$/, `${file} runs on ubuntu-24.04 or macos-15, got ${image}`);
    }
    assert.doesNotMatch(text, /docker login|docker buildx|docker\/(login|build-push|setup-buildx)-action|ghcr\.io\/markjoyeuxcom/, `${file} builds or publishes no container image`);
    assert.doesNotMatch(text, /continue-on-error: true/, `${file} treats nothing as optional`);
  }
  for (const text of [ci, release]) {
    for (const body of text.split(/^  [\w-]+:$/m).slice(1)) {
      if (/runs-on:/.test(body)) assert.match(body, /runs-on: ubuntu-24\.04\n    container:\n      image: node:24-bookworm/, 'every Linux job runs on ubuntu-24.04 in the Node image');
    }
  }
});

test('pull requests and main run the quality gate; desktop builds there are manual only', () => {
  assert.match(ci, /^on:\n  push:\n    branches: \[main\]\n  pull_request:\n    branches: \[main\]/m);
  const checks = job(ci, 'node-checks');
  assert.match(checks, /npm run check/);
  assert.match(checks, /npm test/);
  assert.match(checks, /npm audit --audit-level=high/);
  assert.match(job(ci, 'browser-tests'), /npm run test:e2e/);
  assert.doesNotMatch(ci, /tauri build|desktop-build\.yml/, 'CI builds no desktop package');
  assert.match(desktop, /^on:\n  workflow_dispatch:\n/m, 'desktop builds off a tag are started by hand');
  assert.doesNotMatch(desktop, /pull_request|push:/, 'and never by a pull request or push');
  assert.match(desktop, /uses: \.\/\.github\/workflows\/desktop-build\.yml/);
});

test('release tags verify the tag against the version sites and run every gate CI applies to main', () => {
  assert.match(release, /^on:\n  push:\n    tags:\n      - "v\*\.\*\.\*"/m);
  assert.match(job(release, 'resolve'), /\^v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\(-\[0-9A-Za-z\.-\]\+\)\?\$/, 'the tag must be vMAJOR.MINOR.PATCH with an optional prerelease suffix');
  const quality = job(release, 'quality');
  assert.match(quality, /verify-desktop-release\.mjs --tag "\$RELEASE_TAG"/);
  assert.match(quality, /npm run check/);
  assert.match(quality, /npm test/);
  assert.match(quality, /npm audit --audit-level=high/);
  assert.match(quality, /npm run test:e2e/);
});

test('both desktop jobs ship a pinned, checksummed Node and build with a pinned Rust against the lockfile', () => {
  // prepare-sidecar copies the building Node into the package, so neither
  // job may ship whatever Node its image or machine happens to have.
  assert.match(build, /^  NODE_VERSION: "\d+\.\d+\.\d+"$/m);
  assert.match(build, /^  NODE_DARWIN_ARM64_SHA256: "[0-9a-f]{64}"$/m);
  assert.match(build, /^  NODE_LINUX_X64_SHA256: "[0-9a-f]{64}"$/m);
  assert.match(build, /^  RUST_VERSION: "\d+\.\d+\.\d+"$/m);
  assert.doesNotMatch(build, /actions\/setup-node|dtolnay\/rust-toolchain/, 'no action-installed Node or Rust: the pinned downloads are the only toolchain');
  const jobs = {
    'desktop-linux-x64': { node: /node-v\$NODE_VERSION-linux-x64[\s\S]*?echo "\$NODE_LINUX_X64_SHA256  [^"]+" \| sha256sum -c -/, sums: /sha256sum -- \* > \.\.\/SHA256SUMS\.linux-x64/ },
    'desktop-macos-arm64': { node: /node-v\$NODE_VERSION-darwin-arm64[\s\S]*?echo "\$NODE_DARWIN_ARM64_SHA256  [^"]+" \| shasum -a 256 -c -/, sums: /shasum -a 256 -- \* > \.\.\/SHA256SUMS\.macos-arm64/ },
  };
  for (const [name, expected] of Object.entries(jobs)) {
    const body = job(build, name);
    assert.match(body, expected.node, `${name} downloads and verifies the pinned Node`);
    assert.match(body, /test "\$\(node --version\)" = "v\$NODE_VERSION"/, `${name} refuses any other Node`);
    assert.ok(body.indexOf('test "$(node --version)"') < body.indexOf('npm ci'), `${name} checks Node before installing with it`);
    assert.match(body, /--default-toolchain "\$RUST_VERSION"/);
    assert.match(body, /echo "RUSTUP_TOOLCHAIN=\$RUST_VERSION" >> "\$GITHUB_ENV"/, `${name} builds with the pinned toolchain`);
    assert.match(body, /cargo build --locked /);
    assert.match(body, /cargo test --locked /);
    assert.match(body, /npx tauri build --bundles [a-z,]+(?: --verbose)? -- --locked/);
    assert.doesNotMatch(body, /cargo (?:build|test) --manifest-path/, `${name} has no unlocked cargo build`);
    assert.match(body, expected.sums, `${name} checksums its packages where it built them`);
    assert.match(body, /if-no-files-found: error/, `${name} fails when a package is missing`);
  }
});

test('both desktop jobs verify the payload tauri build bundled, after the build and before the smoke', () => {
  // tauri build's beforeBuildCommand deletes and re-stages the payload, so a
  // verification before the build checks files that do not ship.
  const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.match(packageJson.scripts['desktop:verify'], /verify-desktop-release\.mjs --require-built$/);
  const tauri = JSON.parse(readFileSync(new URL('../../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  assert.equal(tauri.build.beforeBuildCommand, 'node scripts/prepare-sidecar.mjs', 'the build re-stages the payload itself');
  assert.match(build, /^  RELEASE_TAG: \$\{\{ inputs\.tag \}\}$/m, 'the caller names the tag the payload must match');
  for (const name of ['desktop-linux-x64', 'desktop-macos-arm64']) {
    const body = job(build, name);
    const built = body.search(/npx tauri build --bundles/);
    const tagged = body.indexOf('npm run desktop:verify -- --tag "$RELEASE_TAG"');
    const untagged = body.search(/\n\s+npm run desktop:verify\n/);
    const smoke = body.indexOf('npm run desktop:smoke');
    assert.ok(built > 0 && tagged > built && untagged > built, `${name} verifies after tauri build`);
    assert.ok(smoke > tagged && smoke > untagged, `${name} verifies before the runtime smoke`);
    assert.equal((body.match(/npm run desktop:verify/g) || []).length, 2, `${name} has one verify step (tagged and untagged forms)`);
  }
});

test('exactly two desktop jobs exist, one per supported target, on pinned hosted images', () => {
  const desktopJobs = [...build.matchAll(/^  (desktop-[\w-]+):$/gm)].map((m) => m[1]);
  assert.deepEqual(desktopJobs, ['desktop-linux-x64', 'desktop-macos-arm64'], 'the supported targets are Linux x64 and macOS Apple Silicon, one job each');
  const linux = job(build, 'desktop-linux-x64');
  assert.match(linux, /runs-on: ubuntu-24\.04\n    container:\n      image: node:24-bookworm/, 'the x64 build runs on ubuntu-24.04 in the Node image');
  assert.match(linux, /npx tauri build --bundles deb,appimage/);
  assert.match(linux, /npm run desktop:smoke/);
  assert.match(linux, /xvfb xauth dbus-x11/, 'the smoke needs xvfb and xauth in the container');
  assert.match(linux, /cp src-tauri\/target\/release\/bundle\/deb\/\*\.deb src-tauri\/target\/release\/bundle\/appimage\/\*\.AppImage release-assets\//);
  const mac = job(build, 'desktop-macos-arm64');
  assert.match(mac, /runs-on: macos-15/, 'the macOS build runs on the Apple Silicon macos-15 image');
  assert.doesNotMatch(mac, /container:/, 'and directly on that image');
  assert.match(mac, /npx tauri build --bundles app,dmg/);
  assert.match(mac, /npm run desktop:smoke/);
  assert.match(mac, /Prax-macos-arm64\.app\.tar\.gz/);
});

test('a tagged release waits for the quality gate and both packages, then publishes checksums — no container image', () => {
  assert.match(job(release, 'desktop'), /needs: \[resolve, quality\]\n    uses: \.\/\.github\/workflows\/desktop-build\.yml\n    with:\n      ref: \$\{\{ needs\.resolve\.outputs\.version \}\}\n      tag: \$\{\{ needs\.resolve\.outputs\.version \}\}/, 'the packages are built from the tag and verified against it');
  const publish = job(release, 'publish');
  assert.match(publish, /needs: \[resolve, quality, desktop\]/, 'the release waits for the gate and both packages');
  assert.match(publish, /permissions:\n      contents: write/, 'only the publish job may write');
  assert.match(release, /^permissions:\n  contents: read$/m);
  assert.match(publish, /pattern: prax-\*\n          path: downloaded/, 'each platform\'s upload stays separate until it is flattened');
  assert.match(publish, /cp -n \{\} release-assets\//, 'flattening never overwrites a package');
  assert.match(publish, /uniq -d/, 'filename collisions are rejected');
  assert.match(publish, /\*_amd64\.deb[\s\S]*?\*_amd64\.AppImage[\s\S]*?\*\.dmg[\s\S]*?\*\.app\.tar\.gz/, 'every supported package must be present');
  // Checksums come from the jobs that built the packages and are verified
  // here, after artifact storage, before one combined list is published.
  assert.match(publish, /sha256sum -c --strict SHA256SUMS\.linux-x64 SHA256SUMS\.macos-arm64/);
  assert.match(publish, /cat SHA256SUMS\.linux-x64 SHA256SUMS\.macos-arm64 \| sort -k 2 > SHA256SUMS/);
  assert.match(publish, /test "\$\(ls \| grep -vx SHA256SUMS \| sort\)" = "\$\(awk '\{print \$2\}' SHA256SUMS \| sort\)"/, 'the list covers exactly the attached files');
  assert.doesNotMatch(publish, /sha256sum \* > SHA256SUMS/, 'the release job never re-hashes stored artifacts as if they were fresh');
  assert.match(publish, /release-notes\.mjs --tag "\$RELEASE_TAG" --assets-dir release-assets/, 'the body lists exactly what was attached');
  assert.doesNotMatch(publish, /--image/, 'the body promises no container image');
  assert.match(publish, /softprops\/action-gh-release@v\d+\n        with:\n          tag_name: \$\{\{ needs\.resolve\.outputs\.version \}\}\n          name: \$\{\{ needs\.resolve\.outputs\.version \}\}\n          prerelease: \$\{\{ needs\.resolve\.outputs\.prerelease == 'true' \}\}\n          body_path: release-notes\.md\n          files: release-assets\/\*\n          fail_on_unmatched_files: true/, 'one release with every package, a candidate marked prerelease');
});

test('staging clears Tauri\'s copied resources so a deleted source file is never shipped', async () => {
  const { readFile } = await import('node:fs/promises');
  const script = await readFile(new URL('../../scripts/prepare-sidecar.mjs', import.meta.url), 'utf8');
  assert.match(script, /for \(const profile of \['debug', 'release'\]\)[\s\S]*?rmSync\(join\(root, 'src-tauri', 'target', profile, 'resources', 'app'\)/);
});
