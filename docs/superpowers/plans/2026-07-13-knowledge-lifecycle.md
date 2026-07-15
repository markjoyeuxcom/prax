# Coherent knowledge lifecycle implementation plan

**Spec:** [2026-07-13-knowledge-lifecycle-design.md](../specs/2026-07-13-knowledge-lifecycle-design.md)
**Status:** Complete

## 1. Atomic lifecycle persistence

- [x] Add the database migration that derives target status from live supersession links.
- [x] Remove route-level secondary status writes.
- [x] Prove generic linking, multi-replacement archive/restore/unlink, and cascade deletion.
- [x] Update historical/current fixture and restore expectations for the new migration.

## 2. Truthful mutation outcomes

- [x] Add pure observable-intent matching for verify, supersede, archive, restore, and delete.
- [x] Reconcile rejected responses through canonical document readback.
- [x] Apply successful documents locally before refreshing collections.
- [x] Distinguish confirmed failure, committed-but-refresh-failed, and unknown outcome copy.

## 3. Human recovery and provenance

- [x] Keep Verify/Unverify and archive/restore reversible through the truthful outcome path.
- [x] Add exact supersession Undo through the typed unlink endpoint.
- [x] Preserve explicit confirmation for permanent deletion.
- [x] Prove reviewed human revision preserves verification and agent revision revokes it.

## 4. Production-path evidence

- [x] Automate the complete knowledge lifecycle and default-retrieval agreement.
- [x] Prove a lost mutation response is reconciled without duplicate application.
- [x] Prove unreadable outcomes block same-page retry until reload.
- [x] Prove a failed collection refresh cannot turn committed lifecycle state into reported failure.

## 5. Gates and adoption record

- [x] Run focused route, SQLite, frontend, MCP, and browser tests.
- [x] Run `npm test`, `npm run check`, `npm run test:e2e`, and `npm run eval`.
- [x] Run portability/restore drills and `git diff --check`.
- [x] Update the exceptional-quality evidence. Durable memory remains an explicit follow-up because
      the local Prax service was unavailable.

## Verification

- `npm test`: 156/156 test files.
- `npm run check`: passed.
- `npm run test:e2e`: 39/39 browser journeys.
- Focused lifecycle browser suite: 5/5.
- `npm run eval`: 7/7 cases, 100% recall.
- `npm run verify:portable`: passed.
- `npm run verify:restore`: passed at schema `0012` for current live-WAL and historical drills.
- `git diff --check`: clean.
- `npm run eval:nl`: not runnable because no chat backend is configured; no NL behavior changed in
  this lifecycle slice.
