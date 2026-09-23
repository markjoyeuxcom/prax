import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The GitLab pipeline is the distribution gate (docs/desktop/BUILD.md). These
// pins keep a release from being created without its quality gate and both
// supported desktop packages with their runtime smoke, keep the desktop jobs on
// the self-hosted runners, and keep them from burning compute minutes on every
// merge request.

const pipeline = readFileSync(new URL('../../.gitlab-ci.yml', import.meta.url), 'utf8');

function job(name) {
  const match = pipeline.match(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\n([\\s\\S]*?)(?=^\\S|(?![\\s\\S]))`, 'm'));
  assert.ok(match, `.gitlab-ci.yml must define ${name}`);
  return match[1];
}

test('every pipeline runs the quality gate, and release tags verify the tag against the version sites', () => {
  const checks = job('node-checks');
  assert.match(checks, /npm run check/);
  assert.match(checks, /npm test/);
  assert.match(checks, /npm audit --audit-level=high/);
  assert.match(checks, /verify-desktop-release\.mjs --tag "\$CI_COMMIT_TAG"/);
  const browser = job('browser-tests');
  assert.match(browser, /npm run test:e2e/);
  assert.match(pipeline, /^workflow:\n  rules:\n[\s\S]*?\$CI_COMMIT_TAG =~ \/\^v\\d\+\\\.\\d\+\\\.\\d\+\(-\[0-9A-Za-z\.-\]\+\)\?\$\//m);
  assert.match(pipeline, /^\.rules-desktop: &rules-desktop\n  - \*rule-release-tag\n  - if: .*merge_request_event.*\n    when: manual\n    allow_failure: true/m, 'desktop builds are automatic on tags and manual, non-blocking elsewhere');
});

test('the Linux x64 job builds on the homelab runner: verify, build, test, package, smoke', () => {
  const linux = job('desktop-linux-x64');
  assert.match(linux, /tags: \[homelab\]/, 'the x64 build runs on the self-hosted homelab runner');
  assert.match(linux, /npm run desktop:verify -- --tag "\$CI_COMMIT_TAG"/);
  assert.match(linux, /cargo build --locked --manifest-path src-tauri\/Cargo\.toml\n[\s\S]*?cargo test --locked --manifest-path src-tauri\/Cargo\.toml --lib/);
  assert.match(linux, /npx tauri build --bundles deb,appimage/);
  assert.match(linux, /npm run desktop:smoke/);
  assert.match(linux, /xvfb xauth dbus-x11/, 'the smoke needs xvfb and xauth in the container');
  assert.match(linux, /cp src-tauri\/target\/release\/bundle\/deb\/\*\.deb src-tauri\/target\/release\/bundle\/appimage\/\*\.AppImage release-assets\//);
  assert.match(linux, /rules: \*rules-desktop/);
  assert.doesNotMatch(pipeline, /desktop-linux-arm64|saas-linux-medium-arm64/, 'Linux ARM64 packages are no longer built');
});

test('both desktop jobs ship a pinned, checksummed Node and build with a pinned Rust against the lockfile', () => {
  // prepare-sidecar copies the building Node into the package, so neither
  // job may ship whatever Node its image or machine happens to have.
  assert.match(pipeline, /^  NODE_VERSION: "\d+\.\d+\.\d+"$/m);
  assert.match(pipeline, /^  NODE_DARWIN_ARM64_SHA256: "[0-9a-f]{64}"$/m);
  assert.match(pipeline, /^  NODE_LINUX_X64_SHA256: "[0-9a-f]{64}"$/m);
  assert.match(pipeline, /^  RUST_VERSION: "\d+\.\d+\.\d+"$/m);
  const jobs = {
    'desktop-linux-x64': { node: /node-v\$NODE_VERSION-linux-x64[\s\S]*?echo "\$NODE_LINUX_X64_SHA256  [^"]+" \| sha256sum -c -/, sums: /sha256sum -- \* > \.\.\/SHA256SUMS\.linux-x64/ },
    'desktop-macos-arm64': { node: /node-v\$NODE_VERSION-darwin-arm64[\s\S]*?echo "\$NODE_DARWIN_ARM64_SHA256  [^"]+" \| shasum -a 256 -c -/, sums: /shasum -a 256 -- \* > \.\.\/SHA256SUMS\.macos-arm64/ },
  };
  for (const [name, expected] of Object.entries(jobs)) {
    const body = job(name);
    assert.match(body, expected.node, `${name} downloads and verifies the pinned Node`);
    assert.match(body, /test "\$\(node --version\)" = "v\$NODE_VERSION"/, `${name} refuses any other Node`);
    assert.ok(body.indexOf('test "$(node --version)"') < body.indexOf('npm ci'), `${name} checks Node before installing with it`);
    assert.match(body, /RUSTUP_TOOLCHAIN: "\$RUST_VERSION"/, `${name} builds with the pinned toolchain`);
    assert.match(body, /--default-toolchain "\$RUST_VERSION"/);
    assert.match(body, /cargo build --locked /);
    assert.match(body, /cargo test --locked /);
    assert.match(body, /npx tauri build --bundles [a-z,]+(?: --verbose)? -- --locked/);
    assert.doesNotMatch(body, /cargo (?:build|test) --manifest-path/, `${name} has no unlocked cargo build`);
    assert.match(body, expected.sums, `${name} checksums its packages where it built them`);
  }
});

test('both desktop jobs verify the payload tauri build bundled, after the build and before the smoke', () => {
  // tauri build's beforeBuildCommand deletes and re-stages the payload, so a
  // verification before the build checks files that do not ship.
  const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.match(packageJson.scripts['desktop:verify'], /verify-desktop-release\.mjs --require-built$/);
  const tauri = JSON.parse(readFileSync(new URL('../../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  assert.equal(tauri.build.beforeBuildCommand, 'node scripts/prepare-sidecar.mjs', 'the build re-stages the payload itself');
  for (const name of ['desktop-linux-x64', 'desktop-macos-arm64']) {
    const body = job(name);
    const build = body.search(/npx tauri build --bundles/);
    const tagged = body.indexOf('npm run desktop:verify -- --tag "$CI_COMMIT_TAG"');
    const untagged = body.search(/\n\s+npm run desktop:verify\n/);
    const smoke = body.indexOf('npm run desktop:smoke');
    assert.ok(build > 0 && tagged > build && untagged > build, `${name} verifies after tauri build`);
    assert.ok(smoke > tagged && smoke > untagged, `${name} verifies before the runtime smoke`);
    assert.equal((body.match(/npm run desktop:verify/g) || []).length, 2, `${name} has one verify step (tagged and untagged forms)`);
  }
});

test('exactly two desktop jobs exist and nothing in the pipeline is optional', () => {
  const desktopJobs = [...pipeline.matchAll(/^(desktop-[\w-]+):$/gm)].map((m) => m[1]);
  assert.deepEqual(desktopJobs, ['desktop-linux-x64', 'desktop-macos-arm64'], 'the supported targets are Linux x64 and macOS Apple Silicon, one job each');
  assert.doesNotMatch(pipeline, /optional: true/, 'a release never treats a package as optional');
  assert.equal((pipeline.match(/allow_failure: true/g) || []).length, 1, 'allow_failure appears only in the shared manual-on-merge-request rule for the desktop builds');
});

test('the macOS job builds on the macos runner and is required for a release', () => {
  const mac = job('desktop-macos-arm64');
  assert.match(mac, /tags: \[macos\]/, 'the macOS build runs on the self-hosted macos runner');
  assert.match(mac, /npx tauri build --bundles app,dmg/);
  assert.match(mac, /npm run desktop:smoke/);
  assert.match(mac, /Prax-macos-arm64\.app\.tar\.gz/);
  assert.match(mac, /rules: \*rules-desktop/);
  assert.doesNotMatch(mac, /allow_failure: true\n  rules/, 'the macOS package is not optional on a release tag');
});

test('a tagged release waits for the quality gate and both packages, then publishes checksums — no container image', () => {
  // The desktop app is the product. Nothing builds or publishes a container
  // image: no container stage, no dind, no registry login, no Docker socket or
  // privileged executor on the runner. deploy/Dockerfile stays for self-builds.
  assert.match(pipeline, /^stages: \[check, test, desktop, release\]$/m);
  assert.doesNotMatch(pipeline, /^(\.container|container|container-preview):/m, 'no container job of any kind');
  assert.doesNotMatch(pipeline, /docker:\d+(-dind)?|docker login|docker buildx|CI_REGISTRY|docker\.sock/, 'no Docker at all in the pipeline');
  assert.match(pipeline, /^default:\n(?:  .*\n)*?  tags: \[homelab\]/m, 'every job defaults to the self-hosted homelab runner; only the macOS build overrides it');
  assert.doesNotMatch(pipeline, /saas-linux/, 'no job is pinned to a GitLab shared runner');
  const release = job('release');
  assert.match(release, /needs:\n    - node-checks\n    - browser-tests\n    - job: desktop-linux-x64\n      artifacts: true\n    - job: desktop-macos-arm64\n      artifacts: true\n  rules:/, 'the release waits for the gate and both packages, and nothing else');
  assert.doesNotMatch(release, /optional: true/, 'no package is optional');
  assert.match(release, /rules:\n    - \*rule-release-tag/);
  assert.match(release, /release-notes\.mjs --tag "\$CI_COMMIT_TAG" --assets-dir release-assets/, 'the body lists exactly what was attached');
  assert.doesNotMatch(release, /--image/, 'the body promises no container image');
  assert.match(release, /\*_amd64\.deb[\s\S]*?\*_amd64\.AppImage[\s\S]*?\*\.dmg[\s\S]*?\*\.app\.tar\.gz/, 'every supported package must be present');
  assert.match(release, /uniq -d/, 'filename collisions are rejected');
  // Checksums come from the jobs that built the packages and are verified
  // here, after artifact storage, before one combined list is published.
  assert.match(release, /sha256sum -c --strict SHA256SUMS\.linux-x64 SHA256SUMS\.macos-arm64/);
  assert.match(release, /cat SHA256SUMS\.linux-x64 SHA256SUMS\.macos-arm64 \| sort -k 2 > SHA256SUMS/);
  assert.match(release, /test "\$\(ls \| grep -vx SHA256SUMS \| sort\)" = "\$\(awk '\{print \$2\}' SHA256SUMS \| sort\)"/, 'the list covers exactly the attached files');
  assert.doesNotMatch(release, /sha256sum \* > SHA256SUMS/, 'the release job never re-hashes stored artifacts as if they were fresh');
  assert.match(release, /release-cli create --name "\$CI_COMMIT_TAG" --tag-name "\$CI_COMMIT_TAG" --description release-notes\.md/);
});

test('staging clears Tauri\'s copied resources so a deleted source file is never shipped', async () => {
  const { readFile } = await import('node:fs/promises');
  const script = await readFile(new URL('../../scripts/prepare-sidecar.mjs', import.meta.url), 'utf8');
  assert.match(script, /for \(const profile of \['debug', 'release'\]\)[\s\S]*?rmSync\(join\(root, 'src-tauri', 'target', profile, 'resources', 'app'\)/);
});
