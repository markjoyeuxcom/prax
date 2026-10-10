# Move back to GitHub — 2026-10-10

**Why:** the move to GitLab on 2026-09-07 ([plan](2026-09-07-move-to-gitlab.md)) was forced by
GitHub-hosted macOS minutes. Both desktop builds have run on the project's own runners since
then, so the reason is gone, and one home for code, issues, releases and the skills installer
is simpler than a read-only mirror plus a working copy.
**Where:** `https://github.com/markjoyeuxcom/prax` (the existing private repository, fast-forwarded
from v0.32.0 with every tag); the GitLab project is archived read-only with a README pointer.

## What changed

| Surface | Before (GitLab) | After (GitHub) |
|---|---|---|
| CI | `.gitlab-ci.yml`: `check` → `test` → `desktop` → `release` on self-hosted group runners | `.github/workflows/ci.yml` (checks, unit + contract, audit, browser suite), `desktop.yml` (manual packages), `desktop-build.yml` (reusable: the two package jobs), `release.yml` (tag → quality → packages → release) |
| Runners | GitLab group runners tagged `homelab` (Docker executor) and `macos` (Tart custom executor, throwaway VM per job) | GitHub Actions self-hosted runners registered with the `markjoyeuxcom` organisation: Linux with the extra label `homelab` and Docker (jobs run in `container: node:24-bookworm`), and an Apple Silicon Mac (`self-hosted`, `macOS`, `ARM64`). GitHub's runner has no per-job VM executor, so the macOS job assumes a persistent machine and installs its pinned toolchain under `$RUNNER_TEMP` and `$HOME/.cargo`; running the runner inside a long-lived Tart VM is recommended |
| Desktop builds off tags | manual, non-blocking jobs on merge requests and `main` | the `Desktop builds` workflow, started from the Actions tab (`workflow_dispatch`); never on a pull request |
| Release | `release-cli` + generic-package uploads, no prerelease flag | `softprops/action-gh-release` with every package, `SHA256SUMS` and the changelog body; `-rc.N` tags are marked prerelease. Artifacts stay separate until flattened with `cp -n` and a count check, so a filename collision cannot hide a package |
| Container image | none published (since v0.30.0) | unchanged: none. Manifests and docs name `ghcr.io/markjoyeuxcom/prax` for images you build and push yourself |
| Changelog links | `gitlab.com/…/-/compare/` | `github.com/…/compare/` and `/releases/tag/` (footer rewritten; `prepare-release` emits the GitHub form) |
| Skills installer | `glab api` fetch, `glab auth git-credential` | `gh api -H "Accept: application/vnd.github.raw"` fetch, `gh auth git-credential`, SSH and token alternatives |
| Claude Code plugin | `marketplace add git@gitlab.com:markjoyeuxcom/apps/prax.git` | `marketplace add markjoyeuxcom/prax` |
| Security reports | GitLab confidential issue | GitHub private vulnerability reporting |
| Dependabot | removed | restored (`.github/dependabot.yml`: weekly npm and actions groups) |

`tests/contract/desktopReleaseWorkflow.test.js` now pins the workflows: no GitHub-hosted runner
and no container image anywhere; the quality gate on every pull request, push to `main` and tag;
tag verification against the version sites; both desktop jobs on their self-hosted labels with
the pinned, checksummed Node and pinned Rust, `--locked` builds, verify → build → smoke; exactly
two desktop jobs; the release waiting for the gate and both packages, verifying the per-job
checksums after artifact storage and refusing a missing package or a collision.

## Steps on the GitHub side

1. Push `main` and every tag; switch `origin`; close the stale Dependabot pull request.
2. Register the two self-hosted runners (organisation Settings ▸ Actions ▸ Runners ▸ New
   runner). The Linux host needs Docker for `container:` jobs and the custom label `homelab`;
   the Mac needs the Xcode command line tools and gets `macOS`/`ARM64` automatically.
3. Watch the first `CI` run on `main`, then run `Desktop builds` by hand before the next tag.
4. Archive the GitLab project (its README points here).

## Not done here

- The runners are registered by a person: the step needs an organisation admin token and runs
  on the two machines. Until then every workflow queues (GitHub holds a queued job for 24 hours).
- Fork pull requests: keep "Require approval for all outside collaborators" on in the
  organisation's Actions settings, because `container:`-less macOS jobs run on a personal Mac.
- Linux ARM64 remains unsupported (no self-hosted ARM64 runner).
- The installed desktop app still carries the GitLab-era installer until the next release.
