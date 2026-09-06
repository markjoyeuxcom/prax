# PR #118 re-verification at 48fedf5

Reviewed 2026-09-06 in `/Users/markjoyeux/Developer/Personal/prax`, branch `fix/release-candidate-2026-09-06`, HEAD `48fedf5672f40bd53618904e48f0cb2b22cfa77d`. The tracked working tree was clean before and after verification. References below are to this commit unless otherwise identified.

**Verdict: request changes. I would not yet approve merging PR #118 or pushing `v0.21.0-rc.1`.** The original discovery race, recall pagination, gh-only installer, and two documentation fixes now pass inspection and independent checks. However, the promised legacy-server `coverage-unknown` warning still fails through the actual client; the claimed F1 concurrency regression tests are absent from the commit; and hosted CI for this exact commit is red because Dependency Review is unsupported on the repository.

All requested local gates pass: **1,901 unit/contract tests, 84 focused CLI/installer tests, and the syntax/bundle check**. The new serialized Rust verification step has also **passed on macOS Apple Silicon, Linux ARM64 and Linux x64** in the running hosted desktop workflow. The full native packaging jobs had not completed when checked.

## Remaining findings

### V1 — P1: the legacy coverage warning is bypassed by production client normalization

`cli/lib/apiClient.js:186` transforms a legacy HTTP array into:

```js
{ items: res, page: null, index: null, degraded: false, reason: null }
```

Consequently, `collectSemantic` and `recall` receive an object. The new `Array.isArray(res)` condition at `cli/lib/recall.js:105` is false, so the `coverage-unknown` branch at `:111` is never reached for a real client talking to a legacy server.

I reproduced this with the real `createClient` and `recall`, against a disposable HTTP server returning `[]` as the legacy semantic response:

```text
legacy real-client result {"kind":"empty","query":"missing","note":null,"degraded":false,"reason":null,"index":null,"page":null}
human output No relevant memory found for: "missing"
AssertionError: old-server array must retain unknown coverage through createClient
+ actual - expected
+ null
- 'coverage-unknown'
legacy production-client probe actual exit: 1
```

This contradicts the newly added promise at `docs/cli.md:169–170`: old servers are labelled as unknown and never assumed complete. It leaves the earlier compatibility caveat unresolved; it does not invalidate the now-working current-server pagination and incomplete-index fixes.

The new test at `tests/cli/recall.test.js:194–201` injects a fake client whose `semanticSearch` returns an array directly. It bypasses the normalization responsible for the failure. Conversely, `tests/cli/apiClient.test.js:236–238` still explicitly expects the normalized legacy response to have `reason:null`.

**Required:** preserve unknown coverage when the HTTP array is normalized, carry that signal through recall, and test the real client-to-recall composition for both a hit and a miss. Rebuild the bundles. The reproduction is retained at `.local-review-backups/pr118-reverify-evidence/prax-pr118-reverify-legacy.mjs` and can be run from the repo root. This is a truthful-retrieval/contract gap under Gate A; the response cannot establish that an unqualified miss is complete.

### V2 — P2: the stated concurrency regression tests were not committed

The implementation passes my independent concurrency probes, but the three tests named in the delegation—concurrent first writes, late read cannot re-pin, failed discovery retried—are not present in `tests/cli/apiClient.test.js` at this HEAD.

Evidence:

```text
git show HEAD:tests/cli/apiClient.test.js | wc -l
239
```

The file's binding cases at `tests/cli/apiClient.test.js:172–219` are sequential; its final test at `:222–239` covers semantic response normalization. A search for `concurrent|late read|failed discovery|shared` under `tests/cli` found only the unrelated shared-git-config detection case in `detectProject.test.js`.

The diff from `1a6fe35` changes existing discovery expectations to account for `/readyz`; it adds no concurrent F1 case. Gate A specifically requires narrow durable regression evidence for practical-to-automate fixes (`docs/superpowers/specs/2026-07-13-exceptional-prax-quality-standard.md:35–36`). **Commit those tests before considering F1 fully closed under the repository's policy.** This is an evidence gap, not another demonstrated routing failure. My scratch checks below show the implementation behaving correctly.

### V3 — P1 operational gate: exact-commit CI is red

[CI run 34056046006](https://github.com/markjoyeuxcom/prax/actions/runs/34056046006) is completed with conclusion `failure` for this exact SHA. Actual job results:

```json
[
  {"name":"Browser tests","status":"completed","conclusion":"success"},
  {"name":"Pull request dependency review","status":"completed","conclusion":"failure"},
  {"name":"Node checks","status":"completed","conclusion":"success"},
  {"name":"Dependency security","status":"completed","conclusion":"success"}
]
```

The failed job log says:

```text
Dependency review is not supported on this repository. Please ensure that Dependency graph is enabled along with GitHub Advanced Security
```

The job is configured at `.github/workflows/ci.yml:89–105`. This is repository capability/configuration evidence, not a detected vulnerable package or a failure of the local tests. It was not introduced by the latest runtime fixes. Resolve the unsupported job with an available, agreed dependency-review configuration and obtain a successful CI result before treating all merge gates as green. I did not change repository settings or workflow policy.

## F1 verification — discovery race repaired

`cli/lib/apiClient.js:80,107–115` holds one shared discovery promise. Every request awaits it at `:130`; `probe` assigns the base only while unpinned (`:94–98`); requests capture that selected base and no longer reassign it (`:133–142`). A rejected discovery clears the promise so later requests can try again.

I reran the exact original `.local-review-backups/pr118-evidence/prax-pr118-discovery-probe.mjs` under a three-second process timeout. It timed out (`ETIMEDOUT`, owned child terminated with SIGTERM). That is expected for this old defect fixture: it releases A's first held probe only when B receives a write; the repaired client never sends that write, so the fixture has no path to release A. This alone is not a passing result.

I then used a scratch copy of the same two-server setup, with an independent 150 ms release for A and assertions for the repaired result:

```text
discovery exit 0
{"concurrentWrites":2,"writes":["A","A"],"candidatesWritten":1,"aReadyProbes":1}
PASS: concurrent writes share one probe and both reach A; B sees no write.
```

Additional independent checks passed:

```text
late read after write: {"base":"http://a","calls":["http://a/readyz","http://a/api/library/documents/slow","http://a/api/library/documents/upsert-by-title"]}
shared failed discovery, then retry: {"firstResults":["rejected","rejected"],"calls":["http://a/readyz","http://b/readyz","http://a/readyz","http://a/api/library/documents/3"],"base":"http://a"}
PASS: late read stays pinned and failed shared discovery can be retried.
```

The read-then-write legacy remember fallback also still passes through normal discovery:

```text
legacy read-then-write fallback: created mutations=["/api/library/documents"]
demo remember: 503 upsert by title is unavailable
```

The demo's 503 is the previously documented limitation, not a new regression. Only the exact demo child I started was stopped; no unrelated server was killed.

## F2 verification — requested paging and bound disclosure repaired

`collectSemantic` at `cli/lib/recall.js:39–56` follows `nextOffset` until the requested bound or the end of the result set. `createClient.semanticSearch` now sends offset (`cli/lib/apiClient.js:179–185`). Recall retains page metadata (`cli/lib/recall.js:113–114`) and prints `boundNote` (`:29–33,150–151`).

Rerunning the original pagination reproducer failed its **old-bug assertion** with actual 60 versus expected 50, exit 1. A scratch copy using the same real `buildApp`, fresh SQLite database, 60 current matching vectors, and updated success assertions passed:

```text
pagination exit 0
raw semantic metadata {"page":{"offset":0,"limit":50,"returned":50,"total":60,"hasMore":true,"nextOffset":50},"index":{"total":60,"embedded":60,"pending":0},"degraded":false}
recall limit 100 {"returned":60,"resultKeys":["kind","note","degraded","reason","index","page","top","related"],"degraded":false,"hasPageMetadata":true}
recall limit 55 {"returned":55,"page":{"offset":50,"limit":5,"returned":55,"total":60,"hasMore":true,"nextOffset":55},"note":"(55 of 60 matches shown — raise --limit for the rest)"}
PASS: 100 returns all 60; 55 returns 55 and discloses remaining matches.
```

The limit-100 assertion also checked `page.hasMore === false`; the limit-55 assertion checked it is true and that the human output contains the bound note. The committed pagination test at `tests/cli/recall.test.js:166–192` covers both counts. The legacy `coverage-unknown` addition remains V1 above.

## F3 verification — gh-only fresh-machine installation repaired

`run_git` applies the selected credential helper to both clone and sparse checkout (`skills/install.sh:71–96`). I repeated the previous failing scenario against the pushed branch installer, from a temporary working directory, with:

```text
GIT_CONFIG_GLOBAL=/dev/null
GIT_CONFIG_SYSTEM=/dev/null
GIT_CONFIG_NOSYSTEM=1
GIT_TERMINAL_PROMPT=0
PRAX_SKILLS_REF=fix/release-candidate-2026-09-06
PRAX_SKILLS_DIR=<temporary>/codex
PRAX_CLAUDE_SKILLS_DIR=<temporary>/claude
PRAX_SKILLS_REPO unset
```

Actual output:

```text
gh auth status exit: 0
installer exit: 0
Prax skills installed from https://github.com/markjoyeuxcom/prax.git@fix/release-candidate-2026-09-06 over https (gh credentials).
prax-recall: Codex copy=true, Claude symlink=true, bundle matches reviewed HEAD=true
prax-remember: Codex copy=true, Claude symlink=true, bundle matches reviewed HEAD=true
uninstall exit: 0
removed prax-recall
removed prax-remember
```

This ran the unmodified installer, with no global credential setup or patched positive-control script. Both downloaded bundles matched the reviewed working tree byte-for-byte. Real `~/.claude` and `~/.agents` were untouched. The new regression at `tests/skills/installScript.test.js:127–174` verifies that both Git commands carry the helper; it passes in the requested suites.

## F4/F5 verification — documentation repaired

- **F4:** `docs/cli.md:88–93` now includes the existing project-marker fallback after git-remote matching and before folder name. This matches `cli/prax.js:90–107` and `cli/lib/detectProject.js:8–23`. The code change here is a comment correction; the underlying precedence was already exercised in the previous review.
- **F5:** `docs/contract.md:402–407` and `docs/agent-memory.md:54–57` now say the receipt is checked before title lookup and inserted after the mutation within the same transaction. That matches the unchanged implementation at `server/libraryRepository.js:737–748,767–776,795–798`.

## macOS CI diagnosis and workflow repair

**I agree that the proposed cache race is technically well supported, and the serialization is an appropriate targeted workaround.** I verified the reported failing symptom and inspected the actual dependency sources. I did not deterministically reproduce the compiler interleaving, so this is a source-backed diagnosis rather than proof of the precise historical scheduling.

The lockfile resolves `tauri-codegen` to `2.6.3` (`src-tauri/Cargo.lock:3451–3452`) and `tauri-utils` to `2.9.3` (`:3653–3654`). I read the matching installed files under:

```text
/Users/markjoyeux/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/
```

Evidence chain:

1. `tauri-codegen-2.6.3/src/image.rs:74–97` decodes the PNG to RGBA and calls `Cached::try_from(rgba)`.
2. `tauri-codegen-2.6.3/src/lib.rs:135–141` derives a content-checksum filename under `OUT_DIR` and calls `write_if_changed`.
3. `tauri-utils-2.9.3/src/lib.rs:388–399` first reads and compares the existing file, then uses `std::fs::write` when missing/different. It has no lock, exclusive creation, or atomic temp-file rename. Two cold-cache invocations can both pass the check; one can truncate/write while the other compiler expands the subsequent include.
4. `tauri-codegen-2.6.3/src/image.rs:106–114` emits `include_bytes!` pointing at that cache file, then `Image::new` with separately retained width/height. An empty/transient read can therefore yield empty bytes even though the dimensions came from the original PNG.
5. Prax's macOS tray constant uses `include_image!` at `src-tauri/src/lib.rs:632–633`. The test divides by `pixels.len()` at `:931`; zero RGBA pixels produces exactly the observed panic.

The [cited failed macOS job](https://github.com/markjoyeuxcom/prax/actions/runs/34054816477/job/101544706774) is confirmed as completed/failure. Its downloaded log contains:

```text
thread 'tests::tray_template_has_transparent_negative_space_and_monochrome_ink' (16003) panicked at src/lib.rs:931:13:
attempt to divide by zero
test result: FAILED. 6 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out
Process completed with exit code 101.
```

Both workflows now run `cargo build` followed by `cargo test --lib`, sequentially (`.github/workflows/desktop.yml:88–91`, `.github/workflows/release.yml:224–227`). Building first populates the content-identical cache; restricting the test command to the library avoids simultaneously rebuilding the normal library for a separate binary test target. `src-tauri/src/main.rs` has no tests, so this does not discard an existing binary test suite in the current tree. This does not change upstream cache atomicity or make concurrent separate Cargo processes universally safe.

There is fresh hosted evidence for the workaround: [Desktop builds run 34056045950](https://github.com/markjoyeuxcom/prax/actions/runs/34056045950), at this exact HEAD, reports the **Verify Rust source and tests** step completed/success on all three targets:

```text
macOS Apple Silicon: Rust step completed/success; overall job in_progress
Linux ARM64: Rust step completed/success; overall job in_progress
Linux x64: Rust step completed/success; overall job in_progress
```

Thus the new Rust verification step has passed, including the previously failing macOS case. Full packaging completion was not yet established at the observation point.

## Implemented

Review and verification only. No tracked files, dependency files, repository settings, commits, tags or release state were changed. Created this report and ignored evidence in `.local-review-backups/pr118-reverify-evidence/`. Updated-expectation reproduction scripts are scratch copies; the original reproductions remain intact. Temporary servers/databases and installer destinations were isolated, and only owned processes were stopped.

## Tested

| Command / exercise | Actual outcome |
|---|---|
| `git rev-parse HEAD` | `48fedf5672f40bd53618904e48f0cb2b22cfa77d`. |
| `git status --porcelain=v1` | Empty before and after verification. |
| `npm test` | Exit 0; **1,901 passed, 0 failed, 0 skipped**, 4,540.992791 ms. |
| `npm run check` | Exit 0; syntax checks pass; `skill bundles are up to date`. |
| `node scripts/run-tests.js tests/skills tests/cli` | Exit 0; **84 passed, 0 failed, 0 skipped**, 1,976.312583 ms. |
| Original discovery reproducer, bounded to 3 seconds | Timed out because its held probe is released only by the now-prevented wrong-server write; the exact owned child was terminated. |
| Updated discovery scratch probe using independent timed release | Exit 0; one readiness probe, both writes to A, none to B. |
| Additional late-read and failed-discovery-retry probes | Exit 0; pin remains immutable; failed shared discovery resets and later retry succeeds. |
| Original pagination reproducer | Exit 1 on stale assertion `60 !== 50`: new implementation returns all 60. |
| Updated pagination scratch probe | Exit 0; limit 100 → 60/60, hasMore false; limit 55 → 55/60, hasMore true and printed bound note. |
| Real-client legacy coverage probe | **Exit 1**; `reason:null`, unqualified no-match instead of promised `coverage-unknown`. V1. |
| gh-only branch installer with isolated Git configuration and both destination overrides | Exit 0; both tools' files/links present; downloaded bundles equal reviewed HEAD. |
| Uninstall using the same temporary destination overrides | Exit 0; both copies/links removed. |
| Legacy fallback/demo probe | Exit 0; legacy 404 fallback creates successfully; demo returns previously known 503. |
| `gh api repos/markjoyeuxcom/prax/actions/jobs/101544706774 …` and `gh run view 34054816477 --job 101544706774 --log-failed …` | Retrieved original macOS failure; divide-by-zero at the cited line, 6 pass/1 fail. |
| `gh run list --repo markjoyeuxcom/prax --commit 48fedf5672f40bd53618904e48f0cb2b22cfa77d …` | Exact-commit CI failed; desktop workflow still running. |
| `gh run view 34056046006 …` | Browser tests, Node checks and Dependency security pass; Pull request dependency review fails as unsupported. |
| `gh run view 34056045950 --json jobs …` | New serialized Rust verification step completed successfully for macOS and both Linux targets; full jobs still running. |

The ellipses on the read-only `gh` commands represent output selectors/log redirection, not additional mutations. Captured logs and the four new reproduction scripts are preserved under the evidence directory above. Run reproduction scripts from the repository root.

## Unable to test

- I did not reproduce the exact compiler scheduling race deterministically; agreement with the diagnosis is based on the matching dependency source, the verified historical failure, and the new successful hosted Rust steps.
- Full native packaging jobs were still running when checked. No artifact download/install, release publication, tag push or registry publication was performed.
- The browser suite was not rerun locally in this pass; the exact-commit hosted Browser tests job passed. The three requested local gates were run directly.
- Project-memory recall could not reach a running user's Prax instance on its saved/default addresses. All functional probes used disposable fixtures instead.

**Final decision:** request changes at `48fedf5`. Fix V1, commit the missing F1 regression tests (V2), resolve the unsupported hosted CI gate (V3), and confirm completion of the desktop workflow before approval to merge PR #118 and then push `v0.21.0-rc.1`.
