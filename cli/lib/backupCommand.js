// `prax backup` — the git backup from the terminal (server/gitBackup.js,
// docs/backup-restore.md). Configuration stays in Settings; this runs,
// lists and stages what Settings configured, for scripts and cron.
//   prax backup                 push a backup now
//   prax backup status          what is configured, the last run, a staged restore
//   prax backup list [--limit n] the remote history, newest first
//   prax backup restore <commit> --yes   stage a restore; applied at the next start
import { CliUsageError, positiveIntFlag } from './cliArgs.js';

export const BACKUP_USAGE = 'prax backup [status | list [--limit <n>] | restore <commit> --yes] [--json]';
export const BACKUP_COMMAND = { flags: ['limit', 'yes'], max: 2, usage: BACKUP_USAGE };

function when(iso) {
  if (!iso) return 'never';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? String(iso) : date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function size(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

export function formatBackupStatus(status) {
  const lines = [];
  if (!status.configured) {
    lines.push('Git backup is not configured. Set the repository in Settings › Data & admin › Git backup.');
  } else {
    lines.push(`Repository: ${status.remote} (branch ${status.branch}, ${status.auth === 'token' ? (status.hasToken ? 'token saved' : 'token missing') : 'SSH key'})`);
    lines.push(`Daily backup: ${status.scheduleEnabled ? `on (last scheduled run ${when(status.lastScheduledRunAt)})` : 'off'}`);
  }
  lines.push(`git: ${status.gitAvailable ? status.gitVersion : 'not found (set PRAX_GIT)'}`);
  const last = status.lastBackup;
  if (last?.error) lines.push(`Last backup: failed ${when(last.at)} — ${last.error.message}`);
  else if (last) lines.push(`Last backup: ${when(last.at)} · ${last.changed ? `commit ${String(last.commit).slice(0, 12)}` : 'nothing changed'} · ${size(last.bytes)}`);
  else lines.push('Last backup: never');
  if (status.pendingRestore) lines.push(`Restore staged: commit ${String(status.pendingRestore.commit).slice(0, 12)} (backup of ${when(status.pendingRestore.backupCreatedAt)}). Restart Prax to apply it.`);
  if (status.lastRestore) lines.push(`Last restore: ${status.lastRestore.ok ? `applied ${when(status.lastRestore.appliedAt)} from ${String(status.lastRestore.commit).slice(0, 12)}` : `failed ${when(status.lastRestore.appliedAt)} — ${status.lastRestore.error}`}`);
  if (status.busy) lines.push(`A git ${status.busy} is running now.`);
  return lines.join('\n');
}

export function formatBackupRun(report) {
  if (!report.changed) return `Nothing changed since the last backup (${String(report.commit || '').slice(0, 12) || 'no commits yet'}); no commit made.`;
  return `Backed up ${size(report.bytes)} as commit ${report.commit.slice(0, 12)} on ${report.branch} at ${report.remote}.${report.large ? ' The snapshot is near the hosting limit for one file; see docs/backup-restore.md.' : ''}`;
}

export function formatBackupHistory(history) {
  if (!history.backups.length) return `No backups on ${history.branch} yet.`;
  return history.backups.map((entry) => `${entry.commit.slice(0, 12)}  ${when(entry.at)}  ${size(entry.bytes) || '—'}  ${entry.praxVersion ? `v${entry.praxVersion}` : ''}`.trimEnd()).join('\n');
}

export async function runBackup({ positionals, flags, client, out }) {
  const sub = positionals[1] || 'run';
  const json = Boolean(flags.json);
  if (sub === 'run') {
    if (positionals.length > 1) throw new CliUsageError(`Usage: ${BACKUP_USAGE}`);
    const report = await client.gitBackupRun();
    out(json ? report : formatBackupRun(report));
    return;
  }
  if (sub === 'status') {
    const status = await client.gitBackupStatus();
    out(json ? status : formatBackupStatus(status));
    return;
  }
  if (sub === 'list') {
    const history = await client.gitBackupHistory({ limit: positiveIntFlag(flags, 'limit') });
    out(json ? history : formatBackupHistory(history));
    return;
  }
  if (sub === 'restore') {
    const commit = positionals[2];
    if (!commit) throw new CliUsageError(`backup restore needs a commit id.\nUsage: ${BACKUP_USAGE}`);
    if (!flags.yes) {
      out(`This stages the backup at ${commit} to replace the whole workspace the next time Prax starts. Run again with --yes to stage it; the current database is kept in a rollback folder beside it.`);
      process.exitCode = 1;
      return;
    }
    const info = await client.gitBackupRestore(commit);
    out(json ? info : `Restore staged from commit ${String(info.commit).slice(0, 12)} (backup of ${when(info.backupCreatedAt)}, ${size(info.bytes)}). Quit and start Prax again to apply it; the current database is kept beside it as a rollback.`);
    return;
  }
  throw new CliUsageError(`Unknown backup subcommand: ${sub}\nUsage: ${BACKUP_USAGE}`);
}
