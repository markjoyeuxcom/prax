# Self-hosted runners and Linux ARM64 removal review — d84a3f6

Codex report mirrored verbatim from `.local-review-backups/codex-gitlab-runners-review-d84a3f6.md` (2026-09-07). The P1 (a stale paragraph in the `[0.21.0]` changelog bullet) and the P2 (an exact desktop-job-set assertion) were fixed in e95a282.

---

# d84a3f6 GitLab runner review

## Implemented

Reviewed commit d84a3f6 (ci: build macOS on the self-hosted macos runner and drop Linux ARM64) and its complete diff. The working tree was clean.

The pipeline shape is sound and GitLab accepts it:

- .gitlab-ci.yml:91-146 defines Linux x64 on the self-hosted homelab tag, installs the container-side Linux toolchain and smoke dependencies, verifies the release, builds/tests/packages, and publishes artifacts.
- .gitlab-ci.yml:148-180 defines macOS on the self-hosted macos tag. Its shell-executor assumptions are explicit: it adds $HOME/.cargo/bin and $HOME/.local/share/mise/shims to PATH, checks Node/npm/cargo/Xcode, and does not brew-install toolchains. It emits both .dmg and Prax-macos-arm64.app.tar.gz.
- .gitlab-ci.yml:41-46 makes both desktop jobs automatic on matching release tags and manual/allowed-failure on merge requests and main.
- .gitlab-ci.yml:191 makes the multi-arch container wait for both desktop jobs; :225-233 makes release wait for both desktop artifacts. Neither package is optional.
- .gitlab-ci.yml:241-247 requires x64 .deb + .AppImage, macOS .dmg + .app.tar.gz, rejects duplicate filenames, and writes SHA256SUMS before uploading all files.
- .gitlab-ci.yml:12-17 accurately says an offline self-hosted runner blocks the tag pipeline rather than allowing a release without packages.
- The release-notes platform list now contains only macOS and Linux x64 (scripts/release-notes.mjs:18-21).

Linux ARM64 removal is complete for product/release surfaces. README, BUILD.md, the removed-section of CHANGELOG, the manual-activation matrix, release notes, the plan, and the pipeline no longer advertise a Linux ARM64 installer. Remaining ARM64 hits are permitted target-triple/package-dependency mappings, generic container multi-arch support, historical evidence/reviews, tests of cross-platform helpers, or macOS Apple Silicon identifiers.

### Findings

- P1 — stale release documentation in CHANGELOG.md:253-257. The current [0.21.0] “repository moved to GitLab” entry still says hosted macOS and Linux ARM64 jobs are allowed to fail on tags, that Linux x64 is the only package a release cannot ship without, and that missing packages are built by hand and attached. d84a3f6 removes the ARM64 job, requires the self-hosted macOS package, and makes both packages/container/release dependencies mandatory. A reader using the changelog as the release body would get the old, contradictory release contract. Rewrite this paragraph to describe homelab + macos, two required packages, and blocking offline runners.

- P2 — contract test does not enforce exact job uniqueness. tests/contract/desktopReleaseWorkflow.test.js:35-64 correctly fails on any desktop-linux-arm64/hosted ARM tag and tests/contract/desktopReleaseWorkflow.test.js:61 fails if the release’s declared needs contain optional: true. However it does not assert that there is exactly one macOS job or reject a separately named optional macOS job/artifact path. The current pipeline is correct, but a future duplicate optional macOS job could evade these textual pins. Add an explicit forbidden optional macOS/desktop job assertion or a parsed job-name set if this invariant matters.

The macOS PATH and artifact assumptions are otherwise coherent for the stated runner contract. The container remains multi-arch independently of desktop package targets. No P0 or other P1 issue was found.

## Tested

- glab ci lint — exit 0; output: ✓ CI/CD YAML is valid!
- npm test — exit 0; 1,918 passed, 0 failed.
- npm run check — exit 0; syntax checks passed and skill bundles are up to date.
- git show --stat d84a3f6 and git diff d84a3f6~1 d84a3f6 — reviewed; 11 files changed, 119 insertions and 144 deletions.
- Tree grep for ARM64/Linux ARM64 claims — only the allowed target mappings, generic dependencies/container targets, historical/evidence files, macOS Apple Silicon identifiers, and the stale changelog paragraph above remained.

## Unable to test

No self-hosted homelab or macos runner was available in this pane, so the actual package builds, shell-executor environment, Tauri bundles, and release upload were not run. No tracked files were modified.

## Verdict

Changes needed: fix the stale CHANGELOG.md:253-257 release contract (and preferably strengthen the exact-job contract test), then approve d84a3f6.

