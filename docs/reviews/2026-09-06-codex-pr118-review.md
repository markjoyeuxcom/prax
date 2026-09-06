# Independent review of Prax PR #118

Reviewed 2026-09-06 in `/Users/markjoyeux/Developer/Personal/prax`, branch `fix/release-candidate-2026-09-06`, HEAD `1a6fe35632c57f99745ba50c7c41a8097e4783ed`, against main `fe09b935bba155fca92a44d1d7315bd70c4e5480`. Line references below refer to the reviewed branch unless explicitly marked main.

**Verdict: request changes. I would not approve merging PR #118 as complete, and would not approve pushing `v0.21.0-rc.1` yet.** All requested automated gates pass. R1 and R4 are repaired, and the ordinary sequential R2 and incomplete-index R3 cases are repaired. However, I independently reproduced three remaining P1 defects: concurrent discovery can write to two instances, recall introduces undisclosed truncation above 50 results, and the documented gh-only installation fails during sparse checkout. There are also two small P2 documentation inaccuracies.

Gate A explicitly blocks known invariant violations and requires new machine-facing truncation to be disclosed in both response and contract (`docs/superpowers/specs/2026-07-13-exceptional-prax-quality-standard.md:27–38`). QINV-10 explicitly applies to CLI commands (`:165–169`). No P0 finding.

## 1. Do the repairs close R1–R4?

### R1 — repaired in the exercised create and UPDATE cases

Receipt lookup, intent validation, document lookup/mutation, and receipt insertion all execute through the same transaction client: `server/libraryRepository.js:732–786`, invoked after `begin immediate` at `:793–805`. In particular, receipt lookup at `:737–748` precedes title lookup; receipt insertion follows the update at `:767–768` or create at `:773–776`, within that same transaction. The `db.connect`-absent branch at `:792` is for alternate injected repositories; the production SQLite path uses the transaction.

I used `buildApp`, production routes and a new SQLite `:memory:` database. Operation A created a document; operation B updated that existing title. A subsequent PATCH wrote a newer body. Both operation IDs were then replayed and retried with changed intent, before and after permanent deletion:

```text
create replay {"http":200,"replayed":true,"body":"newer intervening content"}
create replay changed intent 409
update replay {"http":200,"replayed":true,"body":"newer intervening content"}
update replay changed intent 409
create deleted {"http":410,"message":"this remember already completed and its document was permanently deleted; use a new id to write it again"}
update deleted {"http":410,"message":"this remember already completed and its document was permanently deleted; use a new id to write it again"}
cross-project ID collision {"http":409,"receipts":0}
receipt-failure rollback {"http":500,"body":"before"}
All focused route assertions passed.
```

The cross-project case used an existing document ID from another project with a new title in the target project: no receipt was manufactured for that foreign document. The legacy-ID conflict branch checks `documentMatchesCreateFields` before inserting a receipt (`server/libraryRepository.js:779–785`); the title match is explicitly scoped by project (`:751–755`). This is evidence for the tested collision, not a claim that projects form authorization boundaries in this single-user app.

For transaction failure, I installed a temporary SQLite trigger that aborted receipt insertion on a selected UPDATE operation. The endpoint returned 500 and the body stayed `before`, proving mutation and receipt commit/rollback together. The 410 route returns a generic message only, with no document/body (`server/libraryRoutes.js:629–633`); the tested response leaked no deleted content. Receipts deliberately survive document deletion (`server/migrations/0027_document_upsert_receipts.sql:7–12`). Replay also bypasses embed-on-write (`server/libraryRoutes.js:635–643`).

Reproduction: from the repo root, `node .local-review-backups/pr118-evidence/prax-pr118-route-probes.mjs`. Source and captured output are retained beside this report.

### F1 — P1: R2 is still vulnerable to concurrent discovery

Sequential behavior is repaired: writes probe before choosing a candidate, pinning prevents serial failover, and retries target that same instance (`cli/lib/apiClient.js:85–125`). The new tests at `tests/cli/apiClient.test.js:172–219` exercise these sequential cases and passed.

**The pin is not concurrency-safe.** Each initial write can separately enter `pin()` at `cli/lib/apiClient.js:112`. There is no shared discovery promise or guard against replacing a pin established by another in-flight request. Each probe writes the shared `base` and `pinned` at `:89–91`. Initial reads also retain their own candidate list and unconditionally reassign the pin at `:115–123`.

Reproduced with the real `createClient` and two disposable HTTP servers, using two concurrent `upsertMemory` calls with the same operation ID:

1. Server A holds the first `/readyz` response.
2. A closes the second probe's connection; that call discovers B and POSTs to B.
3. B's POST releases A's held probe; the first call overwrites the pin and POSTs to A.

```text
{"concurrentWrites":2,"writes":["B","A"],"candidatesWritten":2,"aReadyProbes":2}
REPRODUCED: one createClient sends the same write ID to TWO candidate servers during concurrent discovery.
```

This reproduces routing, not mutations of two user databases. Independent instances would not share the operation receipt. The stock CLI's common path is sequential, which limits everyday exposure, but the claimed one-instance client guarantee is false under concurrent use and stale probe completion. `docs/agent-memory.md:121–126` explicitly promises that one process cannot straddle workspaces.

**Required before approval:** serialize discovery and make the selected instance immutable for all concurrent requests. Ensure in-flight reads cannot re-pin after another operation binds the client. Add a deterministic interleaving test for concurrent first writes and a concurrent-read/write case; rebuild the skills.

Reproduction: `node .local-review-backups/pr118-evidence/prax-pr118-discovery-probe.mjs`.

### R3 — incomplete-index disclosure repaired; new truncation remains

The client now requests `page=true` and normalizes the coverage-bearing response (`cli/lib/apiClient.js:165–178`). `searchLibrary` retains `index`, `degraded`, `reason`, and `page` (`cli/lib/search.js:15–21`) and emits a human-readable warning (`:36–42`). Recall retains index coverage and warns for both hits and misses (`cli/lib/recall.js:28–35,68–73,94–113`).

With five active documents, one deliberately lacking a current vector in a disposable real database:

```text
search coverage {"mode":"semantic","degraded":true,"reason":"index-incomplete","index":{"total":5,"embedded":4,"pending":1},"page":{"offset":0,"limit":50,"returned":0,"total":0,"hasMore":false,"nextOffset":null}}
recall coverage No relevant memory found for: "needle" (index incomplete: 1 of 5 documents have no current embedding — this may not be a true miss)
```

### F2 — P1: recall silently caps a requested limit at 50 and removes the disclosure

`cli/lib/apiClient.js:169` clamps each page to 50. `cli/lib/recall.js:68–84` copies the index fields but drops `res.page` and never fetches another page. The CLI accepts a larger `--limit` (`cli/prax.js:155–165`); the skill parser also accepts every positive integer (`cli/lib/skillArgs.js:39–42`). The new recall guide offers `--limit <n>` without documenting a 50-result cap (`docs/cli.md:145–170`).

I seeded 60 active documents in a fresh production SQLite database, with current deterministic vectors that all match the query, then requested limit 100:

```text
raw semantic metadata {"page":{"offset":0,"limit":50,"returned":50,"total":60,"hasMore":true,"nextOffset":50},"index":{"total":60,"embedded":60,"pending":0},"degraded":false}
recall limit 100 {"returned":50,"resultKeys":["kind","note","degraded","reason","index","top","related"],"degraded":false,"hasPageMetadata":false}
REPRODUCED: recall accepts limit 100 but returns 50 of 60 matches, discarding hasMore/total metadata.
```

The intentionally short rendered top-hit/Related block is documented and is not the finding. This is an additional hidden transport cap in the structured result, below the caller's requested bound; the previous unpaged route could return all 60. `prax search` does retain and disclose its bound, so this finding is specific to recall.

**Required before approval:** fetch pages up to the requested recall bound, or explicitly validate/document the maximum and retain truncation metadata in JSON and an appropriate human warning. Add an actual >50-match recall test and rebuild the bundle. This is the new machine-facing truncation prohibited by Gate A/QINV-10.

Reproduction: `node .local-review-backups/pr118-evidence/prax-pr118-pagination-probe.mjs`.

### R4 — repaired

Recent recall requests `status:active`, defensively filters retired records, and adds trust labels (`cli/lib/recall.js:38–50`). In the route probe, I created two documents and superseded the first through the normal endpoint. Actual result:

```text
recent lifecycle {"retiredIncluded":false,"allItemsHaveTrust":true}
```

### Legacy fallback and demo

A disposable legacy HTTP fixture returned 404 for upsert. With normal discovery and project lookup, `remember` then completed the old read-then-write create path on the same selected instance:

```text
legacy read-then-write fallback: created mutations=["/api/library/documents"]
demo remember: 503 upsert by title is unavailable
```

Pinning does not break that exercised legacy fallback (`cli/lib/remember.js:23–35`). The real demo starts and answers reads, but its repository lacks upsert and the route returns 503 (`server/libraryRoutes.js:616–618`), while fallback is deliberately 404-only. This is **pre-existing**, verified against `git show main:server/libraryRoutes.js` and the unchanged demo; it is not a PR regression. P2 follow-up: support equivalent in-memory upsert/receipts in the demo or explicitly document that the demo cannot exercise `remember`. Do not indiscriminately fall back on production 503 errors.

Only the exact demo child process started by my probe was terminated. No other server was stopped.

## 2. Release plumbing and changelog

**The requested release repairs pass the local checks. No additional release-plumbing blocker found by this review.** This is source/runtime-script evidence, not proof of a completed hosted release.

| Check | Evidence / result |
|---|---|
| Source version | `package.json:3` and `src-tauri/Cargo.toml:3` are `0.21.0`; `src-tauri/tauri.conf.json:4` uses `../package.json`. |
| Centralized sites | `scripts/release-sites.mjs:44–77` lists 13 files, including lockfiles, plugin, images/overlays and docs; `:80–96` reports drift. The verifier calls it at `scripts/verify-desktop-release.mjs:71`. |
| RC tag acceptance | `scripts/verify-desktop-release.mjs:46–49` accepts the matching prerelease tag. `node scripts/verify-desktop-release.mjs --tag v0.21.0-rc.1` exited 0: `[desktop-release] verified Prax v0.21.0 for aarch64-apple-darwin`. |
| Registry identity | `.github/workflows/release.yml:20` uses `markjoyeuxcom/prax`; `scripts/release-sites.mjs:8` agrees on `ghcr.io/markjoyeuxcom/prax`. |
| Added gates | Audit at `release.yml:84–85`; Chromium installation at `:87–88`; browser suite at `:90–91`. Container publication depends on quality and desktop jobs (`:103`); final release depends on all of them (`:263`). |
| Publish checkout / notes | Publish checks out the release ref at `:266–269`, installs Node at `:271–274`, generates notes with direct `node` at `:276–277`, and uses `body_path: release-notes.md` at `:313`. The notes script imports only built-ins and local release helpers, so no missing npm-install step is needed in this job. |
| Requested notes command | `npm run release:notes -- --tag v0.21.0-rc.1` exited 0. It identifies the candidate and its RC container tag, and includes the cut `0.21.0` section. The workflow's direct Node invocation avoids the npm console preamble. |
| Requested future dry run | `node scripts/prepare-release.mjs 0.22.0 --dry-run` exited **1**: `[release] CHANGELOG.md [Unreleased] has no entries; nothing to release`. This is the intentional guard at `scripts/prepare-release.mjs:79`, not a successful dry run and not a defect. |
| Positive preparation fixture | Copied the 13 site files and changelog to a temporary directory, added one fixture-only Unreleased entry, then called `prepareRelease({base,version:'0.22.0',dryRun:true})`: `14 files; source unchanged: true`. A real cut in that temporary copy then passed `assertReleaseSitesAgree('0.22.0')`. No tracked file was changed. |

The `[0.21.0] - 2026-09-06` section is well formed (`CHANGELOG.md:15`), with one each of `Added`, `Changed`, `Removed`, and `Fixed`. `[Unreleased]` is empty at `:13`; the prior `[0.20.0]` section begins at `:876`.

I compared top-level bullet entry blocks from `git show main:CHANGELOG.md`'s Unreleased section with the new section, ignoring subsection placement but preserving entry text and multiplicity:

```text
oldEntries: 114
newEntries: 122
missing: []
added: 8
headings: ["### Added","### Changed","### Removed","### Fixed"]
```

All 114 pre-cut entries were preserved exactly once relative to their prior multiplicity; the eight additions describe this repair work. No old entry was lost or newly duplicated by the merge. The new compare links are correct (`CHANGELOG.md:1404–1405`):

```text
[Unreleased]: https://github.com/markjoyeuxcom/prax/compare/v0.21.0...HEAD
[0.21.0]: https://github.com/markjoyeuxcom/prax/compare/v0.20.0...v0.21.0
```

Historical comparison links remain as before. The new links intentionally refer to the eventual stable version tag; the RC tag is used for the candidate release/artifact identity.

## 3. Skill installer and POSIX shell behavior

**The local-path install, updates, uninstall and Claude/Codex layout pass. The advertised fresh-machine gh-only path still fails.**

`node scripts/run-tests.js tests/skills` exited 0: **3 passed, 0 failed, 0 skipped**. It verifies byte-identical standalone bundles in the Codex destination, Claude symlinks, standalone usage handling, reinstall/uninstall, old-Node refusal, and an inaccessible repository. `tests/skills/installScript.test.js:48–54` always supplies a local `PRAX_SKILLS_REPO`, so it does not exercise the gh credential branch or a promisor remote's lazy blob fetch.

### F3 — P1: credentials are scoped to clone, not the subsequent authenticated fetch

The exact invocation at `skills/install.sh:74–75` is correct:

```sh
git -c credential.helper= -c 'credential.helper=!gh auth git-credential' clone ...
```

The empty helper resets inherited helpers, and the quoted shell helper works: the authenticated clone succeeded in my test. The problem is the separate command at `skills/install.sh:86`:

```sh
git -C "$TMP/prax" sparse-checkout set --no-cone skills
```

The clone is blobless. Expanding its sparse checkout fetches missing skills blobs from the private promisor remote. The clone's `-c` settings do not persist into that later invocation.

I ran the unmodified branch installer from a temporary directory with both skill destinations overridden, normal working `gh` credentials, no explicit repository override, and Git config disabled to model gh login without previously configured Git credentials:

```text
gh auth status exit: 0
GIT_CONFIG_GLOBAL=/dev/null
GIT_CONFIG_SYSTEM=/dev/null
GIT_CONFIG_NOSYSTEM=1
GIT_TERMINAL_PROMPT=0
PRAX_SKILLS_REF=fix/release-candidate-2026-09-06
PRAX_SKILLS_DIR=<temporary>/codex
PRAX_CLAUDE_SKILLS_DIR=<temporary>/claude

installer exit: 128
fatal: could not read Username for 'https://github.com': terminal prompts disabled
fatal: could not fetch b6892467cc4eff09fea8e64c4e5574510795669f from promisor remote
```

This failed twice identically. As a positive control, I made a **temporary copy only** of the installer and added the same two `-c` options to the sparse-checkout invocation. That control succeeded against the real private HTTPS remote, even under `/bin/dash`:

```text
scratch helper-on-both-commands control under dash: exit 0
Codex copy present: true; Claude link resolves: true
unmodified installer under dash, local repo: exit 0
dash uninstall: exit 0
```

**Required before approval:** apply the selected credential configuration to every Git operation that can fetch missing blobs, including sparse checkout, and add a regression test that covers the gh transport across both operations. The current failure also skips the installer's tailored clone-error explanation, because it happens after clone.

`/bin/sh -n skills/install.sh` passed. The unmodified local-path install and uninstall both worked under `/bin/dash`; I found no demonstrated POSIX-shell syntax issue. The gh failure occurs under normal `/bin/sh` and is a credential lifetime problem, not quoting or shell syntax. No actual `~/.claude` or `~/.agents` files were changed.

The docs now clearly explain private-repository access, transport choice, Node prerequisite, both destinations, update and no-checkout uninstall (`skills/README.md:21–62`). That is a substantial improvement, but `:35–40` and `docs/agent-memory.md:111–114` still promise a gh-only install that fails as above.

## 4. Documentation spot-check: D01–D27

This was a focused check of the original findings and changed statements, not a new exhaustive audit of every example in the repository.

| Original IDs | Status and branch evidence |
|---|---|
| D01 | Resolved: README distinguishes shipped memory functionality from remaining work (`README.md:329–338`). |
| D02 | Resolved: canonical repository links in `README.md:66,355` and vulnerability-report URL in `SECURITY.md:16`. |
| D03 | Resolved: portable task export versus SQLite backup distinction (`README.md:251–253`, `docs/contract.md:3–7,48–52`). |
| D04 | Resolved: unverify listed; project-scoped commands distinguished from cross-project recall and memory writes (`AGENTS.md:72–81`). |
| D05 | Resolved: git-remote match appears in detection order (`docs/cli.md:27–38`, `cli/prax.js:35–57`). |
| D06 | Original environment precedence bug fixed; new marker claim is wrong. See F4 below. |
| D07 | Sequential implementation now matches; absolute pinning promise remains false under concurrency. See F1. |
| D08 | Resolved: search-all widens lifecycle status, not archives (`docs/cli.md:128–139`, `docs/contract.md:453–456`). |
| D09 | Resolved: comma-separated tags and last-flag behavior documented (`docs/cli.md` remember section; actual parsing `cli/prax.js:187`). |
| D10 | Resolved: recall section and remember-memory examples added (`docs/cli.md:145–170,180–204`, `README.md:224–226`). |
| D11 | Resolved: obsolete planned-links example removed (`docs/contract.md:9–12`). |
| D12 | Resolved as scope/compatibility documentation: independently installed skills and 404 fallback are described (`docs/contract.md:20–29`). See compatibility caveat below. |
| D13 | Resolved: export example drops requestId and explains import-only use (`docs/contract.md:38–52`). |
| D14 | Behavioral promise repaired by R1; receipt sequencing wording needs F5 below (`docs/contract.md:402–407`). |
| D15 | Resolved as an explicitly documented compact-MCP-summary exception (`docs/contract.md:420–422,448–450`). No claim that the summary now contains those fields. |
| D16 | Resolved: recall has no status/all override; use search-all for retired status (`docs/contract.md:451–455`, `docs/cli.md:161–163`). |
| D17 | Resolved in code and docs; R4 reproduced (`docs/agent-memory.md:97–101`). |
| D18 | Resolved: full provider set and persisted operator settings described (`docs/contract.md:513–535`). |
| D19 | Resolved: bind refusal occurs before listen but after DB open/migration (`docs/deployment.md:36–49`). |
| D20 | Resolved: image bind/acknowledgement and host publication boundary described (`docs/deployment.md:47–55`). |
| D21 | Resolved: 35-tool count (`docs/ROADMAP.md:50`). |
| D22 | Resolved: saved loopback port described (`docs/ROADMAP.md:113–117`, `docs/google-calendar.md:75–78`, `docs/quality-scorecards.md:169–170`). |
| D23 | Original inaccurate perpetual-Testing claim replaced with the token-expiry qualification and source link (`docs/google-calendar.md:24–34`). No live OAuth lifecycle test was performed. |
| D24 | Resolved: current revision versus historical body hash (`docs/quality-fixture.md:53–56`). |
| D25 | Resolved: scorecard now agrees with operator-settings trust model (`docs/quality-scorecards.md:194–201`). |
| D26 | Not fully resolved: initial HTTPS helper works, later sparse fetch fails without separately configured Git credentials. See F3. |
| D27 | Resolved: fetch-and-pipe uninstall works without a checkout (`skills/README.md:45–51`); both destination overrides are now documented and testable. |

### F4 — P2: init still consults the existing marker

`docs/cli.md:88–92` says init goes from git match to folder name and “does not consult an existing `.prax/project.json`.” But `cli/prax.js:107` calls `detectProject({})`, whose marker scan is at `cli/lib/detectProject.js:8–23`.

Actual temporary-directory output:

```text
init existing marker, exit 0 Wrote .prax/project.json (project: old-marker).
{"project":"old-marker"}
init env override, exit 0 Wrote .prax/project.json (project: explicit-environment-project).
```

The original `PRAX_PROJECT` defect is fixed. Correct the newly added documentation/comment to include the marker fallback, or deliberately change and test the intended precedence.

### F5 — P2: docs misstate when the receipt is inserted

`docs/agent-memory.md:54–55` and `docs/contract.md:402–404` say a receipt is stored before the title is mutated. The implementation **checks** an existing receipt first, then stores a new receipt **after** mutation, atomically in the same transaction (`server/libraryRepository.js:737–748,767–776,795–798`). The implementation is sound in the exercised rollback test; describe that actual sequence.

One compatibility qualification remains worth making explicit: `docs/cli.md:168–169` says a plain no-match is an honest miss, while `docs/contract.md:25–27` permits old unpaged servers with no coverage information. `cli/lib/apiClient.js:171` normalizes that old array with `index:null, degraded:false`, and `coverageNote` prints nothing for it. Thus the plain-miss guarantee is only justified when coverage is actually known; older-server coverage is unknown, not proven complete. This compatibility limitation predates the repaired current-server path.

## 5. Gates and release decision

All requested automated gates pass, but the additional probes identify behavior outside their coverage. I would require **F1, F2 and F3** fixed with regression evidence, and correct F4/F5 while doing so, before approving this repair PR and the candidate tag. I am not proposing a larger product feature expansion as an RC prerequisite.

The existing demo limitation is a P2 follow-up, not a newly introduced release blocker. Native/platform and hosted-publication checks below remain unverified in this review.

## Implemented

Independent review only. No tracked source, config, dependency, or Git changes; no commit, merge, tag, or release operation. Created this report and ignored review evidence under `.local-review-backups/pr118-evidence/`. The scratch installer positive control and release-cut fixture were in temporary directories only. The working tree remained clean at the reviewed HEAD after testing.

## Tested

| Command / exercise | Actual outcome |
|---|---|
| `git rev-parse HEAD` | `1a6fe35632c57f99745ba50c7c41a8097e4783ed`. |
| `git status --porcelain=v1` | Empty output before and after tests. |
| `node -p 'process.version'` | `v24.19.0` (installed runtime, not a claim about latest upstream). |
| `npm test` | Exit 0; **1,897 passed, 0 failed, 0 skipped**, 3,806.12975 ms. Includes release-helper, API-client, receipt, recall and installer regressions. |
| `npm run check` | Exit 0; syntax checks passed; `skill bundles are up to date`. |
| `PLAYWRIGHT_BROWSERS_PATH=/private/tmp/prax-rc-browsers PRAX_E2E_PORT=32819 npm run test:e2e` | Exit 0; **113 passed (1.5m)**. |
| `node scripts/run-tests.js tests/skills` | Exit 0; **3 passed, 0 failed, 0 skipped**, 625.888625 ms. |
| `npm audit --audit-level=high` | Exit 0; `found 0 vulnerabilities`. |
| `npm run release:notes -- --tag v0.21.0-rc.1` | Exit 0; correct candidate/container/changelog content. |
| `node scripts/verify-desktop-release.mjs --tag v0.21.0-rc.1` | Exit 0; source metadata/resources/site agreement verified for aarch64-apple-darwin. |
| `node scripts/prepare-release.mjs 0.22.0 --dry-run` | Exit **1**, expected empty-Unreleased guard; no files changed. |
| Copied release fixture: `prepareRelease` dry run, then real temporary cut | 14 proposed files; dry run unchanged; resulting 13 site versions agree on 0.22.0. |
| Changelog entry-multiset comparison with `git show main:CHANGELOG.md` | 114 old entries preserved; eight added; no lost/duplicated old entries. |
| `node …/prax-pr118-route-probes.mjs` | Exit 0; all focused real SQLite/route assertions passed for R1, index disclosure, recent lifecycle, foreign-ID rejection and receipt rollback. |
| `node …/prax-pr118-discovery-probe.mjs` | Exit 0 means the assertion reproduced **F1**: writes to both A and B. |
| `node …/prax-pr118-pagination-probe.mjs` | Exit 0 means the assertion reproduced **F2**: 50/60 matches and no pagination metadata despite limit 100. |
| `node …/prax-pr118-compat-probes.mjs` | Exit 0; legacy 404 fallback creates; owned demo returns the pre-existing 503. |
| Unmodified `/bin/sh skills/install.sh` with gh-only credentials and isolated Git config/destinations | **Exit 128 twice**, sparse promisor fetch cannot authenticate: F3. |
| Scratch-only installer with helper also applied to sparse checkout, run by `/bin/dash` | Exit 0; both Codex copies and Claude symlink targets exist. |
| Unmodified `/bin/dash skills/install.sh` with local repository and temporary destinations | Exit 0; installs both skills. |
| `/bin/dash skills/install.sh --uninstall` with those temporary destinations | Exit 0; removes both copies/links. |
| `/bin/sh -n skills/install.sh` | Exit 0. |
| `prax init` in a temporary directory, with existing marker and then explicit PRAX_PROJECT | Both exit 0; marker preserved first, environment override honored second. |

Full gate/probe logs and the four independent reproduction scripts are in `.local-review-backups/pr118-evidence/`. Commands above using `…` refer to that directory; run from the repository root.

## Unable to test

- No GitHub Actions release was dispatched and no registry/package publication was attempted. Workflow token permissions, hosted runner behavior, final uploaded assets and GitHub Release creation therefore remain unverified.
- No fresh native build/install/update or multi-platform packaged-runtime smoke was performed in this pass. The desktop verifier command checks source release readiness; it does not establish that new native packages have been built and exercised.
- No live Claude Code/Codex plugin-manager installation was performed. Filesystem placement, symlinks, standalone script usage and isolated installer paths were exercised; actual GUI/agent skill discovery was not.
- The recall-first attempt could not reach a user's running Prax instance (saved desktop port or default port). All behavioral reproductions instead used owned, disposable fixtures; no user library data was accessed or changed.
