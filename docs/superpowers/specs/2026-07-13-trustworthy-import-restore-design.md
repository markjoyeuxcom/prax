# Trustworthy Import and Restore Design

**Date:** 2026-07-13
**Status:** Implemented

> **Later interaction amendment:** loose-Markdown intake now uses a destination-selecting dialog,
> visible/editable document ownership, and caller-ID exact-once per-file retry. See
> `2026-07-13-project-owned-library-import-dialog-design.md`. The task-import design below is unchanged.

## Problem

Prax has strong production drills for task portability and whole-database restore, but the human
task-import flow does not yet meet the same standard:

- Settings describes the retained project context while the submit handler calls
  `defaultProjectId()`. In Settings that helper falls back to Inbox, so the visible destination and
  the actual destination can disagree.
- Changing import mode re-renders the file input and discards the selected file.
- Rapid activation can submit the same append twice. A response lost after commit leaves the user
  unable to retry safely because the server has no import-operation identity.
- A committed import followed by a failed task refresh is reported as though the import failed.
- The Library action says `Import .md`, next to the portable Markdown export, but it is intentionally
  a plain-file intake: it creates notes in one project and does not restore Prax front matter,
  provenance, types, trust, or document links. Per-file errors are silently discarded.

The whole-database backup/restore runbook remains the authoritative full-fidelity restore. Task JSON
is the portable task/checklist transfer format. Loose Markdown intake is useful, but must not imply a
round-trip guarantee that does not exist.

## Outcomes

1. The selected task-import destination is explicit, visible, stable, and is the value sent.
2. A chosen file survives mode and destination changes because parsed import state lives outside the
   ephemeral file-input DOM.
3. Task import is exact-once when a caller supplies `requestId`. Reusing an ID for different normalized
   intent is a conflict; replaying the same intent returns the original committed result.
4. Import submit is locked while pending. A network failure retains the same request identity for a
   safe retry.
5. Commit and refresh are separate outcomes. A refresh failure says the import committed and asks the
   user to reload; it never says the import failed.
6. Loose Markdown intake makes its partial semantics and selected project explicit, reports both
   successes and failures, and reports refresh failure separately. Its later dialog interaction is
   specified by `2026-07-13-project-owned-library-import-dialog-design.md`.
7. Existing task import clients remain compatible: `requestId` is additive and optional.

## Task import contract

`POST /api/tasks/import` accepts an optional UUID `requestId`.

The server hashes normalized intent:

- resolved destination project ID;
- normalized import mode;
- every cleaned task and checklist record before duplicate filtering.

When `requestId` is absent, the existing behavior is unchanged. When it is present, the production
SQLite repository executes the task/checklist mutation and operation-record insert in one
`BEGIN IMMEDIATE` transaction.

The operation record stores the request hash and the complete original response snapshot. Therefore:

- first commit returns `201` when rows were imported, otherwise `200`, with `replayed: false`;
- an exact replay performs no task mutation and returns `200` with the original counts/tasks and
  `replayed: true`;
- the same UUID with different normalized intent returns `409`;
- a transaction failure leaves neither imported rows nor an operation record.

The record is independent of imported task rows. Later edits, deletes, or replacement imports do not
erase the evidence needed to answer an old retry safely.

## Settings interaction

Entering Settings captures the project context into `adminImportProjectId`; if that project is not a
valid active/on-hold destination, Prax chooses Inbox, then the first available project. The Data card
renders a destination select from the valid projects and uses its state value for copy and submit.

On file selection, the browser reads and validates JSON immediately, then stores the filename and
payload in state. Re-rendering shows the retained filename instead of pretending the native input can
be restored. Changing destination or mode invalidates an uncommitted request identity, because it
changes intent; an unchanged retry retains it.

Submit flow:

1. validate destination, parsed payload, and destructive confirmation;
2. create or reuse a caller UUID for the exact visible intent;
3. set `adminImportPending` before the fetch, disabling controls and repeat activation;
4. on response, treat the mutation as committed and refresh tasks separately;
5. on transport failure, retain the request and show a safe-retry message;
6. on a server rejection, show its useful message and retain the selected file for correction.

## Loose Markdown intake (superseded interaction)

This was the first trustworthy-intake interaction and is retained as implementation history. The
later project-owned import-dialog design supersedes its navigation-derived destination. The picker
accepts `.md`, `.markdown`, and `.txt`; each file becomes a source note in the currently selected
destination with its original filename and an `imported` tag.

This pass deliberately does not parse Prax export front matter or restore the document graph. The UI
and contract say so directly. Per-file failure is an explicit partial result, and collection-refresh
failure cannot overwrite the known committed count.

## Evidence

- Route and SQLite integration tests for first commit, replay, conflicting reuse, and transaction
  rollback.
- Frontend unit tests for request serialization and Settings' explicit/pending/retained state.
- Browser tests through the production server for visible destination correctness, file retention,
  double activation, lost-response retry, and committed-but-refresh-failed messaging.
- Existing portable round-trip and authoritative backup/restore drills remain green.
- Full `npm test`, `npm run check`, and `npm run test:e2e` gates.

## Non-goals

- Loose Markdown is not promoted to a document-graph restore format in this slice.
- Whole database restore does not move into the browser; it remains an operator workflow with its
  destructive safeguards and verification drill.
- Existing import envelopes are not broken or rewritten.
