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
**Saved**. Clearing site/application data can remove outstanding recovered drafts.

## 1. App-level export (portable, not a full backup)

Settings ▸ Data & admin exports:

- **Tasks** as a `moomora.tasks` JSON envelope (per-project or all projects).
- **Library** documents as a ZIP of `.md` files (per-project or all projects).

Library ▸ **Export…** and both Settings Library-export actions open the same scope and destination
dialog. Desktop Prax opens the operating system Save dialog. Supporting browsers open their Save
picker. Browsers without that API use their configured Downloads folder; enable the browser's
“Ask where to save” preference when you need to choose a location for each download.

These are good for moving content between instances or keeping human-readable
copies. Task JSON includes active/archived tasks, current task metadata, and checklist state.
It does **not** capture task activity history, task↔document links, or project metadata. Library
ZIP export contains active documents only and is not a full metadata round-trip. Treat these as
portability/export, not as a complete backup.

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
the main file together with any `-wal` and `-shm` siblings.

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
   up-to-date backup.
6. Start Prax, require `/healthz` and `/readyz` to succeed, and inspect representative recent work.
   If validation fails, stop Prax and put the saved pre-restore files back.

For app-level exports: create/choose a project, then Settings ▸ Data & admin ▸
**Import tasks from JSON** (choose append/skip/replace). To intake loose `.md` files, open Library ▸
**Import Markdown…**, choose the destination in the dialog, then choose one or more files. Browser
task import and caller-identified Markdown creates are exact-once, so an unchanged retry after a lost
response is safe. Plain Markdown intake preserves file content/filename but does not parse Prax front
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
