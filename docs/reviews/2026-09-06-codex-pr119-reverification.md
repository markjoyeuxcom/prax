# PR #119 re-verification — dc06647

## Verdict

**Approve merging PR #119 and cutting `v0.21.0-rc.2` from dc06647.** The three prior findings are closed by the freshness epoch/token, focus restoration, and early trigger installation. The working tree was clean and no tracked files were modified.

Reviewed `dc0664737fe2ece31667d7b9a5f86c1b02970517` on `fix/refresh-after-external-writes`.

## F1: stale refresh versus a newer task save

`public/js/main.js:236-249` gives task loads latest-request-wins semantics and rejects a guarded result when `writeEpoch()` changed during its fetch. `public/js/externalRefresh.js:118-143` increments the epoch when each non-GET/HEAD fetch starts and settles. `main.js:367-384` requests guarded loads and schedules a follow-up when a snapshot is stale.

The extended scratch probe at `.local-review-backups/pr119-evidence/browser-probes.mjs` held an old task GET, completed a newer title PATCH, and then released the old response. It observed:

```text
after stale response {"uiTitle":"Newer locally saved title","stateTitle":"Newer locally saved title","baseline":{"title":"Newer locally saved title","description":"","notes":""},"saveStatus":"Saved","serverTitle":"Newer locally saved title"}
VERIFIED: stale refresh cannot overwrite the newer accepted task save.
```

The dedicated E2E journey at `tests/e2e/external-refresh.spec.js:92-129` also checks client state and persisted server state. This closes the previous QINV-09 stale-snapshot finding.

## F2: editor, drawer, and capture editing integrity

When a document is open, `refreshFromOutside` updates state but skips `renderApp` (`public/js/main.js:375-379`). For views that do render, `captureFocus` and `restoreFocus` preserve the focused control and selection range (`public/js/externalRefresh.js:145-181`, called at `main.js:379-382`). The selector set includes task drawer fields, quick capture, palette, project rename, and search inputs.

The extended probe observed:

```text
editor cursor before {"offset":2,"text":"abcdef","focused":"cm-content cm-lineWrapping"}
editor cursor after {"offset":2,"text":"abcdef","focused":"cm-content cm-lineWrapping"}
editor body after X abXcdef
drawer after refresh {"value":"Draft stays here","focused":"INPUT"}
drawer next key n {"captureOpened":false,"title":"Draft stays heren"}
```

The committed E2E journeys at `tests/e2e/external-refresh.spec.js:131-154`, `156-170`, `172-200`, and `202-222` independently cover document caret/typing, drawer focus/caret, startup capture retention, and quick-capture mid-text caret. The former focus/caret regression is closed.

## F3: startup trigger gap

`installWriteEpoch()` and `installExternalRefreshTriggers()` now run before the initial task/document loads (`public/js/main.js:6440-6453`). A superseded initial task load waits for the newer refresh (`main.js:6452-6453`).

Rerunning the old startup probe produced:

```json
{"serverCreate":201,"triggered":["broadcast","focus","visibility"],"initialTaskReads":3,"taskInClientAfterStartup":true}
```

That probe exits 1 only because its obsolete assertion still expects `true !== false`; the observed state is the repaired result. The committed startup journey at `tests/e2e/external-refresh.spec.js:172-200` passes.

## Scheduler and unit coverage

The existing scheduler at `public/js/externalRefresh.js:31-116` still coalesces concurrent triggers, runs a trailing refresh after throttling, retries after rejection, and cleans up listeners/channel. New unit tests at `tests/frontend/externalRefresh.test.js:132-182` cover write-epoch start/settle/failure behavior and focus/selection round-tripping. The wrapper observes fetch-based writes, which are the application mutation path exercised here.

## Hosted CI

Both hosted runs cited by Claude are green on the exact SHA:

- Desktop builds `34065409573`: completed, success, head `dc0664737fe2ece31667d7b9a5f86c1b02970517`.
- CI `34065409668`: completed, success, same head SHA.

## Implemented

No product changes were made. This is a read-only verification report; the scratch probe and captured logs are review artifacts.

## Tested

| Command | Result |
|---|---|
| `git rev-parse HEAD` | `dc0664737fe2ece31667d7b9a5f86c1b02970517` |
| `git status --short` | Empty |
| `npm test` | Exit 0; **1,915 passed, 0 failed, 0 skipped**; 4,683.978209 ms |
| `npm run check` | Exit 0; syntax checks and committed skill bundle check passed |
| `PLAYWRIGHT_BROWSERS_PATH=/private/tmp/prax-rc-browsers PRAX_E2E_PORT=32879 npx playwright test tests/e2e/external-refresh.spec.js --repeat-each 3` | Exit 0; **24 passed** (8 journeys × 3), 31.8 s |
| `PLAYWRIGHT_BROWSERS_PATH=/private/tmp/prax-rc-browsers node .local-review-backups/pr119-evidence/browser-probes.mjs` | Exit 0; stale-save, editor-caret, and drawer-focus results above |
| `PLAYWRIGHT_BROWSERS_PATH=/private/tmp/prax-rc-browsers node .local-review-backups/pr119-evidence/startup-probe.mjs` | Observed repaired `taskInClientAfterStartup:true`; exit 1 is the obsolete `true === false` assertion |
| `gh run view 34065409573 --json status,conclusion,name,headSha` | Desktop completed successfully on dc06647 |
| `gh run view 34065409668 --json status,conclusion,name,headSha` | CI completed successfully on dc06647 |
| `git show --check dc06647` | No whitespace errors |

## Unable to test

I did not build or visually inspect a packaged native macOS/Linux artifact in this pass. That limitation concerns the earlier transparency change, not the external-refresh repairs reviewed here. I did not kill or interfere with any unrelated `node server/index.js` process.

**Final decision: approve merging PR #119 and then pushing `v0.21.0-rc.2`.**
