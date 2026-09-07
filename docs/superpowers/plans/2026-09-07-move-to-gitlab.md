# Move to GitLab — 2026-09-07

**Why:** the GitHub Actions minute allowance ran out (macOS desktop builds are billed at ten times
the Linux rate, and three release candidates plus their pull-request builds landed in one day).
**Where:** `https://gitlab.com/markjoyeuxcom/apps/prax`, created by push-to-create over SSH with
`main` and every tag; the GitHub repository is kept read-only.

## What changed

| Surface | Before | After |
|---|---|---|
| CI | `.github/workflows/{ci,desktop,release}.yml` | `.gitlab-ci.yml`: `check` → `test` → `desktop` → `container` → `release` |
| Merge requests / `main` | Node checks, browser suite, audit; desktop builds on any desktop-affecting PR | same checks; Linux desktop builds **manual** (about fifteen compute minutes each) |
| Release tag | quality → 3 desktop builds → container → GitHub release | quality → 2 Linux desktop builds → multi-arch container → GitLab release with generic-package assets and `SHA256SUMS` |
| macOS and Linux ARM64 packages | GitHub-hosted runners | GitLab hosted `saas-macos-medium-m1` / `saas-linux-medium-arm64` jobs, allowed to fail (not assignable on the Free plan: `no_matching_runner`); the release body lists what was attached; missing packages built by hand and attached with `glab release upload` |
| Container registry | `ghcr.io/markjoyeuxcom/prax` | `registry.gitlab.com/markjoyeuxcom/apps/prax` (`scripts/release-sites.mjs` `IMAGE`, compose, deploy manifests, README, docs) |
| Changelog links | `github.com/…/compare/` | `gitlab.com/…/-/compare/` (footer rewritten; `prepare-release` emits the GitLab form) |
| Skills installer | `gh api` fetch, `gh auth git-credential` | `glab api` fetch, `glab auth git-credential`, SSH and token alternatives |
| Claude Code plugin | `marketplace add markjoyeuxcom/prax` | `marketplace add git@gitlab.com:markjoyeuxcom/apps/prax.git` |
| Codex skill-installer | GitHub shorthand | not applicable; use the installer |
| Security reports | GitHub private advisory | GitLab confidential issue |
| Dependabot | weekly npm + actions groups | removed (no equivalent on the free tier; `npm audit` remains the gate) |

`tests/contract/desktopReleaseWorkflow.test.js` now pins the GitLab pipeline: quality gate on every
pipeline, tag verification on release tags, both Linux jobs verify → build → smoke → package,
manual desktop jobs off tags, the macOS job optional for the release, the container needing both
Linux packages, and the release refusing a missing package or a filename collision.

## Not done here

- Nothing on the GitLab side has run yet at the time of writing; the first pipeline validates the
  YAML for real. `glab ci lint` needs a fresh `glab auth login`.
- Confirmed: on the Free plan the hosted macOS and Linux ARM64 runners are not assignable (`no_matching_runner`), so those packages are manual attachments unless the plan changes or a self-hosted runner is registered.
- Archiving the GitHub repository and pointing its README at GitLab (owner decision).
- A Dependabot replacement (Renovate, or GitLab's dependency scanning on a paid tier).
