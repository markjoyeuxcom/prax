# Project-owned Library and Markdown Import Dialog Design

**Date:** 2026-07-13
**Status:** Implemented

## Decision

A Prax document continues to have exactly one required owning project. Ownership is useful for
project-scoped export, task/runbook context, maintenance, graph workflows, and future access
boundaries. Library remains a cross-project knowledge surface: ownership scopes and explains a
document; it does not hide the document by default.

The current UI violates that model in two ways. It mostly hides document ownership, and loose
Markdown intake infers its destination from navigation history before opening a native file picker.
The destination must instead be selected and visible inside a real import dialog.

## Library ownership visibility

- Every browse card, semantic result, and archive row shows the owning project's name as a project
  chip.
- The Library facet row gains a Project axis. Project filtering is OR within that axis and AND with
  the existing Type and Trust axes.
- The editor header shows the owning project next to tags/trust state.
- Document info includes a Project selector. It offers active/on-hold projects and retains the
  current owner even if that project is completed, so opening the form never presents a false value.
- Reassignment uses the existing document PATCH contract's `project` field and refreshes the
  canonical collection before closing the form.

## Markdown import dialog

The Library action becomes `Import Markdown…` and opens a modal dialog. The dialog owns:

- an explicit destination-project select;
- a multiple-file picker for `.md`, `.markdown`, and `.txt`;
- a retained preview listing filenames and derived titles;
- plain-language scope: each file becomes a source note; Prax export front matter, provenance,
  trust, type, and graph links are not restored;
- pending, validation, partial-success, and retry states;
- Cancel/close controls that are disabled while writes are pending.

The initial destination is a visible convenience default (the last dialog choice when still valid,
otherwise Inbox/first available project). It is never inferred again at submit time: the exact
`markdownImportProjectId` displayed by the dialog is sent.

Selecting files reads them once into state. Re-rendering therefore cannot erase the selection. Each
record receives a client UUID. Document creation treats that UUID as exact-once identity, allowing a
failed/unknown item to be retried from the dialog without duplicating a document whose response was
lost after commit.

On partial failure the dialog remains open with only failed records and an explicit `Retry failed`
action. Destination and file replacement stay locked in this state so the retry intent cannot drift
away from its retained UUIDs. On complete success it closes and reports the committed
destination/count. A collection refresh failure is reported separately from the known committed creates.

## Evidence

- Pure renderer tests for dialog semantics, selected project/files, escaping, pending lock, and
  partial retry state.
- Library renderer tests for ownership chips and project facet/filter behavior.
- Editor tests for visible and editable ownership.
- Route/SQLite tests for caller-ID exact-once document creation and conflicting reuse.
- Production-server browser journey selecting a destination entirely inside Library, importing,
  filtering by project, reassigning in Document info, and retrying an interrupted create once.
- Full unit, syntax, browser, portable, and restore gates remain green.
