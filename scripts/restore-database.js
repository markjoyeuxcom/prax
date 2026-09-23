#!/usr/bin/env node
import { dirname, join, resolve } from 'node:path';
import { chmodSync, existsSync, readFileSync } from 'node:fs';
import { restoreDatabaseFromBackup, validateSqliteBackup } from '../server/sqliteBackup.js';
import { assertManifestRestorable } from '../server/backupManifest.js';
import { isDirectInvocation } from '../server/cliEntrypoint.js';

// The manifest to check: --manifest, or the manifest.json extracted beside
// the database (a workspace ZIP holds prax.db and manifest.json side by side).
function loadManifest(source, manifest) {
  const path = manifest ? resolve(manifest) : join(dirname(source), 'manifest.json');
  if (!existsSync(path)) {
    if (manifest) throw new Error(`Backup manifest does not exist: ${path}`);
    return null;
  }
  try {
    return { path, value: JSON.parse(readFileSync(path, 'utf8')) };
  } catch (error) {
    throw new Error(`Backup manifest is not valid JSON: ${path} (${error.message}). No restore was performed.`, { cause: error });
  }
}

export function restoreWorkspaceDatabase({ from, to, sha256, manifest } = {}) {
  if (!from || !to || !/^[a-f0-9]{64}$/i.test(sha256 || '')) throw new Error('--from, --to and the manifest --sha256 are required');
  const source = resolve(from), target = resolve(to);
  if ([`${source}-wal`, `${source}-shm`].some(existsSync)) throw new Error('Workspace backups are self-contained. Refusing source WAL/SHM sidecars outside the manifest checksum.');
  // Version guard first: a backup from a newer Prax is refused before anything
  // else is read or written. The database's own schema is checked again below.
  const found = loadManifest(source, manifest);
  if (found) {
    assertManifestRestorable(found.value);
    const recorded = found.value.database?.sha256;
    if (recorded && recorded.toLowerCase() !== sha256.toLowerCase()) {
      throw new Error(`--sha256 does not match the checksum in ${found.path}. No restore was performed.`);
    }
  }
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
    if (!['--from', '--to', '--sha256', '--manifest'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Usage: npm run restore -- --from backup/prax.db --to restored/prax.db --sha256 <manifest checksum> [--manifest backup/manifest.json]');
    result[args[i].slice(2)] = args[++i];
  }
  return result;
}
if (isDirectInvocation(import.meta.url)) {
  try {
    const options = parseRestoreArgs(process.argv.slice(2));
    if (options.help) console.log('Stop Prax first. Extract a full workspace backup ZIP, then run:\n  npm run restore -- --from /backup/prax.db --to /restored/prax.db --sha256 <database.sha256 from manifest.json>\nThe target database and its WAL/SHM files must not exist. The manifest.json beside the database (or --manifest <path>) is checked too: a backup made by a newer Prax is refused. Only restore a backup you trust; it includes saved provider settings.');
    else console.log(JSON.stringify(restoreWorkspaceDatabase(options), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
