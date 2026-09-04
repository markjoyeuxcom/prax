# Prax independent codebase review — Claude (2026-09-04)

Reviewer: Claude (Fable 5.1), Parley pane `Claude` in the Prax workspace. Requested by Codex as one
of three independent reviews. Read-only: no implementation files were edited, nothing was committed,
and the live application database was not opened for writing.

## State reviewed

| Item | Value |
|---|---|
| HEAD | `0c3cdfa9a63f021c983e7985a1df57cd60ffb388` — "before wipe" (== `origin/main`) |
| Working tree | ` M prax.db-shm`, ` M prax.db-wal`, `?? ROOM-prax.md` (no source changes) |
| Node | v24.19.0 |
| Package version | 0.20.0 |
| Recall | `node .claude/skills/prax-recall/recall.mjs …` — Prax not reachable at 127.0.0.1:3000, so no prior memory was available. Started fresh. |

Scope covered: architecture, HTTP routes and repositories, migrations and SQLite adapter, backup and
restore, MCP server and tools, CLI and skills, in-app assistant, chat and embedding providers,
Google Calendar integration, desktop shell (Rust and lifecycle), deployment manifests and CI
workflows, frontend API clients, Markdown renderer, draft recovery, assistant UI, and documentation.
See "Coverage gaps" for what was sampled rather than read in full.

## Findings, prioritised

Severity reflects impact under the documented trusted-network model and the Gate A invariants in
`docs/superpowers/specs/2026-07-13-exceptional-prax-quality-standard.md`.

| ID | Severity | Finding | Reproduced |
|---|---|---|---|
| H1 | High | Live SQLite WAL/SHM tracked in git beside the default DB path; checkout corrupts, commit leaks | yes (scratch pairing → malformed) |
| H2 | High | `server/index.js:109` entry guard never runs on space/symlink/Windows paths; server exits 0 silently | yes (macOS); Windows by analysis |
| H3 | High* | `server/config.js:49` static root percent-encoded on such paths; UI 404s while `/healthz` is 200 | yes |
| H4 | High (gate) | `npm audit --audit-level=high` red: 5 high / 4 moderate, incl. direct `@fastify/static`; exploitability low | yes |
| M1 | Medium | Keyword search returns the whole library for non-Latin/symbol queries (UI, MCP, CLI) | yes |
| M2 | Medium | `/documents/:id/tasks` and `/similar` return `200 []` for a missing owner; `/similar` hides semantic-off | yes |
| M3 | Medium | Lost response to an assistant approval: write outcome unknown, no idempotency key, chat stuck | code reading |
| M4 | Medium | Reflected HTML injection in the Google OAuth callback (CSP blocks script) | yes |
| M5 | Medium | Docs drift: import caps, "Postgres", in-image `npm run migrate`, pre-rename `.prax/project.json` | yes |
| M6 | Medium | e2e suite fails 8 journeys on macOS (`Control+A` select-all assumption) | yes |
| L1–L5 | Low | LIKE wildcards, loose import timestamps, archived-supersede message, remote images in CSP, QINV-04 scope question | yes |

\* High in combination with H2 for `npm start` installs; Medium alone.

### H1 — Live SQLite WAL and SHM sidecars are version-controlled beside the default database path

- **Where:** `prax.db-wal` and `prax.db-shm` are tracked (added in HEAD `0c3cdfa`, present on
  `origin/main` as blobs of 82,432 and 32,768 bytes). `.gitignore:16` ignores only `/prax.db`.
  `server/config.js:48` defaults `databaseFile` to `prax.db` in the working directory, so a
  `npm start` from the checkout writes its database into the tracked location.
- **Trigger:** any working-tree reset while Prax uses the default path — `git checkout -- .`,
  `git stash`, `git reset --hard`, a branch switch, or a fresh clone — replaces the live WAL with the
  committed one. In the other direction, `git commit -a` / `git add -A` captures the full live WAL.
- **Impact:** committed transactions live only in the WAL here: the main file is a single 4,096-byte
  page and the working WAL is 667,472 bytes. Pairing the current main file with the committed WAL
  fails with `database disk image is malformed` (reproduced in a scratch copy), which is exactly the
  state a checkout would produce for a running or next-started instance. Every push also ships
  the workspace's data off the machine; the committed WAL contains 117 ISO timestamps of row data
  (no API-key-, client-secret-, or refresh-token-shaped strings were found in either the committed
  or the working WAL). Whether the remote is private could not be confirmed: the GitHub API
  returns 404 unauthenticated for both `markjoyeuxcom/prax` and the README's `awaybreaktoday/prax`.
- **Invariants:** QINV-01/QINV-06 class (data loss on an ordinary operation); Security and privacy.
- **Fix:** `git rm --cached prax.db-wal prax.db-shm`; ignore `/prax.db*`; consider moving the
  default database out of the repository root (or refusing to start with a tracked database file);
  if the remote is or was ever public, rewrite history for the blob.
- **Verification:** `git ls-files | grep prax.db` → `prax.db-shm`, `prax.db-wal`;
  `git ls-tree -l origin/main prax.db-wal`; `ls -la prax.db*`; scratch pairing test.

### H2 — The server entry guard never runs from a path containing a space, a symlink, or Windows separators

- **Where:** `server/index.js:109` —
  ``if (import.meta.url === `file://${process.argv[1]}`)``. Every other entry point uses
  `fileURLToPath` (`scripts/backup-database.js:65`, `mcp/server.js:75`,
  `scripts/verify-desktop-release.mjs:112`).
- **Trigger:** `node server/index.js` or `npm start` where the absolute path contains any
  character that percent-encodes in a URL (space, non-ASCII, `%`, `#`), or where the checkout is
  reached through a symlink (Node resolves the real path for `import.meta.url` but not for
  `argv[1]`). On Windows the comparison can never hold (`file://C:\…` vs `file:///C:/…`).
- **Impact:** the process exits with code 0 immediately: no migration, no listen, no log line. Under
  the desktop shell the child terminates and the recovery screen reports "The local server did not
  announce readiness within 30 seconds" (`src-tauri/src/lib.rs:94`). The Windows case is by analysis
  only; I could not run Windows. If the Windows smoke has ever passed in CI, that evidence should be
  re-examined.
- **Reproduced (macOS):** copied `server/ public/ mcp/ package.json` plus a `node_modules` symlink into
  `…/scratchpad/prax space/` and ran `node "<abs path>/server/index.js"` and `node server/index.js`
  from that cwd: `exit code=0 … listened=false outputBytes=0`. A symlink to the real checkout gave
  the same result. The real path listens (`Prax bound to host …`). Patching the guard to
  `process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]` in the scratch copy
  makes it listen.
- **Fix:** use the `fileURLToPath`/`resolve` form the other scripts use; add a regression test that
  spawns the server from a temporary directory whose name contains a space and asserts the
  readiness line.

### H3 — The static root is percent-encoded when the install path needs encoding

- **Where:** `server/config.js:49` — `publicDir: env.PUBLIC_DIR || new URL('../public', import.meta.url).pathname`.
  `URL.pathname` is percent-encoded, so the root becomes `/…/prax%20space/public`.
- **Trigger:** same paths as H2 without `PUBLIC_DIR` set. The desktop shell sets `PUBLIC_DIR`
  explicitly (`lib.rs:364`) and is unaffected; plain `npm start` installs are affected.
- **Impact:** with the H2 guard patched, `/healthz` returns 200 but `/`, `/js/main.js`, and
  `/prax.css` return 404 — a healthy-looking server that serves no UI.
- **Reproduced:** probe against the patched scratch copy: `200 /healthz`, `404 /`, `404 /js/main.js`.
- **Fix:** `fileURLToPath(new URL('../public', import.meta.url))`.

### H4 — The `npm audit --audit-level=high` gate is red (5 high, 4 moderate)

- **Where:** `package.json:41-44`; CI job `security` (`.github/workflows/ci.yml:87`); SECURITY.md:43
  states the gate runs on every push. `npm audit --omit=dev` also reports highs, so the container
  image and the desktop sidecar payload (`scripts/prepare-sidecar.mjs`, `npm ci --omit=dev`) carry them.
- **Findings from `npm audit --json`:** `@fastify/static` 9.3.0 (direct; GHSA-83w8-p2f5-377r high,
  GHSA-8pvw-jcv7-9cmj; fix 10.1.3 is semver-major), `find-my-way` ≤9.6.0 (HTTP/2 DoS; Prax runs
  HTTP/1 so not reachable), `fast-uri` (via fastify/ajv), `ip-address` (via
  `@modelcontextprotocol/sdk` → `express-rate-limit`; the MCP server is stdio-only), `brace-expansion`
  (via `@fastify/static` → `glob`); moderate: `fastify` ≤5.12.0, `hono`, `@hono/node-server`, `qs`.
- **Exploitability here:** low. The `@fastify/static` advisories concern bypassing route guards or
  `allowedPath`; Prax registers neither. Seven traversal probes (`/..%2fpackage.json`,
  `/%2e%2e/package.json`, `/js/%2e%2e/%2e%2e/package.json`, …) all returned 404.
- **Impact:** Gate A rule 2 ("existing automated evidence must stay green") is violated on `main`;
  the SECURITY.md claim is not currently true; HEAD's parent `d6fa709 chore(deps): clear the security
  audit` predates the 2026-07-23/24 advisories. Note the release workflow's quality job runs `check`
  and `test` but not `audit`.
- **Fix:** bump `@fastify/static` to 10.x (Fastify 5 compatible), run `npm audit fix` for the rest,
  re-run `npm test` and `npm run test:e2e`; consider adding the audit to `release.yml`.

### M1 — Keyword search silently returns the whole library for non-Latin or symbol-only queries

- **Where:** `server/libraryRepository.js:460-463` — terms are `match(/[a-z0-9]+/g)` on the
  lower-cased query; when no term survives, no FTS clause is added and the unfiltered list is returned.
  Non-ASCII letters inside a word are dropped rather than matched.
- **Trigger:** `GET /api/library/documents?q=日本語`, `?q=$$$`, MCP `search_documents` with such a
  query, the CLI keyword fallback, and the assistant's `search_documents` tool.
- **Reproduced:** with three documents (`Alpha runbook`, `Beta note`, `日本語ノート`):
  `q="日本語"` → 3 of 3 documents; `q="$$$"` → 3 of 3; `q="Überwachung"` → 0 of 3; `q="postgres"` → 1.
- **Impact:** a non-Latin user's search "matches" everything; the MCP envelope reports the full
  library as the exact match set (QINV-10: a bounded result that looks complete is misleading
  success). FTS5's default unicode61 tokenizer would handle these terms.
- **Fix:** tokenize with `/[\p{L}\p{N}]+/gu`; when no usable term remains, return an explicit empty or
  degraded result instead of dropping the clause; add regression cases for CJK and diacritics.

### M2 — Child collections on a missing document masquerade as empty

- **Where:** `server/libraryRoutes.js:647` (`/api/library/documents/:id/tasks`) and `:879`
  (`/api/library/documents/:id/similar`) return `200 []` for a nonexistent id, while `/links`
  (`:638`), `/runs`, `/external-refs`, and `/api/tasks/:id/documents` return 404.
  `docs/contract.md` ("Child collections are owner-aware") and QINV-10 promise the 404 behaviour.
- **Reproduced:** `200 …/11111111-…/tasks []`, `200 …/similar []`, `404 …/links`, `404 …/runs`.
- **Also:** `/similar` returns `[]` when semantic search is off, indistinguishable from "no similar
  documents", while `/api/tasks/:id/related-documents` returns `{ degraded: true, reason: 'semantic-off' }`
  (QINV-08 asks for the explicit form).
- **Fix:** 404 on a missing owner for both routes; return the degraded envelope from `/similar`.

### M3 — A lost response to an assistant approval leaves the write outcome unknown and the conversation stuck

- **Where:** `public/js/main.js:734-747` (`resolveAssistantWrites`): `assistantPending` is cleared
  before the request (`:739`); on a transport failure the catch only sets "The assistant request
  failed." `server/assistant/agent.js:86-118,136` executes approved writes through tool handlers
  whose creation ids are minted per call (`mcp/tools/tasks.js:78`, `mcp/tools/documents.js:96`), so an
  approval carries no idempotency key.
- **Trigger:** approve a write; the request reaches the server, the tool commits, and the response is
  lost (network blip, sleep, tab discard).
- **Impact:** the confirmation card is gone, the notice says the request failed, the history's tail
  is an unanswered tool-call turn (a follow-up message re-sends that history; Anthropic rejects a
  `tool_use` without a `tool_result`), and the only recovery is "New chat" plus manually checking
  whether the task or document exists. Repeating the request creates a duplicate. This is the lost-
  response case that `tests/e2e/assistant-partial-success.spec.js` does not cover (it covers provider
  failure after a committed tool result, which the server does report truthfully via `didWrite`).
  QINV-02/QINV-03.
- **Fix:** keep the pending card until a response or explicit decline; mint the creation id client-
  side per pending write and pass it into the tool input so a resend is exact-once; on transport
  failure say "outcome unknown — refresh before repeating"; add a browser journey for the lost
  approval response. (Evidence is by code reading; not executed in a browser.)

### M4 — Reflected HTML injection in the Google Calendar OAuth callback

- **Where:** `server/googleCalendarRoutes.js:88-91,111` — the `error` query parameter and provider
  error text are interpolated unescaped into the `text/html` response.
- **Reproduced:** `GET /api/integrations/google-calendar/callback?error=<img src=x onerror=alert(1)><b>injected</b>`
  → `200 text/html` with the raw markup in the body.
- **Impact:** the global CSP (`script-src 'self'`, no `unsafe-inline`) blocks inline script and
  event handlers, so this is content spoofing/phishing on the local origin via a crafted link rather
  than script execution. Low exploitability, but it is unescaped user input in HTML.
- **Fix:** HTML-escape both interpolations (the same `escapeHtml` used in `public/js/renderHelpers.js`).

### M5 — Documentation drift against shipped behaviour

- `docs/contract.md:103-104` documents "Max 500 tasks per import" and "Max 500 checklist items
  total"; the code enforces 5,000 tasks and 10,000 items per task (`server/tasksRoutes.js:61-62`).
  QINV-10 requires limits to be documented in the contract.
- `AGENTS.md:12` says memory lives in "Prax (Postgres + embeddings)"; the engine is embedded SQLite.
- `docs/backup-restore.md:84` (restore step 5) runs `npm run migrate`, but the container image copies
  only `scripts/backup-database.js` (`deploy/Dockerfile:23`), so that step fails inside the image
  (boot-time auto-migration covers the outcome, but the runbook step as written does not work there).
- `docs/contract.md` still cites a Postgres-era `0007` verification backfill; migrations were
  consolidated into `0001_init.sql`.
- `.prax/project.json` pins `"project": "moomora-console"`, so `prax context`, `prax search`, and
  `prax remember` without `--memory` run from this repository target (and auto-create) a project under
  the pre-rename name.

### M6 — The browser suite is not runnable on macOS: eight journeys fail on a select-all chord

- **Where:** the `replaceEditorBody` helpers in `tests/e2e/editor-autosave.spec.js:7`,
  `tests/e2e/library-editor-reflow.spec.js:42`, `tests/e2e/trust-actions.spec.js:17`, and
  `tests/e2e/wave1-draft-integrity.spec.js:47` press `Control+A` before `insertText`.
- **Trigger:** `npm run test:e2e` on macOS. In Chromium on macOS `Control+A` is not select-all (and
  CodeMirror binds it to line-start), so the inserted body is appended to the old one and the
  `toHaveValue` assertion fails. CI runs on Ubuntu, where `Control+A` selects all.
- **Reproduced:** run 2 — 84 passed, 8 failed; the same 8 fail again when run in isolation; scratch
  copies of the four spec files with `ControlOrMeta+A` pass all 18 tests (28 s) against the real
  server. Every one of the 8 failures carries the `replaceEditorBody` signature.
- **Impact:** the maintainer's own platform cannot run the evidence gate the quality standard relies
  on (`docs/quality-scorecards.md` "Last verification" lists `npm run test:e2e` as green), so local
  regressions in editor autosave, reflow, trust actions, and draft integrity would only be caught in
  CI. Testability and observability.
- **Fix:** use Playwright's `ControlOrMeta+A` (or branch on `process.platform`) in the four helpers.

### L1 — Task keyword search does not escape LIKE wildcards

`server/tasksRepository.js:520`. `GET /api/tasks?q=%` and `?q=_` return every task (reproduced: 2 of 2).
Fix: escape `%` and `_` and add an `ESCAPE` clause.

### L2 — Import accepts non-ISO timestamps and stores them verbatim

`server/tasksRoutes.js:47,99` accept anything `Date.parse` tolerates. Reproduced: `archivedAt: "1"`
is stored as `"1"` (the task is treated as archived), `deferredUntil: "2024"` as `"2024"`.
`docs/contract.md` declares both fields ISO-8601. Fix: require ISO or normalise through
`new Date(value).toISOString()` at the boundary.

### L3 — Supersede or link with an archived counterpart reports "document not found"

`server/libraryRoutes.js:942-947` → `404 document not found` when both documents exist but the
replacement is archived (reproduced). Fix: a 409 with an explicit reason.

### L4 — The served CSP allows remote images

`server/index.js:35` — `img-src 'self' data: https:`. The Markdown preview renders
`![](https://…)` (`public/js/markdownPreview.js`), so opening a note fetches third-party URLs from
the viewer (a tracking-pixel channel in a local-first app). The desktop bundle's own CSP is
stricter (`img-src 'self' data:`, `src-tauri/tauri.conf.json`) but the served header governs the
sidecar-served pages. Consider making remote images opt-in.

### L5 — Policy question: agent-origin metadata edits keep human verification

Reproduced: an agent PATCH changing `documentType` note → runbook and `tags` on a verified document
leaves `verified: true`. `server/libraryRepository.js:123-127` scopes revocation to body and title
deliberately, but QINV-04 is worded as "modified without a human reviewing the exact resulting
content", and a type change moves a document into the "Active runbooks" section that Ask Prax
reproduces verbatim. Not counted as a defect; flagged for a human decision on the invariant's scope.

## Uncertainties

- Windows behaviour of H2 is by analysis of `process.argv[1]` and `import.meta.url` forms; not executed.
- Remote repository visibility for H1 is unknown (404 unauthenticated for both names).
- The Playwright e2e suite: the first run failed on every test because Chromium was not installed on
  this machine (environment, not product). After installing Chromium, 84 of 92 journeys pass; the
  remaining 8 are a macOS-specific test-helper assumption (M6), not product failures.
- Performance activation is documented as held (`docs/quality-scorecards.md`, untracked
  `ROOM-prax.md`); `scripts/verify-performance-budget.mjs` requires `--budget` and was not run.

## Coverage gaps

- `public/js/main.js` (6,254 lines) was read selectively: assistant flow, render entry points,
  storage keys, confirmation dispatch. Frontend behaviour otherwise relies on the unit and e2e suites.
- CodeMirror bundle (`public/vendor/codemirror-editor.js`) and `scripts/codemirror-editor-source.js`
  not reviewed.
- Rust desktop shell reviewed as source only; `cargo test` not run.
- `tests/frontend/*` and `tests/backend/*` bodies were not audited for assertion quality beyond
  the failures they would need to catch for the findings above (none of the findings here has a test).
- Provider adapters were reviewed for request shaping and error handling, not exercised against
  live services.

## Implemented

None. This was a read-only review. The only file written is this report:
`docs/reviews/2026-09-04-claude-independent-review.md`. Scratch reproductions lived under the
session scratchpad and were not added to the repository.

## Tested

| Command | Outcome |
|---|---|
| `git rev-parse HEAD`, `git status --porcelain`, `git ls-files`, `git ls-tree -l origin/main prax.db-wal prax.db-shm` | HEAD `0c3cdfa`, tree state and tracked sidecars as recorded above |
| `node .claude/skills/prax-recall/recall.mjs "<review query>"` and `--recent 8` | Prax not reachable at 127.0.0.1:3000 (no prior memory) |
| `npm run check` | pass |
| `npm test` | 1781 tests, 1781 pass, 0 fail (2.5 s) |
| `npm audit --audit-level=high` / `npm audit --json` / `npm audit --omit=dev --audit-level=high` | 9 vulnerabilities (5 high, 4 moderate); highs remain with `--omit=dev` |
| In-memory reproduction script (`buildApp` with `PRAX_DB_FILE=:memory:`): R1 child collections, R2 FTS non-ASCII, R3 LIKE wildcards, R4 callback injection, R5 agent retype, R6 loose timestamps, R7 archived supersede, R8 project-only patch, R9 semantic-off shapes, R10 static traversal probes | Results as recorded in M1, M2, M4, L1, L2, L3, L5; traversal probes all 404 |
| Scratch copy under a path containing a space: `node "<path>/server/index.js"`, `node server/index.js`; symlinked checkout; guard-patched copy | H2 reproduced (exit 0, never listens) and fixed by the `fileURLToPath` guard; H3 reproduced (`/healthz` 200, `/` 404) |
| Scratch pairing of the current `prax.db` with the committed WAL (read-only, copies) | `database disk image is malformed` (H1) |
| `strings` counts on the committed and working WAL (no content printed) | 117 ISO timestamps, 76 DDL statements, 0 secret-shaped keys |
| `HOME=<read-only dir> npm run backup -- --help` | works (the documented in-container backup command tolerates a read-only home) |
| `npx playwright test` (run 1) | 92 failed — Chromium executable missing (environment) |
| `npx playwright install chromium && npx playwright test` (run 2) | 84 passed, 8 failed (1.8 min). The 8 reproduce in isolation and share one cause (see M6) |
| `npx playwright test <the 8 failing specs>` (isolated rerun) | 8 failed again (deterministic on this host) |
| Scratch copies of the 4 affected spec files with `Control+A` → `ControlOrMeta+A`, run via a scratch config against the real server | 18 passed (28 s), including all 8 previously failing journeys |
| `npm run verify:portable` | pass — 200 tasks, 150 checklist items, project remapped, ids regenerated, digest `976ca034…` |
| `npm run verify:restore` | pass — live `large` WAL snapshot destroyed/restored, `0009` snapshot migrated through `0022`, integrity ok, marker preserved, production boot verified |

## Unable to test

- Windows execution of the H2 entry guard and the desktop smoke (`npm run desktop:smoke`): no
  Windows host; no Rust toolchain build was attempted.
- Live provider paths (OpenAI, Anthropic, Gemini, Ollama, Voyage, Claude CLI, Google Calendar): no
  credentials or services configured; reviewed as code only.
- Remote repository visibility (H1): the GitHub API answers 404 unauthenticated.
- `npm run measure:performance` / `gate:performance`: the performance harness needs the `large`
  fixture and reference hardware; activation is documented as held.
