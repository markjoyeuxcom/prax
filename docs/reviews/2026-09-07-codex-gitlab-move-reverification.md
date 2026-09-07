# GitLab migration re-verification — a227fa5

## Verdict

**Approve merging MR !1 and cutting `v0.21.0-rc.3` on GitLab.** The prior P1 is fixed: the current release body no longer contains the stale GitHub release-body wording, old marketplace command, `gh` installer commands, GHCR image, or the old GitHub project URL. The requested tests and an additional check gate pass.

Reviewed `a227fa5deb3e39a6c9ba81816d6fe7768ae0c43a` on `chore/move-to-gitlab`; `origin` is the GitLab repository and `github` remains the retained GitHub remote. The worktree was clean and no tracked files were modified.

## P1 re-verification

`node scripts/release-notes.mjs --tag v0.21.0-rc.3 --image registry.gitlab.com/markjoyeuxcom/apps/prax` exited 0. The generated body contains the GitLab container image and current plugin/install instructions:

- `registry.gitlab.com/markjoyeuxcom/apps/prax:v0.21.0-rc.3`
- `claude plugin marketplace add git@gitlab.com:markjoyeuxcom/apps/prax.git`
- current `glab`/SSH/token wording

A prohibited-string scan of the generated body found no stale actionable strings: `gh api`, `gh auth`, `ghcr.io`, `marketplace add markjoyeuxcom/prax`, `GitHub release body`, or `github.com/markjoyeuxcom`. The remaining matches are intentional product/history references in the changelog, such as external GitHub links and the note that the GitHub copy is retained read-only.

The new regression test in `tests/backend/releaseTools.test.js` asserts exactly those exclusions from the current changelog section, which `release-notes.mjs` uses as the release body. This test passed.

The repaired changelog passages are visible at `CHANGELOG.md:19-31` and `CHANGELOG.md:458-472`: release body is platform-neutral, the marketplace URL is GitLab, installer transport is glab/SSH/token, and the old workflow wording is explicitly marked as GitHub-era history.

## Pipeline and release conclusion

The earlier pipeline review remains valid. `.gitlab-ci.yml` preserves the quality, browser, audit, Linux desktop, multi-arch container, package collision/checksum, and GitLab release gates. The macOS job remains honestly manual/optional on this plan. The GitLab API lint was unavailable in the earlier pass because the stored token was expired; local YAML parsing and static contract tests passed, and this re-verification did not change pipeline YAML.

## Implemented

No product or tracked-file changes. This is a read-only verification report.

## Tested

| Command | Result |
|---|---|
| `git rev-parse HEAD` | `a227fa5deb3e39a6c9ba81816d6fe7768ae0c43a` |
| `git status --short` | Empty |
| `node scripts/release-notes.mjs --tag v0.21.0-rc.3 --image registry.gitlab.com/markjoyeuxcom/apps/prax` | Exit 0; GitLab RC body generated; prohibited-string scan clean |
| `npm test` | Exit 0; **1,917 passed, 0 failed, 0 skipped**; 4,395.08325 ms |
| `node scripts/run-tests.js tests/backend/releaseTools.test.js tests/contract tests/skills` | Exit 0; **47 passed, 0 failed**; 1,906.636958 ms |
| `npm run check` | Exit 0; syntax checks and skill-bundle check passed |
| `git diff HEAD^ HEAD -- CHANGELOG.md tests/backend/releaseTools.test.js` | Confirmed the three wording fixes, GitHub-era annotation, and release-body regression test |

## Unable to test

- GitLab server-side CI lint and an actual hosted pipeline: the GitLab API token remains expired; the prior local YAML parse and contract tests passed.
- macOS self-hosted packaging and manual release upload remain outside this local verification.

**Final decision: approve MR !1, then cut/push `v0.21.0-rc.3` on GitLab.**
