# GitLab migration follow-up review — 53719c4

Codex report mirrored verbatim from `.local-review-backups/codex-gitlab-move-followup-53719c4.md` (2026-09-07). The two P2s it raised were fixed in 57c6ed1.

---

# GitLab migration MR !1 follow-up review — 53719c4

## Implemented

Reviewed commit `53719c44cd6808c5f4a02de2d761289ff018cf8b` (the two commits after the prior approval are `294b275` and `53719c4`). The working tree was clean.

The Free-plan runner diagnosis is reproduced against GitLab. Jobs 16349762069 (Linux ARM64) and 16349762070 (macOS ARM64) both returned `status=failed`, `failure_reason=no_matching_runner`, and `allow_failure=true`. The current MR pipeline (2826947438) shows the same two jobs failing with `no_matching_runner` and allowed failure; the x64 job is manual on the MR, while quality jobs proceed.

The current YAML is internally consistent:

- `.gitlab-ci.yml:146-155` makes Linux ARM64 automatic on release tags but allowed to fail, and manual/allowed on MRs and main.
- `.gitlab-ci.yml:157-203` gives macOS the same tag/manual policy.
- `.gitlab-ci.yml:216` makes the multi-arch container depend on quality, browser, and only Linux x64.
- `.gitlab-ci.yml:248-259` makes release depend on x64 artifacts and optional ARM64/macOS artifacts.
- `.gitlab-ci.yml:268-288` requires x64 .deb and AppImage, rejects filename collisions, emits SHA256SUMS, uploads every artifact, and creates the GitLab release.
- `.gitlab-ci.yml:227-231` leaves prerelease tags without `latest`, major, or minor floating tags.
- `.gitlab-ci.yml:151-152` and `:199-200` use a YAML merge key to inherit the tag `if` and add `allow_failure`. GitLab lint accepts this shape; because no `when` is supplied on the matching tag rule, the jobs run automatically on tags (and their failures do not block). The following MR/main rule is explicitly `when: manual`.

The release-body change is exercised by `scripts/release-notes.mjs:18-30,41-94`. With x64 assets, the generated body says macOS and Linux ARM64 were not built by that pipeline, names the x64 files, and says SHA256SUMS covers attached files. The changelog, README, BUILD.md, and migration plan now consistently describe Free-plan ARM64/macOS manual completion and GitLab/glab transports. The prior GitHub-era changelog P1 is closed; the current releaseTools test rejects the old commands and URLs.

Two P2 issues remain:

1. `.gitlab-ci.yml:191-192 uploads both `Prax-macos-arm64.app.tar.gz` and the `.dmg`, but `scripts/release-notes.mjs:18-20,49-53` classifies/list only `.dmg`. The release loop uploads the tarball and SHA256SUMS covers it, yet “Packages attached by the pipeline” does not name that attached file. This makes “exactly which packages” incomplete when the macOS job succeeds.
2. `docs/desktop/BUILD.md:62-65` says Linux ARM64 “uses GitLab's hosted `saas-linux-medium-arm64` runner” without the Free-plan qualification that appears at lines 69-76. On this project’s plan that statement is false as written; it should say “when available” or lead with the manual-build path.

No P0/P1 blocker was found. The GitLab migration design is otherwise honest: the current plan cannot assign the two hosted architectures, those jobs are allowed to fail, x64 remains the release gate, and the release body exposes missing platform coverage.

Plan recommendation: keep the Free plan with x64 CI plus hand-built/attached macOS and ARM64 packages for now. Premium would buy automated hosted ARM64/macOS coverage and remove the manual step, but the current pipeline is explicitly designed to operate safely without it. Keeping GitHub only for releases would duplicate release plumbing and weaken the single GitLab source of truth.

## Tested

- `glab ci lint` — exit 0; output: `✓ CI/CD YAML is valid!`
- `npm test` — exit 0; 1,918 passed, 0 failed.
- `npm run check` — exit 0; syntax checks passed and skill bundles are up to date.
- `node scripts/run-tests.js tests/contract tests/backend/releaseTools.test.js` — exit 0; 44 passed, 0 failed.
- `node scripts/release-notes.mjs --tag v0.21.0-rc.3 --image registry.gitlab.com/markjoyeuxcom/apps/prax` — exit 0; emitted the 0.21.0 changelog body and GitLab container reference.
- Temporary assets probe with x64 `.deb`, `.AppImage`, and `SHA256SUMS` — emitted the expected package-coverage section.
- `glab api .../jobs/16349762069` and `.../16349762070` — both confirmed `no_matching_runner` and `allow_failure=true`.
- Current MR pipeline 2826947438 jobs — node-checks success; browser running; ARM64/macOS failed with allowed `no_matching_runner`; x64 manual.

## Unable to test

The hosted MR pipeline was still running when this review completed, so no claim is made that pipeline 2826947438 is fully green. No macOS or ARM64 package was built locally. No tracked files were modified.

## Verdict

Request changes for the two P2 documentation/release-body mismatches above. After the macOS tarball is either named in the package section (or intentionally excluded from upload) and the ARM64 BUILD.md sentence is corrected, approve merging MR !1 and cut `v0.21.0-rc.3` on GitLab.

