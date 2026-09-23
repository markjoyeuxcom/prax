# Prax Backup & Restore

Prax stores all data in a single embedded SQLite file (`PRAX_DB_FILE`, default
`./prax.db`). There are two layers to know about.

## Unsaved editor recovery

The document editor mirrors each accepted title/body change into versioned, origin-local browser
or desktop-webview storage before its debounced database save. If persistence fails or the app is
reloaded, reopen that document: Prax restores the local draft and offers **Save recovered draft**.
It does not silently autosave a restored draft; if the database copy also changed, Prax labels the
conflict and asks before replacement.

This recovery cache is a last-mile data-loss guard, not a backup. Drafts disappear from it after an
acknowledged save and are not present in database backups or portable exports until the editor says
**Saved**. Clearing site/application data can remove outstanding recovered drafts. Desktop relaunches reuse
the port saved in the app-data `webview-port` file, preserving this storage origin. Keep that file
with the desktop webview profile. An upgrade can recover the most recently logged origin; drafts
stranded on older, unrecorded origins are not automatically merged. Quick-capture retry payloads,
project-field drafts and pending assistant approvals also use local recovery storage.

## 1. App-level export and workspace backup

Settings ▸ Data & admin exports:

- **Tasks** as a `moomora.tasks` JSON envelope (per-project or all projects).
- **Markdown documents** as a ZIP of `.md` files (per-project or all projects, with optional Archive).
- **Full workspace backup** as a validated SQLite snapshot ZIP, manifest and bundled restore guide.

Library ▸ **Export…** and both Settings Library-export actions open the same scope and destination
dialog. Desktop Prax opens the operating system Save dialog. Supporting browsers open their Save
picker. Browsers without that API use their configured Downloads folder; enable the browser's
“Ask where to save” preference when you need to choose a location for each download.

The JSON and Markdown options are good for moving content between instances or keeping human-readable
copies. Task JSON includes active/archived tasks, current task metadata, and checklist state.
It does **not** capture task activity history, task↔document links, or project metadata. Library
ZIP export includes nonarchived documents by default, including superseded/deprecated records
labeled with their status. It can include Archive and carries v3 trust, provenance, links and
citations. Plain Markdown import remains note intake rather than a metadata round-trip.

Choose **Full workspace backup** in the same dialog for all committed SQLite data, including tasks,
projects, archives, templates, trust, run history and Inbox undo records. It includes saved provider
credentials, so keep it private. Unsaved drafts, browser preferences/pending decisions and external
files are excluded. Follow the included `RESTORE.md` or the
[bundled restore guide](../public/starter-content/workspace-restore.md) with Prax stopped. The
shipped `npm run restore` command checks the manifest checksum, refuses a backup made by a newer
Prax (see [Version and schema guards](#version-and-schema-guards)) and refuses to overwrite
existing data. This is the authoritative recovery option accessible from the UI.

The automated task portability drill is `npm run verify:portable`. It proves the documented task
fields and checklist state against a fresh target instance; it does not change the exclusions
above or turn the library ZIP into a round-trippable backup.

## 2. Database backup (authoritative)

A full backup is a coherent snapshot of the SQLite database. The recommended command uses
SQLite's online-backup API, so the app may remain running and committed WAL-mode writes are
included:

```bash
PRAX_DB_FILE=/path/to/prax.db \
  npm run backup -- --output /backups/prax-$(date +%F).db
```

The destination must not exist. Success means the snapshot was fsynced and passed
`PRAGMA integrity_check` plus `PRAGMA foreign_key_check`; the JSON report includes its byte/page
counts and SHA-256 digest. Copy that backup off the application host and retain more than one
generation. A backup that exists only beside the live database does not protect against disk or
host loss.

If the app is fully stopped, copying `prax.db` also works. Do not copy only the main file while the
app is running: committed data may still be in `prax.db-wal`. When using a raw stopped copy, keep
the main file together with any `-wal` and `-shm` siblings. A normal desktop quit (menu-bar
**Quit Prax**, ⌘Q, the Dock's Quit, logout) closes the database and folds the WAL back into
`prax.db`, but a crash, a force quit or a server that misses the five-second shutdown bound leaves
committed data in `prax.db-wal` until the next launch — so copy the siblings whenever they exist.

**Docker Compose:** the file lives in the `prax-data` volume at `/data/prax.db`:

```bash
docker compose exec app npm run backup -- --output /data/backup.db
docker compose cp app:/data/backup.db ./prax-backup.db
```

Move or remove `/data/backup.db` after copying it off-host so the next run does not overwrite it
silently (the command deliberately refuses).

**Kubernetes:** the file lives on the `prax-data` PersistentVolumeClaim at `/data/prax.db`. Run
the same `npm run backup -- --output /data/backup.db` command with `kubectl exec`, copy it from the
selected pod with `kubectl cp`, then remove the in-volume copy. A storage-class volume snapshot is
also valid when its consistency guarantees cover SQLite/WAL; rehearse the exact provider restore.

## Restore

1. Confirm the backup's recorded SHA-256 after transferring it to the restore host.
2. Stop Prax completely. Do not restore over a process with an open database connection.
3. Move the current `prax.db`, `prax.db-wal`, and `prax.db-shm` (when present) into a dated rollback
   directory; keep them until the restored instance is accepted.
4. Copy the backup to the configured `PRAX_DB_FILE` path with ownership/mode appropriate for the
   Prax process. Do not carry stale sidecars across from the failed working copy.
5. Run `PRAX_DB_FILE=/restored/prax.db npm run migrate`. Migrations are idempotent and no-op on an
   up-to-date backup. A backup taken by a newer Prax is refused here (see below).
6. Start Prax, require `/healthz` and `/readyz` to succeed, and inspect representative recent work.
   If validation fails, stop Prax and put the saved pre-restore files back.

## Version and schema guards

Prax never runs older code on a schema a newer Prax has changed, and never quietly serves a schema
that lost one of its data-rule triggers. Three guards enforce this.

- **Downgrade guard (startup and `npm run migrate`).** Before applying anything, the migration
  runner compares the database's `schema_migrations` with the migrations this build ships. If the
  database records a migration this build does not know, it refuses to start with a message naming
  the unknown migration(s) and the last migration this build knows (error code
  `PRAX_SCHEMA_TOO_NEW`). Install the newer Prax again, or restore a backup made by this version or
  an older one. Nothing is changed.
- **Restore guard (`npm run restore`, the app-bundle restore command and the restore drill).** A
  full workspace ZIP's `manifest.json` records `praxVersion` and `schema.finalMigration`. The
  restore command reads the manifest extracted beside `prax.db` (or the one named with
  `--manifest <path>`) and refuses, before writing anything, a backup whose `praxVersion` is newer
  than this Prax, whose final migration this build does not know, whose manifest format or version
  it does not understand, or whose `database.sha256` disagrees with `--sha256`. It then checks the
  database's own `schema_migrations` too, before copying and again after folding in any WAL, so an
  edited or missing manifest (for example a raw database backup) cannot bypass the guard. A backup
  from the same or an older Prax restores as before and is upgraded by the normal startup
  migrations.
- **Trigger-set check (after migrations).** FTS maintenance and the supersession lifecycle live in
  triggers on `markdown_documents` and `document_links`. SQLite drops a table's triggers when a
  migration rebuilds the table (SQLite cannot `ALTER` a `CHECK` constraint), and a `document_links`
  trigger that names `markdown_documents` makes the rebuild's rename fail. The expected trigger set
  is listed once, as `EXPECTED_TRIGGERS` in `server/migrate.js`. The runner verifies it inside the
  final migration's transaction, so a migration that loses a trigger is rolled back and startup
  fails with the missing or unexpected trigger names. It also verifies it at every startup of an
  up-to-date database. A migration that adds or removes one of these triggers updates the list in
  the same change.

For app-level exports: create/choose a project, then Settings ▸ Data & admin ▸
**Import tasks from JSON** (choose append/skip/replace). To intake loose `.md` files, open Library ▸
**Import Markdown…**, choose the destination in the dialog, then choose one or more files. Browser
task import and caller-identified Markdown creates are exact-once, so an unchanged retry after a lost
response is safe. Large task files upload as bounded chunks and commit in one transaction only
after every chunk is present. Reselecting an unchanged task file after a reload retains its pending
import identity until success is confirmed. Plain Markdown intake preserves file content/filename but does not parse Prax front
matter or restore type, provenance, trust, or graph relationships; it is a convenience intake path,
not an authoritative or round-trip recovery format.

## Reproducible restore-drill data

Use the deterministic `ci` or `large` mature-workspace fixture when rehearsing restore and upgrade
procedures. Its versioned manifest verifies semantic sentinels, related rows, FTS content, and
foreign keys in addition to raw counts. See [quality-fixture.md](quality-fixture.md) for generation,
historical-schema upgrade, and post-restore verification commands.

Run the complete disposable rehearsal with:

```bash
npm run verify:restore
```

It snapshots a live `large` workspace through a second SQLite connection while a committed marker
is still in WAL, validates the backup before deletion, destroys the generated source, restores the
same path, verifies the full manifest, and boots Prax. It also restores a `0009` `ci` snapshot and
proves migrations `0010`/`0011` preserve the taxonomy/FTS rebuild and related rows. The command
only destroys artifacts inside its own temporary directory; use `--keep` to retain them for
inspection.

After the exact-revision upgrade, old semantic vectors remain pending until re-indexed: their old body-only token cannot prove that the embedded title was current. Settings ▸ Intelligence can rebuild the index; Library, Ask Prax, and MCP disclose incomplete coverage while only current-revision/current-model vectors are ranked. Original Markdown content and verification stamps are retained.
