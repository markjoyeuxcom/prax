# Prax Backup & Restore

Prax stores all data in a single embedded SQLite file (`PRAX_DB_FILE`, default
`./prax.db`). There are two layers to know about.

## 1. App-level export (portable, not a full backup)

Settings ▸ Data & admin exports:

- **Tasks** as a `moomora.tasks` JSON envelope (per-project or all projects).
- **Library** documents as a ZIP of `.md` files (per-project or all projects).

These are good for moving content between instances or keeping human-readable
copies. They do **not** capture: archived tasks/documents, task↔document links,
checklist or activity history, or project metadata. Treat them as
portability/export, not as a complete backup.

## 2. Database backup (authoritative)

A full backup is a copy of the database file. Prax runs SQLite in WAL mode, so
either stop the app first, or use SQLite's online-backup command against the
live file:

```bash
sqlite3 "$PRAX_DB_FILE" ".backup '/backups/prax-$(date +%F).db'"
```

Copying the raw file while the app is stopped also works — take `prax.db`
together with its `-wal` and `-shm` siblings if they exist.

**Docker Compose:** the file lives in the `prax-data` volume at `/data/prax.db`:

```bash
docker compose exec app sqlite3 /data/prax.db ".backup '/data/backup.db'"
docker compose cp app:/data/backup.db ./prax-backup.db
```

**Kubernetes:** the file lives on the `prax-data` PersistentVolumeClaim at
`/data/prax.db`; use `kubectl exec` + `kubectl cp` the same way, or snapshot
the volume with your storage class's tooling.

## Restore

Stop the app, replace the database file with the backup copy (removing any
stale `-wal`/`-shm` files), and start the app again — migrations are
idempotent and will no-op on an up-to-date backup.

For app-level exports: create/choose a project, then Settings ▸ Data & admin ▸
**Import tasks from JSON** (choose append/skip/replace), and re-import `.md`
files through the Library's **Import .md**.
