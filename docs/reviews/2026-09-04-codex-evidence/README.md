# Codex review evidence

These scripts assert that the reported defects can be reproduced on the reviewed revision. A successful run means it reproduced the defect; after a fix the relevant assertion should fail until converted into a regression test asserting the corrected behavior.

From the repository root:

```sh
node docs/reviews/2026-09-04-codex-evidence/repro.mjs
node docs/reviews/2026-09-04-codex-evidence/extra-repro.mjs
PLAYWRIGHT_BROWSERS_PATH=/private/tmp/prax-codex-review-browsers node docs/reviews/2026-09-04-codex-evidence/browser-repro.mjs
```

The browser script uses the repository's installed Playwright. The temporary browser path existed during review; on a later machine use that installation's browser cache instead. Scripts use in-memory databases and owned temporary fixture/export directories; they do not open the working workspace database. Supplemental ZIP verification uses `unzip`.

`tests.log`, `check.log`, `e2e.log`, `portable.log`, `restore.log`, and `audit.json` are raw verification results. `platform-corrected-e2e.log` comes from a temporary test copy with only the macOS select-all helper corrected. Original repository tests remain unchanged.

Additional retained checks:

```sh
PLAYWRIGHT_BROWSERS_PATH=/private/tmp/prax-codex-review-browsers node docs/reviews/2026-09-04-codex-evidence/followup.mjs
node docs/reviews/2026-09-04-codex-evidence/peer-verification.mjs
```

`followup.log` covers the Health verification and archive lost-response findings. Its task-counter concurrency probe did not reproduce a defect and is not a finding. `peer-verification.log` contains Codex's subsequent checks of Claude's path/child-collection findings and tracked-journal metadata. The journal content and live workspace database are not read by that script.

`retrieval-eval.log` records Codex's successful independent rerun of the seven-case retrieval benchmark reported by Agy. The delivered `followup.mjs` was also rerun from its final path and reproduced the same two defects.
