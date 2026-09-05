# Prax — Codex independent codebase review

Review baseline: `0c3cdfa9a63f021c983e7985a1df57cd60ffb388`. Initial working tree: modified `prax.db-shm` and `prax.db-wal`; untracked `ROOM-prax.md`. Those files were excluded from inspection and left untouched. No implementation changes or commits. This initial report was completed before reading Claude or Agy findings.

Reviewed major surfaces: HTTP routes and SQLite repositories/migrations; task recurrence, planning, checklists and runbooks; Library trust, retrieval, graph and exports; assistant/MCP/CLI mutation handling; browser orchestration and draft recovery; provider configuration and calendar integration; desktop origins/lifecycle/permissions; container and CI/release packaging. Review is evidence-based, not a claim that every possible behavior is proven. The intentional trusted-network/no-auth model is not itself a finding.

## Findings

Priorities: P1 = fix before release because of startup failure, lost user content, duplicate consequential operations, or incorrect trust; P2 = actionable correctness/security/verification defect. Gate A may block release for a confirmed invariant violation regardless of priority.

### C01 — P1: Container omits modules required at startup

`deploy/Dockerfile:20–24` copies `server` and `public`, but omits `mcp`. `server/assistant/injectClient.js` and `server/assistant/tools.js` import that directory through the unconditional server import graph. A temporary copy matching the Dockerfile application layout fails to import `server/index.js` with `ERR_MODULE_NOT_FOUND` for `mcp/praxClient.js`. Include the full runtime dependency tree and test startup from the image layout. Docker itself is unavailable here; this was a Node startup reproduction of the exact copied application paths.

### C02 — P1: Desktop per-launch ports strand persistent drafts and preferences

`src-tauri/src/lib.rs:359` requests a fresh port on every launch. `public/js/main.js:1882`, `public/js/documentDraftRecovery.js:37`, `public/js/taskCaptureRecovery.js:73`, and `public/js/preferences.js:112` persist state in origin-scoped localStorage. A changed port creates a different storage origin. In one browser context, two ephemeral localhost app origins changed a saved dark preference to the light default and made an existing document recovery record unreadable. Unsaved task/document/capture drafts and saved views can disappear from the next desktop session. Persist durable frontend state independently of the changing sidecar origin; preserve the exact-origin security restriction. Browser origin behavior was reproduced; a packaged native restart was not run.

### C03 — P1: Body-only editor autosave overwrites a newer remote title

`public/js/main.js:2152–2155` sends both title and body on every autosave; `server/libraryRepository.js:109–153` performs an unconditional update. Open a document, let another client rename it, then edit only its body in the original editor. The successful autosave writes the old title back, with no conflict or recovery prompt. Reproduced in Chromium against real SQLite: remote title `New remote title` became `Original title` while the local body saved. Send only edited fields and atomically guard writes against the reviewed baseline; same-field concurrent changes also need conflict handling. QINV-01/09.

### C04 — P1: One project debounce timer drops edits to other fields

`public/js/main.js:5493–5509` shares `projectOpsSaveTimer` across on-call, handoff, repository URL and area inputs, and only patches the most recent field. Editing another field inside 600 ms cancels the first field's only persistence attempt. The draft is not immediately copied into state and failures are swallowed. Real-browser reproduction: enter On call, then Handoff; stored On call remains null while Handoff saves. Preserve and flush independent field/project drafts, with truthful failure recovery. QINV-01.

### C05 — P1: Quick-capture success clears newer input

`public/js/captureBar.js:69–73` unconditionally clears the input and its saved draft when an older request succeeds, while the input remains editable during the request. Hold a create response, type a second capture, then release the response: the second text and localStorage record are both cleared. Reproduced against the production route. Tie completion to the submitted draft revision or preserve the newer text. QINV-01/09.

### C06 — P1: Quick-capture reload loses the exact-once identity

`public/js/captureBar.js:25,58,105` keeps `pending.payload.id` only in memory; localStorage contains just the text. If task creation commits but its response is lost, reload and press Enter: a new UUID creates a duplicate task. Browser reproduction committed the first request, aborted its response, reloaded and retried; two tasks resulted. Persist the submitted intent and UUID with the recoverable text until the outcome is reconciled. QINV-02/03.

### C07 — P1: Replaying an assistant approval repeats creates

`server/assistant/agent.js:136–137` executes echoed approved tool calls every time, while `mcp/tools/tasks.js:78` generates a fresh UUID when the model omitted one. The generated identity is not written into the pending canonical call or stored as a receipt. Sending the identical approval payload twice produced two tasks with distinct IDs, both HTTP 200. Protect the approval operation with a stable, durable identity for each consequential tool call; document/checklist/run generation has the same class of exposure when IDs are omitted. QINV-03. This is a replay correctness issue, not an authentication complaint.

### C08 — P1: Verification guard does not cover the reviewed title

`server/libraryRepository.js:7,118,207` hashes only the body, although an agent title change correctly revokes verification elsewhere in the same module. A person can review title A, an agent can change it to B, and the old contentHash still verifies B. Production-route reproduction returned HTTP 200 and `verified:true` for an unreviewed agent title using the earlier hash. Use a reviewed revision token covering all content that verification blesses, and require the token for attended verification. QINV-04.

### C09 — P2: Delayed title embeddings can overwrite newer vectors

`server/embeddingService.js:17–23` embeds title plus body, but `server/libraryRepository.js:298` guards the commit with a body-only hash. Two title revisions share that guard. Holding the old job, saving the latest title/vector, then releasing the old job replaced `[0,1]` with `[1,0]`; the repository reported success. Guard with the full embedded-input revision and the active provider generation. QINV-09.

### C10 — P2: Semantic search ranks stale content and incompatible models

`server/libraryRepository.js:310` filters only by backend, without checking `embedded_hash = content_hash` or the active embedding model. A changed document remains searchable using its old vector; a switch to a different same-dimension model ranks vectors from incompatible spaces. Reproduction returned the latest, unrelated body as a match even while `countEmbeddings` reported zero embeddings current for the chosen model. Exclude stale/mismatched vectors and make incomplete-index degradation explicit. QINV-08/09.

### C11 — P1: Large native task exports cannot be imported

`server/index.js:26` uses the server's default request-body limit; `server/tasksRoutes.js:530` has no import-specific override or chunk protocol. Running the project's own `runPortableRoundTripDrill({profile:'large'})` fails with `Target task import failed with HTTP 413: Request body is too large`, although the fixture is within the declared 5,000-task record limit. The standard 200-task drill passes. Support bounded large imports end-to-end and keep atomic replacement/exact-once behavior; exports larger than the separate record-count cap also need a truthful supported path. QINV-06.

### C12 — P2: Calendar updates queued during a slow push are stranded

`server/googleCalendarSync.js:140–143` returns the current drain when a debounce fires during an existing drain. Once that drain completes it clears `draining`, but does not schedule or process the newly queued IDs. A controlled pusher reproduction notified two tasks around a blocked first push and observed only one push after both debounce intervals elapsed. The second task waits for another edit, manual sync, or the 15-minute sweep despite the documented few-second live sync. Drain pending work again on completion, with a single serialized owner. QINV-09.

### C13 — P2: Normal idempotent imports never trigger calendar reconciliation

`server/tasksRoutes.js:564–565` returns from the requestId import branch before the bulk notification present in the legacy branch. The Settings import uses requestId, so append/replace does not perform the promised immediate reconcile. Production-route reproduction imported a dated task with HTTP 201 and recorded zero bulk notifications. Notify after a new committed import, preserving replay semantics.

### C14 — P2: Google all-day payload represents an empty date interval

`server/googleCalendar.js:86–87` sets all-day start and end to the same date. Google defines end as exclusive; a one-day event needs the next date as its end. Pure-helper output is `{start:{date:'2026-09-04'},end:{date:'2026-09-04'}}`, unlike the correct next-day handling in the ICS serializer. This does not represent the promised one-day event. Provider rejection/display consequences are inferred from the API contract; no live Google account was modified. [Google event insert contract](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert).

### C15 — P2: Non-ASCII keyword searches silently become unfiltered browsing

`server/libraryRepository.js:460–465` extracts only `[a-z0-9]` and omits the search predicate when nothing remains. A query of `数据库` returned an unrelated English document. Accented words can also be broken into mismatching token fragments. Preserve Unicode terms safely for FTS, and never treat a nonempty unsupported query as no query. This affects HTTP/MCP keyword search and retrieval fallbacks. QINV-08.

### C16 — P2: Export filename deduplication breaks link destinations

`server/libraryRoutes.js:276,292` deduplicates ZIP entry names, but `buildLinksFromGroups` reconstructs refs from the original title/filename. Two titles `Same!` and `Same?` export as `same.md` and `same-2.md`; a link to the second document still exports `ref: same.md`, pointing to the first body. Reproduced with a real ZIP export and `unzip`. Build link refs from the final ID-to-entry-path map. QINV-06.

### C17 — P2: OAuth callback reflects unescaped HTML

`server/googleCalendarRoutes.js:88–91` interpolates the query's `error` into an HTML response without escaping, even without a valid state. A request containing `<h2 id="injected">Review fixture HTML</h2>` is returned as actual markup with HTTP 200. This permits same-origin page-content injection and misleading account-connection UI. CSP blocks ordinary inline script execution, so this report does not claim a demonstrated JavaScript execution exploit. Escape all callback details, including upstream error text.

### C18 — P2: Weekly “Shipped” uses last edit time instead of completion time

`server/weeklyReview.js:71` counts any currently completed task whose updatedAt falls inside the week. Editing or archiving an old completed task makes it appear newly shipped; editing this week's completion next week removes it from a regenerated historical review. The compiler reproduction counts an old completion with a current notes-edit timestamp as shipped despite no completion event in the period. Use completion events or a persisted completion timestamp, and explicitly handle legacy gaps. QINV-02/08.

### C19 — P2: Browser regression helpers are not portable to macOS

`tests/e2e/editor-autosave.spec.js:7` and the corresponding helpers in `library-editor-reflow`, `trust-actions`, and `wave1-draft-integrity` use `Control+A` to select CodeMirror text. On macOS it does not select all, so replacement appends text and eight tests fail before reaching their intended behavior. The unmodified suite produced 84 passes/8 failures; a temporary copy of those four files with only `ControlOrMeta+A` substituted passed all 18 tests. Fix the helpers, retaining production assertions.

### C20 — P2: Dependency audit gate is currently failing

`package-lock.json` resolves nine packages flagged by the current npm registry advisory database: five high, four moderate. `npm audit --audit-level=high --json` exited 1. High flags cover `@fastify/static`, `brace-expansion`, `fast-uri`, `find-my-way`, and `ip-address`; the full advisory output is retained in evidence. This is a confirmed failure of the repository's CI security gate, not proof that every advisory is reachable in Prax's configuration. Triage reachability and update the graph with registry-verified compatible versions; no replacement versions are recommended here.

## Verification and limits

- `npm test`: 1,781 passed; zero failed/skipped.
- `npm run check`: exit 0.
- Original Chromium suite on an isolated in-memory server: 84 passed, 8 failed from the Mac shortcut issue above.
- Temporary platform-corrected subset: 18 passed, including all originally failing tests. Repository test files were not changed.
- `npm run verify:portable`: passed; 200 tasks, 150 checklist items, target project/identities remapped.
- `npm run verify:restore`: passed; live-WAL and historical migration restore, integrity/semantic checks, markers and production boot verified.
- Large portability drill: confirmed HTTP 413.
- Controlled real-SQLite/API/browser reproductions: see [evidence](2026-09-04-codex-evidence/).
- `npm audit --audit-level=high`: failed as described above.
- `docker` and `cargo`: command not found. No packaged native run or actual container launch. Desktop storage evidence is browser-level plus Rust source tracing.
- No live Google or LLM provider calls, external writes, assistive-technology/manual touch drills, or hardware performance budget activation. Google event semantics checked against official documentation.
- Prax memory recall failed because the configured local API was unreachable. No live workspace database was opened or mutated by the review; temporary servers used `:memory:` or owned fixture directories.
