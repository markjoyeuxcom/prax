# Moomora Console Backup & Restore

Moomora Console stores all data in PostgreSQL. There are three layers to know about.

## 1. App-level export (portable, not a full backup)

The Admin panel exports:

- **Tasks** as a `moomora.tasks` JSON envelope (per-project or all projects).
- **Library** documents as a ZIP of `.md` files (per-project or all projects).

These are good for moving content between instances or keeping human-readable copies. They do **not** capture: archived tasks/documents, task↔document links, checklist or activity history, or project metadata. Treat them as portability/export, not as a complete backup.

## 2. Database backup (authoritative)

A full backup is a PostgreSQL dump of the database behind `DATABASE_URL`.

**Docker Compose:**

```bash
docker compose exec -T postgres pg_dump -U moomora -d moomora_console > moomora-backup.sql
# restore (into an empty database):
docker compose exec -T postgres psql -U moomora -d moomora_console < moomora-backup.sql
```

**Kubernetes (run from a pod with `psql`/`pg_dump` and the app secret):**

```bash
DATABASE_URL=$(kubectl get secret moomora-console-db-app -o jsonpath='{.data.uri}' | base64 -d)
pg_dump "$DATABASE_URL" > moomora-backup.sql
psql "$DATABASE_URL" < moomora-backup.sql   # restore into an empty database
```

This dump includes the `schema_migrations` table, so a restored database is recognised as already-migrated.

## 3. CloudNativePG (cluster-level)

When running on Kubernetes with CloudNativePG, prefer CNPG's built-in scheduled backups and point-in-time recovery for the database cluster — see the CloudNativePG documentation. The `pg_dump` flow above remains useful for portable, logical snapshots.

## Upgrading safely

1. **Back up** with `pg_dump` (section 2).
2. **Deploy** the new image.
3. Migrations **apply automatically on startup** (or run `npm run migrate` explicitly).
4. **Verify** `GET /readyz` returns ready.

**Rollback:** migrations are forward-only. To roll back, redeploy the previous image **and** restore the pre-upgrade dump — a migration may have changed the schema in a way the old code cannot read.
