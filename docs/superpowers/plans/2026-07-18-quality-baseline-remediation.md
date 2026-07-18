# Quality Baseline Remediation Plan

**Source:** Adversarial review of commit `400452f` (2026-07-18) — 38 deduplicated candidates,
35 CONFIRMED (nearly all with executed reproductions), 1 plausible, 2 refuted. Full evidence
in the review transcript; every fix below lands with its reproduction as a regression test.

**Ground rules**

- No fix without executable evidence: the review's reproduction becomes the permanent test.
- Full gate after each wave: unit suite, e2e suite, `verify:portable`, `verify:restore`.
- The pass ends with an adversarial re-review of the fix diff itself — three of the worst
  findings in `400452f` were inside fixes for prior findings.

## Wave 1 — Data loss & trust integrity (Gate A blockers)

1. **WAL restore discards committed data** (`server/sqliteBackup.js:152`). Restore must copy
   db + `-wal` + `-shm` into staging, `PRAGMA wal_checkpoint(TRUNCATE)` the staging copy, then
   validate → rename. Validation and copy must see the same bytes. Regression: raw hot-copy
   backup whose rows live only in the WAL restores completely.
2. **Explicit verification never recorded** (`server/libraryRepository.js:195`). The replay
   guard `verified_by = $2` is NULL under three-valued logic when `verified_by IS NULL`
   (every user-created doc). Use null-safe `IS`. The route must not mask a 0-row update as 200.
   Regression: verify a user-created doc → `verified_at`/`verified_by` stamped.
3. **Agent metadata-only edit destroys human verification** (`server/libraryRepository.js:118`).
   Revoke verification only when `content_hash` changes (QINV-04's own rule); agent retag or
   project-move of byte-identical content keeps it. Regression: agent retag keeps verification;
   agent body edit revokes it.
4. **Drawer autosave overwrites out-of-band edits** (`public/js/main.js:1138`). Per-field dirty
   tracking: PATCH only fields whose draft diverges from the seeded baseline; re-seed non-dirty
   fields when a refresh installs newer server state. Regression: agent updates description via
   MCP while user edits notes → description survives.
5. **Document rename silently reverted** (`public/js/main.js:4150`). `save-document-info` must
   update `documentDraftTitle` after the PATCH so the next autosave does not resend the stale
   title. Regression: rename → body keystroke → title stays renamed.
6. **Palette/keyboard project-nav drops dirty drawer notes** (`public/js/main.js:3006`).
   Route all project-nav entry points through the same flush/veto guard as the click path.
   Regression: dirty notes + palette project open → notes saved or veto surfaced.
7. **Restore of the app's own export loses tasks** (`server/tasksRepository.js:76`,
   `server/tasksRoutes.js:150`). Skip-mode must not dedupe within the incoming batch on the
   lossy title/project/status/dueDate key; replace the 500-item global checklist cap with a
   per-task bound creation also enforces. Property regression: any export restores completely
   into an empty database.

## Wave 2 — Misleading success & duplicate mutations

8. **`didWrite` lies about failed writes** (`server/assistant/agent.js:138`): derive from
   approved && !isError, using the outcomes `executeToolCalls` already records.
9. **Recurrence retro-cap silently ends legacy series** (`server/recurrence.js:19`): migration
   clamps stored over-cap intervals; completion toast derives from the transition result.
   Also stop `planTaskRecurrenceTransition` nulling caller-supplied recurrence on reopen (`:99`).
10. **Replay "succeeds" against an archived task** (`server/tasksRoutes.js:585`): idempotent
    match requires `archived_at IS NULL`.
11. **Capture can't distinguish permanent 409 from transient failure**
    (`public/js/taskApi.js:33`, `main.js:5148`): surface status/body on the thrown error;
    "retry unchanged is safe" copy only for transient failures.
12. **Any keystroke destroys the exact-once retry identity** (`public/js/main.js:4601`):
    keep identity until the text meaningfully diverges from the failed payload.
13. **MCP retry duplicates generation calls** (`mcp/praxClient.js:40`): timeout aborts are not
    "unreachable"; disable `retryUnavailable` for non-idempotent `generate_*` tools.
14. **No-exit draft traps on externally archived doc/task** (`public/js/main.js:1864`, `:1175`):
    explicit Discard / Restore-and-save affordances; the drawer's invisible vetoing draft must render.

## Wave 3 — Lifecycle & agent-surface coherence

15. **0012 archive/restore leaves stuck supersession states**: restore-side reconciliation +
    repair migration for already-stuck rows.
16. **0013 backfill bakes false order into the chronicle**: repair migration re-sequencing
    backfilled events by `checked_at` (tie-break position).
17. **Non-transactional run reads** (`server/runbookRunsRepository.js:54`): one transaction.
18. **Orphaned "durable" runs unreachable** (`server/libraryRoutes.js:569`): detached-runs
    listing surface.
19. **Case-sensitive citation check discards grounded answers** (`server/askLibrary.js:116`).
20. **Multi-tab capture-recovery clobber + title-toast focus loop** (`public/js/main.js:2448`,
    `:1127`): ownership guard on the shared key; inline title hint instead of re-rendering toast.
21. **Unbounded semantic-search fallback + non-advancing cursor**
    (`mcp/tools/semanticSearch.js:21`, `mcp/pagination.js:40`).

## Wave 4 — Ops, deploy & docs

22. **`docker run -p` black-holes after upgrade** (`deploy/Dockerfile`): bake
    `HOST=0.0.0.0` + acknowledgement flag into the image; loud startup bind log.
23. **Bind assertion blocks backup/migrate CLIs** (`server/config.js:62`): move
    `assertSafeNetworkBinding` to the server listen path.
24. **Backup leaves sidecars blocking the next backup** (`scripts/backup-database.js:43`):
    validate via `immutable=1` open or clean artifacts.
25. **Desktop orphan, CSP images, missing changelog** (`server/desktopLifecycle.js:55`,
    `server/index.js:34`, `CHANGELOG.md`): stdin `end`/`close` → shutdown; `img-src` allows
    `https:`; write the missing `400452f` entry plus this pass's.

## Checklist additions to the quality standard

- Null-safe SQL comparisons (`IS` vs `=`) wherever NULLable columns are compared.
- Validation change ⇒ data migration: never retro-invalidate stored rows silently.
- Success derives from outcome, not intent (flags, toasts, notices).
- Tests must execute the guard, not regex the SQL or mock the failing function.
