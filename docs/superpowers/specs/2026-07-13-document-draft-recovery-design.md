# Document Draft Recovery — Design

**Date:** 2026-07-13
**Status:** Approved for implementation
**Quality gate:** QINV-01, QINV-02, QINV-03, and QINV-09 in the
[Exceptional Prax Quality Standard](./2026-07-13-exceptional-prax-quality-standard.md)

## Problem

The document editor currently saves title and body through separate debounce paths. Only the body
participates in the dirty-state and navigation-flush lifecycle, and an unsaved title or body exists
only in page memory. A refresh, shutdown, or failed request can therefore discard accepted input.
After a failure the footer reports `Save failed`, but recovery requires another edit and there is no
explicit retry control.

## Draft transaction

Title and body become one editor draft and one persistence transaction. Every document PATCH from
the primary editor carries the normalized title and exact body captured from the same draft
revision. A single in-flight promise coalesces autosave, keyboard save, retry, double activation,
and navigation flushes.

If the user edits while a request is in flight, the response updates the persisted base but never
replaces the newer live draft. The newer draft remains dirty, its local recovery record is rebased
onto the acknowledged server version, and the normal debounce saves it next.

If a PATCH errors, the client reads the canonical document once before reporting failure. When the
server already contains the exact sent title/body, the client treats the write as acknowledged and
does not invite a duplicate retry. Otherwise it keeps the draft dirty and exposes an explicit
`Retry` action.

## Durable local recovery

Every accepted title/body edit is synchronously mirrored to versioned origin-local storage before
the debounce can run. Records are per document and contain:

- schema version and document id;
- the persisted base title/body from which editing began; and
- the exact local draft title/body.

The record is removed only when the live draft matches the canonical document or when an
acknowledged save matches that stored draft. Conditional removal prevents an older response from
deleting a newer recovery record.

Opening a document resolves its recovery record as follows:

1. If the server already equals the draft, or the draft equals its base, the record is obsolete and
   is cleared.
2. If the server still equals the base, the local title/body is restored as `Recovered draft` and
   waits for an explicit save.
3. If both server and draft changed from the base, the local content is restored as
   `Recovered draft — saved copy changed`. Autosave stays paused and replacing the saved copy
   requires an explicit confirmation.

Malformed or wrong-document records are ignored and removed. If local storage itself is
unavailable, editing and server autosave continue, but status and failure messaging tell the user
to keep the tab open rather than claiming durable recovery.

## User experience and accessibility

The editor footer is the single save-status surface. Its live region announces status changes. A
keyboard-focusable action appears only for failed or restored drafts:

- `Retry` after an observed failure;
- `Save recovered draft` after reload/reopen;
- `Review and save` for a recovered conflict, followed by an in-app confirmation.

Recovery does not remount the active editor during typing or saving. Switching to another document
continues to flush ordinary dirty drafts, but restored/conflicting drafts require the visible
explicit action first so reopening cannot silently overwrite a saved copy.

## Evidence

- Pure tests cover record validation, obsolete/safe/conflicting resolution, and conditional clear.
- Editor-render tests cover the live status and accessible recovery actions.
- The production-path Playwright journey fails the first PATCH, proves the exact title/body survives
  reload and reopen, double-activates retry, and proves only one successful PATCH commits the
  recovered revision.
- Existing delayed edit-and-switch evidence remains green.
- Run `npm test`, `npm run test:e2e`, `npm run check`, and `git diff --check`.

## Journey record

```text
Journey ID and title: P0-02 — Failed-save recovery
Surfaces: Web editor, HTTP document API, SQLite persistence, origin-local recovery storage
Invariant/category protected: QINV-01, QINV-02, QINV-03, QINV-09; correctness and recovery
Fixture/profile and fixed clock: Playwright in-memory production SQLite; deterministic seeded pair
Preconditions: Active source/synthesized documents; editor using its production CodeMirror bundle
Happy-path outcome: One coherent title/body draft reaches one document and reports Saved
Delay/failure/interruption variants: Delayed navigation flush; pre-commit 503; reload/reopen;
  double retry activation; committed write with a lost 503 response
Accessibility clauses: Live status region; keyboard-focusable explicit recovery action; conflict
  replacement uses the in-app alert dialog and never a native webview dialog
Machine-contract clauses: PATCH carries one title/body revision; GET reconciliation distinguishes
  a lost acknowledgement from a failed write
Performance measurements (only after instrumented): Not instrumented; no budget claim
Automated evidence or reproducible drill: tests/e2e/editor-autosave.spec.js;
  tests/frontend/documentDraftRecovery.test.js; tests/frontend/documentDraftSave.test.js;
  tests/frontend/renderEditor.test.js
Last verified revision/date: codex/resolve-review-findings working tree, 2026-07-13
Known gaps: Cross-device draft sync is out of scope; local recovery is deliberately device/origin local
```
