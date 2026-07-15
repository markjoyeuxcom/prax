# Authoritative SQLite Backup and Restore — Design

**Date:** 2026-07-13
**Status:** Approved for implementation
**Quality gate:** QINV-02 and QINV-06 in the
[Exceptional Prax Quality Standard](./2026-07-13-exceptional-prax-quality-standard.md)

## Scope

This journey proves database-level backup and recovery for Prax's authoritative SQLite file. It
does not broaden the task JSON or Library Markdown portability formats into backup formats.

The primary drill uses the deterministic `large` mature-workspace profile. A production Prax
application stays open, commits a marker through the project HTTP API, and keeps WAL state live
while Node's native SQLite online-backup API snapshots the database from a second connection. The
backup is structurally and semantically verified before the disposable source is destroyed. The
drill then restores the backup into the exact former source path, runs normal migrations, verifies
the full fixture manifest, reads the live-write marker, and boots the production application.

A second, smaller scenario creates a `ci` fixture at migration `0009`, backs it up while an SQLite
connection is live, destroys and restores it, applies `0010` and `0011`, and verifies it against the
deterministic upgraded manifest. This proves that an older authoritative backup can cross the
document-table/FTS rebuild without losing related rows.

## Safety contract

- The automated drill creates a unique directory under the system temporary directory (or under
  a caller-supplied test root) and owns every artifact it removes.
- Destruction requires both an explicit owning directory and a database path strictly below it.
  It removes only the exact database, `-wal`, and `-shm` paths.
- The online backup refuses a missing source, identical source/destination, or an existing
  destination. A failed backup removes only its incomplete destination.
- Before destruction, the snapshot must pass `PRAGMA integrity_check`,
  `PRAGMA foreign_key_check`, the complete versioned fixture verifier, and the live-marker check.
- Restore refuses an existing target or sidecar. It validates the source backup, copies to an
  owned staging file, validates that copy, and only then renames it into place.
- A corrupt snapshot cannot trigger source deletion or replace an existing target.

These checks make the command a rehearsal and verifier, not a general-purpose "force restore"
utility. The operator runbook remains responsible for stopping the real app before replacing its
database.

## Runtime and observability

The drill uses `sqlite.backup(sourceDb, path)`, available in the supported Node 24 runtime. Unlike a
raw file copy, SQLite's online-backup API produces a coherent snapshot while WAL-mode writes are
active. The versioned report records the profile, row counts, WAL observation, copied page/byte
counts, integrity/foreign-key results, source-destruction proof, live-marker preservation,
migration versions, and a SHA-256 digest for each backup artifact.

`npm run verify:restore` runs the `large` current-schema scenario and the `ci` historical-upgrade
scenario. Ordinary unit tests run both scenarios with `ci` scale and exercise corrupt-backup and
target-preservation failure paths.

## Journey record

```text
Journey ID and title: P0-04 — Authoritative backup, destruction, and restore
Surfaces: SQLite/WAL storage, Node online backup, migrations, production HTTP/app boot, operations docs
Invariant/category protected: QINV-02, QINV-06; correctness, reliability/recovery, observability
Fixture/profile and fixed clock: current large + historical ci; 2026-07-13T12:00:00.000Z; seed 20260713
Preconditions: Writable temporary directory; supported Node 24 runtime
Happy-path outcome: A validated live snapshot restores every manifest semantic and latest committed write
Delay/failure/interruption variants: Corrupt snapshot rejected before deletion; existing target preserved;
  historical 0009 snapshot migrates across 0010 table/FTS rebuild and 0011 external-ref schema
Accessibility clauses: Not applicable to this machine/operations journey
Machine-contract clauses: Versioned JSON report; exact owned paths; non-zero pages/bytes; explicit migrations
Performance measurements (only after instrumented): Elapsed phases reported; no release budget claimed yet
Automated evidence or reproducible drill: npm run verify:restore;
  tests/backend/backupRestoreDrill.test.js; tests/backend/qualityFixture.test.js
Last verified revision/date: codex/resolve-review-findings working tree, 2026-07-13
Known gaps: The command rehearses local SQLite recovery; volume snapshots and off-host retention remain
  deployment-specific operator responsibilities
```
