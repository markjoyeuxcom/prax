import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The GitLab pipeline is the distribution gate (docs/desktop/BUILD.md). These
// pins keep a release from being created without its quality gate, its Linux
// packages and their runtime smoke, and keep the desktop jobs from silently
// dropping a platform or burning compute minutes on every merge request.

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
});

test('Linux desktop jobs verify, build, smoke and package both architectures, automatic on tags and manual elsewhere', () => {
  const linux = job('.desktop-linux');
  assert.match(linux, /npm run desktop:verify -- --tag "\$CI_COMMIT_TAG"/);
  assert.match(linux, /cargo build --manifest-path src-tauri\/Cargo\.toml\n[\s\S]*?cargo test --manifest-path src-tauri\/Cargo\.toml --lib/);
  assert.match(linux, /npx tauri build --bundles deb,appimage/);
  assert.match(linux, /npm run desktop:smoke/);
  assert.match(linux, /cp src-tauri\/target\/release\/bundle\/deb\/\*\.deb src-tauri\/target\/release\/bundle\/appimage\/\*\.AppImage release-assets\//);
  assert.match(linux, /rules:\n    - \*rule-release-tag\n    - if: .*merge_request_event.*\n      when: manual\n      allow_failure: true/);
  assert.match(job('desktop-linux-x64'), /extends: \.desktop-linux\n  tags: \[saas-linux-medium-amd64\]/);
  assert.match(job('desktop-linux-arm64'), /extends: \.desktop-linux\n  tags: \[saas-linux-medium-arm64\]/);
});

test('the macOS job runs on the hosted Apple Silicon runner, may fail without blocking a release, and is manual elsewhere', () => {
  const mac = job('desktop-macos-arm64');
  assert.match(mac, /tags: \[saas-macos-medium-m1\]/);
  assert.match(mac, /npx tauri build --bundles app,dmg/);
  assert.match(mac, /npm run desktop:smoke/);
  assert.match(mac, /rules:\n    - <<: \*rule-release-tag\n      allow_failure: true\n    - if: .*merge_request_event.*\n      when: manual\n      allow_failure: true/);
  const release = job('release');
  assert.match(release, /- job: desktop-macos-arm64\n      artifacts: true\n      optional: true/);
});

test('a tagged release waits for the quality gate, both Linux packages and the container, then publishes checksums', () => {
  const container = job('container');
  assert.match(container, /needs: \[node-checks, browser-tests, desktop-linux-x64, desktop-linux-arm64\]/);
  assert.match(container, /rules:\n    - \*rule-release-tag/);
  assert.match(container, /--platform linux\/amd64,linux\/arm64/);
  assert.match(container, /\*-\*\) ;;/, 'a prerelease tag must not become latest');
  const release = job('release');
  assert.match(release, /needs:\n    - node-checks\n    - browser-tests\n    - container\n    - job: desktop-linux-x64\n      artifacts: true\n    - job: desktop-linux-arm64\n      artifacts: true/);
  assert.match(release, /rules:\n    - \*rule-release-tag/);
  assert.match(release, /release-notes\.mjs --tag "\$CI_COMMIT_TAG"/);
  assert.match(release, /\*_amd64\.deb[\s\S]*?\*_arm64\.deb[\s\S]*?\*_amd64\.AppImage[\s\S]*?\*_aarch64\.AppImage/, 'every Linux package must be present');
  assert.match(release, /uniq -d/, 'filename collisions are rejected');
  assert.match(release, /sha256sum \* > SHA256SUMS/);
  assert.match(release, /release-cli create --name "\$CI_COMMIT_TAG" --tag-name "\$CI_COMMIT_TAG" --description release-notes\.md/);
});
