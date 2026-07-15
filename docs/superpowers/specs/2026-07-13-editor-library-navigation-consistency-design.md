# Editor and Library Navigation Consistency — Design

**Date:** 2026-07-13
**Status:** Implemented and verified
**Quality gate:** QINV-01 and QINV-09 in the
[Exceptional Prax Quality Standard](./2026-07-13-exceptional-prax-quality-standard.md)

## Problem

Document-to-document navigation waits for a dirty title/body draft to save, but top-level sidebar,
back-button, and command-palette navigation can replace the editor immediately. A debounce may save
later, and local recovery may protect the draft, but neither is an exceptional navigation contract:
the destination can appear before persistence settles, and a failed save is discovered after the
person has already left its context.

The library collection loader also installs every response unconditionally. A slow Active request
can resolve after a newer Archive request and replace the archive rows with active documents while
the toggle still says Archive.

## Navigation contract

Every action that leaves the editor for another top-level view uses one preparation boundary:

1. wait for an in-flight save;
2. save the newest dirty title/body revision;
3. navigate only after the exact revision is acknowledged; and
4. if persistence remains failed or a recovered/conflicting draft needs explicit review, stay in
   the editor and show the existing actionable recovery state.

This applies to sidebar/rail navigation, the editor back button, project and filter destinations,
settings/health destinations, and equivalent command-palette commands. Document-to-document
navigation continues to use the same underlying flush. Closing overlays or changing editor-local
mode does not leave the document and does not force a save.

An archive action saves the current draft before changing the document lifecycle. It must not
archive the stored old revision while leaving a newer local draft behind.

## Collection freshness contract

Each library document load and semantic query receives a monotonically increasing generation. Only
the newest generation may install its response. Superseded responses return without mutating state.
The query/view shape is captured when the request begins, so neither Active/Archive rows nor
meaning-search results can drift from the controls that describe them. A submitted meaning search
has an announced loading state; editing its query immediately invalidates the old result set.

This is a client cache rule; the production API contract and repository queries do not change.

Focused native controls retain their standard keyboard activation. Global one-key navigation may
only consume unmodified keys from non-interactive page context; it cannot steal Enter from a
focused button or link.

## Evidence

Production-path Playwright cases will prove:

- global project navigation waits behind a delayed title/body PATCH and the destination appears
  only after the exact draft commits;
- a failed navigation save keeps the editor and its recovery action visible; and
- a delayed Active response cannot overwrite a newer Archive response or its rows; and
- an archived document remains directly openable with the keyboard after the race settles.
- a slow first semantic query cannot overwrite the visible results from a newer query.

Unit coverage continues to own draft comparison/recovery internals. The browser cases own event
delegation, real routes, concurrent requests, rendered destination, and accessible recovery output.

**Verified:** 2026-07-13 on `codex/resolve-review-findings`; `npm test` (150/150 files),
`npm run test:e2e` (21/21 journeys), `npm run check`, `npm run verify:portable`, and
`npm run verify:restore` passed.
