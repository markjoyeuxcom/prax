# Independent review repairs — verification

Work follows the [consolidated independent review](2026-09-04-consolidated-review.md) of baseline `0c3cdfa9a63f021c983e7985a1df57cd60ffb388`. Codex integrated repairs with Claude and Agy through the authenticated Parley panes on branch `fix/independent-review-2026-09-04`. The verification below preceded the user-authorized commit, pull request and merge. No release was made.

**All confirmed review findings have repairs and passing automated regression evidence.** Codex reviewed the combined changes; Claude independently checked editor/assistant recovery and Agy independently checked import/capture/project recovery. Follow-up findings were repaired before the final combined verification below. This supersedes the original review’s code-defect disposition; it is not a release or Gate-B activation.

## Repairs and regression coverage

| Finding | Resulting behavior | Durable regression evidence |
|---|---|---|
| C01; Claude H2/H3 | Container runtime includes MCP and migration entry points; filesystem-safe startup/static paths work with spaces and symlinked installs. | `tests/backend/startupPaths.test.js` launches the copied Dockerfile layout and actual path fixtures, checks health, HTML and JS. |
| C02 | Desktop saves the first child-owned port, reuses it, refuses occupied/corrupt ports, and recovers the prior origin from existing logs on upgrade. | `desktopOrigin.test.js`; `tests/e2e/desktop-draft-persistence.spec.js`; native build/runtime smoke checks two launches, database sentinel, origin and clean shutdown. |
| C03 | Document autosave sends edited fields plus `ifRevision`; independent title/body edits merge; same-field conflicts remain protected across reload and require deliberate review. Document-info preserves its explicit form draft through failures, offers a choice for contested fields, and retries failed references without repeating committed metadata. | `libraryRevision.test.js`, `documentDraftMerge.test.js`, `review-regressions.spec.js`, `editor-autosave.spec.js`, `wave1-draft-integrity.spec.js`, `document-info.spec.js`. |
| C04 | Project drafts retain every edited field per project, serialize writes, preserve newer edits, reconcile lost responses and recover after reload. | `projectDrafts.test.js`; project multi-field browser journey. |
| C05/C06 | Capture completion only clears its submitted draft; pending request identity is persisted atomically with recovery state and reused after reload. A 409 after the prior task was edited/archived reconciles by its saved UUID; unreadable outcomes keep that identity. | `captureBarCore.test.js`; delayed-input and lost-commit browser journeys; `capture-bar-recovery.spec.js` covers modified/archived originals, newer input and unreadable outcomes. |
| C07; Claude M3 | Approved assistant writes claim durable receipts; concurrent/replayed approvals reuse the result. Pending history survives response loss and model changes. An interrupted receipt is reported unknown and never automatically re-executed. | `assistantWriteReceipts.test.js`, `assistantRoute.test.js`, `assistantRecovery.test.js`, `assistantOutcome.test.js`; lost-commit/reload/provider-switch browser journey. |
| C08/C21 | Revision token covers the stored title and body. Verification atomically checks the exact reviewed token. Health opens content for review; dirty drafts cannot be verified. | Library revision/trust API tests; `trust-actions.spec.js`; Health browser regression. |
| C09/C10 | Embedding writes are guarded by full revision; retrieval requires current revision and active model. Incomplete coverage reaches HTTP, MCP, Library and Ask Prax. New fixtures use revision hashes; old vectors remain pending. | `libraryRevision.test.js`, embedding repository/service tests, quality-fixture regression, MCP semantic/insight tests, renderer tests and retrieval browser journey. |
| C11 | Direct import accepts the large fixture; staged uploads support totals beyond 5,000 tasks. Final task/checklist replacement and receipt are atomic. Committed chunk hashes validate retries; gaps, changed chunks/counts and cross-protocol ID reuse are rejected. Browser retry identity survives reload. | `reviewFixesRegression.test.js` includes 6,000-task/30-chunk roundtrip, replay and cancellation; `taskApi.test.js`, `importRecovery.test.js`; 501-task lost-commit/reload browser journey; 5,000-task portability drill. |
| C12/C13 | Calendar queue drains work arriving during slow pushes. New imports notify reconciliation; receipt replays do not repeat notifications. | Controlled delayed-push and import notification regressions in `reviewFixesRegression.test.js`. |
| C14/C17 | All-day Google event ends are exclusive next-day dates. OAuth callback interpolations are HTML-escaped. | Google Calendar unit tests and callback injection regression. |
| C15; Claude L1/L2 | Unicode Library search retains letters/digits; symbol-only nonblank queries match nothing. Task `%`/`_` queries are literal. Imported timestamps are validated/normalized. | Library revision and task regression tests. |
| C16 | Export link refs use final deduplicated ZIP entry names. | Collision roundtrip assertion in `libraryExportRoute.test.js`. |
| C18 | Weekly Shipped uses actual completion evidence; a later reopen does not erase historical completion. Unknown legacy dates are disclosed, never inferred from modification/creation. Creating an already-completed task records completion. | Weekly compiler/API tests and completion/reopen/unknown-date regressions. |
| C19 | Browser select-all helpers use the platform-aware modifier. | Original affected Mac journeys are included in the full Chromium run. |
| C20; Claude H4 | Registry-verified dependency updates clear the security audit. | `audit.log`, full unit/browser gates. |
| C22 | Archive and Undo reconcile canonical state after response loss, preserve unresolved selections and distinguish committed writes from refresh failures. | Lost-archive browser regression and task lifecycle journeys. |
| Claude H1 | SQLite journals are ignored and removed from the index only, after a verified online backup. Live files are retained. | Backup integrity/FK check; staged deletions; local protected snapshot. |
| Claude M2/M5 | Missing document owners return 404; unavailable similar search is explicitly degraded. Agent/operating docs describe SQLite, settings trust, actual import protocol and persisted desktop origin. | Library route tests; current contract/runbook changes; copied container migration entry point. |

## Final combined verification

| Command/check | Observed result |
|---|---|
| `npm test` | **1,847 passed, 0 failed, 0 skipped** (3.39 s). |
| `PLAYWRIGHT_BROWSERS_PATH=/private/tmp/prax-codex-review-browsers PRAX_E2E_PORT=3613 npm run test:e2e -- --workers=1` | **112 passed, 0 failed** on Chromium/macOS. |
| `npm run check` and syntax-check every changed/new JS module/test | Passed; **90 files** checked in the additional sweep. |
| `npm audit --audit-level=high` | **found 0 vulnerabilities**. |
| `npm run verify:portable` | 200 tasks / 150 checklist items round-tripped; identities regenerated and project remapped. |
| `runPortableRoundTripDrill({profile:'large'})` from `scripts/verify-portable-round-trip.js` | **5,000 tasks / 3,750 checklist items** round-tripped. |
| Staged-import production regression | **6,000 tasks in 30 chunks**, export comparison, replay, hash/count conflicts and cancellation passed in `npm test`. |
| `npm run verify:restore` | Current large WAL backup/restore and historical schema upgrade through migration 0025 passed; integrity/FK, semantic state and production boot verified. |
| `npm run eval` | **7/7** retrieval cases passed. |
| Rust tests via mise | **6 passed** after sidecar preparation. |
| `mise exec rust@1.98.1 -- npm run tauri build -- --debug --no-bundle` | Native Mac debug application built. Rust tool version was verified with `mise latest rust` before installation. |
| `npm run prepare:sidecar`, `npm run desktop:verify` | Final combined payload restaged and release-manifest validation passed. |
| `npm run desktop:smoke -- --binary src-tauri/target/debug/prax` | Final payload launched twice, preserved database across **25 migrations**, retained the browser storage origin and exited cleanly. |
| Actual demo smoke | Conditional PATCH, stale-revision rejection, exact-revision verification and replayed assistant approval passed; included in `npm test`. |
| `git diff --check` | Passed. |

## Data protection and upgrade behavior

Before journal untracking, an online SQLite backup was saved to `.local-review-backups/before-review-fixes-2026-09-04.db` (directory mode 0700, file mode 0600). Integrity check was `ok`, foreign-key violations `0`, size 225,280 bytes, SHA-256 `a3528228e66ec3710509f436c6f4c9986b0d59a8d575dd42576c6896893c0401`. The snapshot is ignored, not included in source control. `prax.db`, its live journals and pre-existing `ROOM-prax.md` were preserved. Repository history was not rewritten.

Migrations add document revisions, staged task imports and assistant receipts. Existing document bodies, titles and trust stamps are preserved. Revision is SHA-256 of UTF-8 `JSON.stringify([storedTitle, storedBody])`; `contentHash` retains its body-only meaning. Legacy vectors need re-indexing because their old hashes cannot prove title freshness; the UI/API disclose pending coverage.

Assistant receipts guarantee that the same approval is not blindly executed twice. They do not pretend a process interruption between tool mutation and receipt completion can always be resolved automatically: that outcome remains explicitly unknown and requires inspection of the refreshed canonical workspace. Demo workspaces opt into process-local receipts because their data is also process-local; production does not silently fall back.

## Verification boundaries

Raw selected failure-before-fix and passing execution logs are in [repair evidence](2026-09-04-repair-evidence/README.md). Initial review reports and evidence retain their original findings; trailing whitespace was normalized for source control.

- Native verification ran on this Mac with a debug Tauri application and isolated app data. It includes actual two-launch runtime smoke plus Chromium draft persistence across child restart. Signed release packaging, Windows/Linux native execution and direct WebView draft interaction were not exercised.
- Docker is unavailable on this machine. The actual Dockerfile COPY layout was assembled and launched with Node, but an image build/run was not performed.
- Google/LLM provider behavior is covered by contract and controlled fake-provider tests; no live external account or provider service was mutated.
- Manual screen-reader/physical-device evidence and reference-hardware performance activation remain the separate existing quality-policy work. These repairs do not activate Gate B or certify a release.
- Local shared-memory recall and the final remember attempt were unavailable because the Prax API at `127.0.0.1:3000` was not running. Durable repair decisions are captured in this report and the updated contract/runbooks.
- The original unverified Google 410 hypothesis and policy questions about remote Markdown images, metadata-only trust retention, active-only 404 semantics and `.prax/project.json` identity were not promoted into defects or changed.

## Publication follow-up (5 September)

The user authorized commit, push, PR and merge. The repair branch incorporated `origin/main` at `26b3d65` before opening [PR #115](https://github.com/markjoyeuxcom/prax/pull/115), retaining both main's dependency updates and the registry-verified security fixes.

The newer accessibility checker reproduced insufficient contrast in the unavailable Semantic search description in both themes. Removing opacity from the explanatory row fixed the existing accessibility regression without changing the disabled control. A local run after midnight also caught the cockpit fixture using a UTC date while Today uses local dates; using a local fixture date fixed that journey and its downstream stale-plan contamination.

Desktop CI exposed existing Rust formatting drift and a retired Intel runner. Rust formatting is corrected, both desktop workflows stage the declared sidecar resources before `cargo test`, and Intel uses the current `macos-26-intel` label verified against [GitHub's runner inventory](https://github.com/actions/runner-images/blob/main/README.md). The initial failed native run was cancelled before the corrected run.

After integration and these corrections, local verification again passed: **1,847 unit/contract tests, 112 Chromium browser tests, all four accessibility journeys, syntax checks, six Rust tests, Rust formatting and staged desktop manifest validation**. The dependency audit reported **zero vulnerabilities**. Publication evidence is in `2026-09-04-repair-evidence/publication-*.log`.

GitHub's Pull request dependency review check reports that the service is unsupported for this private repository without the relevant Dependency graph/GitHub Advanced Security configuration. The failing check was retained and its limitation disclosed; the independent npm security audit remains active. This is an external repository configuration limitation, not a successful dependency-review result.

Further native packaging checks identified two dependency-payload defects. Linuxdeploy tried to load `bare-fs/prebuilds/android-ia32/bare-fs.bare` and could not resolve Android's `libm.so`; Windows WiX reported LGHT0311 because `@fastify/send` ships the development fixture `test/fixtures/snow ☃`, outside the default MSI code page. Sidecar staging now removes foreign native prebuild directories and that package's unused test tree, while retaining host/universal prebuilds, runtime code and metadata. The desktop workflow watches the new staging helper. Verbose bundler logs remain enabled; Cargo still strips the Prax release executable, and linuxdeploy's extra stripping pass is disabled.

The staging regression failed before fixture exclusion and passed after repair. An actual Mac staging run removed 37 non-runtime directories; assertions checked all three native dependency targets and absence of the test tree. Staged ZIP/TAR generation, the rebuilt Mac application's two-launch smoke test, syntax checks and **1,848 unit/contract tests** passed. Hosted installer verification continues on the updated PR; see its check results for the final cross-platform outcome.
