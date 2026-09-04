# Prax — consolidated independent reviews

**Review baseline:** `0c3cdfa9a63f021c983e7985a1df57cd60ffb388`, 4 September 2026. **Disposition: release blocked under the existing Gate A policy.** Executed reproductions demonstrate lost input, duplicate consequential writes, incorrect human verification, broken portability and startup failures. Passing unit tests do not cover these defect classes.

Codex, Claude and Agy reviewed independently through separate Parley panes. Each received the same broad scope and no other reviewer's findings before completing its initial report. Codex then reconciled the reports, reproduced selected peer findings, and requested focused challenges of uncertain claims. Agreement is identified below; a finding does not require a majority vote to be valid.

No implementation or test files were changed, and nothing was committed. Initial changes to `prax.db-shm`, `prax.db-wal` and the untracked `ROOM-prax.md` were left in place. New repository files are review reports and evidence. Reproductions used in-memory databases or temporary fixtures. Claude additionally tested copies of SQLite files in a scratch directory; the live database was not opened for writing.

## Independent reports and evidence

- [Codex initial review — C01–C20](2026-09-04-codex-independent-review.md) and [independent supplemental checks — C21–C22](2026-09-04-codex-followup.md).
- [Claude initial review — H1–H4, M1–M6, L1–L5](2026-09-04-claude-independent-review.md).
- [Agy initial review — Defects 1–3 and subsystem assessment](2026-09-04-agy-codebase-review.md).
- [Executed reproductions and raw verification logs](2026-09-04-codex-evidence/README.md).
- [Claude's subsequent challenge of desktop storage C02](2026-09-04-desktop-storage-peer-check.md).
- [Agy's subsequent corrections and qualifications](2026-09-04-agy-followup.md).

The initial reports preserve each reviewer's original conclusions. Where an initial claim is broader than its evidence, the qualification in this consolidated report controls the release assessment. Broad positive descriptions in a review are not proof that an invariant holds across every failure mode.

## Findings to address first

### 1. Desktop restarts can strand drafts and preferences — P1

**Source:** `src-tauri/src/lib.rs:359`; `public/js/main.js:1882`; recovery and preference modules. **Provenance:** Codex C02; subsequently challenged and corroborated by Claude.

The sidecar requests an ephemeral port and the main/capture windows use that port in their origin. Drafts, preferences and saved views use origin-scoped localStorage. A changed port makes the previous records inaccessible. In an executed browser reproduction, the same browser context lost access to a saved document recovery record and reverted its theme at the second app origin. Claude found no native storage bridge or server mirror. Persist this state independently of the changing port while preserving exact-origin native permissions. A packaged native relaunch remains untested.

### 2. Git tracks mutable SQLite journals — P1

**Source:** `.gitignore:16`; tracked `prax.db-wal` and `prax.db-shm`; default database path in `server/config.js:48`. **Provenance:** Claude H1; Codex independently confirmed tracked-file metadata.

Git operations can replace database sidecars beside the live default database, and subsequent commits can capture workspace data. Claude paired scratch copies of the current main database and committed WAL and received `database disk image is malformed`. This demonstrates the unsafe pairing, not that this review corrupted the live database. Protect and back up the database before removing journals from version control and correcting ignore rules. No secret disclosure or public repository exposure was established; history rewriting is not part of this review.

### 3. Container and ordinary checkout launch paths fail — P1

**Source:** `deploy/Dockerfile:20–24`; `server/index.js:109`; `server/config.js:49`. **Provenance:** Codex C01; Claude H2/H3, subsequently reproduced by Codex.

These are three separate defects:

- The container omits `mcp/`, although the unconditional server import graph requires it. A temporary application layout matching the Dockerfile fails with `ERR_MODULE_NOT_FOUND` for `mcp/praxClient.js`. Docker itself was unavailable.
- The direct-entry guard compares a file URL to an undecoded filesystem path. Launching from a directory containing spaces exits successfully without listening or printing anything. Claude also reproduced a symlink-path failure; Windows failure is source analysis only.
- The default static root uses URL `.pathname`. In the space-path fixture, directly invoking `buildApp` gives `/healthz` 200 but `/` 404 because the static path contains `%20`. The desktop's explicit `PUBLIC_DIR` avoids this third defect.

Include every runtime module and use filesystem-safe URL/path conversion and entry detection. Add startup checks against the image layout and paths containing spaces; include a packaged Windows launch in release verification.

### 4. Editor autosave overwrites another client's title — P1

**Source:** `public/js/main.js:2152–2155`; `server/libraryRepository.js:109–153`. **Provenance:** Codex C03.

Open a document, rename it through another client, then change only the original editor's body. Autosave sends both fields and restores the stale title without a conflict. This was reproduced in the browser against real SQLite. Save only changed fields and condition writes on an explicit baseline, with recovery for concurrent edits. Sending fewer fields alone does not resolve same-field conflicts.

### 5. Project field edits disappear inside one debounce window — P1

**Source:** `public/js/main.js:5493–5509`. **Provenance:** Codex C04.

On-call, handoff, repository and area share one timer that persists only the most recently edited field. Editing On call then Handoff within 600 ms leaves On call null while Handoff saves. The earlier draft is not retained and failures are swallowed. Keep field/project drafts and flush them reliably with visible failure recovery.

### 6. Quick capture loses newer input and duplicates uncertain writes — P1

**Source:** `public/js/captureBar.js:25,58,69–73,105`. **Provenance:** Codex C05/C06.

Two distinct browser reproductions confirmed the problems. First, a delayed response to capture A clears capture B typed while A was pending, including B's recovery record. Second, task creation commits but its response is lost; reloading and retrying restores the text with a fresh UUID and creates a second task. Associate completion with the submitted draft revision and persist its operation identity until the outcome is reconciled.

### 7. Replayed assistant approval creates duplicate records — P1

**Source:** `server/assistant/agent.js:136–137`; `mcp/tools/tasks.js:78`; `public/js/main.js:734–747`. **Provenance:** Codex C07; Claude M3 independently identified the lost-response recovery exposure.

Identical approval payloads executed twice produced two tasks with different IDs and successful responses. The generated identity is not retained as part of the approved operation. The UI also clears pending approval before receiving a response, making recovery ambiguous. Introduce durable operation identities/receipts and reconcile unknown outcomes; preserve the approval and canonical tool history until resolved. Duplicate creation was executed; Claude's prediction of a subsequent live-provider history rejection was not.

### 8. Human verification can bless unreviewed machine edits — P1

**Source:** `server/libraryRepository.js:7,118,207`; `public/js/main.js:755–760`; `public/js/renderHealth.js:11–18,123–127`. **Provenance:** Codex C08/C21.

Two independent gaps bypass review safety. The verification token hashes only the body, so an old token still verifies a new agent-written title. Separately, Health's Verify action fetches and verifies the latest body without displaying it; an agent edit after the Health list loads is blessed unseen. Both were executed through production routes, the Health case in Chromium. Show the exact revision being approved and atomically verify a token covering all content that approval blesses.

### 9. A supported large task export cannot round-trip — P1

**Source:** `server/index.js:26`; `server/tasksRoutes.js:530`. **Provenance:** Codex C11.

The project's own large portability fixture fails import with HTTP 413, despite being within its 5,000-task cap. The default request-body limit conflicts with the declared portable format. The standard 200-task drill passes. Align payload limits and record limits with actual exported data, preserving atomic replacement and replay behavior; explicitly address exports larger than the record cap as well.

## Other actionable findings

P2 denotes an actionable correctness, security or evidence defect. A confirmed invariant violation still blocks release under Gate A, even when its impact ranks below the findings above.

| Finding | Location | Evidence and required correction | Provenance |
|---|---|---|---|
| Stale title embedding overwrites a newer vector | `server/embeddingService.js:17–23`; `server/libraryRepository.js:298` | Delayed old job overwrote the current vector because the guard hashes body only while embedding includes title. Guard the full embedded input and provider generation. | C09 |
| Semantic search uses stale or incompatible vectors | `server/libraryRepository.js:310` | Changed body and changed same-dimension model still matched stale vectors. Filter by current revision/model and disclose incomplete indexing. | C10 |
| Calendar queue strands edits received during a slow push | `server/googleCalendarSync.js:140–143` | Controlled delayed push plus a second notification processed only the first task. Drain queued work on completion. | C12 |
| Request-ID import skips calendar reconciliation | `server/tasksRoutes.js:564–565` | Successful dated-task import emitted zero bulk notifications. Notify after a new committed import without repeating effects for a replay. | C13 |
| All-day Google events have an empty date interval | `server/googleCalendar.js:86–87`; `tests/backend/googleCalendar.test.js:51` | Helper emits identical start/end dates; the unit test encodes that mistake. Google defines the end as exclusive. Use the next date and test against the provider contract. No live provider request was made. | C14; Agy Defect 1 |
| Non-ASCII Library search becomes an unfiltered listing | `server/libraryRepository.js:460–465` | CJK queries returned unrelated English records; accented words lose letters. Preserve Unicode terms and never erase a nonempty query silently. | C15; Claude M1 |
| Exported Library links target the wrong collision file | `server/libraryRoutes.js:276,292` | Real ZIP assigns `same.md` and `same-2.md`, but links to the second still name the first. Resolve refs from final export filenames. | C16 |
| OAuth callback reflects query/provider HTML | `server/googleCalendarRoutes.js:88–91,111` | Crafted query markup appears in the HTML response. Escape every interpolation. CSP blocks ordinary inline scripts; demonstrated impact is content injection, not proven JavaScript execution. | C17; Claude M4 |
| Weekly Shipped uses edit time rather than completion time | `server/weeklyReview.js:71` | An old completion edited this week appears newly shipped. Use completion events or an explicit completion timestamp, accounting for legacy gaps. | C18 |
| Successful task archive is reported as failed | `public/js/main.js:1234–1247` | Let DELETE commit and drop its response: database archived, failure toast shown, no Undo. Reconcile canonical outcome and separate refresh failures. | C22 |
| Missing document child collections look empty | `server/libraryRoutes.js:647,879` | Missing owner returns 200 `[]` for tasks/similar while links/runs return 404. Similar also hides semantic-off. Enforce owner checks and explicit degradation. | Claude M2; Codex peer reproduction |
| Mac browser helpers break eight regression journeys | Four `tests/e2e/` files identified in C19 | Original suite: 84 pass/8 fail. Only changing select-all to `ControlOrMeta+A` in a temporary copy made all 18 affected-file tests pass. Fix helpers and rerun the full suite. | C19; Claude M6 |
| Dependency security gate fails | `package-lock.json`; `.github/workflows/ci.yml` | Current audit: five high, four moderate; exit 1. Reachability varies. Triage and update using registry-verified compatible versions; rerun gates. | C20; Claude H4 |
| Operating/agent documentation contradicts runtime | `AGENTS.md`; `docs/contract.md:103–104`; `docs/backup-restore.md:84` | Docs say Postgres and env-only providers; runtime uses SQLite and UI-configured providers. Import caps differ; in-container migration command references an omitted script. Correct runbooks/contracts. | Claude M5; Agy Defect 3 (documentation portion) |

The all-day conclusion follows the [official Google event insertion contract](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert). Agy's exact predicted HTTP 400 error text was not observed and is not asserted here.

Two lower-impact input-contract observations remain useful: task search treats `%`/`_` as LIKE wildcards rather than literal characters (`server/tasksRepository.js:520`, Claude L1), and task import accepts/stores loose timestamps such as `"1"` or `"2024"` despite the documented ISO format (`server/tasksRoutes.js:47,99`, Claude L2). Claude reproduced both; Codex confirmed the source paths. Define the intended search syntax and normalize/validate timestamp inputs.

## Claims requiring qualification

- **Agy Defect 2 — restoring deleted Google events:** the code propagates an unexpected 410, but the claimed sequence of POST 409 followed by PUT 410, and the proposed PATCH/import repair, was not exercised. Google's [error guide](https://developers.google.com/workspace/calendar/api/guides/errors) recommends update after a duplicate ID and explicitly discusses 410 for expired sync state or already-deleted deletion requests; that does not establish the report's specific update behavior. Agy explicitly reclassified this as an unverified coverage gap in its follow-up. Retain as an integration hypothesis pending provider-backed evidence, not a confirmed release finding.
- **Agy Defect 3 — arbitrary CLI path:** source confirms operator-configurable executable selection and subsequent `spawn`. `SECURITY.md` intentionally permits local provider settings and requires authentication/TLS outside the trusted boundary. This is not evidence that the default loopback binding fails QINV-07. Document that settings access includes host process execution, and review whether executable selection should remain an operator-only capability. Do not treat a basename allowlist as a security boundary. No malicious command was executed.
- **Claude L3–L5:** active-only 404 semantics, remote Markdown image loading, and verification retention after metadata-only edits are contract/privacy/policy questions. They are not counted here as established release defects. The stale `.prax/project.json` name also needs intent confirmation before changing project identity.
- Codex's attempted task-counter concurrency reproduction did not fail and is explicitly excluded.

## Verification performed

| Check | Result |
|---|---|
| `npm test` | 1,781 passed; zero failed/skipped. All three reviewers reported the same result. |
| `npm run check` | Passed for all three reviewers. |
| Original Chromium browser suite | 84 passed, 8 failed on this Mac; Codex and Claude independently reproduced the select-all cause. |
| Temporary platform-corrected browser subset | 18 passed, including every originally failing test. Production code and checked-in tests unchanged. |
| Standard `npm run verify:portable` | Passed: 200 tasks, 150 checklist items, identities/project remapped. |
| Large portability profile | Failed with HTTP 413. |
| `npm run verify:restore` | Passed: live-WAL backup/restore and historical migration drill, integrity and production boot checks. |
| `npm audit --audit-level=high` | Failed: 9 affected packages, 5 high/4 moderate. Raw JSON retained. |
| `npm run eval` | 7/7 retrieval cases passed, independently rerun by Codex after Agy reported the result. This small benchmark does not cover the reproduced Unicode/model-generation defects. |
| `npm run eval:nl` | Agy reported exit 2/skipped because no chat backend was configured; not a passing provider evaluation. |
| Focused API/browser/queue/export checks | Defects reproduced; scripts and logs retained. Their assertions deliberately assert the current defect, not correct behavior. |
| Docker and Rust | Unavailable (`docker` and `cargo` command not found). Source/layout checks only. |

Coverage included backend routes/repositories/migrations, frontend state/recovery, task/runbook/Library lifecycles, trust/retrieval/assistant/MCP/CLI, providers/calendar, desktop shell, deployment, tests and operating documentation. Large frontend and test bodies were selectively inspected; this is a broad independent review, not proof every line or possible schedule is correct. No packaged desktop restart, actual image launch, Windows host, live Google/LLM interaction, manual assistive-technology drill or reference-hardware performance activation was completed. Memory recall was unavailable because the local Prax API was not running.

## Suggested repair sequence

1. Protect database files and fix startup/package defects so every supported runtime can execute its verification.
2. Fix input preservation, durable operation identities, concurrent writes and exact-revision verification. Turn the retained failure schedules into regression tests asserting correct behavior.
3. Repair portability, retrieval generations, calendar delivery, outcome reporting and collection contracts.
4. Restore audit and full cross-platform browser gates; correct runbooks and add native relaunch, packaged Windows/container and real-provider contract evidence.

This sequence is a review recommendation. No fixes, releases, repository history changes or external data mutations were performed.
