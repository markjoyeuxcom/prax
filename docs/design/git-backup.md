# Git backup and restore

Adopted 2026-10-25, tracked in the Prax task "Git backup and restore: push workspace backups to a
private GitHub or GitLab repository and restore from one" (`0e0cf392`). The user guide is
[Backup and restore](../backup-restore.md#3-git-backup-to-github-or-gitlab); this note records the
design and its reasons.

## What it is

A private git repository as the off-host home of the workspace backup, with a restorable
history. Each backup is one commit of the validated SQLite snapshot the Full workspace backup
already produces, its manifest, the restore guide, and a readable copy (Markdown v3 of the
Library in the mirror layout, JSON of the tasks). Restore is any commit on the branch.

SQLite stays the single source of truth. Git is a transport and a history: nothing is ever read
back from the repository except the one snapshot a person chose to restore. The readable copy is
a courtesy for browsing the repository, and `prax mirror` remains the per-project projection into
a checkout.

## Decisions

- **System `git`, not a JavaScript git.** SSH keys, agents, known hosts, HTTPS tokens, proxies and
  self-managed hosts all work the way they do in a terminal, with no second implementation to
  keep correct. Prax never prompts: `GIT_TERMINAL_PROMPT=0`, SSH in batch mode, and a token
  answered through a `GIT_ASKPASS` script that reads an environment variable. `PRAX_GIT` names
  the executable when the desktop app's minimal PATH lacks it; the container image installs it.
- **The token lives beside the database, not in it.** `git-backup/token`, owner-only. The backup
  contains the database; a token inside it would unlock the repository that holds the backup.
  Every other setting (remote, branch, auth mode, username, schedule) is an `app_settings` row
  and travels with backups like other provider settings.
- **One clone under the data directory** (`git-backup/repo`), re-pointed at the remote on every
  run and reset to the remote branch before each backup, so local state is disposable and a
  remote that moved is noticed. Prax only appends to its branch; a non-fast-forward is reported,
  never forced.
- **The database decides whether to commit.** `manifest.json` and `tasks.json` carry timestamps
  that change on every run; only a changed `prax.db` makes a commit, and an unchanged run discards
  the regenerated files. The snapshot is byte-stable for an unchanged database (SQLite's online
  backup copies pages), so git's delta compression keeps the history reasonable; the 100 MB
  single-file limit of GitHub and GitLab is flagged from 90 MB.
- **Restore is staged, then applied at the next start.** The server never replaces the file it
  has open. `POST …/restore` fetches the commit, runs the same guards as `npm run restore`
  (manifest version, schema, checksum, integrity, foreign keys) and writes `restore-pending/`
  beside the database. `applyPendingRestore` runs in `buildApp` before the database opens: the
  live files move to `restore-rollback-<time>/`, the staged copy goes through
  `restoreDatabaseFromBackup`, and the outcome is recorded in `git-backup/last-restore.json`. A
  failure puts the live files back, keeps the staged copy under `restore-failed-<time>/`, and the
  server starts on the previous database. The desktop shell's existing `restart_prax` command
  gives Settings a one-click apply.
- **One operation at a time.** Backup, history and restore share a lock (`409` while busy); the
  daily schedule skips a tick while something runs and reuses the librarian's sweep pattern (a
  quarter-hour unref'd timer, one run per day once the person turned it on).
- **Operator surface, not an agent write.** Routes carry no agent origin, the CLI command exists
  for scripts and cron, and the restore needs `--yes` or the confirm dialog.

## Evidence

- `tests/backend/gitBackup.test.js`: settings validation; a local bare repository as the remote;
  first commit's contents; unchanged run makes no commit; history; staging with a short commit
  id; the staged restore applied by the next `buildApp` with a rollback folder; cancel; token
  kept in the file and out of the database and responses; a staged restore from a newer Prax
  refused with the live database untouched; the token path end to end against a loopback
  `git http-backend` server with Basic auth (the askpass helper answers, a wrong token is
  reported as refused credentials, the token never appears in a response or recorded error).
  Plain `http://` is accepted for loopback addresses only, for such tests.
- `tests/cli/backupCommand.test.js`: the four subcommands, `--yes`, formatting.
- `tests/frontend/renderSettings.test.js`: the section's states (unconfigured, token, draft,
  failed, git missing, history, staged, busy).

## Not done

- No in-process restore: it would need every repository and the migration runner to re-open the
  database, for a path a person takes rarely. The staged restore is deliberate.
- No pruning of the backup history; delete old commits in the hosting UI or start a new branch.
- Windows: the askpass helper is a `sh` script; the desktop app ships for macOS and Linux.
