# Independent review repair plan

User authorized all confirmed repairs on 2026-09-04. Baseline and defect specifications are in `docs/reviews/2026-09-04-consolidated-review.md`; its retracted hypotheses remain integration gaps, not implementation requirements. Work proceeds on `fix/independent-review-2026-09-04`, without commits or releases.

## Design and ownership

- Codex: runtime packaging/path entry, safe journal untracking, stable desktop storage origin, frontend draft and outcome races, durable assistant approval receipts, dependency audit, browser portability and documentation/integration.
- Claude: Library revision/verification and conditional writes, embedding input/model generation, Unicode search, export filename identity, owner-aware child collections. Migration reservation 0023.
- Agy: staged/chunked task import with atomic final commit and replay, calendar queue/notification/date/escaping, completion-based weekly reports and input contracts. Migration reservation 0024.
- Codex reserves 0025 for approval receipts. Each owner reports contract changes before consumers are changed; Codex reviews returned diffs and combines verification.

## Required behavior

Accepted drafts survive a delayed response and subsequent restart; uncertain writes preserve their identities and are reconciled before retry. Verification applies only to content actually shown. Old writes and embedding jobs cannot overwrite a newer revision. Every native export remains importable through bounded uploads, with replace committed once, atomically. Runtime packaging and path conversion work from shipped layouts and encoded paths. The exact child-owned loopback origin remains the native permission boundary.

## Evidence and sequence

1. Back up and validate the current SQLite database, ignore journals and remove only their index entries.
2. Write failing tests for each nontrivial reproduced defect; run them before the fix, then targeted passing tests. Preserve initial review evidence unchanged.
3. Integrate adapters with the finalized backend contracts and add production browser journeys for lost responses, stale edits and pending-input races.
4. Run unit/contract, syntax, browser, portability (including large), restore, retrieval and audit checks. Run native/container checks where tools are available; record execution gaps plainly.
5. Cross-review changes and report resolved findings, remaining evidence gaps and exact test results. No automatic commits, history rewrite, release or external-provider data mutation.

## Completion

All confirmed findings and integration follow-ups are repaired. The final combined tree passed 1,847 unit/contract tests, 112 Chromium journeys, syntax checks, a zero-vulnerability audit, large portability/restore drills and the Mac native runtime smoke. See [the verification report](../../reviews/2026-09-04-repair-verification.md) for the finding map, raw evidence and explicit platform/provider limits. No commits or release were made.
