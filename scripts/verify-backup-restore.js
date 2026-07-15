#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildApp } from '../server/index.js';
import { loadConfig } from '../server/config.js';
import { createDb } from '../server/db.js';
import { runMigrations } from '../server/migrate.js';
import {
  createOnlineBackup,
  destroyOwnedDatabase,
  restoreDatabaseFromBackup,
  validateSqliteBackup,
} from '../server/sqliteBackup.js';
import { createQualityFixture, verifyQualityFixture } from './create-quality-fixture.js';

export {
  createOnlineBackup,
  destroyOwnedDatabase,
  restoreDatabaseFromBackup,
  validateSqliteBackup,
};

export const BACKUP_RESTORE_DRILL_FORMAT = 'prax.backup-restore-drill';
export const BACKUP_RESTORE_DRILL_VERSION = 1;

const SILENT_LOGGER = { info() {}, error() {} };
const CURRENT_LIVE_MARKER = 'QUALITY BACKUP LIVE WRITE — current WAL snapshot';
const HISTORICAL_LIVE_MARKER = 'QUALITY BACKUP LIVE WRITE — historical WAL snapshot';

function databaseArtifacts(databaseFile) {
  return [databaseFile, `${databaseFile}-wal`, `${databaseFile}-shm`];
}

function walBytes(databaseFile) {
  const path = `${databaseFile}-wal`;
  return existsSync(path) ? statSync(path).size : 0;
}

async function migrateDatabase(databaseFile) {
  const db = createDb(databaseFile);
  try {
    return await runMigrations(db, { logger: SILENT_LOGGER });
  } finally {
    await db.close();
  }
}

async function expectProductionApp(databaseFile, { projectId, handoffNotes, taskCount }) {
  const app = await buildApp({
    config: loadConfig({ PRAX_DB_FILE: databaseFile, EMBEDDING_BACKEND: 'none' }),
  });
  try {
    const health = await app.inject({ method: 'GET', url: '/healthz' });
    if (health.statusCode !== 200) throw new Error(`Restored production health check returned ${health.statusCode}`);
    const projects = await app.inject({ method: 'GET', url: '/api/projects' });
    const marker = projects.json().find((project) => project.id === projectId);
    if (marker?.handoffNotes !== handoffNotes) throw new Error('Restored production app lost the live marker');
    const tasks = await app.inject({ method: 'GET', url: '/api/tasks?archived=all' });
    if (tasks.statusCode !== 200 || tasks.json().length !== taskCount) {
      throw new Error(`Restored production app task count mismatch: expected ${taskCount}`);
    }
    return { health: true, taskCount: tasks.json().length, liveMarkerPreserved: true };
  } finally {
    await app.close();
  }
}

async function runCurrentRestoreScenario(directory, profile) {
  const startedAt = Date.now();
  const databaseFile = join(directory, 'current-live.db');
  const backupFile = join(directory, 'current-live.backup.db');
  const fixture = await createQualityFixture({ databaseFile, profile });
  const projectId = fixture.manifest.expected.sentinels.unicodeTask.projectId;
  const marker = { projectId, handoffNotes: CURRENT_LIVE_MARKER };

  const app = await buildApp({
    config: loadConfig({ PRAX_DB_FILE: databaseFile, EMBEDDING_BACKEND: 'none' }),
  });
  let appOpen = true;
  let backup;
  let validation;
  try {
    const write = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${projectId}`,
      payload: { handoffNotes: CURRENT_LIVE_MARKER },
    });
    if (write.statusCode !== 200) throw new Error(`Live backup marker write returned ${write.statusCode}`);
    const activeWalBytes = walBytes(databaseFile);
    if (activeWalBytes <= 0) throw new Error('Current backup scenario did not observe active WAL bytes');

    backup = await createOnlineBackup(databaseFile, backupFile);
    validation = validateSqliteBackup(backupFile, marker);
    await verifyQualityFixture({ databaseFile: backupFile, manifest: fixture.manifest });
    return await (async () => {
      await app.close();
      appOpen = false;
      const removed = destroyOwnedDatabase(databaseFile, directory);
      const sourceDestroyedBeforeRestore = !databaseArtifacts(databaseFile).some(existsSync);
      if (!sourceDestroyedBeforeRestore || !removed.includes(databaseFile)) {
        throw new Error('Current source database was not destroyed before restore');
      }

      restoreDatabaseFromBackup(backupFile, databaseFile, { ownerDirectory: directory, marker });
      const migration = await migrateDatabase(databaseFile);
      const semantic = await verifyQualityFixture({ databaseFile, manifest: fixture.manifest });
      const restored = validateSqliteBackup(databaseFile, marker);
      const production = await expectProductionApp(databaseFile, {
        ...marker,
        taskCount: fixture.manifest.expected.counts.tasks,
      });
      return {
        profile,
        schemaVersion: fixture.manifest.schema.finalVersion,
        taskCount: fixture.manifest.expected.counts.tasks,
        documentCount: fixture.manifest.expected.counts.documents,
        relationCount: fixture.manifest.expected.counts.documentLinks,
        runCount: fixture.manifest.expected.counts.runbookRuns,
        sourceWalBytes: activeWalBytes,
        backup,
        preDestructionValidation: validation,
        sourceDestroyedBeforeRestore,
        migrationsAppliedAfterRestore: migration.applied,
        semanticVerified: semantic.ok,
        restoredIntegrityCheck: restored.integrityCheck,
        liveMarkerPreserved: restored.liveMarkerPreserved && production.liveMarkerPreserved,
        productionBootVerified: production.health,
        elapsedMs: Date.now() - startedAt,
      };
    })();
  } finally {
    if (appOpen) await app.close().catch(() => {});
  }
}

async function runHistoricalRestoreScenario(directory, profile) {
  const startedAt = Date.now();
  const databaseFile = join(directory, 'historical-live.db');
  const backupFile = join(directory, 'historical-live.backup.db');
  const expectedDatabaseFile = join(directory, 'historical-expected-upgraded.db');
  const historical = await createQualityFixture({ databaseFile, profile, through: '0009' });
  const expected = await createQualityFixture({
    databaseFile: expectedDatabaseFile,
    profile,
    through: '0009',
    upgrade: true,
  });
  const projectId = historical.manifest.expected.sentinels.unicodeTask.projectId;
  const marker = { projectId, handoffNotes: HISTORICAL_LIVE_MARKER };

  const liveDb = createDb(databaseFile);
  let liveDbOpen = true;
  try {
    await liveDb.query('update projects set handoff_notes = $1 where id = $2', [HISTORICAL_LIVE_MARKER, projectId]);
    const activeWalBytes = walBytes(databaseFile);
    if (activeWalBytes <= 0) throw new Error('Historical backup scenario did not observe active WAL bytes');
    const backup = await createOnlineBackup(databaseFile, backupFile);
    const validation = validateSqliteBackup(backupFile, marker);
    await verifyQualityFixture({ databaseFile: backupFile, manifest: historical.manifest });
    await liveDb.close();
    liveDbOpen = false;

    const removed = destroyOwnedDatabase(databaseFile, directory);
    const sourceDestroyedBeforeRestore = !databaseArtifacts(databaseFile).some(existsSync);
    if (!sourceDestroyedBeforeRestore || !removed.includes(databaseFile)) {
      throw new Error('Historical source database was not destroyed before restore');
    }
    restoreDatabaseFromBackup(backupFile, databaseFile, { ownerDirectory: directory, marker });
    const migration = await migrateDatabase(databaseFile);
    const semantic = await verifyQualityFixture({ databaseFile, manifest: expected.manifest });
    const restored = validateSqliteBackup(databaseFile, marker);
    const production = await expectProductionApp(databaseFile, {
      ...marker,
      taskCount: expected.manifest.expected.counts.tasks,
    });

    return {
      profile,
      seededThrough: historical.manifest.schema.finalVersion,
      migratedTo: expected.manifest.schema.finalVersion,
      taskCount: expected.manifest.expected.counts.tasks,
      documentCount: expected.manifest.expected.counts.documents,
      relationCount: expected.manifest.expected.counts.documentLinks,
      sourceWalBytes: activeWalBytes,
      backup,
      preDestructionValidation: validation,
      sourceDestroyedBeforeRestore,
      migrationsAppliedAfterRestore: migration.applied,
      semanticVerified: semantic.ok,
      restoredIntegrityCheck: restored.integrityCheck,
      liveMarkerPreserved: restored.liveMarkerPreserved && production.liveMarkerPreserved,
      productionBootVerified: production.health,
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    if (liveDbOpen) await liveDb.close().catch(() => {});
  }
}

export async function runBackupRestoreDrill({
  profile = 'large',
  historicalProfile = 'ci',
  includeHistorical = true,
  keepArtifacts = false,
  workspaceRoot,
} = {}) {
  const root = resolve(workspaceRoot || tmpdir());
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, 'prax-backup-restore-'));
  try {
    const current = await runCurrentRestoreScenario(directory, profile);
    const historical = includeHistorical
      ? await runHistoricalRestoreScenario(directory, historicalProfile)
      : null;
    return {
      format: BACKUP_RESTORE_DRILL_FORMAT,
      version: BACKUP_RESTORE_DRILL_VERSION,
      current,
      historical,
      ...(keepArtifacts ? { artifactsDirectory: directory } : {}),
    };
  } finally {
    if (!keepArtifacts) rmSync(directory, { recursive: true, force: true });
  }
}

export function parseBackupRestoreArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--keep') options.keepArtifacts = true;
    else if (arg === '--skip-historical') options.includeHistorical = false;
    else if (arg === '--profile' || arg === '--historical-profile') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      index += 1;
      if (arg === '--profile') options.profile = value;
      else options.historicalProfile = value;
    } else {
      throw new Error(`Unknown backup/restore option: ${arg}`);
    }
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runBackupRestoreDrill(parseBackupRestoreArgs(process.argv.slice(2)))
    .then((report) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`))
    .catch((error) => {
      console.error(error?.stack || error);
      process.exitCode = 1;
    });
}
