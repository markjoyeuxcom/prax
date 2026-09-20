# Workspace export resolution — v0.37.0 candidate

The export audit's lifecycle and metadata gaps are corrected. Library export now offers readable
Markdown v3, with optional Archive, or a full workspace backup ZIP for authoritative recovery.
This candidate also includes the reviewed default Inbox, processing workflow and Library Back fix.

## Changes reviewed

- One shared Markdown serializer preserves document IDs, lifecycle/archive status, verification,
  specific agent attribution, filenames, code/external references, linked tasks and dependency
  snapshot hashes. Archived targets retain link identity. Retired guidance is explicitly labeled.
  The existing seven types, body, project/tag data and collision-safe ZIP filenames remain supported.
- The workspace route snapshots SQLite behind the transaction gate, validates integrity and
  foreign keys, and packages the database with a SHA-256 manifest, four starters and restore guide.
  It covers every committed table, including operation receipts and all archived records. One
  backup runs at a time; failures and disconnects release its temporary files and slot.
- The offline restore command checks the expected digest, rejects corrupt files and unexpected
  WAL/SHM companions, refuses existing targets/sidecars, and restores with owner-only permissions.
  Desktop and container packaging include the command. Prepared-payload checks require the restore
  guide, backup route and both database commands.
- The UI uses the existing native Save, browser Save or download destination. Full backups force
  all-workspace scope and disclose saved credentials plus exclusions. Markdown intake explicitly
  remains plain-note intake, not an exact metadata or operational restore.

## Validation

- `npm test`: 2,224 passed with no failures or skips; `npm run check` and desktop v0.37.0 version
  agreement passed. Source diff has no whitespace errors.
- `tests/backend/workspaceBackup.test.js` uses production SQLite and actual ZIP bytes. It checks
  Markdown metadata, archived inclusion and link evidence; checksum/restore; every table's rows;
  restored app readiness; retained Inbox replay and undo; snapshot ordering behind an open
  transaction; malformed/checksum/occupied-target/sidecar rejection; overlapping and failed
  backups; and cleanup after disconnect during the snapshot.
- The original 14-document audit now asserts all seven types and preserved metadata/status. It
  still proves plain Markdown re-import is note intake. No personal library was used for tests.
- Initial full browser run: 148 passed, four failed. The failures exposed test assumptions:
  a fake answer backend left by an earlier spec, folded tags in the larger shared fixture, and a
  download check awaiting a page request event. Fixtures now control/restore the model backend,
  use tag search when folded, and inspect the actual download event and ZIP bytes.
- Final full Chromium run: **152 passed in 2.3 minutes**, reviewed Parley run
  `a622ecb5-3016-4eb1-8338-8d43d11624c1`, captured exit 0, no cancellation or truncation.
  Both export formats pass automatic WCAG A/AA checks in light/dark at 1440px and 360px;
  actual downloads, Save-picker cancellation, Inbox replay/undo and Library return pass.
- GitLab publication evidence is recorded with the release and Prax task
  `d033a1c8-7fd8-455d-b44a-96d20f3d935b`. Publication requires all five CI jobs, both native
  packaged-runtime checks, the complete browser suite and verified package checksums.

## Boundaries

Committed SQLite state is covered; unsaved drafts, browser-only preferences/pending decisions,
external files and environment configuration are separate. Saved Inbox receipts survive recovery;
selection of the last Undo action is tab state. Markdown preserves evidence but does not recreate
trust automatically on import. Backups contain saved provider credentials and need private storage.
The existing native save bridge buffers ZIP bytes in the webview; very large databases should use
`npm run backup` directly to avoid native IPC overhead. No large-workspace throughput claim or new
manual native-dialog/assistive-technology certification is made by these automated checks.
