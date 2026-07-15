#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../server/config.js';
import { createOnlineBackup, validateSqliteBackup } from '../server/sqliteBackup.js';

export const SQLITE_BACKUP_REPORT_FORMAT = 'prax.sqlite-backup';
export const SQLITE_BACKUP_REPORT_VERSION = 1;

export function parseBackupArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--output' || arg === '--rate') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      index += 1;
      if (arg === '--output') options.output = value;
      else options.rate = Number(value);
    } else {
      throw new Error(`Unknown backup option: ${arg}`);
    }
  }
  return options;
}

const HELP = `Usage:
  PRAX_DB_FILE=/path/to/prax.db npm run backup -- --output /safe/place/prax.db

The app may remain online. The destination must not already exist. The command uses SQLite's
online-backup API, fsyncs the snapshot, and runs integrity + foreign-key checks before success.
`;

export async function backupConfiguredDatabase({ output, rate } = {}) {
  if (!output) throw new Error('--output is required');
  const sourceFile = loadConfig().databaseFile;
  if (sourceFile === ':memory:') throw new Error('In-memory Prax databases cannot be backed up to a file');
  const destinationFile = resolve(output);
  const backup = await createOnlineBackup(sourceFile, destinationFile, rate === undefined ? {} : { rate });
  const validation = validateSqliteBackup(destinationFile);
  return {
    format: SQLITE_BACKUP_REPORT_FORMAT,
    version: SQLITE_BACKUP_REPORT_VERSION,
    sourceFile: resolve(sourceFile),
    backupFile: destinationFile,
    ...backup,
    integrityCheck: validation.integrityCheck,
    foreignKeyViolations: validation.foreignKeyViolations,
  };
}

async function main() {
  const options = parseBackupArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }
  const report = await backupConfiguredDatabase(options);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
