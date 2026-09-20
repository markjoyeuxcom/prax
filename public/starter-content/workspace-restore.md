# Restore a full Prax workspace backup

A full workspace ZIP contains `prax.db`, `manifest.json`, this guide, and bundled starter
resources. The database preserves all committed projects, documents (including archived and
retired ones), types/templates, tasks/checklists/activity, links/citations, run histories,
provider settings, embeddings and operation/Inbox undo receipts. It includes saved credentials:
keep this ZIP private and restore only a backup you trust.

Unsaved drafts, tab-only pending decisions, Library filters/scroll, browser preferences, files
outside Prax and environment configuration are not database records. Save current work first.
A saved undo receipt is retained; the tab's Undo button selection is separate browser state.

1. Extract the ZIP into a private folder. Check `format: prax.workspace-backup`, `version: 1`
   in `manifest.json`. Use the same or a newer Prax release than `praxVersion`.
2. Quit Prax completely. Preserve the current database plus any `-wal` and `-shm` files in a
   dated rollback folder. Do not overwrite a database while any Prax process has it open.
3. Use the manifest's `database.sha256` value with the shipped restore command:

   ```sh
   npm run restore -- --from /private/backup/prax.db --to /path/to/restored/prax.db --sha256 <database.sha256>
   ```

   The destination and sidecars must not exist. The command checks SHA-256, SQLite integrity
   and foreign keys, restores the database and restricts the file to its owner. To run it
   from the macOS app bundle, use its bundled Node executable and script:

   ```sh
   /Applications/Prax.app/Contents/MacOS/prax-server /Applications/Prax.app/Contents/Resources/resources/app/scripts/restore-database.js --from /private/backup/prax.db --to /path/to/restored/prax.db --sha256 <database.sha256>
   ```

   Locate the existing app-data database path before choosing the destination; do not assume
   your terminal checkout's database is the installed app's database. On server deployments,
   use the configured `PRAX_DB_FILE`. Other desktop platforms package the same script.
4. Start Prax using the restored database. Startup applies supported migrations. Check health,
   recent Memory/Inbox documents, tasks, references and run history. If validation fails, quit
   and restore the saved pre-restore files. Retain the rollback copy until accepted.

Markdown ZIP export is for readable documents and metadata. Markdown import creates new plain
notes; use this workspace backup/restore process to recover exact types, trust and relationships.
