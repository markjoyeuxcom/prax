# Release-candidate review — 2026-09-06

> **Repair status:** every blocker, P1 and P2 item below was repaired on branch
> `fix/release-candidate-2026-09-06` the same day; see
> [`docs/superpowers/plans/2026-09-06-release-candidate-repairs.md`](../superpowers/plans/2026-09-06-release-candidate-repairs.md)
> and the `[0.21.0]` changelog section. The `v0.21.0-rc.1` tag push (step 4 of the suggested
> order) was deliberately left to the user.

**Baseline:** `main` at `fe09b93` (178 commits after the last tag `v0.20.0`, released 2026-06-11).
**Reviewers:** Claude (this consolidated report) and Codex (independent, delegated through Parley;
its full report is [2026-09-06-codex-rc-review.md](2026-09-06-codex-rc-review.md)). Where a finding
below was reproduced by both, it says so. Apple Developer ID signing and notarization are out of
scope by the user's instruction and are not assessed. No code was changed by either reviewer.

## Verdict

Not yet a release candidate, but close. Every automated gate is green locally and in CI, and the
2026-09-04 repairs hold. What blocks an RC tag is one reproduced data-loss defect in the memory
path, release plumbing that has not been updated since the repository moved owners, an uncut
version and changelog, and three cheaper honesty defects in the skills and CLI. Documentation is
mostly current but carries the old GitHub owner and a list of stale statements.

## Evidence gathered

Both reviewers ran the full local gate set independently and got identical results.

| Check | Result |
|---|---|
| `npm test` | 1,873 passed, 0 failed, 0 skipped |
| `npm run check` | passed; committed skill bundles are current |
| `npm audit --audit-level=high` | 0 vulnerabilities |
| `npx playwright test` | 113 passed (after `npx playwright install chromium`; the local cache had build 1228, Playwright 1.62.1 needs 1234) |
| `npm run verify:portable` | passed: 200 tasks / 150 checklist items, ids regenerated, project remapped |
| `npm run verify:restore` | passed: restored integrity check `ok`, historical migration drill, production boot |
| `npm run eval` | 7/7 retrieval cases, recall 100% |
| `node scripts/verify-desktop-release.mjs --tag v0.20.0` | passed for the current source (Codex); a mismatched tag is rejected as designed |
| CI on `main` for this exact commit (run 34038893921) | Node checks, browser tests, security: success |
| Desktop builds on the last PR (run 34038076838) | macOS Apple Silicon, Linux x64, Linux ARM64: success |
| `skills/install.sh` from a local repo path and from the real private SSH remote, isolated destinations | install, reinstall, uninstall all succeeded (both reviewers) |
| Installed bundles run from outside the checkout against a disposable server | remember, update-in-place, `--recent` all worked; bundles byte-identical to source (Codex) |
| Documented `gh api … install.sh` fetch | succeeded; the old-owner path also redirects |
| Meaning-based `recall` | **not verifiable on this machine**: the `fake` backend is non-semantic by design and no embedding service is available |
| Prax memory recall at session start | unavailable: the app was not running |

## Release blockers

### 1. A remember retry can overwrite newer accepted memory (data loss, QINV-03)

`server/libraryRepository.js:710-727` looks up the active title and updates its body before it
ever looks at the caller-supplied `id`; the replay and conflict checks at lines 730-738 run only when
no active title matches. The CLI retries this endpoint automatically (`cli/lib/apiClient.js:151-154`)
and `docs/contract.md:389-395` promises that a replay returns the existing document and that reusing
an id for different content is a 409.

Reproduced over HTTP by both reviewers. Four calls to `upsert-by-title` with the same title:

```text
1) id A, body "A: original"                 -> 201 created
2) id B, body "B: newer accepted memory"    -> 200 updated
3) replay of call 1, unchanged              -> 200, body is back to "A: original"
4) id A, body "Changed intent…"             -> 200 accepted (contract says 409)
```

A delayed transport retry of an old remember silently reverts a newer memory. Fix: validate the
operation id and its intent before any title mutation, including updates to an existing title;
a replayed completed operation must return the current document without reapplying its old body.
Add the interleaved A/B/A and changed-intent cases to `tests/backend/libraryUpsertByTitle.test.js`,
which today only covers a consecutive identical retry.

### 2. The release workflow publishes the container to the wrong owner

The repository was transferred from the user account `awaybreaktoday` to the organisation
`markjoyeuxcom` (`gh api repos/awaybreaktoday/prax` now redirects). The last release predates the
transfer. `.github/workflows/release.yml:20` still sets `IMAGE_NAME: awaybreaktoday/prax`, and the
registry login uses `secrets.GITHUB_TOKEN`, which is scoped to the repository's own owner. Neither
reviewer could push to confirm the denial (no Docker locally, and a package listing needs a scope the
credential lacks), so this is a permission-model conclusion, not a reproduced failure. Either way the
namespace must be decided before tagging: fix it or prove a grant exists. `publish` depends on
`container`, so a denial means no GitHub release and no desktop assets.

Fix: `IMAGE_NAME: markjoyeuxcom/prax`, then the same owner in `compose.image.yaml:3`,
`README.md:120`, `docs/deployment.md:120-121`, `deploy/base/deployment.yaml:34` (also still pinned to
`v0.15.0`), and the three `deploy/overlays/*/kustomization.yaml` files. `README.md:65,340` and
`SECURITY.md:16` also name the old owner.

### 3. The version and changelog have not been cut

`package.json`, `src-tauri/Cargo.toml`, `Cargo.lock`, `package-lock.json` and
`.claude-plugin/plugin.json` all say `0.20.0`, the tag that already shipped. `CHANGELOG.md` has an
833-line `[Unreleased]` section with duplicated headings (`### Added` twice, `### Changed` twice,
`### Fixed` four times). It contains a `### Removed` entry (the Plain editor), so the next version
should be `0.21.0`. A manual dispatch of the existing tag would rebuild the June commit, not this one.

A release prep touches at least ten sites: the five version files above, `compose.image.yaml`,
`README.md:120`, the three overlay `newTag` values, `docs/deployment.md:71`, `docs/ROADMAP.md:7`, and
`CHANGELOG.md`. `scripts/verify-desktop-release.mjs` checks only package, Cargo and Tauri against the
tag.

### 4. The release path has never run end to end on a tag, and its gate is narrower than CI

`v0.20.0` has zero release assets and its workflow run took 1m29s; the desktop and publish jobs were
added or rewritten in eight later commits to `release.yml`. Separately, the release `quality` job runs
`npm run check` and `npm test` only (`release.yml:54-80`); browser tests and the dependency audit run
in `ci.yml` and the release workflow neither depends on that workflow nor checks its result for the
tagged SHA (Codex). Fix: add `npm run test:e2e` and `npm audit --audit-level=high` to the release
quality job, then push a prerelease tag such as `v0.21.0-rc.1`. The workflow already recognises the
suffix, marks the GitHub release as a prerelease and skips the `latest` container tag; that is the RC
mechanism this project already has.

## P1 — fix before the RC tag; each is small

### 5. Recall hides an incomplete index (QINV-08, QINV-10)

`cli/lib/recall.js:32-44` and `cli/lib/search.js` call the unpaged semantic-search route, which returns
a bare array and so cannot carry the `index` / `degraded: true` / `reason: "index-incomplete"` fields the
paged response has (`server/libraryRoutes.js:439`). When vectors are pending (after a model change, a
fresh document, or the legacy documents the September repairs deliberately left pending), recall
prints `No relevant memory found`, which `SKILL.md` tells the agent to treat as an honest miss, and
`prax search --json` reports `degraded: false`. Reproduced by Codex with one active document and no
current embedding. Fix: request `page=true`, page to completion or disclose the bound, and print
`(index incomplete: N of M documents pending)` on both the hit and the empty paths; add a
`tests/cli/recall.test.js` case with the object shape; rebuild the bundles.

### 6. A write can silently land in a different Prax instance (QINV-02)

`cli/lib/apiClient.js:74-90` retries every request, including agent writes, against the next
candidate base URL whenever the current one rejects the connection, and the `Remembered` line never
names the base. Codex reproduced it with two loopback servers: the first recorded the POST and dropped
its response, the second then accepted the same POST. In production the candidate pair is the desktop
app's saved port and `127.0.0.1:3000`. Fix: discover with a read, bind to that instance, never fail
over a write, and print the base URL in the write confirmation.

### 7. `recall --recent` returns retired memories without saying so (QINV-05, QINV-08)

`cli/lib/recall.js:17-26` calls `listDocuments` without a status filter and drops the lifecycle
fields, so superseded and deprecated documents appear as if current. `docs/agent-memory.md:88-89`
says recall is active-only. Reproduced by Codex after a normal supersede. Fix: pass `status: 'active'`
by default and label status in any explicit history mode.

### 8. The installer's default transport does not match the documented credential

`skills/README.md:19-25` says `gh auth login` once is enough, then `skills/install.sh:15` clones over
SSH. A machine with only `gh` HTTPS credentials and no SSH key fails at the clone. The README's
no-checkout uninstall snippet (`sh install.sh --uninstall`) also cannot run, because the documented
pipeline never saves the installer. Fix: default to `https://github.com/markjoyeuxcom/prax.git` when
`gh auth status` succeeds (after `gh auth setup-git`), or state that an SSH key is required and show
the `PRAX_SKILLS_REPO=https://…` override; give a real no-checkout uninstall command; check the Node
major (the script only checks that `node` exists).

### 9. Release notes do not say the installers are unsigned

`docs/desktop/BUILD.md` ("Unsigned distribution") requires release notes to state that installers are
unsigned and not notarized. The body in `release.yml` says signing "depends on the release
credentials configured", which is not that statement. One sentence in the workflow body closes it.

## P2 — documentation that is stale or wrong

Both reviewers checked every `npm run` name and relative link in the current guides; all resolve. The
stale statements are content, not links. Codex's report carries the full list of 27 with line
numbers; the ones that matter most:

- `README.md:317-319` lists four future items; three are shipped (trust loop in UI and MCP, retrieval
  eval harness, external references and repo-URL detection). Only "Ask Project" RAG remains.
- `README.md` never mentions the memory skills or `skills/README.md`; a desktop user cannot find the
  standalone pack from the main entry point.
- `docs/deployment.md:36-46` says the image bakes in neither a network bind nor the acknowledgement;
  `deploy/Dockerfile:17-18` sets `HOST=0.0.0.0` and `PRAX_ALLOW_UNAUTHENTICATED_NETWORK=true`. The same
  passage says the bind check happens before the database opens; it runs after migrations.
- `docs/cli.md` omits the `recall` command, `--memory`, the global `--url` / `--agent` flags, the
  comma-separated `--tag` form, and the git-remote rung of project detection; it says `search --all`
  includes archived documents (it includes retired statuses only) and that the first answering app is
  pinned (see item 6). `prax init` ignores `PRAX_PROJECT` despite the documented order (Codex).
- `docs/contract.md`: links and provenance described as "planned" at lines 7-8 though implemented
  later in the file; the export example includes a `requestId` the export does not emit; the
  embedding-backend passage omits `llamacpp`, `gemini` and `voyage` and says configuration is env-only;
  the claim that all search paths carry `kind` and trust fields is contradicted by the MCP
  `search_documents` summary shape.
- `docs/quality-scorecards.md:193-195` still lists UI-settable provider config as a release blocker;
  `SECURITY.md` and `AGENTS.md` now permit it within the operator boundary.
- `docs/ROADMAP.md:113-114` and `docs/google-calendar.md:69-71` say the desktop port changes per
  launch; it is persisted since the September repairs. `docs/google-calendar.md:25-26` overstates how
  long a Testing-mode OAuth app keeps refresh tokens for Calendar scope.
- `AGENTS.md:38` lists `--type` values without `note`; `AGENTS.md:72` omits `unverify`.
- `mcp/README.md:17` says Node 20+; `engines` is `>=24`.
- `mise.toml` (`rust = "stable"`) is untracked; `BUILD.md` requires Rust stable and this machine pins
  tools with mise, so commit it. `ROOM-prax.md` is untracked and should be git-ignored, not committed.

## Are there clear instructions for installing the skills without a checkout?

Yes, with the gaps in item 8. `skills/README.md` gives a one-line installer, environment overrides,
a verification command, an uninstall flag, and alternative routes for Claude Code (plugin marketplace)
and Codex (skill-installer). `docs/agent-memory.md` and `AGENTS.md` point to it. Both reviewers ran
the unmodified installer from a local path and from the real private remote into isolated
destinations; Codex additionally ran the installed bundles from outside the checkout and confirmed
remember, update and recent against a disposable server. Not exercised: the plugin-manager and
skill-installer routes, and a fresh Claude Code or Codex session discovering the installed skills.
Worth adding to the README: that the repository is private so access must be granted, that a custom
`PRAX_SKILLS_DIR` still creates the Claude links, and a remember plus recall verification example.

## Missing functionality, prioritised

- **Blocker: safe remember replay** (item 1). This is the one product defect that loses data.
- **Blocker: release preparation.** `npm run release:prepare -- 0.21.0` that bumps every site in
  item 3, renames `[Unreleased]` with the date, merges duplicate headings and opens a fresh
  `[Unreleased]`; extend `verify-desktop-release.mjs` to check `plugin.json`, `compose.image.yaml` and
  the overlay tags against the tag so drift fails the gate instead of shipping.
- **Blocker: release gate parity** (item 4): browser tests and audit in the release quality job.
- **P1: instance-bound writes** (item 6), **degradation disclosure** (item 5), **active-only recent
  recall** (item 7), **HTTPS installer path and Node check** (item 8).
- **P2: trust signals in compact results.** Recall output and MCP keyword references drop
  verified / status / kind, so the "unverified is a lead" guidance needs a second fetch to act on.
- **P2: release notes from the changelog.** Extract the version's `CHANGELOG.md` section into the
  GitHub release body instead of the fixed template plus generated commit notes.
- **P2: image on merge to `main`** (already on the roadmap) once the namespace is fixed.
- **P2: desktop calendar subscription.** The ICS URL is still hidden on desktop
  (`public/js/main.js:3707`) even though the stated reason, a per-launch port, no longer holds.
- **P2: install-script coverage.** No test exercises `skills/install.sh`; a temp-directory
  install / reinstall / uninstall test would protect the one path new users take.

Neither reviewer recommends new AI features or an authentication layer as RC prerequisites.

## Gate A status

One reproduced invariant violation is open (item 1, QINV-03) and three contract-honesty violations
(items 5, 6, 7 under QINV-02, QINV-05, QINV-08, QINV-10). Under the quality standard a discovered
violation blocks release until fixed or explicitly revised. Everything the 2026-09-04 review closed
remains closed in this evidence.

## Suggested order

1. Fix item 1 with its regression tests. Fix items 5, 6 and 7 in `cli/lib`, rebuild the bundles.
2. Fix the owner in `release.yml` and the deploy and doc references (item 2); add browser tests and
   audit to the release quality job (item 4); add the unsigned statement (item 9).
3. Add the release-prep script, cut `0.21.0` and the changelog, commit `mise.toml`, ignore
   `ROOM-prax.md`.
4. Push `v0.21.0-rc.1`, confirm image, three desktop packages and `SHA256SUMS` land on the
   prerelease, install one package over the existing app and run the deliberate-update drill from
   `BUILD.md`.
5. Documentation pass from the P2 list and item 8, then tag `v0.21.0`.
