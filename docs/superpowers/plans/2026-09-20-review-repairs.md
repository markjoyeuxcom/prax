# Repair the v0.35.0 repository review findings

Scope: R01–R10 in `docs/reviews/2026-09-20-codex-full-repo-review.md`.
Preserve the existing UI, retrieval policy, trusted-network boundary and release version.

## Design and implementation order

1. R01: add a receipt-backed document-update endpoint. A stable operation ID
   identifies the exact patch; the receipt and mutation commit in one SQLite
   transaction. Replay returns current canonical state without reapplying the
   patch; changed intent and deleted results are explicit conflicts. CLI/skills
   and MCP use this endpoint. Older servers receive at most one legacy PATCH,
   with an explicit unknown outcome on transport failure. Remember carries the
   revision it read so an intervening content edit conflicts before first commit.
2. R03/R04: return project slugs in document listings, resolve older listings by
   project ID, and reject cycles atomically when adding supersession links.
   Reject both dedicated and generic-link paths, including concurrent requests.
3. R02/R05: bind verification and review continuations to the editor/walk that
   initiated them. Preserve newly typed input, navigation and autosave ownership.
4. R06/R07: refresh outside the actual editor and include trust changes in the
   existing collection fingerprint without adding a polling loop.
5. R08: queue bulk calendar reconciliation after committed project deletion.
6. R09: retain Gemini response parts, including thought signatures, through
   assistant history and approval round trips, with bounded validation at input.
7. R10: describe verification as a trust signal on every affected UI surface.

## Review and validation

Add regression tests using production SQLite/routes/client paths, deferred
frontend I/O and signed provider fixtures. Include delayed-response browser
journeys where practical. Keep the original review evidence as a historical
reproduction and document the replacement regression checks.

Run targeted tests, rebuild skills, then `npm test`, `npm run check`, portable
and backup/restore drills. Run browser journeys and the large-fixture performance
instrument when available; distinguish environment failures from test failures.
Review the final diff for retry safety, stale-state ownership, migration behavior
and unnecessary work on read/typing paths. No release publication is part of
this repair task.
