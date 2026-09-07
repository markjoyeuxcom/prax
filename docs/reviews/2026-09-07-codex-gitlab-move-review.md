# GitLab migration review — fb527ac

## Verdict

**Request changes before merging the GitLab MR or cutting `v0.21.0-rc.3`.** The pipeline migration is structurally sound and the requested local gates pass, but the release body generated for the current `0.21.0` section still contains actionable GitHub-era commands. A GitLab release would tell users to use `gh` and the old GitHub plugin marketplace URL. That is a P1 release-documentation defect because it ships in the release notes produced by `scripts/release-notes.mjs`.

Reviewed `fb527ac6a6ffbf1029f5269e20ffa94519ee5908` on `chore/move-to-gitlab`, with `origin` pointing to `gitlab.com/markjoyeuxcom/apps/prax` and `github` retained as the GitHub remote. The working tree was clean; no tracked files were modified.

## 1. GitLab CI parity and pipeline review

`.gitlab-ci.yml` has five stages (`check`, `test`, `desktop`, `container`, `release`). The quality gate is preserved in `node-checks` (`.gitlab-ci.yml:47-63`): `npm run check`, tag verification, `npm test`, and `npm audit --audit-level=high`. `browser-tests` (`:66-81`) installs Chromium and runs `CI=1 npm run test:e2e`.

The Linux desktop template (`.gitlab-ci.yml:84-132`) preserves sidecar preparation, desktop verification, `cargo fmt --check`, `cargo build`, `cargo test --lib`, Tauri deb/AppImage bundling, runtime smoke, and fatal package collection. `desktop-linux-x64` and `desktop-linux-arm64` use the requested `saas-linux-medium-amd64` and `saas-linux-medium-arm64` tags (`:134-146`). They are automatic on release tags and manual/allowed-to-fail on merge requests and `main` (`:128-132`).

The macOS job (`:149-184`) is manual and allowed to fail, uses the `macos-arm64` self-hosted tag, runs the same verify/format/build/test/build/smoke sequence, and is optional in the release `needs` (`:231-236`). This is consistent with the stated plan limitation. GitLab’s hosted Linux documentation lists `saas-linux-medium-amd64` and `saas-linux-medium-arm64`; the current docs say the medium ARM64 runner is Premium/Ultimate-only, so the project’s actual plan must include that runner for ARM64 releases to work. This is a deployment prerequisite, not a YAML error.

The tag-only container job (`:187-222`) needs both Linux desktop jobs plus `node-checks` and `browser-tests`, uses `docker:27` + `docker:27-dind`, installs arm64 binfmt, creates Buildx, and pushes `linux/amd64,linux/arm64`. Its case statement omits `latest`, major, and minor tags for any tag containing `-` (`:201-209`), so prereleases do not float those tags. GitLab hosted Linux SaaS runners are documented as privileged for Docker-in-Docker, and the official BuildKit documentation confirms the dind + Buildx shape. The job uses the project’s requested hosted runner tags.

The release job (`:225-261`) needs quality, browser tests, container, and both Linux desktop artifacts; macOS artifacts are optional. It installs `release-cli`, generates the body from `release-notes.mjs`, requires all four Linux package filename patterns, rejects duplicate names, writes `SHA256SUMS`, uploads each artifact to the GitLab generic package registry, and invokes `release-cli create` with package asset links. This preserves the old release ordering and collision/checksum safeguards. `APPIMAGE_EXTRACT_AND_RUN=1` is set in the Linux template (`:88-93`), which is appropriate for AppImage tooling inside a container.

`GIT_DEPTH: "1"` is safe for the inspected scripts: the release verifier and release-site checks read files and version metadata, and no CI script requires commit history. Tests that create Git repositories do so in temporary fixtures rather than reading this checkout’s history.

The YAML parses with Ruby’s standard YAML parser (`yaml parse ok`). `glab ci lint` could not be run because the installed GitLab token is expired (`oauth2: invalid_grant`); this is recorded below. The contract suite statically pins the major pipeline relationships in `tests/contract/desktopReleaseWorkflow.test.js:18-66`, including anchors, needs, manual jobs, package globs, prerelease tag handling, collisions, checksums, and `release-cli`.

## 2. macOS decision and documentation

The macOS decision is honest and consistent. `.gitlab-ci.yml:149-184` describes a manual self-hosted `macos-arm64` runner and makes it optional to release. `docs/desktop/BUILD.md:69-79` says hosted runners cannot build macOS on this plan, gives the self-hosted tag, and documents the Mac build/smoke/`glab release upload` fallback. `README.md:7-15` says Linux packages are CI-gated while the Mac package is built, smoke-tested, and attached separately. `scripts/release-notes.mjs:49-56` describes the same split. The contract test asserts the manual/optional macOS job (`tests/contract/desktopReleaseWorkflow.test.js:42-50`).

The documented commands exist: `npm run desktop:build` is defined in `package.json`, `npm run desktop:smoke` is defined, and local `glab 1.113.0 release upload --help` confirms the documented command form. This review did not have a macOS runner or packaged artifact to exercise.

## 3. Remaining GitHub/GHCR references

The requested grep shows no stale release registry or CI reference outside the excluded changelog/review/spec files. Remaining hits fall into these categories:

- Product behavior for arbitrary external references: `public/js/externalRefKind.js:14,19`, `public/prax.css:1925`, `public/js/renderEditor.js:207`, `docs/ROADMAP.md:88-92`, `docs/contract.md:377`, and `server/migrations/0011_add_document_external_refs.sql:6` deliberately support GitHub, GitLab, and generic links.
- Repository URL normalization and fixtures: `server/repoUrl.js:10-13,52`, `docs/agent-memory.md:141`, `docs/cli.md:36`, `public/js/main.js:3646`, `tests/backend/documentExternalRefs.test.js`, `tests/backend/projects*`, `tests/backend/repoUrl.test.js`, and `tests/cli/detectProject.test.js` use GitHub URLs as valid arbitrary repositories or historical fixtures. They are not claims that Prax is hosted there.
- Intentional migration wording: `README.md:362` says the GitHub copy is retained read-only; `skills/README.md:99` explains that Codex’s bundled installer accepts GitHub shorthand and therefore cannot directly install from GitLab. Both are current and useful.
- Dependency/fixture metadata: `package-lock.json` and `src-tauri/Cargo.lock` contain upstream GitHub/crates.io URLs; `scripts/create-quality-fixture.js` uses GitHub example data. These are not deployment references.

The one stale set is inside `CHANGELOG.md`, which the requested grep explicitly excludes but which feeds release notes: see P1 below.

## 4. Skills installer and docs

The no-checkout entry point is correct: `glab api "projects/markjoyeuxcom%2Fapps%2Fprax/repository/files/skills%2Finstall.sh/raw?ref=main" | sh` (`skills/README.md:29`, `docs/agent-memory.md:112`, and `skills/install.sh:9`). The token variant uses GitLab’s `PRIVATE-TOKEN` header and a GitLab OAuth2 clone URL (`skills/README.md:44-49`). The plugin marketplace instruction uses the GitLab git URL (`skills/README.md:84-92`).

`skills/install.sh:65-82` applies `git -c credential.helper= -c 'credential.helper=!glab auth git-credential'` to both clone and sparse-checkout calls. The installed `glab` is version 1.113.0 and `glab auth git-credential --help` succeeds, confirming that subcommand exists. The token/API path itself could not be authenticated here because the stored glab token is expired; the local skills tests use a fake glab transport and pass.

`tests/skills/installScript.test.js` covers the glab clone and sparse-checkout helper case. The requested subset passes all 39 tests, including the installer cases.

## 5. Release scripts and changelog footer

`scripts/release-sites.mjs:8` points the image to `registry.gitlab.com/markjoyeuxcom/apps/prax`. `scripts/prepare-release.mjs:15,92-95` uses the GitLab project URL and emits `/-/compare/` plus `/-/tags/` links. The current footer is correct at `CHANGELOG.md:1446-1488`.

`node scripts/release-notes.mjs --tag v0.21.0-rc.3 --image registry.gitlab.com/markjoyeuxcom/apps/prax` exits 0 and emits the expected prerelease/container/package guidance. `node scripts/prepare-release.mjs 0.22.0 --dry-run` exits 1 with `CHANGELOG.md [Unreleased] has no entries; nothing to release`; this is the intended guard against cutting an empty release, not a migration regression.

### P1 — stale GitHub commands in the release body

`CHANGELOG.md:19-23` says `release:notes` prints the “GitHub release body”; `CHANGELOG.md:25-31` tells users the plugin marketplace command is `claude plugin marketplace add markjoyeuxcom/prax`; and `CHANGELOG.md:458-463` says the installer uses the GitHub CLI/`gh` and has “gh transport” tests. These lines are part of the `## [0.21.0]` section, so `scripts/release-notes.mjs` copies them into the GitLab release body. The generated output was verified locally and includes the stale wording. The migration added a GitLab paragraph at `CHANGELOG.md:245-255`, but that does not repair the older actionable entries.

Repair the affected changelog text before cutting rc.3: say GitLab release body, use the GitLab plugin git URL, and describe the installer’s current `glab`/SSH/token transports. Preserve historical facts only where they are clearly historical and not presented as current commands. Add a release-notes regression assertion that the current section contains no obsolete `gh api`, `gh auth`, `ghcr.io`, or old marketplace command.

### P2 — server-side CI lint and first pipeline remain unverified

The local YAML parser passed and static contract tests pass, but `glab ci lint` was unavailable because the API token is expired. The first actual GitLab pipeline should be observed after refreshing authentication. This is not itself a code defect, but it leaves GitLab-specific `needs`, runner availability, and release-cli behavior unverified.

## Implemented

No product or tracked-file changes. This is a read-only review report.

## Tested

| Command | Result |
|---|---|
| `git rev-parse HEAD` / `git remote -v` | `fb527ac6a6ffbf1029f5269e20ffa94519ee5908`; `origin` is GitLab and `github` is retained |
| `npm test` | Exit 0; **1,916 passed, 0 failed, 0 skipped**; 4,285.152208 ms |
| `npm run check` | Exit 0; syntax checks and skill-bundle check passed |
| `node scripts/run-tests.js tests/contract tests/skills` | Exit 0; **39 passed, 0 failed**; 1,079.914875 ms |
| Ruby YAML parse of `.gitlab-ci.yml` | Exit 0; `yaml parse ok` |
| `glab --version` | `glab 1.113.0` |
| `glab auth git-credential --help` | Exit 0; subcommand supported |
| `glab auth status` | API authentication failed with `oauth2: invalid_grant` (expired token); SSH Git operations remain configured |
| `node scripts/release-notes.mjs --tag v0.21.0-rc.3 --image registry.gitlab.com/markjoyeuxcom/apps/prax` | Exit 0; prerelease notes and GitLab image emitted; output exposed stale changelog commands above |
| `node scripts/prepare-release.mjs 0.22.0 --dry-run` | Exit 1; `[Unreleased]` is empty, so the intentional no-op release guard fired |
| `glab release upload --help` | Exit 0; documented upload syntax supported |

## Unable to test

- `glab ci lint`: blocked by the expired GitLab API token (`invalid_grant`); no token refresh was attempted.
- An actual GitLab pipeline, hosted runner availability, Docker-in-Docker Buildx/binfmt execution, generic-package uploads, and release-cli creation.
- A macOS self-hosted build and manual release asset upload.

**Final decision: request changes for the P1 stale release-body commands; after correcting the changelog text and rerunning the gates, approve the MR and cut `v0.21.0-rc.3`.**
