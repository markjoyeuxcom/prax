# Move to GitLab — 2026-09-07

**Why:** the GitHub Actions minute allowance ran out (macOS desktop builds are billed at ten times
the Linux rate, and three release candidates plus their pull-request builds landed in one day).
**Where:** `https://gitlab.com/markjoyeuxcom/apps/prax`, created by push-to-create over SSH with
`main` and every tag; the GitHub repository is kept read-only.

## What changed

| Surface | Before | After |
|---|---|---|
| CI | `.github/workflows/{ci,desktop,release}.yml` | `.gitlab-ci.yml`: `check` → `test` → `desktop` → `container` → `release` |
| Merge requests / `main` | Node checks, browser suite, audit; desktop builds on any desktop-affecting PR | same checks; both desktop builds **manual**, on the self-hosted runners tagged `homelab` (Linux x64) and `macos` (Apple Silicon), so no compute minutes |
| Release tag | quality → 3 desktop builds → container → GitHub release | quality → 2 desktop builds (macOS, Linux x64) → multi-arch container → GitLab release with generic-package assets and `SHA256SUMS`; a missing package fails the release |
| macOS package | GitHub-hosted runner | self-hosted group runner tagged `macos` (GitLab's `saas-macos-medium-m1` is not assignable on the Free plan: `no_matching_runner`), required for the release |
| Linux ARM64 package | GitHub-hosted runner | **dropped**: `saas-linux-medium-arm64` is not assignable on the Free plan and there is no self-hosted ARM64 runner; supported targets are macOS Apple Silicon and Linux x64 |
| Container registry | `ghcr.io/markjoyeuxcom/prax` | `registry.gitlab.com/markjoyeuxcom/apps/prax` (`scripts/release-sites.mjs` `IMAGE`, compose, deploy manifests, README, docs) |
| Changelog links | `github.com/…/compare/` | `gitlab.com/…/-/compare/` (footer rewritten; `prepare-release` emits the GitLab form) |
| Skills installer | `gh api` fetch, `gh auth git-credential` | `glab api` fetch, `glab auth git-credential`, SSH and token alternatives |
| Claude Code plugin | `marketplace add markjoyeuxcom/prax` | `marketplace add git@gitlab.com:markjoyeuxcom/apps/prax.git` |
| Codex skill-installer | GitHub shorthand | not applicable; use the installer |
| Security reports | GitHub private advisory | GitLab confidential issue |
| Dependabot | weekly npm + actions groups | removed (no equivalent on the free tier; `npm audit` remains the gate) |

`tests/contract/desktopReleaseWorkflow.test.js` now pins the GitLab pipeline: quality gate on every
pipeline, tag verification on release tags, both desktop jobs on their self-hosted runner tags and
verify → build → smoke → package, manual desktop jobs off tags, the container and the release
needing both packages, no Linux ARM64 job, and the release refusing a missing package or a
filename collision.

## Not done here

- Nothing on the GitLab side has run yet at the time of writing; the first pipeline validates the
  YAML for real. `glab ci lint` needs a fresh `glab auth login`.
- Confirmed: on the Free plan the hosted macOS and Linux ARM64 runners are not assignable (`no_matching_runner`). Resolved on 2026-09-07 by building macOS on the self-hosted runner tagged `macos` and dropping Linux ARM64 as a target.
- Archiving the GitHub repository and pointing its README at GitLab (owner decision).
- A Dependabot replacement (Renovate, or GitLab's dependency scanning on a paid tier).
- The release job creates the release with `release-cli`, which GitLab deprecated in 18.0 (removal
  planned for 20.0) in favour of `glab release create`. Migrate before then; the generic-package
  uploads and `SHA256SUMS` do not depend on it.
- Lessons from the first tag pipelines (2026-09-07): under docker:dind, buildx needs
  `docker context create` before `docker buildx create`; and the multi-arch push must run with
  `--provenance=false --sbom=false`, otherwise GitLab's registry rejects the index with
  `blob unknown to registry`. The manual `container-preview` MR job exists so the next registry
  problem is found on a merge request, not a release tag.
