# Independent Prax release-candidate review

Reviewed on 2026-09-06, on `main` at `fe09b935bba155fca92a44d1d7315bd70c4e5480` (`fe09b93`). All repository paths below are relative to `/Users/markjoyeux/Developer/Personal/prax`; line numbers refer to that revision. No source, configuration, dependency, or Git changes were made.

**Verdict: not ready to designate as a release candidate.** The automated baseline passes, including the browser suite, but four independently reproduced memory-path defects violate the active Gate A rules. Release identity also needs preparation: the working tree still identifies itself as an already-published release while substantial changes remain under Unreleased.

## 1. Is the app ready to be a release candidate?

### Actual validation results

| Command | Actual result |
|---|---|
| `npm test` | Exit 0; **1,873 passed, 0 failed, 0 skipped**, 3,979.779375 ms reported by the test runner. |
| `npm run check` | Exit 0; syntax checks passed and **`skill bundles are up to date`**. |
| `npm run test:e2e` | Initial attempt: exit 1, all 113 cases unable to launch the missing Playwright browser. After installing Chromium in a temporary directory, the rerun passed **113/113 in 1.6m**, exit 0. |
| `npm audit --audit-level=high` | Exit 0; **`found 0 vulnerabilities`**. |
| `npm run verify:portable` | Exit 0; 200 tasks, 150 checklist items, 12 archived tasks; project remapping and regenerated task/checklist IDs verified. |
| `npm run verify:restore` | Exit 0; disposable large/current and historical restore scenarios passed integrity, semantic validation, migration, live-WAL-marker preservation, and production boot. |
| `node scripts/verify-desktop-release.mjs --tag v0.20.0` | Exit 0; **`[desktop-release] verified Prax v0.20.0 for aarch64-apple-darwin`**. This checks source metadata/resources, not a newly built native package. |

The browser rerun command was:

```sh
PLAYWRIGHT_BROWSERS_PATH=/private/tmp/prax-rc-browsers PRAX_E2E_PORT=32791 npm run test:e2e
```

The missing runtime was remedied with `PLAYWRIGHT_BROWSERS_PATH=/private/tmp/prax-rc-browsers npx playwright install chromium`. It did not require changing the repository or the user's browser installations. Local execution used Node `v24.19.0`, reported by `node -p 'process.version'`.

Independent external corroboration: `gh run list --repo markjoyeuxcom/prax --commit fe09b935bba155fca92a44d1d7315bd70c4e5480 ...` returned one completed, successful [CI run for this exact commit](https://github.com/markjoyeuxcom/prax/actions/runs/34038893921). It did not return a native release build for this commit.

### Confirmed Gate A blockers

The governing standard makes a discovered invariant violation a release blocker at `docs/superpowers/specs/2026-07-13-exceptional-prax-quality-standard.md:27–41`. These are behavioral reproductions, not deductions from missing tests.

**R1 — P1: an old remember retry overwrites newer accepted memory. QINV-03 and QINV-09.**

`server/libraryRepository.js:710–727` looks up the active title and updates its body before checking the caller ID. The ID conflict/replay checks at lines 730–738 are reached only when no matching active title exists. `cli/lib/apiClient.js:151–154` automatically retries this endpoint, while `cli/lib/remember.js:20–29` describes the ID as making a lost response safe.

Reproduced through `buildApp`, real HTTP route injection, and a fresh SQLite `:memory:` database:

1. Upsert title “Retry review”, request ID A, body “A: original”.
2. Upsert the same title, ID B, body “B: newer accepted memory”.
3. Replay the original request A unchanged.
4. Send ID A again with a different body.

Observed output, with the same stored document ID throughout:

```text
{"http":201,"body":"A: original","created":true}
{"http":200,"body":"B: newer accepted memory","created":false}
{"http":200,"body":"A: original","created":false}
{"http":200,"body":"Changed intent under SAME request id","created":false}
```

The replay loses the newer body, and changed intent is accepted instead of the documented 409. `docs/contract.md:389–395` explicitly promises safe replay and conflicting-ID rejection. The existing test at `tests/backend/libraryUpsertByTitle.test.js:80–87` checks a consecutive identical retry, without an intervening write; that does not cover this defect.

Required fix: durable operation identity/intent validation before title mutation, including retries of updates to existing titles. Replaying a completed operation must not reapply its old body. Add the interleaved A/B/A and changed-intent regression cases.

**R2 — P1: API discovery can redirect a committed write into a second workspace. QINV-02, QINV-03, and QINV-09.**

`cli/lib/apiClient.js:54–62` builds the desktop-port/default-port candidate list. Every request at lines 85–95 tries the selected base and then the other candidates on any fetch rejection. Successful discovery does not permanently pin a workspace, and the loop applies to writes as well as reads. `docs/cli.md:54–56` says the first answering instance is pinned.

Reproduced with two disposable loopback HTTP servers and the real `createClient({bases})` implementation. A preliminary GET selected the first server. On POST, the first server recorded the mutation and dropped its response; the second server accepted the same POST. Output:

```text
Initially selected: http://127.0.0.1:54697
Observed POST commits: ["desktop","fallback"] Final selected: http://127.0.0.1:54698
```

Those ports are test values, not product defaults. This proves transport routing; it does not claim to have mutated two actual user databases. The production candidate list supplies the equivalent desktop/default-server pair. Independent databases do not share ID receipts, so a stable document ID does not prevent this cross-workspace effect. Even a pre-commit failure can put the intended write in the wrong workspace.

Required fix: discover using read-only validation, bind the client to that instance, and never switch instances to reconcile or retry an uncertain write. Return an explicit uncertain outcome tied to the original instance.

**R3 — P1: CLI search and skill recall hide an incomplete semantic index. QINV-08 and QINV-10.**

`cli/lib/apiClient.js:130–134` uses the legacy unpaged semantic route. `server/libraryRoutes.js:418` returns its array before index coverage is calculated at lines 427–439. `cli/lib/search.js:3–11` then labels any successful response `degraded:false`; `cli/lib/recall.js:43–44,57–59` turns an empty array into an unconditional “No relevant memory found”.

Reproduced with the real app, an in-memory database, the deterministic fake embedder, and one active document with no current embedding. The same query produced:

```text
PAGED {"items":[],"page":{"offset":0,"limit":20,"returned":0,"total":0,"hasMore":false,"nextOffset":null},"index":{"total":1,"embedded":0,"pending":1},"degraded":true,"reason":"index-incomplete"}
CLI_SEARCH {"schemaVersion":1,"retrieval":{"mode":"semantic","degraded":false,"reason":null},"items":[]}
SKILL_RECALL No relevant memory found for: "restore"
```

This matters during upgrades, reindexing, new-document embedding delay, and provider/model changes. The code already has the necessary coverage information, but the CLI and bundled skill path loses it. `docs/contract.md:591–595` documents pending vectors; `skills/prax-recall/SKILL.md:31–35` describes a no-match as honest.

Required fix: consume and preserve the coverage-bearing response, paginate it completely or disclose the requested bound, and distinguish “no matches among indexed documents” from a complete no-match. Propagate this to JSON and human-readable output and rebuild the bundles.

**R4 — P1: recent recall returns retired memories without identifying them as retired. QINV-05 and QINV-08.**

`cli/lib/recall.js:17–26` calls `listDocuments` without `status:active`, then discards lifecycle fields from the output. `cli/lib/apiClient.js:204–209` only applies a status filter when supplied. The raw listing deliberately includes non-archived superseded/deprecated documents (`docs/contract.md:437–440`).

Reproduced with two new documents in a disposable real database, retiring the first through the normal supersede route, then calling recent recall:

```text
Retirement: 200 superseded
Most recent 2 document(s) in "recent-lifecycle-review":
- Retired instruction — 1835e10e-527c-4a6c-8c4d-9149d799eb7c — Retired instruction
- Current replacement — 9ac1c291-565e-4bb3-bb06-b8964fe799df — Current replacement
```

`docs/agent-memory.md:88–89` describes recall, including its recent mode, as active-only. The retired result carries no status warning. It can therefore reintroduce instructions that the user deliberately replaced.

Required fix: make ordinary recent recall active-only. If a historical curation mode is desired, expose it explicitly and retain lifecycle/trust labels.

### Release identity

| Location | Observed value | Assessment |
|---|---|---|
| `CHANGELOG.md:13` | `[Unreleased]`, with substantial content through line 844 | Not prepared as a new candidate/release entry. |
| `CHANGELOG.md:845` | `[0.20.0] - 2026-06-11` | Historical release entry, not the present Unreleased work. |
| `package.json:3` | `0.20.0` | Matches the historical release. |
| `src-tauri/tauri.conf.json:4` | `../package.json` | Correctly delegates version resolution to package.json. |
| `src-tauri/Cargo.toml:3` | `0.20.0` | Matches package.json. |
| `package-lock.json:3,9`; `src-tauri/Cargo.lock:2549`; `.claude-plugin/plugin.json:4` | `0.20.0` | Agree with the same source version. |

Actual tag evidence:

```text
git rev-parse HEAD
fe09b935bba155fca92a44d1d7315bd70c4e5480

git rev-parse 'v0.20.0^{}'
b8eb4cee1cf3fa47be7ef8ac0cffd5ce99382730

gh release list --repo markjoyeuxcom/prax --limit 5
v0.20.0  Latest  v0.20.0  2026-06-11T13:08:01Z
```

A manual release dispatch using the existing tag checks out that older commit (`.github/workflows/release.yml:59–62,87–90,167–170`). A new tag with a different version is rejected until package/Cargo versions agree (`scripts/verify-desktop-release.mjs:36–47`). Do not repurpose the published tag; prepare a fresh candidate identity and corresponding changelog entry.

### Release workflow assessment

- **Current structure is sensible:** native builds are prerequisites of both container publication and final release publication (`release.yml:84,134,244`); native Rust checks and packaged runtime smoke run before artifacts are uploaded (lines 193–239); final publication rejects filename collisions and emits SHA-256 sums (lines 254–278). Supported targets match README: macOS ARM64 and Linux x64/ARM64.
- **P1 gate gap:** release quality runs source verification, `npm run check`, and `npm test`, but neither browser tests nor dependency audit (`release.yml:54–80`). Those run in the separate CI workflow, triggered by main pushes/PRs (`ci.yml:3–9,38–87`). The release workflow neither depends on that workflow nor checks its exact-SHA result. A tag/manual release can therefore publish a revision whose broader Gate A evidence is absent or failing. For this reviewed commit, independent local/browser/audit evidence is green; the pipeline still needs enforcement.
- **Stale namespace requiring validation:** `release.yml:20` still publishes `awaybreaktoday/prax`, whereas origin and authenticated repository metadata identify the private organization repo as `markjoyeuxcom/prax`. `compose.image.yaml:3`, deployment overlays, and README use the old GHCR namespace too. This may intentionally preserve an existing package, but repository redirects do not establish package-push permission. Read-only package metadata queries for both namespaces returned 404 with the available credential; that is inconclusive about private package existence/access. Validate the linked package and Actions write grant, or migrate the namespace consistently. Do not count this as a reproduced publishing failure. [GitHub documents package/repository access separately](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).
- **No nonexistent/stale action-major blocker found.** I fetched the source GitHub release registries at review time. All versioned actions used by these workflows are on the observed latest major:

| Source release registry | Latest returned tag | Workflow major |
|---|---|---|
| [actions/checkout](https://api.github.com/repos/actions/checkout/releases/latest) | `v7.0.1` | `v7` |
| [actions/setup-node](https://api.github.com/repos/actions/setup-node/releases/latest) | `v7.0.0` | `v7` |
| [actions/upload-artifact](https://api.github.com/repos/actions/upload-artifact/releases/latest) | `v7.0.1` | `v7` |
| [actions/download-artifact](https://api.github.com/repos/actions/download-artifact/releases/latest) | `v8.0.1` | `v8` |
| [actions/dependency-review-action](https://api.github.com/repos/actions/dependency-review-action/releases/latest) | `v5.0.0` | `v5` |
| [docker/setup-qemu-action](https://api.github.com/repos/docker/setup-qemu-action/releases/latest) | `v4.3.0` | `v4` |
| [docker/setup-buildx-action](https://api.github.com/repos/docker/setup-buildx-action/releases/latest) | `v4.3.0` | `v4` |
| [docker/login-action](https://api.github.com/repos/docker/login-action/releases/latest) | `v4.6.0` | `v4` |
| [docker/metadata-action](https://api.github.com/repos/docker/metadata-action/releases/latest) | `v6.2.0` | `v6` |
| [docker/build-push-action](https://api.github.com/repos/docker/build-push-action/releases/latest) | `v7.3.0` | `v7` |
| [softprops/action-gh-release](https://api.github.com/repos/softprops/action-gh-release/releases/latest) | `v3.0.3` | `v3` |

The prior successful [release run](https://github.com/markjoyeuxcom/prax/actions/runs/27348942183) belongs to the old release commit, not the reviewed HEAD. I did not trigger publication.

### Remaining quality evidence

No surface is Gate B activated (`docs/quality-scorecards.md:3,20–29`). Manual assistive-technology, cognitive, physical-touch, and native-platform evidence remains prepared rather than completed (lines 47–54). The last recorded enforcing performance run failed the Library p50 boundary (lines 60–65; `docs/quality-fixture.md:173–177`). These are explicitly recorded evidence gaps, not fresh measurements from this review and not proof of another invariant violation. Do not conflate Gate B incompleteness with the four confirmed Gate A blockers above.

## 2. Are the instructions up to date?

**Partly.** I cross-checked README, AGENTS, SECURITY, all ten `docs/*.md` guides, and `skills/README.md`, plus the installer, relevant desktop instructions, quality policy, workflows, and their implementations. A mechanical check of those 14 current guides found **no missing literal `npm run` script names or local Markdown-link targets**. That does not validate placeholder paths or every possible invocation. I did not treat dated design plans/review archives as current installation instructions.

The following are the stale, wrong, or materially incomplete statements found. Some entries describe a documentation promise broken by code; those are not invitations to weaken a Gate A invariant instead of repairing the implementation.

| ID | Statement/location | Current evidence and needed correction |
|---|---|---|
| D01 | README's future-work list, `README.md:317–319` | Trust UI/supersede, retrieval evaluation, external references, and repo-URL detection already exist. See `docs/ROADMAP.md:21–30,80–98`, `package.json:26`, `cli/prax.js:35–57`, and MCP document-link/reference tools. Update the summary to actual remaining work. |
| D02 | Repository clone/link and vulnerability-report URLs: `README.md:65,340`, `SECURITY.md:16` | They use `awaybreaktoday/prax`; origin is `markjoyeuxcom/prax`. Both authenticated `gh api repos/...` queries currently returned `full_name:markjoyeuxcom/prax, private:true`. Thus these are stale, redirect-dependent references, not demonstrated broken links. Use the canonical repository, including for reporting. |
| D03 | Task export described as “backups”: `README.md:239`, `docs/contract.md:4–5,45` | These formats omit history, links, and project metadata (`docs/backup-restore.md:34–38`). Surrounding docs usually explain the limitation, but these labels contradict the distinction. Call them portable task exports; reserve authoritative backup for SQLite snapshots. |
| D04 | AGENTS' “full surface” list and blanket namespace distinction: `AGENTS.md:72,75–78` | The list omits `unverify`; `prax recall` is cross-project by default, and the recall skill also searches all projects rather than only `memory`. Actual help is `cli/prax.js:60–76`; skill defaults are `cli/lib/recall.js:15–17,32`. Qualify the distinction as project-scoped commands versus the remember skill's write namespace. |
| D05 | CLI project detection skips the git rung: `docs/cli.md:29–33` | `cli/prax.js:35–57` inserts git-remote matching before folder-name fallback. `docs/agent-memory.md:117–124` already describes the correct order. |
| D06 | `prax init` uses the “usual detection order”: `docs/cli.md:69` | The implementation separately checks a git match and then calls `detectProject({})`, omitting `PRAX_PROJECT` (`cli/prax.js:88–105`). In a temporary directory, `PRAX_PROJECT=explicit-environment-project` still wrote `{"project":"prax-rc-init-jAG41b"}` with exit 0. Align init with the promised precedence, or document its distinct behavior. |
| D07 | First answering app is “pinned”: `docs/cli.md:54–56` | It remains only a preferred base; other candidates are still tried on later failed writes (`cli/lib/apiClient.js:85–95`). See R2. |
| D08 | `search --all` includes archived documents: `docs/cli.md:109` | It includes retired lifecycle statuses, but not archived rows. Keyword calls have no `archived=all`; semantic SQL always requires `archived_at is null` (`cli/lib/apiClient.js:124–134`; `server/libraryRepository.js:417`). A real archived-document query returned `items:[]` with `all:true`. Describe the actual scope or implement an explicit archive mode. |
| D09 | `--tag` takes “a single tag”: `docs/cli.md:145` | It accepts a comma-separated list (`cli/prax.js:187`; help at line 68). Repeated `--tag` flags are last-one-wins in `parseArgs`, not accumulated. Document both accurately. |
| D10 | CLI “full guide” omits a recall command section and `remember --memory` guidance: `docs/cli.md:58–180`, `README.md:219–220` | Both commands are in actual help (`cli/prax.js:66,68`) and agent-memory docs, but missing from the human CLI command guide. Cross-link or add these supported paths. |
| D11 | Document links/provenance described as “planned”: `docs/contract.md:7–8` | They are implemented and documented later in the same file (lines 353–406). Remove the obsolete example. |
| D12 | HTTP API consumed “only” by frontend and local MCP: `docs/contract.md:19–21` | The independently installed CLI/skills also call it (`cli/lib/apiClient.js`, `skills/README.md:10–14`). Explain that separately updated skill bundles can encounter older servers and document compatibility limits. |
| D13 | Task export example includes `requestId`: `docs/contract.md:32–40` | `server/tasksRoutes.js:489–495` exports format/version/exportedAt/project/tasks, without a requestId. Request IDs belong to import operations. Remove it from the export example. |
| D14 | Safe upsert retry and conflicting-ID rejection: `docs/contract.md:389–395`, `docs/agent-memory.md:54` | False for a matching active title; R1 demonstrates both cases. Repair the implementation and regression evidence. |
| D15 | All search/read paths carry `kind` and trust fields: `docs/contract.md:403–407,433–436` | Normal MCP `search_documents` maps through `toDocumentRef`, which strips kind and all trust/lifecycle fields (`mcp/tools/documents.js:41`, `mcp/shape.js:8–16`). The six-field summary at `docs/contract.md:261` is accurate, but contradicts the broader claim. Preserve the metadata or explicitly document this summary exception. |
| D16 | CLI recall accepts an explicit status/`--all` override: `docs/contract.md:434–436` | The recall branch only consumes project/recent/limit/json (`cli/prax.js:153–164`); neither status nor all is forwarded. The skill parser also exposes no such curation mode. |
| D17 | Recent recall is active-only: `docs/agent-memory.md:88–89` | Superseded documents appear without a status label; see R4. |
| D18 | Embedding backend list and env-only configuration: `docs/contract.md:495–513` | The passage omits supported dedicated `llamacpp`, `gemini`, and `voyage` providers and says URLs/models/keys are env-only and settings is just status/toggle. `server/embedderProvider.js:11` lists the backends; `server/settingsRoutes.js:8,125–146` accepts and persists provider fields. README and SECURITY already explain the actual operator-settings model. |
| D19 | Unsafe bind refused before opening DB: `docs/deployment.md:36–37` | The application is built, opens/migrates SQLite, and only then checks bind safety (`server/index.js:31,46–47,118–123`). Listener refusal still works; the claimed timing is wrong. |
| D20 | Container image does not bake in bind/acknowledgement: `docs/deployment.md:43–46` | `deploy/Dockerfile:17–18` explicitly sets `HOST=0.0.0.0` and `PRAX_ALLOW_UNAUTHENTICATED_NETWORK=true`. Explain the image's internal bind and host-publication boundary accurately. Compose remains host-loopback-only (`compose.yaml:15–17`). |
| D21 | Assistant has a 32-tool tree: `docs/ROADMAP.md:50` | `buildToolset({}).length` returned **35**; see `mcp/server.js:28–41`. |
| D22 | Desktop port changes per launch: `docs/ROADMAP.md:113–114`, `docs/google-calendar.md:69–71`; ambiguous ephemeral wording in `docs/quality-scorecards.md:168–170` | `server/desktopLifecycle.js:4–28` reuses a saved port after the first launch. The ICS URL is still hidden on desktop (`public/js/main.js:3707`), but lack of a stable port is no longer the reason. Update the explanation. |
| D23 | Google OAuth testing mode is fine forever: `docs/google-calendar.md:25–26` | Google's published rule gives External/Testing refresh tokens a seven-day expiry except for basic identity-only scopes. Prax requests Calendar scope (`server/googleCalendar.js:28`), so that exception does not apply. Document reconnect/production-consent implications. [Google OAuth token-expiration rules](https://developers.google.com/identity/protocols/oauth2). |
| D24 | Fixture embedding hash matches the body: `docs/quality-fixture.md:53–54` | Current-schema fixtures use title+body revision; body hash is only the historical fallback (`scripts/create-quality-fixture.js:357–368`). |
| D25 | UI-settable backend secrets/config listed as a release blocker: `docs/quality-scorecards.md:193–195` | Current code intentionally offers those operator settings (`server/settingsRoutes.js:8–10,106–146`); `SECURITY.md:39–51` and `AGENTS.md:82–87` explicitly permit them within the operator trust boundary. Update the stale scorecard clause to the agreed model. This is a policy-document contradiction, not an independently established security defect. |
| D26 | `gh auth login` alone presented as sufficient for installer Git access: `skills/README.md:21–25,42–43` | The installer hardcodes an SSH repository default (`skills/install.sh:15,40`). An HTTPS-only gh login does not provide an SSH key. Specify SSH setup or an HTTPS `PRAX_SKILLS_REPO` with Git credential setup. [GitHub CLI documents the selectable Git protocols](https://cli.github.com/manual/gh_auth_login). Existing SSH access worked here; this is a fresh-machine instructions gap. |
| D27 | No-checkout uninstall uses `sh install.sh --uninstall`: `skills/README.md:31–34` | The documented pipeline never saves install.sh locally and deletes its clone. Supply an actual no-checkout uninstall download command or explain saving the installer first. |

Other relevant distinctions: `docs/ROADMAP.md:16–20` describes what an older release originally shipped; I did not call that historical PostgreSQL entry a current deployment instruction. Likewise, dated test counts and performance results are historical evidence, not claims of the current suite count. The roadmap's claim of a live Keycloak-fronted private deployment (`docs/ROADMAP.md:118–119`) is not verifiable from this sanitized repository and should not be relied on as a deployment prerequisite already satisfied.

Ports and paths checked as correct: plain server fallback `127.0.0.1:3000` (`server/config.js:44–50`); demo `127.0.0.1:3100` (`scripts/demo-server.js:703–707`); Compose host `127.0.0.1:3100` → container `3000` (`compose.yaml:13–17`); desktop saved-port discovery (`cli/lib/apiClient.js:35–62`); database env precedence `PRAX_DB_FILE` → legacy `DATABASE_URL` → `prax.db`; the referenced backup/migrate/fixture/verification scripts and local guide links exist.

## 3. Can the memory skills be installed without a checkout?

**Yes: the installer and standalone bundles work with repository access. The new-user instructions need the corrections below.**

I ran the **unmodified** `skills/install.sh` against both this local Git repository and the real private SSH remote. Both installed successfully; reinstall succeeded, and remote-install uninstall succeeded. `gh api -H 'Accept: application/vnd.github.raw' repos/markjoyeuxcom/prax/contents/skills/install.sh` downloaded an installer byte-identical to the reviewed file. `git ls-remote ... refs/heads/main` returned the reviewed full SHA.

Isolation matters: setting only `PRAX_SKILLS_DIR` is insufficient because `skills/install.sh:18,47,57` still writes to the hardcoded Claude directory. I used a temporary `PRAX_SKILLS_DIR` plus tiny PATH shims for `mkdir`, `ln`, and `rm` that translated only the exact Claude skill destination prefix to another temporary directory. HOME was unchanged; real `~/.claude` and `~/.agents` were not modified. The original installer's printed “linked from” strings retain the hardcoded home path, but the writes were redirected by the test harness.

Test root:

```text
/var/folders/6_/9rj0621x461b4xs8vbk7zlym0000gn/T/prax-rc-install-Sdl4gp
```

Observed installation evidence:

```text
install exit 0
prax-recall bundle byte-identical: true
prax-remember bundle byte-identical: true
Claude-linked script syntax exit 0  [both scripts]
reinstall exit 0
Remote SSH install: exit 0
Remote uninstall: exit 0
removed prax-recall
removed prax-remember
```

I then ran the installed scripts with their working directory outside the checkout, against a temporary production Prax HTTP server using SQLite `:memory:`:

```text
Codex remember: exit 0
Remembered "RC portable skill rehearsal" ... (created, as codex)

Claude-linked recall: exit 0
(semantic search disabled — keyword results)
## RC portable skill rehearsal  (decision · ...)
Recalled from an installed standalone bundle.

Claude-linked remember: exit 0
Remembered "RC portable skill rehearsal" ... (updated, as codex)

Codex recent: exit 0
Most recent 1 document(s):
- RC portable skill rehearsal ... Updated through Claude symlink.
```

Database readback found **one** document after both writes, with the updated body, preserved `documentType:decision`, `kind:synthesized`, `updatedBy:agent`, `updatedByAgent:codex`, and `verified:false`. Both paths were executed by this Codex pane; the Claude path test verifies the symlinked script, not an assertion that Claude authored the write or that a fresh Claude process discovered it.

The filesystem layout follows the declared skill structure, and the repository contains a plausible Claude marketplace/plugin manifest (`.claude-plugin/marketplace.json:7–11`; `.claude-plugin/plugin.json`). I did not mutate either application's real skill registry or execute plugin-manager installs.

Documentation assessment:

- `skills/README.md:19–43` provides a concrete one-command path, prerequisites, destination, update behavior, and overrides. `docs/agent-memory.md:95–113` explains installation, app discovery, and embeddings. This is a usable starting point.
- Fix the SSH-versus-gh-login mismatch and unusable no-checkout uninstall snippet (D26–D27).
- Add a portable-skills installation link near `README.md:215–220`: the main user entry point currently explains only checkout-based `npm link` for the CLI. A desktop user should be able to discover the standalone pack directly.
- Explicitly explain that the repository is private: a person without granted repository access cannot install it with these commands. Authentication alone does not grant membership/access.
- Explain that a custom `PRAX_SKILLS_DIR` changes the real copies but still creates Claude links, and that an arbitrary directory will not automatically become a Codex discovery root. An explicit Claude destination override would also permit straightforward isolated testing.
- Provide both recall and remember verification examples against disposable data. The existing `--recent` check proves reachability but does not test semantic retrieval or writing.
- The installer checks only that `node` exists (`skills/install.sh:31`), not the documented minimum major. A clear version check would give a new user an actionable failure instead of installing unusable scripts.

## 4. What functionality is missing before calling this a release candidate?

**P0: none established in this bounded review.** The following P1 items are still release blockers or immediate release-preparation requirements; P2 items can be tracked separately without pretending Gate B is activated.

### P1 — before candidate designation/publication

1. **Safe durable remember retries** (R1): receipt/intent checking before mutation, including update operations, and tests with an intervening human/agent edit. This closes reproduced data loss.
2. **Instance-bound discovery and write reconciliation** (R2): select an instance before writes and preserve it through failures; never silently fail over a consequential request to another database.
3. **Truthful semantic coverage in CLI and both bundles** (R3): include pending-index/fallback information and distinguish a partial search from a complete no-match.
4. **Lifecycle-aware recent recall** (R4): exclude retired memory by default and label it in any explicit history mode.
5. **A fresh release identity plus enforceable release gates:** align package/Cargo/lock/plugin metadata and changelog with a new tag; require exact-revision browser/audit results along with existing unit/native gates. Validate GHCR permissions for the namespace actually published, and collect native artifacts/smoke results for that candidate revision.
6. **Correct installation, security-boundary, and integration guidance:** prioritize D07/D14/D17, D18–D20, D23, and D25–D27 because they affect recovery, exposure, or first installation. The remaining wording corrections should be a focused documentation pass.

### P2 — concrete follow-up, not invented RC requirements

- **Reliable skill installation lifecycle:** a supported Claude destination override, runtime-major validation, a no-checkout uninstall command, and automated temporary-directory install/reinstall/uninstall coverage. The current unit suite contains shared-bundle/CLI coverage but no `skills/install.sh` tests found by source search.
- **Expose trust in compact recall/search results:** ordinary recalled text and MCP keyword references drop verified/status/kind signals (`cli/lib/recall.js:61–79`; `mcp/shape.js:8–16`). Showing those signals would make the documented “unverified is a lead” guidance actionable without another get call.
- **Complete the existing human and performance evidence program:** run the prepared manual matrix and resolve/re-measure the recorded Library p50 budget failure on the approved reference environment (`docs/manual-activation.md:152–207`; `docs/quality-fixture.md:173–177`). These improve evidence and usability rather than adding another product feature.
- **Restore desktop calendar subscription discoverability:** the implementation still hides the ICS URL on desktop despite persisted ports (`public/js/main.js:3707`; `server/desktopLifecycle.js:4–28`). Decide and document whether local desktop subscriptions are supported now that the stated prerequisite exists.

I would not add broad new AI features or a new authentication system as prerequisites for this candidate. The existing documented trust boundary and feature set can support an RC once the concrete correctness and release-evidence gaps above are closed.

## Implemented

Independent read-only review and this Markdown report. No product code was changed, no commit/tag/release was created, and no real skill installation directories were modified. Tests used temporary databases, servers, browser binaries, and skill destinations. The pre-existing untracked `ROOM-prax.md` and `mise.toml` were left alone.

## Tested

- Required `npm test`: 1,873/1,873 pass, exit 0.
- Required `npm run check`: syntax/bundle checks pass, exit 0.
- Browser gate: initial missing-browser failure; temporary browser installation succeeded; final 113/113 pass, exit 0.
- `npm audit --audit-level=high`: zero vulnerabilities, exit 0.
- `npm run verify:portable`: 200-task/150-checklist semantic round trip, exit 0.
- `npm run verify:restore`: current/large and historical recovery, integrity and production boot, exit 0.
- Desktop source/tag agreement verifier: matching current source version accepted; an intentionally different candidate tag rejected with `Release tag ... does not match package version v0.20.0`.
- Original installer with local and private-remote sources: install/reinstall/uninstall passed with temporary destination redirection.
- Both installed skill entry paths: remember/read/update/recent operations passed from outside the checkout against a disposable server; bundles byte-identical to source.
- Real-route/database probes: reproduced stale upsert replay, accepted changed request intent, hidden incomplete index, and retired-memory recent recall.
- Two-loopback-server transport probe: reproduced a POST accepted by both selected and fallback servers after response loss.
- CLI documentation probes: archived documents absent from `search --all`; `init` ignored PRAX_PROJECT; toolset count is 35.
- Fourteen current guides: all literal npm script references and relative Markdown targets resolved.
- GitHub read-only checks: canonical private repository, current source SHA, historical published tag, same-commit CI success, release-run history, current action-release majors.

Evidence logs copied alongside this report contain the check/browser/audit/portable/restore/installer/consumer outputs. The installer harness and standalone consumer harness are retained under `/private/tmp/prax-rc-installer-test.mjs` and `/private/tmp/prax-rc-consumer-test.mjs` on this machine. Their paths are supporting local evidence, not distributable product commands.

## Unable to test

- Initial Prax recall could not reach the saved desktop port or fallback port: `Prax not reachable at http://127.0.0.1:51623 or http://127.0.0.1:3000 ... (fetch failed)`. I used no prior-memory claims. Later skill integration tests used a separate disposable app.
- No Docker runtime command was available (`docker: command not found`), so I did not build/run the container or establish GHCR push success. Package metadata requests returned 404 and do not prove package absence or permission failure.
- I did not build or manually install all native packages, trigger a release workflow, test real Google account authorization, or operate human assistive technologies/physical devices. Existing source checks and historical CI results are explicitly distinguished from those unperformed checks.
- A fresh Claude Code/Codex installation-discovery session and plugin-manager installation were not run because the review was required to preserve the real user skill directories. Filesystem layouts and both standalone entry paths were exercised instead.
- Approved reference-hardware performance enforcement was not rerun on this macOS review environment; the recorded failure remains unresolved evidence.

The default command sandbox initially failed before launching any process with `sandbox-exec: sandbox_apply: Operation not permitted`. Review commands were subsequently run through the tool's approved escalation path. No rejected command was represented as successful.
