# Portable Task Round-Trip — Design

**Date:** 2026-07-13
**Status:** Approved for implementation
**Quality gate:** QINV-02 and QINV-06 in the
[Exceptional Prax Quality Standard](./2026-07-13-exceptional-prax-quality-standard.md)

## Scope

This journey covers the declared bidirectional `moomora.tasks` version 1 format. Library Markdown
export remains explicitly one-way and is not represented as round-trippable or as a backup.

The source is the deterministic `ci` mature-workspace fixture: 200 tasks, 150 checklist items,
every task status/priority/recurrence form, due/snooze/time states, archives, labels, notes,
Unicode, and long text. The exported all-project task set is imported into one new project in a
fresh Prax instance, matching the documented project-remapping semantics.

## Semantic contract

The verifier compares the multiset of every field accepted by import:

- `title`, `description`, `notes`, `priority`, `status`;
- `dueDate`, `dueTime`, `deferredUntil`, `recurrence`;
- `labels`, `sortOrder`, `archivedAt`; and
- checklist label, completion state, and array order.

Task/checklist ids and creation/update timestamps are runtime identity, are regenerated, and are
not compared. Every imported task must belong to the selected target project, regardless of the
source `projectId`. The report includes a deterministic digest of the canonical portable task set,
record counts, archive/checklist counts, and proof that task and checklist ids were regenerated.

Descriptions and notes are preserved exactly. Title, labels, and checklist labels retain their
documented normalization. Import accepts only version 1 when a version is supplied; an unknown
version fails before mutation instead of being interpreted as v1.

## Atomicity and truthful failure

Production SQLite import writes task rows and their checklist items inside one transaction.
Replace mode deletes the target project in that same transaction. If any checklist insert fails,
the task inserts and replace deletion roll back together; the API cannot report failure after
leaving a partial imported project behind.

Injected/custom repositories retain the existing compatibility fallback, but the shipped database
path is the atomic path exercised by the fixture-backed drill.

## Harness

`npm run verify:portable` creates temporary source/target databases, generates the `ci` fixture,
drives both production Fastify applications through the real export/import HTTP routes, compares
the canonical portable semantics, prints the versioned report, and removes no user data.

The ordinary test suite calls the same exported drill function. Temporary generated databases are
never committed.

## Journey record

```text
Journey ID and title: P0-03 — Portable mature-workspace round-trip
Surfaces: Task JSON format, HTTP export/import, SQLite repositories, checklist persistence
Invariant/category protected: QINV-02, QINV-06; correctness, recovery, machine-contract usability
Fixture/profile and fixed clock: prax.quality-fixture ci; 2026-07-13T12:00:00.000Z; seed 20260713
Preconditions: Current schema; fresh target instance and target project
Happy-path outcome: Every declared portable task/checklist semantic survives with regenerated ids
Delay/failure/interruption variants: Unknown version rejection; checklist-write rollback; semantic
  mismatch makes the verifier fail with the differing record
Accessibility clauses: Not applicable to this machine-facing journey; the existing Settings UI
  invokes the same routes and keeps its confirmation requirement for replace mode
Machine-contract clauses: Version 1 is validated; unknown fields remain ignorable; project ids and
  runtime identity are deliberately regenerated; limits remain explicit
Performance measurements (only after instrumented): Not instrumented; no budget claim
Automated evidence or reproducible drill: npm run verify:portable;
  tests/backend/portableRoundTrip.test.js; tests/backend/tasksRepository.test.js;
  tests/contract/taskFormat.test.js
Last verified revision/date: codex/resolve-review-findings working tree, 2026-07-13
Known gaps: Library Markdown import is not supported and remains documented as one-way
```
