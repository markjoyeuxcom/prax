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
  assert.match(linux, /cargo build --manifest-path src-tauri\/Cargo\.toml\n[\s\S]*?cargo test --manifest-path src-tauri\/Cargo\.toml --lib/);
  assert.match(linux, /npx tauri build --bundles deb,appimage/);
  assert.match(linux, /npm run desktop:smoke/);
  assert.match(linux, /xvfb xauth dbus-x11/, 'the smoke needs xvfb and xauth in the container');
  assert.match(linux, /cp src-tauri\/target\/release\/bundle\/deb\/\*\.deb src-tauri\/target\/release\/bundle\/appimage\/\*\.AppImage release-assets\//);
  assert.match(linux, /rules: \*rules-desktop/);
  assert.doesNotMatch(pipeline, /desktop-linux-arm64|saas-linux-medium-arm64/, 'Linux ARM64 packages are no longer built');
});

test('exactly two desktop jobs exist and nothing in the pipeline is optional', () => {
  const desktopJobs = [...pipeline.matchAll(/^(desktop-[\w-]+):$/gm)].map((m) => m[1]);
  assert.deepEqual(desktopJobs, ['desktop-linux-x64', 'desktop-macos-arm64'], 'the supported targets are Linux x64 and macOS Apple Silicon, one job each');
  assert.doesNotMatch(pipeline, /optional: true/, 'a release never treats a package as optional');
  assert.equal((pipeline.match(/allow_failure: true/g) || []).length, 2, 'allow_failure appears only in the shared manual-on-merge-request rule and the container preview');
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

test('a tagged release waits for the quality gate, both packages and the container, then publishes checksums', () => {
  const container = job('container');
  assert.match(container, /extends: \.container/);
  assert.match(container, /needs: \[node-checks, browser-tests, desktop-linux-x64, desktop-macos-arm64\]/);
  assert.match(container, /rules:\n    - \*rule-release-tag/);
  const build = job('.container');
  assert.doesNotMatch(build, /tags:/, 'the container build runs on the pipeline default runner, not a hosted one');
  assert.match(pipeline, /^default:\n(?:  .*\n)*?  tags: \[homelab\]/m, 'every job defaults to the self-hosted homelab runner; only the macOS build overrides it');
  assert.doesNotMatch(pipeline, /saas-linux/, 'no job is pinned to a GitLab shared runner');
  assert.match(build, /--platform linux\/amd64 /, 'the server image is built for amd64 only for now');
  assert.doesNotMatch(build, /linux\/arm64|binfmt/, 'no arm64 cross-build and no qemu registration on the host until arm64 is a target again');
  // Host socket binding, not docker:dind: no dind service, no TLS cert dir, no
  // named-context workaround; a per-job builder that the job removes again.
  assert.doesNotMatch(build, /docker:\d+-dind|DOCKER_TLS_CERTDIR|docker context create/, 'the container build drives the host daemon over the mounted socket, not a dind service');
  assert.match(build, /docker buildx create --use --driver docker-container --name "prax-\$CI_JOB_ID"/, 'the builder is named per job so leftovers and concurrent jobs cannot collide');
  assert.match(build, /after_script:\n\s*(?:#.*\n\s*)*- docker buildx inspect "prax-\$CI_JOB_ID" >\/dev\/null 2>&1 && docker buildx rm "prax-\$CI_JOB_ID" \|\| true/, 'the builder container is removed from the host whether the job passed or failed');
  assert.match(build, /DOCKER_HOST: unix:\/\/\/var\/run\/docker\.sock/, 'the daemon endpoint is pinned to the socket, never inferred from a dind hostname');
  assert.match(build, /test -S \/var\/run\/docker\.sock \|\| \{\n\s*echo 'No Docker socket in this job: the runner must mount \/var\/run\/docker\.sock/, 'a runner without the socket fails with an actionable message, not a DNS error');
  assert.match(build, /docker version --format/, 'reachability is checked with a command that exits non-zero on failure (docker info does not)');
  assert.match(build, /--provenance=false --sbom=false/, 'attestations made GitLab\'s registry reject the multi-arch index (rc.3)');
  assert.match(build, /version="\$\{CI_COMMIT_TAG:-mr-\$CI_MERGE_REQUEST_IID\}"/, 'a preview push is tagged mr-<iid>');
  assert.match(build, /\*-\*\) ;;/, 'a prerelease or preview tag must not become latest');
  assert.match(build, /imagetools inspect "\$CI_REGISTRY_IMAGE:\$version"/, 'the pushed index is read back');
  const preview = job('container-preview');
  assert.match(preview, /extends: \.container/);
  assert.match(preview, /needs: \[node-checks, browser-tests\]/, 'a preview does not wait for the manual desktop jobs');
  assert.match(preview, /merge_request_event.*\n\s*when: manual\n\s*allow_failure: true/, 'the preview is manual and non-blocking on merge requests');
  assert.doesNotMatch(preview, /rule-release-tag/, 'a preview never runs on a release tag');
  const release = job('release');
  assert.match(release, /needs:\n    - node-checks\n    - browser-tests\n    - container\n    - job: desktop-linux-x64\n      artifacts: true\n    - job: desktop-macos-arm64\n      artifacts: true\n  rules:/);
  assert.doesNotMatch(release, /optional: true/, 'no package is optional');
  assert.match(release, /rules:\n    - \*rule-release-tag/);
  assert.match(release, /release-notes\.mjs --tag "\$CI_COMMIT_TAG" --image "\$CI_REGISTRY_IMAGE" --assets-dir release-assets/, 'the body lists exactly what was attached');
  assert.match(release, /\*_amd64\.deb[\s\S]*?\*_amd64\.AppImage[\s\S]*?\*\.dmg[\s\S]*?\*\.app\.tar\.gz/, 'every supported package must be present');
  assert.match(release, /uniq -d/, 'filename collisions are rejected');
  assert.match(release, /sha256sum \* > SHA256SUMS/);
  assert.match(release, /release-cli create --name "\$CI_COMMIT_TAG" --tag-name "\$CI_COMMIT_TAG" --description release-notes\.md/);
});
