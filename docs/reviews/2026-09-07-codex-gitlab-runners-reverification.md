# Self-hosted runners final re-verification — 1ba6b5c

Codex report mirrored verbatim from `.local-review-backups/codex-gitlab-runners-reverification-1ba6b5c.md` (2026-09-07). Live evidence supplied to Codex: pipeline 2827159904 on 1ba6b5c, `desktop-macos-arm64` job 16351423295 (348 s, smoke passed, `.dmg` and `.app.tar.gz` uploaded) and `desktop-linux-x64` job 16351423294 (1051 s on the homelab runner).

---

# Final re-verification — 1ba6b5c

## Implemented

Reviewed HEAD 1ba6b5cf2d8fd52c006bf83cbc81cb8d488553a and the diff from d84a3f6. The working tree was clean.

The prior findings are resolved:

- e95a282 updates the [0.21.0] changelog paragraph to say the self-hosted runners hold a tag pipeline when offline and Linux ARM64 is no longer a target (CHANGELOG.md:251-258).
- The exact desktop-job contract now asserts exactly ['desktop-linux-x64', 'desktop-macos-arm64'], rejects optional needs, and limits allow_failure to the shared manual rule (tests/contract/desktopReleaseWorkflow.test.js:35-48).
- The release and docs now consistently describe the two required packages and no Linux ARM64 installer.

The Rust change is sound (src-tauri/src/lib.rs:801-823):

- Normal launches have no --desktop-smoke argument, so smoke_data_dir is None and the single-instance plugin is registered. The existing callback still surfaces the existing window, preserving normal single-instance protection.
- A smoke launch is created by verify-desktop-runtime with --desktop-smoke and an isolated temporary directory. That makes smoke_data_dir Some and skips only the single-instance plugin; setup then calls prepare_data_dir with that explicit directory (src-tauri/src/lib.rs:836-847), starts the isolated sidecar, and exits after readiness (src-tauri/src/lib.rs:894-897).
- No implicit path reaches the user's real app-data directory: the smoke harness supplies its temporary directory, and the conditional only changes plugin registration. An operator who deliberately passes a real directory to --desktop-smoke could of course make the smoke use that directory; that is an explicit CLI choice, not a race or default.
- The builder is constructed once with dialog/shell plugins, conditionally extended with single-instance, then extended with the desktop shortcut plugin. Both branches reach the same invoke handler/setup path.

No P1/P2/P3 defect remains. The remaining grep hits are accurate negative statements, historical/planning/spec evidence, macOS Apple Silicon identifiers, or generic Rust/container target mappings. In particular, the BUILD.md hosted-runner mention says those hosted runners are unavailable and explains the self-hosted replacement.

## Tested

- npm test — exit 0; 1,920 passed, 0 failed.
- npm run check — exit 0; syntax checks passed and skill bundles are up to date.
- PATH=$HOME/.cargo/bin:$PATH cargo fmt --manifest-path src-tauri/Cargo.toml -- --check — exit 0.
- PATH=$HOME/.cargo/bin:$PATH cargo test --manifest-path src-tauri/Cargo.toml --lib — exit 0; 7 passed, 0 failed.
- grep across README.md, docs, and CHANGELOG.md for stale Linux ARM64/hosted macOS claims — no stale positive claim; only accurate removal/unavailability statements remain.
- git diff d84a3f6 1ba6b5c — reviewed Rust fix, changelog/docs updates, and contract tests; no tracked files modified.

## Unable to test

The self-hosted macOS and homelab package builds were not rerun locally. The supplied live evidence reports macOS job 16351423295 succeeded on pipeline 2827159904, with both macOS artifacts uploaded; prior homelab jobs succeeded. No release tag or upload was performed.

## Verdict

Approve merging MR !1 and tagging v0.21.0-rc.3.

