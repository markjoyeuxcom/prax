# PR #118 final verification at 0ade363

Reviewed 2026-09-06 in `/Users/markjoyeux/Developer/Personal/prax`, on `fix/release-candidate-2026-09-06`, HEAD `0ade3638ebce24f5f647061e1f32d4d52aadb811`. GitHub PR #118 reports the same head SHA. The tracked working tree was clean.

**Verdict: approve. V1–V3 are closed; I request no further code changes from this verification pass. I approve merging PR #118 and then pushing `v0.21.0-rc.1`, once the remaining exact-commit CI/desktop checks finish successfully.** Pending checks are reported below; this is code-review approval, not a claim that those pending jobs have passed.

All requested local gates passed: **1,906 unit/contract tests**, **89 focused CLI/installer tests**, and the syntax/bundle consistency check. Independent real-client legacy miss/hit checks, concurrent-discovery checks, and 60-document pagination checks also passed. No remaining P0/P1/P2 finding was identified in the changes under re-verification.

## V1 — legacy coverage survives the real client: verified fixed

`cli/lib/apiClient.js:186–189` now normalizes a legacy HTTP array with both `reason: 'coverage-unknown'` and `legacy: true`. `cli/lib/recall.js:104–116` recognizes that normalized shape and retains the reason. `cli/lib/search.js:15–20` retains it in retrieval metadata; `:36–37` prints the corresponding warning.

The exact previously failing reproduction now exits 0:

```sh
node .local-review-backups/pr118-reverify-evidence/prax-pr118-reverify-legacy.mjs
```

```text
legacy real-client result {"kind":"empty","query":"missing","note":null,"degraded":false,"reason":"coverage-unknown","index":null,"page":null}
human output No relevant memory found for: "missing" (index coverage unknown: this server predates coverage reporting — this may not be a true miss)
```

I also exercised both a miss and a hit through a disposable HTTP server, the production `createClient`, and the actual recall/search functions:

```text
recall missing {"kind":"empty","reason":"coverage-unknown","index":null,"human":"No relevant memory found for: \"missing\" (index coverage unknown: this server predates coverage reporting — this may not be a true miss)"}
search missing {"count":0,"reason":"coverage-unknown","human":"Note: this server does not report semantic index coverage; a complete result cannot be assumed."}
recall hit {"kind":"hit","reason":"coverage-unknown","index":null,"human":"(index coverage unknown: this server predates coverage reporting — results may be missing)"}
search hit {"count":1,"reason":"coverage-unknown","human":"Note: this server does not report semantic index coverage; a complete result cannot be assumed."}
PASS: real client preserves unknown coverage for recall/search misses and hits.
```

This closes the actual normalization failure, rather than testing an injected array that bypasses it. The committed regression at `tests/cli/recall.test.js:211` uses the real client for both miss and hit; `tests/cli/search.test.js:59` covers the equivalent search path. Both passed. The rebuilt skill bundles also passed `npm run check`.

## V2 — durable concurrency regressions: verified committed and passing

The three tests are now present in this commit, confirmed with the diff from `48fedf5` and source inspection:

| Test | Location |
|---|---|
| Concurrent first writes and read share one discovery, never contacting the fallback | `tests/cli/apiClient.test.js:243` |
| A late-finishing read cannot re-pin after a write | `tests/cli/apiClient.test.js:268` |
| Failed discovery is retried by the next request | `tests/cli/apiClient.test.js:290` |

The first case deliberately holds the readiness probe while concurrent requests arrive and asserts exactly one probe. This would reject the old independent-discovery implementation. All three tests passed in both requested suites.

The independent two-server reproduction, adapted in the previous pass to release the held probe independently of an erroneous fallback write, still passes:

```text
{"concurrentWrites":2,"writes":["A","A"],"candidatesWritten":1,"aReadyProbes":1}
PASS: concurrent writes share one probe and both reach A; B sees no write.
```

Command: `node .local-review-backups/pr118-reverify-evidence/prax-pr118-reverify-discovery.mjs`, exit 0.

## V3 — unsupported dependency-review job: verified resolved for this repository

`.github/workflows/ci.yml:97` now requires both a pull-request event and `github.event.repository.private == false`. The independent `npm audit --audit-level=high` job remains at `:83–87`. `SECURITY.md:43–46` describes the effective public/private behavior and retained audit gate.

The exact-commit PR checks now report **Pull request dependency review: skipping** and **Dependency security: pass**. The previous unsupported-repository failure is no longer present. This is a deliberate, documented choice of the dependency gate available on this private repository; the skipped action is not represented as having passed.

## Other repaired behavior checked for regression

The existing 60-document production-SQLite pagination probe still exits 0:

```sh
node .local-review-backups/pr118-reverify-evidence/prax-pr118-reverify-pagination.mjs
```

```text
recall limit 100 {"returned":60,"resultKeys":["kind","note","degraded","reason","index","page","top","related"],"degraded":false,"hasPageMetadata":true}
recall limit 55 {"returned":55,"page":{"offset":50,"limit":5,"returned":55,"total":60,"hasMore":true,"nextOffset":55},"note":"(55 of 60 matches shown — raise --limit for the rest)"}
PASS: 100 returns all 60; 55 returns 55 and discloses remaining matches.
```

The limit-100 assertion verifies `hasMore:false`; the limit-55 case verifies `hasMore:true` and the human disclosure. This confirms the legacy-shape fix did not disrupt current-server paging.

The gh credential-helper implementation, receipt transaction code, init/receipt documentation fixes, and serialized native build/test commands are unchanged by this commit. Their earlier independent evidence remains in `.local-review-backups/codex-pr118-reverification-48fedf5.md`. The installer regressions, including the helper on both Git operations, passed again in the requested suites. This pass did not repeat the real remote installer or every prior receipt probe.

## Hosted check snapshot

The requested `gh pr checks 118` was run against head `0ade3638ebce24f5f647061e1f32d4d52aadb811`. At **2026-09-06T20:04:28Z**, the reported states were:

| Check | State | Link |
|---|---|---|
| Node checks | pass, 1m11s | [job](https://github.com/markjoyeuxcom/prax/actions/runs/34056724363/job/101549864741) |
| Dependency security | pass, 10s | [job](https://github.com/markjoyeuxcom/prax/actions/runs/34056724363/job/101549864883) |
| Pull request dependency review | skipping | [job](https://github.com/markjoyeuxcom/prax/actions/runs/34056724363/job/101549865353) |
| Browser tests | pending | [job](https://github.com/markjoyeuxcom/prax/actions/runs/34056724363/job/101549864870) |
| macOS Apple Silicon | pending | [job](https://github.com/markjoyeuxcom/prax/actions/runs/34056724327/job/101549864772) |
| Linux ARM64 | pending | [job](https://github.com/markjoyeuxcom/prax/actions/runs/34056724327/job/101549864836) |
| Linux x64 | pending | [job](https://github.com/markjoyeuxcom/prax/actions/runs/34056724327/job/101549864891) |

The desktop run's `headSha` also matches the reviewed commit. A job-step query showed **macOS Verify Rust source and tests completed successfully**, while the corresponding Linux steps and all full desktop jobs were still running. The previous macOS Rust failure is therefore not reproduced by that new step on this commit. Full native packaging success is not yet established by this snapshot.

## Implemented

Independent read-only verification and this report. No tracked file, dependency, repository setting, commit, tag, or release state was modified. Evidence files are stored in the ignored directory `.local-review-backups/pr118-final-evidence/`. The extended legacy probe used an owned temporary HTTP server; no unrelated server was stopped, and real `~/.claude` and `~/.agents` were untouched.

## Tested

| Command / exercise | Actual outcome |
|---|---|
| `git rev-parse HEAD` | `0ade3638ebce24f5f647061e1f32d4d52aadb811`. |
| `git status --short` | Empty; tracked tree clean. |
| `gh pr view 118 --json headRefOid,headRefName,url` | Same SHA and branch as the local review. |
| `npm test` | Exit 0; **1,906 passed, 0 failed, 0 skipped**, 4,373.825 ms. |
| `npm run check` | Exit 0; syntax checks pass; `skill bundles are up to date`. |
| `node scripts/run-tests.js tests/cli tests/skills` | Exit 0; **89 passed, 0 failed, 0 skipped**, 1,124.294416 ms. |
| Original real-client legacy-miss reproduction | Exit 0; reason and human output now disclose unknown coverage. |
| Extended real-client legacy HTTP probe | Exit 0; recall and search both preserve the unknown-coverage warning for misses and hits. |
| Independent discovery reproduction | Exit 0; one readiness probe, two writes to the same instance, no fallback write. |
| Independent 60-document pagination reproduction | Exit 0; 60/60 for limit 100; 55/60 plus disclosure for limit 55. |
| `gh pr checks 118` | Returned the pass/skipping/pending states above, with no failing check in that snapshot. |
| `gh run view 34056724327 --json headSha,status,conclusion,jobs …` | Correct SHA; macOS Rust verification step passed; full native jobs still running. |

The ellipsis on the last command is a JSON output selector, not an additional action. The new legacy reproduction is `.local-review-backups/pr118-final-evidence/prax-pr118-final-legacy.mjs`; run it from the repository root. Full local gate and probe output is retained alongside it.

## Unable to test

- The hosted browser and full desktop jobs had not finished at the recorded check snapshot. This report does not count them as passes. Complete those normal gates before merging and tagging.
- No fresh local native build, artifact installation, registry publication, release creation, merge, or tag push was performed in this pass.
- Project-memory recall could not reach a running user's Prax instance on its saved/default addresses. Independent functional probes used disposable fixtures instead.

**Final verdict: approve merging PR #118, followed by pushing `v0.21.0-rc.1`, after the remaining exact-commit checks complete successfully. No further code change is requested by this review.**
