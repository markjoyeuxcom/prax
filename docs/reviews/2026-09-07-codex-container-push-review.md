# Container push repair review — 488c4b2

Codex report mirrored verbatim from `.local-review-backups/codex-container-push-review-488c4b2.md` (2026-09-07). Live evidence: `container-preview` jobs 16354095695 (102 s, cold cache) and 16354154937 (35 s, warm cache) on MR !3 pushed `mr-3` with linux/amd64 and linux/arm64 manifests. Its P2 (release-cli deprecated since GitLab 18.0, removal planned for 20.0; migrate the release job to `glab release create`) is tracked in the plan document as follow-up work.

---

# MR !3 container-push review — 488c4b2

## Implemented

Reviewed diff cfdf4f4..488c4b2. The container template and preview job are coherent:

- .gitlab-ci.yml:188-207 uses a named Docker context for docker:dind TLS, avoiding the prior buildx failure, and pins the privileged hosted runner.
- .gitlab-ci.yml:209-217 computes vX.Y.Z floating tags only for stable releases. Prereleases and mr-<iid> previews match *-* and therefore never receive latest, major, or minor tags.
- .gitlab-ci.yml:223-233 disables provenance/SBOM attestations for the affected GitLab registry path and reads the pushed index back with imagetools inspect.
- container (.gitlab-ci.yml:235-239) remains release-tag-only and needs both desktop packages plus quality/browser jobs.
- container-preview (.gitlab-ci.yml:241-247) is manual, non-blocking, MR-only, and needs only quality/browser jobs. Supplied live evidence shows job 16354095695 successfully pushed mr-3 with amd64 and arm64 manifests.
- release (.gitlab-ci.yml:251-290) still requires both desktop artifacts, checks amd64 deb/AppImage and macOS dmg/app.tar.gz, rejects duplicate filenames, writes SHA256SUMS, uploads every file with CI_JOB_TOKEN, and invokes release-cli with description release-notes.md plus one assets-link JSON argument per uploaded file. release-cli supports a path as --description, so this invocation reads the generated body.
- tests/contract/desktopReleaseWorkflow.test.js:60-86 pins the named context, disabled attestations, inspect step, preview rules/tag, both package needs, and no optional release artifact. docs/desktop/BUILD.md:203-207 accurately documents the preview tag.

No P1 issue was found.

### P2

GitLab documents release-cli as deprecated (since GitLab 18.0, with removal planned in 20.0) and recommends glab release create. The current downloaded release-cli path is still valid today and the command shape is compatible, so this is a maintenance risk rather than a current MR blocker. Track migration before the announced removal.

The release job itself could not be exercised in this pane because it requires a release tag, both self-hosted desktop artifacts, registry upload permissions, and the release-cli binary. The supplied previous pipeline evidence covers the container preview, not the release job.

## Tested

- npm test — exit 0; 1,920 passed, 0 failed.
- npm run check — exit 0; syntax checks passed and skill bundles are up to date.
- glab ci lint .gitlab-ci.yml — exit 0; output: ✓ CI/CD YAML is valid!
- git diff cfdf4f4 488c4b2 — reviewed; container template, preview job, docs, and contract pins.
- Source grep confirms the release asset checks and upload loop at .gitlab-ci.yml:271-290.
- GitLab documentation lookup confirms release-cli supports reading a description from an existing file path; current GitLab documentation marks release-cli deprecated and recommends glab.

## Unable to test

No release-tag pipeline was started, no registry artifacts were modified, and no tracked files were changed. The homelab/macOS package jobs and release upload were not rerun locally.

## Verdict

Approve merging MR !3. The container push repair and MR preview provide adequate evidence; schedule migration from deprecated release-cli to glab before the documented removal window.

