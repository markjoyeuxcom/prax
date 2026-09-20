# v0.35.0 repository review — repair results

All ten findings from the [original review](2026-09-20-codex-full-repo-review.md)
have been addressed in the working tree based on `6f609dd`. These are repository
repairs; publishing a release or updating an installed Prax app is a separate step.

## Changes and regression evidence

| Finding | Repair | Evidence |
| --- | --- | --- |
| R01 | A document update and its durable operation receipt commit together. Replays return current state without reapplying the patch. CLI/skills and MCP use the new endpoint; remember supplies its reviewed baseline. Legacy updates are sent once. Other unreceipted CLI/MCP operations retry only proven pre-connection failures. | `tests/backend/reviewRepairs.test.js`: lost-response/intervening-writer cases through CLI by ID, cross-project remember and MCP; metadata-only replay; competing retries; changed intent; deletion; restart; receipt-storage rollback; legacy response loss; task and verification retry audit. `tests/mcp/praxClient.test.js` covers refusal versus reset. |
| R02 | Verification conflict responses can reseed only the unchanged initiating editor. Navigation, new drafts, reseeding and input invalidate that ownership. | `tests/frontend/reviewAsync.test.js`: another document, same-document typing, away-and-back, unavailable recovery storage and unchanged-editor reconciliation. `tests/e2e/review-repairs.spec.js` exercises a delayed real 409 while editing another document. |
| R03 | Listings include project slugs. Older ID-only listings resolve through projects; ambiguous/unresolved owners cannot silently create a duplicate. | Production API/client tests in `reviewRepairs.test.js`, older-server and ambiguity checks in `tests/cli/remember.test.js`. |
| R04 | Migration 0031 adds an atomic database guard against supersession cycles. Dedicated and generic routes return a structured conflict. | Short/long cycles, concurrent opposite edges, valid replay and unaffected derived-from links in `reviewRepairs.test.js`; existing lifecycle and historical migration tests. |
| R05 | Verification and delayed document opens retain their walk/position ownership. Late verification counts in its own walk without advancing a different document; the count updates in place. | Deferred verify/Skip/Back/new-walk/open cases and the ordinary advance in `reviewAsync.test.js`; real browser journeys and the final verification-count check. |
| R06 | External refresh checks the active view instead of an editor ID retained after navigation. | Deferred refresh test plus an editor → Today → external-write → focus browser journey. |
| R07 | The document fingerprint includes revision and verification fields, retaining the existing coalesced refresh scheduler. | Verify/unverify/unchanged-refresh tests and a real second-client trust-change browser journey. |
| R08 | Deleting a project with tasks queues one bulk calendar reconciliation after commit. | Production routes/pusher with a local Google transport fixture prove its events are removed. |
| R09 | Gemini parts, signatures and optional call IDs survive parsing, canonical history, approval storage, input validation and replay. | `tests/backend/geminiContinuation.test.js`: signed parallel read tools, approval/decline recovery, final text signatures and bounded/mismatched input rejection. |
| R10 | Library, editor and Today explain that unverified memory can be recalled and verification records human review. | Renderer assertions on all three surfaces, plus a production recall test that preserves labelled unverified retrieval. |

The Gemini fixture follows Google's [full-part signature replay contract](https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures).
No paid provider generation or live Google account was used.

## Validation

- Full local unit/contract suite: **2,176 passed**, no failures or skips.
- `npm run check`: passed; CLI changes rebuilt into both committed skill bundles.
- Full browser suite through Parley's approved native command path: **130 passed**.
- Final focused browser rerun after the review-count refinement: **6 passed**.
- Portable export/import drill: passed with 200 tasks, 150 checklist items,
  project remapping and regenerated IDs.
- Backup/restore drill: passed, including live WAL data, integrity, historical
  upgrades through migration 0031, semantic fixture checks and production boot.
- `git diff --check`: passed.

The first native browser attempt exposed a test setup error (typing while still
in Preview mode); the corrected test and full suite passed. The pane itself
cannot launch Chromium because of macOS MachPort restrictions; the successful
browser results above were captured from approved host runs.

## Performance evidence

The [in-process measurement script](2026-09-20-repair-performance.mjs) compares
the original and repaired application on the same Mac, with 5,000 tasks and 750
documents, 10 warmups and 51 samples. [Raw measurements](2026-09-20-repair-performance.json)
include the sample arrays and environment. These are CPU/SQLite/Fastify costs,
not browser or model latency and not an activated release budget.

The added safeguards have small measured absolute costs: median receipted updates
increased from 0.246 to 0.295 ms, full-workspace fingerprinting from 0.785 to
1.227 ms, and inserting a supersession edge across a 750-document chain from
0.121 to 0.683 ms. These measurements cover individual operations, not sustained
traffic or long-term receipt-table growth.

The [native validation runner](2026-09-20-native-validation.mjs) also compared
the two application versions in Chromium using the same large fixture, three
warmups and 11 samples per journey. The existing measurement harness needed to
open the New menu before Quick capture; that instrumentation fix was applied
identically to both versions. [Raw browser and HTTP results](2026-09-20-repair-browser-performance.json)
include the samples, resource observations and machine details.

| Browser journey | Median before → after (ms) | p95 before → after (ms) |
| --- | ---: | ---: |
| Shell feedback | 234.33 → 235.11 | 293.00 → 243.09 |
| Task collection completion | 245.48 → 244.30 | 351.96 → 355.85 |
| Quick capture feedback | 207.94 → 209.06 | 327.90 → 318.96 |
| Library completion | 343.05 → 343.13 | 516.96 → 507.89 |
| Editor completion | 449.90 → 450.93 | 491.17 → 500.82 |

All five medians changed by less than 1.2 ms. This run found no material median
browser slowdown. Tail timings varied in both directions; with 11 samples the
reported p95 is the maximum, so it is weak evidence of tail-latency behavior.
End-of-run Node RSS was 534.7 MB before and 547.6 MB after; this single observation
does not establish a persistent memory increase. The empty receipt table and
trigger added 8 KiB to the fixture database. These are measurements on one M4 Max,
not a cross-device guarantee or an activated release-performance budget.

## Operational notes

Migration 0031 creates a receipt table and a supersession-insert trigger. It does
not rewrite existing document bodies or remove existing links. Receipt rows are
retained after document deletion to prevent a delayed replay from recreating or
reapplying an operation. Historical cyclic data, if present, remains available
for deliberate unlinking; the guard prevents new cycles, including through
archived edges that could become live on restore.

The updated HTTP retry/ownership behavior is documented in
[the contract](../contract.md#document-update-retries) and
[the memory guide](../agent-memory.md#how-a-remember-is-written).
The original bug-asserting reproduction script is historical evidence for an
unmodified `6f609dd` checkout; use the regression tests for the repaired tree.

These checks do not activate Gate B or substitute for the outstanding manual
assistive-technology/native-platform drills. Native Rust code and dependencies
were not changed; no new Rust build was performed in this pane.
