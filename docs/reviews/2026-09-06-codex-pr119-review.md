# Independent review of PR #119

**Verdict: request changes. Do not merge PR #119 or cut `v0.21.0-rc.2` from this commit yet.** The original external-write visibility defect is covered by passing tests that fail with the main-branch frontend, but independent browser probes reproduce two P1 editing/state regressions and one P2 startup gap.

Reviewed `fix/refresh-after-external-writes` at `6f1c0b6a3f46c006cfb6f02d262434f05c604372`, against parent/main `94db258`. `git status --short` was empty before and after verification. No tracked files were changed. All additional scripts and evidence are under `.local-review-backups/pr119-evidence/`.

## 1. External refresh scheduler, triggers, and announcements

The scheduler in `public/js/externalRefresh.js:31–86` coalesces concurrent refresh requests and retains one trailing refresh. The 1,500 ms interval is measured from the start of a load. A request received in flight is recorded at lines 70–72; settlement arms its follow-up at lines 62–65. A request received during throttling arms a trailing timer at lines 74–78. For the nonempty reasons used by the application, I found no steady-state dropped-trigger defect in this scheduler itself.

The seven frontend tests at `tests/frontend/externalRefresh.test.js:35,45,55,70,81,88,120` cover fingerprints, coalescing, trailing timers, follow-up after an in-flight request, rejected-load recovery, event installation/removal, and announcement fallback. They pass as part of `npm test`.

`installExternalRefreshTriggers` registers focus, visible-state, storage, and BroadcastChannel listeners (`public/js/externalRefresh.js:105–113`). Its disposer removes listeners and closes the channel (line 115). Main installs it once for the page lifetime. I found no accumulating-listener leak in that usage. The disposer does not cancel an already scheduled refresh or an in-flight fetch; there is no scheduler cancellation API.

`announceChange` independently attempts both BroadcastChannel and localStorage and tolerates either being unavailable (`public/js/externalRefresh.js:125–145`). Its true result means one transport accepted the announcement, not that another window refreshed. This matches its implementation comment.

When the server rejects a refresh, the scheduler catches the rejection, clears `inFlight`, and allows a later trigger to retry (`public/js/externalRefresh.js:59–65`; frontend test at line 81). It does not automatically retry without another queued/future trigger. A task-fetch rejection leaves the existing collection visible, skips the subsequent Library load, and is not surfaced to the user by `refreshFromOutside` (`public/js/main.js:232–236,354–360`). There is also no timeout here for a fetch that never settles, so such a request keeps later triggers queued. These are source-inspected limitations; I did not run a separate server-down browser scenario.

The integration does lose events during startup; see F3 below.

## 2. Main-window refresh and editing safety

### F1 — P1: an older external refresh overwrites a newer confirmed task save in client state

**Evidence:** `public/js/main.js:232–236` installs every completed task GET into `state.tasks` without a freshness check, then calls `reconcileTaskDrawerAfterRefresh`. Lines 244–261 replace untouched draft fields and their baseline with that response. Meanwhile, `applyTaskDraftSave` at lines 1450–1499 can already have installed a newer successful PATCH and marked the drawer Saved. The write queue (`public/js/taskMutationQueue.js:1–12`) serializes mutations only; it does not coordinate these collection reads. External refresh's own single-flight scheduler does not serialize it against local writes or other `loadTasks` callers.

**Reproduction:** `.local-review-backups/pr119-evidence/browser-probes.mjs` runs a fresh in-memory server and Chromium. It opens a task drawer, creates an unrelated external task, starts a focus refresh, and holds the GET response after the server has produced its snapshot. It then edits and saves the drawer title, waits for the actual successful PATCH response, and finally releases the older GET. The unrelated external task makes the collection fingerprint change, so the old snapshot also causes a render.

Observed output:

```text
before stale response:
  title = Newer locally saved title
  baseline.title = Newer locally saved title
  dirty = false
  saveStatus = Saved

after stale response:
  uiTitle = Original task title
  stateTitle = Original task title
  baseline.title = Original task title
  saveStatus = Saved
  serverTitle = Newer locally saved title
```

The persisted server title remains the newer value in this reproduction. The proven defect is stale client state and a reverted drawer/baseline still labelled Saved; I am not claiming demonstrated database data loss. This directly contradicts QINV-09, “Older asynchronous work cannot overwrite newer state” (`docs/superpowers/specs/2026-07-13-exceptional-prax-quality-standard.md:159–163`).

**Required repair:** coordinate collection reads with mutation generations/revisions, or conditionally merge/discard stale results. Preserve a refresh request when a stale response is discarded. Add a regression that holds a GET snapshot across a confirmed drawer save, plus coverage across a queued mutation. Serializing external refreshes with one another alone is insufficient.

### F2 — P1: unrelated refreshes disrupt live editing focus and caret position

Skipping document fetching while an editor is open protects the body from that fetch, but does not protect the editor DOM: changed tasks still call `renderApp` (`public/js/main.js:354–359`). The render destroys CodeMirror and rebuilds the workspace (`main.js:3933–3943` and the following `innerHTML` rebuild). CodeMirror remounts with `cursorToEnd: true` (`main.js:2377`), and the selection restoration only applies when `to > from` (`main.js:2394–2401`). A collapsed caret is not restored.

The same probe produced:

```text
editor cursor before: offset 2, text "abcdef"
editor cursor after:  offset 6, text "abcdef"
editor body after typing X: abcdefX
```

Steps: open document `abcdef`, put the caret between `b` and `c`, create an unrelated task externally, trigger focus refresh, then type `X`. The next character lands at the end instead of producing `abXcdef`.

The task drawer also loses focus. `renderApp` preserves a focused drawer field's current text (`main.js:3911–3931`), but the post-render focus logic at lines 3988–4038 does not restore focus to that field. A second journey in the same probe types a drawer title, externally creates a task, and refreshes:

```text
drawer after refresh: {"value":"Draft stays here","focused":"BODY"}
drawer next key n:    {"captureOpened":true,"title":"Draft stays here"}
```

Thus the existing draft's characters survive, but ordinary continued typing is routed to the app's keyboard shortcuts. The committed test checks only `toHaveValue(typed)` at `tests/e2e/external-refresh.spec.js:63`, so it passes despite this regression.

The capture overlay has the same caret-at-end policy in `main.js:3998–4003`: every full render focuses the capture input and sets both selection offsets to its length. That is an additional source-visible exposure of the same render problem; the independent caret reproduction above was performed in the document editor, not in an in-flight capture overlay.

**Required repair:** preserve the active editing DOM, or preserve and restore the active field, collapsed caret, selection, and relevant editing state when refreshing unrelated collections. Add real continued-typing assertions for a task drawer and document editor, and cover a capture draft with the caret in the middle. Do not use preservation of input values alone as evidence that the editing journey survives.

### F3 — P2: changes and focus events during the initial load are dropped

`init()` begins the initial collection requests and awaits tasks at `public/js/main.js:6421–6422`, then installs refresh listeners only at line 6435. There is no catch-up refresh or replay of announcements received before installation.

**Reproduction:** `.local-review-backups/pr119-evidence/startup-probe.mjs` holds the initial GET after its empty snapshot has been obtained, creates a task through the API, emits the same BroadcastChannel/focus/visibility events, then releases the initial response. After 2.2 seconds:

```json
{"serverCreate":201,"triggered":["broadcast","focus","visibility"],"initialTaskReads":1,"taskInClientAfterStartup":false}
```

The task is committed but missing from the client. It remains missing until some later trigger or reload. This is a narrower startup version of the defect this PR intends to close.

**Required repair:** register/record triggers before initial reads and replay them after initialization, or perform a catch-up read after registration. Add a test with a held initial GET and a capture completed during that interval.

### Other integration observations

`navigateTopLevel` and `goProject` trigger refresh at `public/js/main.js:3493,3517`, so navigation contributes to eventual refresh after initialization. Fingerprinting reduces unnecessary renders but is not a stale-response guard. It compares IDs and update/archive/status metadata (`public/js/externalRefresh.js:19–24`), not request generations.

I did not observe a proven deletion of a pending mutation-queue entry. The concrete integration failure is that the independent read can overwrite the result after a mutation succeeds (F1). Similarly, skipping Library fetches does not itself overwrite an open document's draft body in the tested journey, but its editor is still remounted (F2).

## 3. Capture-bar announcements

The calls are placed on both requested success paths:

- `public/js/captureBar.js:56–65`: HTTP 201 or 200, after `finishBarCapture` succeeds and `pending` is cleared.
- `public/js/captureBar.js:71–86`: HTTP 409, after fetching a canonical task and successfully clearing recovery state.

The 409 path does not announce when canonical readback fails. If a write succeeds but clearing recovery fails, the handler returns with an explicit hint before announcing (`captureBar.js:58–60,81–83`); later focus/navigation is then the refresh mechanism. The announcement carries identity/type, and the receiver refetches canonical collections rather than trusting task content from the message.

The targeted browser test exercised the normal capture creation path. I inspected the HTTP 200 and reconciled 409 announcement branches, but did not independently force those two HTTP outcomes in a browser during this review.

## 4. Native capture transparency

**The implementation is consistent with the installed Tauri/Wry source and appears to be the right configuration for a transparent capture window. Visual packaged behavior remains unverified.**

`src-tauri/src/lib.rs:605–618` adds `.transparent(true)` specifically to the `capture` builder. The page already makes its outer background transparent (`public/capture.html:17`) and paints the rounded bar separately. The main-window builder at `src-tauri/src/lib.rs:501–514` does not request transparency. The feature is enabled in `src-tauri/Cargo.toml:15` and the configuration flag in `src-tauri/tauri.conf.json:13`.

I checked actual local dependency source, not an assumed API version:

- `~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-2.11.5/src/webview/webview_window.rs:1073–1086` gates this API on macOS's `macos-private-api` feature and applies transparency to both the native window and its webview.
- `.../tauri-runtime-wry-2.11.4/Cargo.toml:49–53` enables Wry's `transparent` and `fullscreen` features for `macos-private-api`.
- `.../wry-0.55.1/src/wkwebview/mod.rs:367–376` sets `drawsBackground` false when transparency is requested; lines 386–388 also enable WKWebView's fullscreen preference when the feature is compiled in. That fullscreen preference is a broader feature side effect, including the main WKWebView; it does not make the main window transparent.

The capture and main navigation guards remain in place (`src-tauri/src/lib.rs:506,617`), and the CSP is unchanged (`src-tauri/tauri.conf.json:16`). I found no source evidence that this transparency change alters CSP or trust boundaries.

The transparent builder call also applies on Linux; the Tauri method explicitly permits non-macOS targets without the macOS feature gate. Actual compositing/appearance on Linux was not tested. I did not build or visually inspect a packaged native app on either platform, so I cannot certify that the white slab is gone in a release artifact.

## 5. Regression evidence and gates

The three committed E2E tests pin the original defect: all three pass on this branch and all three fail when served the exact pre-PR frontend from `94db258`. For the baseline run, a scratch server serves `git show 94db258:public/js/main.js` and `git show 94db258:public/js/captureBar.js`; backend code is unchanged by this PR. This is an isolated main-frontend comparison, not a claim to have built an entire separate checkout of main.

The current tests do not cover a GET racing a successful local PATCH, continued keyboard input after the external render, or announcements during initialization. Those omissions explain the independent findings despite the passing suite.

## 6. Documentation and changelog

The new desktop instructions generally match the code: close-to-hide behavior, tray open/quit, configurable capture shortcut, `/capture.html`, capture draft retention, and the two transparency settings (`README.md:18–22`; `docs/desktop/BUILD.md:102–116`; `src-tauri/src/lib.rs:519–527,602–628`).

The two new changelog entries are under the existing `[0.21.0]` section's `### Fixed` heading (`CHANGELOG.md:397–412`), appropriate for another RC of that release. The release metadata verifier accepts `v0.21.0-rc.2`.

Small accuracy points to address with the repair:

- `CHANGELOG.md:405` says the channel produces an “immediate refresh”; a trigger can instead wait for the 1,500 ms throttle or an in-flight load. “Schedules a refresh” is precise.
- `docs/desktop/BUILD.md:112–114` and the changelog describe capture appearing without reload. F3 leaves a startup exception to that promise.
- The prose at `README.md:21–22` and `docs/desktop/BUILD.md:110–111` groups `#project`, `@label`, `!high`, and a date word as routing. Only `#project` changes the project; the others set labels, priority, and due date (`public/js/captureBarCore.js:23–53`). This is minor wording, not an additional release-blocking finding.
- `CHANGELOG.md:409–412` states the white slab is fixed. The source change supports that expectation, but packaged visual confirmation is still outstanding.

## Implemented

No product or tracked-file changes. Produced this read-only review, isolated reproductions, a baseline frontend test harness, and captured logs under `.local-review-backups/pr119-evidence/`.

The review found **no P0**, **two P1 findings (F1/F2)**, and **one P2 finding (F3)**. F1/F2 block my approval. Repair F3 in the same refresh work before publishing the next RC.

## Tested

All commands ran from `/Users/markjoyeux/Developer/Personal/prax`. Browser tests used isolated owned servers; no unrelated `node server/index.js` process was killed.

| Command | Actual outcome |
|---|---|
| `git rev-parse HEAD` | `6f1c0b6a3f46c006cfb6f02d262434f05c604372` |
| `git status --short` | Empty; no tracked changes |
| `node skills/prax-recall/scripts/recall.mjs "Prax external window capture refresh draft safety task mutation queue"` | Exit 0; no relevant memory, keyword fallback |
| `npm test` | Exit 0; **1,913 passed, 0 failed, 0 skipped**, duration 4,669.776375 ms |
| `npm run check` | Exit 0; syntax checks passed; `skill bundles are up to date` |
| `PLAYWRIGHT_BROWSERS_PATH=/private/tmp/prax-rc-browsers PRAX_E2E_PORT=32871 npx playwright test tests/e2e/external-refresh.spec.js` | Exit 0; **3 passed (3.7s)** |
| `PLAYWRIGHT_BROWSERS_PATH=/private/tmp/prax-rc-browsers npx playwright test --config .local-review-backups/pr119-evidence/baseline.config.mjs` | Exit 1, expected negative control; **3 failed** with main's frontend because external tasks/documents remain absent |
| `PLAYWRIGHT_BROWSERS_PATH=/private/tmp/prax-rc-browsers node .local-review-backups/pr119-evidence/browser-probes.mjs` | Exit 0; reproduces F1 with assertions and prints F2's caret/focus/typing observations |
| `PLAYWRIGHT_BROWSERS_PATH=/private/tmp/prax-rc-browsers node .local-review-backups/pr119-evidence/startup-probe.mjs` | Exit 0; asserts the startup task remains absent after one initial read, reproducing F3 |
| `node scripts/verify-desktop-release.mjs --tag v0.21.0-rc.2` | Exit 0; `[desktop-release] verified Prax v0.21.0 for aarch64-apple-darwin` |

Gate output excerpts:

```text
ℹ tests 1913
ℹ pass 1913
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 4669.776375

skill bundles are up to date

3 passed (3.7s)
```

Captured gate/probe logs are copied beside the scratch scripts as `prax-pr119-test.log`, `prax-pr119-check.log`, `prax-pr119-e2e.log`, `prax-pr119-baseline-e2e.log`, `prax-pr119-browser-probes.log`, and `prax-pr119-startup-probe.log`.

## Unable to test

- Packaged macOS appearance, native focus delivery, and Linux compositing: no fresh native build or visual native run was performed. Chromium tests do not certify native-webview behavior.
- The full 116-test browser suite was not independently rerun; my E2E count is the requested three external-refresh tests. Claude's stated 116/116 is not treated as my own execution evidence.
- HTTP 200/reconciled 409 announcement delivery, a hung/down server's browser presentation, and a capture submission in flight across refresh were source-inspected but not independently forced in additional end-to-end runs.

**Final release decision: request changes on PR #119; do not merge and then push `v0.21.0-rc.2` at `6f1c0b6`. Re-run the gates and the three additional reproductions after fixing F1–F3, and obtain packaged visual confirmation of the native transparency change.**
