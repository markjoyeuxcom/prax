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

## Not done here

- Image on merge to `main` (roadmap; a separate workflow decision).
- Desktop ICS subscription URL (product decision recorded in `docs/ROADMAP.md`).
- Pushing the `v0.21.0-rc.1` tag: outward-facing, left for the user after review.
