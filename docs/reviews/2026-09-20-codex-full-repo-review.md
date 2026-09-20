# Prax repository review — 2026-09-20

Reviewed by Codex at `6f609ddba0ad7b171dd2ec34a3b90462748c1dcd` (`main`, v0.35.0). The checkout was clean when review began. No application code was changed. This report and its reproduction script are the review deliverables.

**Repair follow-up:** the subsequent request to resolve these findings is tracked
in [the repair results](2026-09-20-review-repair-results.md). The findings below
describe the original reviewed commit; they are not a list of remaining defects
in the repaired working tree.

**Ten actionable findings: two P1 and eight P2.** The existing automated gates pass, but the adversarial checks below reproduce gaps in memory writes, document review, external refresh and integration behavior. R01 and R02 can lose newer edits under the stated conditions. Fix confirmed invariant violations before another release, as required by [Gate A](../superpowers/specs/2026-07-13-exceptional-prax-quality-standard.md).

## Findings

### R01 — P1: Memory updates by ID replay an old body over a newer accepted edit

Locations: [cli/lib/apiClient.js:223](../../cli/lib/apiClient.js#L223), [cli/lib/remember.js:54](../../cli/lib/remember.js#L54).

`remember --id` reads the document and then sends an unconditional PATCH. `updateMemory` enables automatic transport retries, but that PATCH has neither an operation receipt nor an `ifRevision` precondition. If the first PATCH commits and its response is lost, another writer can commit a newer body before the retry. The retry silently reinstalls the older body and reports success.

Reproduced with the real CLI client, remember engine and production SQLite routes: first PATCH committed “older agent write”; an intervening human PATCH committed “newer accepted human edit”; the simulated lost response caused a second PATCH, leaving “older agent write” stored. The safe upsert-by-title receipts do not protect this path. The cross-project PATCH branch will have the same exposure once R03 is repaired.

Use an operation identity with durable replay semantics, or a revision precondition plus explicit reconciliation. Audit the equivalent retry-enabled MCP update methods too. Regression: an interleaved old-write/new-write/retry must preserve the newer write. QINV-03/09.

### R02 — P1: A delayed verification conflict can replace a newer editor draft

Location: [public/js/main.js:1930](../../public/js/main.js#L1930).

The verification-conflict branch always calls `seedEditorDraft(result.document)` after awaiting the verification/reconciliation request. It does not check that the user is still reviewing that document or that the editor has not acquired newer input. Navigation remains possible while verification is pending.

Reproduced with the exact checked-in handler and draft-seeding function: verification of A waits; the user opens B and types; A's conflict response then sets both editor IDs back to A, replaces B's in-window text and clears its dirty state. With local recovery storage unavailable, B's only draft is lost. With working storage it may be recoverable by reopening B, but the late response still replaces the user's current context and cancels the current autosave timer.

Guard the response with document identity and an editor generation. Update A's collection record without replacing a newer editor; preserve or merge newly typed text even when the same document is still open. Regression: delay a 409/reconciliation response, navigate and type, then release it, including the storage-failure case. QINV-01/09.

### R03 — P2: Cross-project remember cannot deduplicate against the production listing

Locations: [cli/lib/remember.js:94](../../cli/lib/remember.js#L94), [server/libraryRepository.js:774](../../server/libraryRepository.js#L774).

`findTitleElsewhere` abandons cross-project matching if a matching document lacks `projectSlug`, treating that as an older server. The current production `listDocuments` query selects `d.*` without joining the project's slug. Consequently, normal cross-project remember takes that fallback on this release too.

Reproduced by creating a document in a user project and remembering the same title with the default shared-memory destination. The command creates a second document in `memory`, leaves the original body untouched and reports creation. Two active versions can subsequently be recalled. Existing cross-project unit tests supply `projectSlug` in mocks, hiding the producer/consumer mismatch. Recall already resolves missing slugs through the project list; remember does not.

Return project identity in the listing or resolve `projectId` through the project list before matching. Add a production-route integration test covering a unique title elsewhere and ambiguity across projects. Preserve safe retry behavior when fixing this; see R01.

### R04 — P2: Supersession accepts cycles that remove every replacement from active retrieval

Locations: [server/libraryRoutes.js:1112](../../server/libraryRoutes.js#L1112), [server/documentLinksRepository.js:21](../../server/documentLinksRepository.js#L21).

The dedicated supersede route rejects only identical IDs. The generic link route and repository also allow a supersedes edge back to an ancestor. Both endpoints require non-archived documents but allow superseded replacements.

Reproduced through the real CLI client and API: supersede A with B, then supersede B with A. Both writes succeed; both records become `superseded`; neither remains in the active listing used for default retrieval. No active replacement terminates the chain. Data remains stored and can be recovered by removing an edge, but the accepted lifecycle operation has hidden the entire chain.

Reject a supersedes edge when its target already reaches its source, within the same transaction as insertion. Apply that rule to both dedicated and generic linking, and cover two-node, longer and concurrent cycles. QINV-05.

### R05 — P2: A late verification advances whichever review walk is current

Location: [public/js/main.js:3670](../../public/js/main.js#L3670).

`reviewWalkVerify` captures the starting walk, awaits verification, then increments and advances `state.reviewWalk` without checking that it is still the same walk and position. Skip and Back to queue remain available while that request is pending.

Reproduced with the exact handlers and deferred verification: begin verifying A, click Skip to open B, then deliver A's verification. The handler advances from B to C without a decision on B. Leaving the walk entirely also makes the continuation operate on an invalid replacement walk. The per-document mutation guard does not guard the walk transition.

Give each walk a generation and advance only if the initiating document and index remain current. Coordinate Skip/Back with pending verification and guard late document opens too. Add delayed-response cases alongside the existing successful sequential browser journey. QINV-09.

### R06 — P2: External Library refresh stops after the first editor visit

Location: [public/js/main.js:374](../../public/js/main.js#L374).

`refreshFromOutside` reloads documents only when `editorDocId` is falsy. Ordinary navigation out of the editor retains that ID: `navigateTopLevel`, `goProject` and `goLibrary` change the view without clearing it. An ID left in state therefore disables the document refresh even when the user is on Today or the Library.

Reproduced by running the exact refresh function with the state retained after editor navigation: the task collection loads, but the document loader is never called. Agent writes then fail to appear in Today's agent card, Library contents and review counts on focus/visibility refresh. Entering the Library again explicitly reloads it, which can conceal the bug during manual checks.

Test whether the editor is actually active rather than whether a prior document ID exists. Regression: open a document, leave it, write a memory externally, then focus the main window. QINV-05.

### R07 — P2: External verification changes are omitted from the refresh fingerprint

Locations: [public/js/externalRefresh.js:19](../../public/js/externalRefresh.js#L19), [server/libraryRepository.js:305](../../server/libraryRepository.js#L305).

The collection fingerprint includes ID, update time, archive time and lifecycle status, but excludes verification fields. Verification changes `verified`, `verified_at` and `verified_by` without changing `updated_at`.

Reproduced independently of R06, with no editor ID set: a real API verification returns a changed trust state with an identical fingerprint. The exact external-refresh handler fetches the verified record but returns `changed: false` and performs zero renders. The visible queue, verification count and trust chips continue showing the prior state until another UI action causes a render. Unverification has the inverse effect, leaving a stale VERIFIED chip visible.

Include all relevant trust fields in document change detection, or provide a dedicated mutation/version token that changes on verification without falsifying the content-edit timestamp. Regression: verify and unverify from a second client, then focus the untouched Library. QINV-05.

### R08 — P2: Project deletion does not queue removal of its Google Calendar events

Location: [server/projectsRoutes.js:149](../../server/projectsRoutes.js#L149).

Permanent project deletion removes its tasks in the database but never notifies `calendarPusher`. The individual task deletion and task-import paths do notify it.

Reproduced using production routes and the real calendar pusher with an in-memory Google client: creating a dated task and flushing creates one event; deleting its project reports one deleted task; flushing again leaves the event in place. Calling `notifyBulkChange` and flushing removes it. Users retain obsolete events/reminders until a manual sync or the 15-minute sweep; quitting before that sweep leaves them until a later reconciliation.

Queue one bulk reconciliation after the project transaction commits. Test deletion of a project with synced tasks and verify the scheduled reconciliation removes their events. No live Google account was modified.

### R09 — P2: Gemini tool continuations discard required thought signatures

Locations: [server/chat/toolProtocol.js:226](../../server/chat/toolProtocol.js#L226), [server/chat/toolProtocol.js:205](../../server/chat/toolProtocol.js#L205).

`parseGemini` keeps only text and function name/arguments; `geminiContents` reconstructs the function-call parts without their `thoughtSignature`. The assistant's next request therefore loses provider metadata needed to continue that call.

Reproduced through the real Gemini adapter and assistant loop with a local transport fixture: the first response contains a signed function call, and the captured second request contains the call without its signature. Google's [thought-signature contract](https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures) requires that signature for Gemini 3 tool continuations and specifies HTTP 400 when it is missing. The wire-format loss is locally observed; the provider rejection is a documented-contract conclusion, not a paid live-model test. The default Gemini 2.5 model does not impose the same mandatory check.

Preserve original provider parts through parsing, canonical history, approval serialization and replay. Test both a read-only tool loop and a write resumed after approval with a signed response fixture.

### R10 — P2: The review UI promises verified-only recall, but recall includes unverified memory

Locations: [public/js/renderLibrary.js:693](../../public/js/renderLibrary.js#L693), [public/js/renderEditor.js:151](../../public/js/renderEditor.js#L151), [public/js/renderToday.js:247](../../public/js/renderToday.js#L247).

The Library banner and review strip say that only verified memory is recalled by default; Today says agents recall only what the person verifies. The shared recall engine deliberately returns active unverified documents with an unverified label. The repository instructions also tell agents to treat those results as leads.

Reproduced with the real CLI recall engine and production routes: a normal query returns the newly created, unverified agent document as its top hit. This is the previously noted UI wording defect, revalidated on v0.35.0. The wording falsely presents review as a gate that withholds content from agents.

Correct all three surfaces to describe verification as a trust signal. Do not silently change retrieval policy to make the copy true. Add a consistency assertion between the displayed policy and an actual unverified recall result.

## Verification and coverage

| Check | Evidence |
| --- | --- |
| Local `npm test` | 2,141 passed; zero failures, skips or cancellations |
| Local `npm run check` | Passed; committed skill bundles current |
| Local `npm audit --json` | Zero reported vulnerabilities in the resolved dependency graph |
| Local `npm run verify:portable` | Passed: 200 tasks, 150 checklist items, project remapping and regenerated IDs |
| Local `npm run verify:restore` | Passed: integrity, WAL/live marker, historical migrations and production boot |
| Keyword/context-pack retrieval eval | 7/7 cases passed; this is not a live semantic-model quality evaluation |
| Adversarial review reproductions | All ten cases reproduced; command below |
| Browser tests for this exact commit | [GitLab browser job](https://gitlab.com/markjoyeuxcom/apps/prax/-/jobs/16608674998): 126 passed |
| Release pipeline for this exact commit | [v0.35.0 pipeline](https://gitlab.com/markjoyeuxcom/apps/prax/-/pipelines/2864686348): Node checks, browser tests, Linux desktop, macOS desktop and release succeeded |

Run the historical companion evidence from an **unmodified checkout of the
reviewed commit**. The repaired tree uses the regression tests linked in the
repair results instead:

```sh
node docs/reviews/2026-09-20-codex-review-repros.mjs
```

The [script](2026-09-20-codex-review-repros.mjs) uses disposable in-memory SQLite databases and local mock transports. Browser-state cases execute the exact checked-in functions in a VM with deferred I/O and minimal state/DOM dependencies. It asserts that the reported defects exist: a repaired case should make its corresponding assertion fail. It is review evidence, not a proposed permanent regression suite or a fresh browser walkthrough.

Source review covered database transactions/migrations, task recurrence/import/checklists/activity, document revisions/trust/links/export/runs, retrieval and provider adapters, assistant approvals, CLI/MCP memory paths, browser drafts/navigation/review/refresh, desktop origin/IPC/sidecar lifecycle, backups, packaging, deployment and GitLab CI. Earlier review reports and existing regression cases were checked to avoid re-reporting repaired issues. This was a broad repository review, not a claim that every line or execution path has been proven correct.

Local Chromium failed before the first test could run because macOS denied its MachPort rendezvous registration. Cargo was unavailable through both PATH and mise, so native Rust tests/builds were not repeated locally; the successful GitLab desktop jobs are separate evidence. No fresh desktop interaction, live OAuth round trip, paid provider generation, screen-reader assessment or performance-budget run was completed. The NL evaluation could not run without a configured chat backend. The intentional trusted-network/no-authentication design was reviewed on its own terms, not counted as a defect.

## Follow-up priorities

Repair R01/R02 first, then memory deduplication and supersession validity (R03/R04), followed by the review and refresh state transitions (R05–R07). Correct the integration and trust-copy gaps (R08–R10) in the same repair cycle. Add production-route tests where mocks currently hide response-shape mismatches, and browser tests that deliberately delay responses and change context while requests are pending.

The release pipeline's successful run provides useful baseline evidence. Its unpinned Rust downloads, missing explicit download deadlines/retries, non-reconciling release-create retry path and ineffective post-extraction filename-collision check remain operational hardening opportunities; no timeout or artifact collision was demonstrated in this review. Deployment documentation also retains statements that container images are built on release tags, while the current README and pipeline explicitly say they are not published. Keep those maintenance items separate from the reproduced product defects above.
