# Release-candidate repairs — 2026-09-06

Repairs for the findings in
[`docs/reviews/2026-09-06-release-candidate-review.md`](../../reviews/2026-09-06-release-candidate-review.md)
(Claude, consolidated) and
[`docs/reviews/2026-09-06-codex-rc-review.md`](../../reviews/2026-09-06-codex-rc-review.md)
(Codex, independent). Branch `fix/release-candidate-2026-09-06`. Apple Developer ID signing stays
out of scope.

## Blockers

1. **Upsert replay data loss (QINV-03).** `document_upsert_receipts` (migration 0027) keyed by
   the caller's operation id, checked before the title lookup, for updates and creates. Replay →
   current document, `replayed: true`; changed intent → 409; document deleted since → 410.
   Evidence: `tests/backend/libraryUpsertByTitle.test.js`.
2. **Registry owner.** `release.yml`, `compose.image.yaml`, `deploy/**`, docs → `markjoyeuxcom`.
3. **Version cut.** `scripts/prepare-release.mjs` + `scripts/release-sites.mjs`; the verifier
   checks every site. 0.21.0 cut with the repaired changelog.
4. **Release gate parity.** Browser suite and audit added to the release quality job; body from
   `scripts/release-notes.mjs`; prerelease tags accepted so `v0.21.0-rc.1` exercises the path.

## P1

5. Recall and search on the paged semantic route with coverage disclosure (`cli/lib/recall.js`,
   `cli/lib/search.js`).
6. Instance binding in `cli/lib/apiClient.js`; base URL in the remember output.
7. `recall --recent` active-only, trust labels in output.
8. `skills/install.sh`: gh-credentialed HTTPS, Node check, Claude dir override, uninstall via
   `sh -s -- --uninstall`; `tests/skills/installScript.test.js`.
9. Unsigned statement in the release body.

## P2

Documentation findings D01–D27 and the consolidated P2 list; `mise.toml` committed;
`ROOM-prax.md` ignored.

## Codex review of PR #118 (same day)

Codex's independent review of the repair branch (`.local-review-backups/codex-pr118-review.md`,
mirrored as [`docs/reviews/2026-09-06-codex-pr118-review.md`](../../reviews/2026-09-06-codex-pr118-review.md))
confirmed the blocker repairs and found five follow-ups, all fixed in the second commit:

- **F1** concurrent first requests could each run their own discovery and pin different instances
  → one shared discovery promise per process; the pin is immutable; concurrency regressions in
  `tests/cli/apiClient.test.js`.
- **F2** recall silently capped at the server's 50-result page → pages up to `--limit`, keeps
  `page` metadata, and discloses a remainder; an old server without coverage is "unknown".
- **F3** the gh credential helper applied to the clone but not to the sparse checkout that
  fetches the blobs → both go through one wrapper; shim-based regression test.
- **F4/F5** docs: `init` does consult an existing marker; the receipt is checked before the title
  lookup and written after the mutation, in one transaction.
- A macOS CI failure unrelated to the review: `cargo test` compiles the lib and its test harness
  concurrently and both expand `include_image!`, racing on tauri's `$OUT_DIR` cache file
  (observed as an empty tray icon and a divide-by-zero). Both workflows now `cargo build` first
  and run `cargo test --lib`.

Codex's re-verification of that commit (`docs/reviews/2026-09-06-codex-pr118-reverification.md`)
found three more, fixed in the third commit: the `coverage-unknown` label was lost inside the
client's own normalisation of an old server's array (now preserved end to end, with tests through
the real client); the F1 concurrency tests had not actually been committed (now present); and the
exact-commit CI was red only because GitHub's dependency-review action is unsupported on this
private repository (the job now runs only on a public repository, `npm audit` stays the gate).

## Not done here

- Image on merge to `main` (roadmap; a separate workflow decision).
- Desktop ICS subscription URL (product decision recorded in `docs/ROADMAP.md`).
- Pushing the `v0.21.0-rc.1` tag: outward-facing, left for the user after review.
