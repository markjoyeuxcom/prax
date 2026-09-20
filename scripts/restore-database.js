#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import { chmodSync, existsSync } from 'node:fs';
import { restoreDatabaseFromBackup, validateSqliteBackup } from '../server/sqliteBackup.js';
import { isDirectInvocation } from '../server/cliEntrypoint.js';

export function restoreWorkspaceDatabase({ from, to, sha256 } = {}) {
  if (!from || !to || !/^[a-f0-9]{64}$/i.test(sha256 || '')) throw new Error('--from, --to and the manifest --sha256 are required');
  const source = resolve(from), target = resolve(to);
  if ([`${source}-wal`, `${source}-shm`].some(existsSync)) throw new Error('Workspace backups are self-contained. Refusing source WAL/SHM sidecars outside the manifest checksum.');
  const proof = validateSqliteBackup(source);
  if (proof.sha256 !== sha256.toLowerCase()) throw new Error('Backup checksum does not match the manifest. No restore was performed.');
  const result = restoreDatabaseFromBackup(source, target, { ownerDirectory: dirname(target) });
  chmodSync(target, 0o600);
  return { ...result, format: 'prax.workspace-restore', version: 1, integrityCheck: 'ok', foreignKeyViolations: 0 };
}
export function parseRestoreArgs(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help' || args[i] === '-h') { result.help = true; continue; }
    if (!['--from', '--to', '--sha256'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Usage: npm run restore -- --from backup/prax.db --to restored/prax.db --sha256 <manifest checksum>');
    result[args[i].slice(2)] = args[++i];
  }
  return result;
}
if (isDirectInvocation(import.meta.url)) {
  try {
    const options = parseRestoreArgs(process.argv.slice(2));
    if (options.help) console.log('Stop Prax first. Extract a full workspace backup ZIP, then run:\n  npm run restore -- --from /backup/prax.db --to /restored/prax.db --sha256 <database.sha256 from manifest.json>\nThe target database and its WAL/SHM files must not exist. Only restore a backup you trust; it includes saved provider settings.');
    else console.log(JSON.stringify(restoreWorkspaceDatabase(options), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
