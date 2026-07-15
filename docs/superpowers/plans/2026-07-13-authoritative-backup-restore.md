# Authoritative Backup and Restore Implementation Plan

**Goal:** Complete Priority-0 journey #4 with a safe, destructive, fixture-backed proof that a
live authoritative SQLite backup restores and that a historical backup migrates without semantic
loss.

**Design:** [Authoritative SQLite Backup and Restore](../specs/2026-07-13-authoritative-backup-restore-design.md)

## Work

- [x] Add safe online-backup, integrity validation, owned destruction, and atomic restore helpers.
- [x] Add the current live-WAL backup/destroy/restore/migrate/app-boot scenario.
- [x] Add the historical `0009` backup/restore/current-migration scenario.
- [x] Add corruption and existing-target preservation regression evidence.
- [x] Add the CLI command, operator documentation, and quality-standard evidence.
- [x] Run all quality gates and attempt the durable Prax-memory write.

Verification: `npm test` (149/149 files), `npm run test:e2e` (16/16 journeys),
`npm run check`, `npm run verify:portable`, `npm run verify:restore` (the full `large` profile),
the operator backup CLI smoke, and `git diff --check` passed on 2026-07-13. The required memory
write was attempted, but Prax was unavailable at `http://127.0.0.1:3000`; rerun it when the local
service is online.
