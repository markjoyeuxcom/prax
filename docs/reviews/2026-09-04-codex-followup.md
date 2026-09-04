# Codex supplemental checks

These checks were completed after freezing the initial report, while waiting for peer reviews, and before reading their findings. Same baseline and isolated-data rules apply.

## C21 — P1: Health “Verify” blesses new content never shown to the reviewer

`public/js/main.js:755–760` fetches the latest document when the Health row's Verify button is pressed, then immediately submits its current hash. `public/js/renderHealth.js:11–18,123–127` displays only title/type/trust, not the content being blessed. A loaded Health list can therefore outlive an agent edit; clicking Verify approves the unseen new body rather than conflicting against what the person saw. A production-browser reproduction changed the body after loading Health, clicked Verify, and observed `verified:true` while that body never appeared in the page. Open a review surface for the exact revision and guard the final verification against that reviewed revision. QINV-04. This is distinct from C08's title omission: it also bypasses body revision safety.

## C22 — P2: Task archival reports failure after a successful commit

`public/js/main.js:1234–1247` groups `archiveTask`, subsequent refresh, and UI outcome in one try/catch without canonical readback. The reproduction let DELETE commit, then dropped its response: SQLite contained an archived task, but the toast said `Prax could not archive the selected task.` The undo affordance was also absent. A collection-refresh failure has the same catch path; bulk task operations have similar partial-outcome exposure. Reconcile the archive against canonical state and distinguish an unknown outcome or failed refresh from a failed mutation. QINV-02.

Evidence: [followup.mjs](2026-09-04-codex-evidence/followup.mjs), [followup.log](2026-09-04-codex-evidence/followup.log). The script also records a task-counter concurrency hypothesis that did **not** reproduce under the attempted schedule; that hypothesis is excluded from findings.
