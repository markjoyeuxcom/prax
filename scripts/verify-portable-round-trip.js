import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildApp } from '../server/index.js';
import { loadConfig } from '../server/config.js';
import { createQualityFixture } from './create-quality-fixture.js';

export const PORTABLE_ROUND_TRIP_FORMAT = 'prax.portable-round-trip';
export const PORTABLE_ROUND_TRIP_VERSION = 1;

export function canonicalPortableTask(task) {
  return {
    title: String(task?.title ?? ''),
    description: String(task?.description ?? ''),
    notes: String(task?.notes ?? ''),
    priority: task?.priority ?? null,
    status: task?.status ?? null,
    dueDate: task?.dueDate ?? null,
    dueTime: task?.dueTime ?? null,
    deferredUntil: task?.deferredUntil ?? null,
    recurrence: task?.recurrence ?? null,
    labels: Array.isArray(task?.labels) ? [...task.labels] : [],
    sortOrder: task?.sortOrder ?? null,
    archivedAt: task?.archivedAt ?? null,
    checklist: Array.isArray(task?.checklist)
      ? task.checklist.map((item) => ({
        label: String(item?.label ?? ''),
        completed: Boolean(item?.completed),
      }))
      : [],
  };
}

function serializedPortableTasks(tasks) {
  return (Array.isArray(tasks) ? tasks : [])
    .map((task) => JSON.stringify(canonicalPortableTask(task)))
    .sort();
}

function preview(value) {
  const text = String(value ?? '');
  return text.length > 500 ? `${text.slice(0, 500)}…` : text;
}

export function comparePortableTaskSets(expectedTasks, actualTasks) {
  const expected = serializedPortableTasks(expectedTasks);
  const actual = serializedPortableTasks(actualTasks);
  if (expected.length !== actual.length) {
    throw new Error(`Portable round-trip task count mismatch: expected ${expected.length}, received ${actual.length}`);
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (expected[index] !== actual[index]) {
      throw new Error(
        `Portable round-trip mismatch at canonical record ${index}: expected ${preview(expected[index])}; received ${preview(actual[index])}`,
      );
    }
  }
  const canonicalJson = `[${expected.join(',')}]`;
  return {
    taskCount: expected.length,
    digest: createHash('sha256').update(canonicalJson).digest('hex'),
  };
}

function expectResponse(response, expectedStatus, operation) {
  if (response.statusCode === expectedStatus) return response.json();
  let detail = '';
  try { detail = response.json()?.message || ''; } catch { /* non-JSON error */ }
  throw new Error(`${operation} failed with HTTP ${response.statusCode}${detail ? `: ${detail}` : ''}`);
}

function checklistStateCounts(tasks) {
  const result = { completed: 0, open: 0 };
  for (const task of tasks) {
    for (const item of task.checklist || []) {
      result[item.completed ? 'completed' : 'open'] += 1;
    }
  }
  return result;
}

export async function runPortableRoundTripDrill({
  workspaceDir,
  profile = 'ci',
  keepArtifacts = false,
} = {}) {
  const ownsWorkspace = !workspaceDir;
  const directory = workspaceDir
    ? resolve(workspaceDir)
    : mkdtempSync(join(tmpdir(), 'prax-portable-round-trip-'));
  mkdirSync(directory, { recursive: true });
  const sourceDatabaseFile = join(directory, 'source.db');
  const targetDatabaseFile = join(directory, 'target.db');
  let sourceApp;
  let targetApp;

  try {
    const fixture = await createQualityFixture({ databaseFile: sourceDatabaseFile, profile });
    sourceApp = await buildApp({
      config: loadConfig({ PRAX_DB_FILE: sourceDatabaseFile, EMBEDDING_BACKEND: 'none' }),
    });
    const sourceExport = expectResponse(
      await sourceApp.inject({ method: 'GET', url: '/api/tasks/export?project=all' }),
      200,
      'Source task export',
    );
    await sourceApp.close();
    sourceApp = null;

    targetApp = await buildApp({
      config: loadConfig({ PRAX_DB_FILE: targetDatabaseFile, EMBEDDING_BACKEND: 'none' }),
    });
    const targetProject = expectResponse(
      await targetApp.inject({
        method: 'POST',
        url: '/api/projects',
        payload: { name: 'Portable round-trip target' },
      }),
      201,
      'Target project creation',
    );
    const imported = expectResponse(
      await targetApp.inject({
        method: 'POST',
        url: '/api/tasks/import',
        payload: {
          format: sourceExport.format,
          version: sourceExport.version,
          project: targetProject.slug,
          mode: 'append',
          tasks: sourceExport.tasks,
        },
      }),
      201,
      'Target task import',
    );
    const targetExport = expectResponse(
      await targetApp.inject({
        method: 'GET',
        url: `/api/tasks/export?project=${encodeURIComponent(targetProject.slug)}`,
      }),
      200,
      'Target task export',
    );

    if (imported.imported !== sourceExport.tasks.length || imported.skipped !== 0) {
      throw new Error(
        `Portable round-trip import outcome mismatch: imported ${imported.imported}, skipped ${imported.skipped}`,
      );
    }
    if (targetExport.tasks.some((task) => task.projectId !== targetProject.id)) {
      throw new Error('Portable round-trip project remapping failed');
    }
    const sourceIds = new Set(sourceExport.tasks.map((task) => task.id));
    if (targetExport.tasks.some((task) => sourceIds.has(task.id))) {
      throw new Error('Portable round-trip reused runtime task identity');
    }
    const sourceChecklistIds = new Set(sourceExport.tasks.flatMap((task) => (
      (task.checklist || []).map((item) => item.id)
    )));
    if (targetExport.tasks.some((task) => (
      (task.checklist || []).some((item) => sourceChecklistIds.has(item.id))
    ))) {
      throw new Error('Portable round-trip reused runtime checklist identity');
    }

    const comparison = comparePortableTaskSets(sourceExport.tasks, targetExport.tasks);
    const checklistStates = checklistStateCounts(targetExport.tasks);
    const checklistItemCount = checklistStates.completed + checklistStates.open;
    const archivedTaskCount = targetExport.tasks.filter((task) => task.archivedAt).length;
    if (checklistItemCount !== fixture.manifest.expected.counts.checklistItems) {
      throw new Error(
        `Portable round-trip checklist count mismatch: expected ${fixture.manifest.expected.counts.checklistItems}, received ${checklistItemCount}`,
      );
    }

    return {
      format: PORTABLE_ROUND_TRIP_FORMAT,
      version: PORTABLE_ROUND_TRIP_VERSION,
      fixture: {
        format: fixture.manifest.format,
        version: fixture.manifest.version,
        profile: fixture.manifest.profile,
        clock: fixture.manifest.clock,
        seed: fixture.manifest.seed,
      },
      taskCount: comparison.taskCount,
      checklistItemCount,
      checklistStates,
      archivedTaskCount,
      targetProjectRemapped: true,
      taskIdsRegenerated: true,
      checklistIdsRegenerated: true,
      portableDigest: comparison.digest,
    };
  } finally {
    if (sourceApp) await sourceApp.close().catch(() => {});
    if (targetApp) await targetApp.close().catch(() => {});
    if (ownsWorkspace && !keepArtifacts) rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runPortableRoundTripDrill({ keepArtifacts: process.argv.includes('--keep') })
    .then((report) => console.log(JSON.stringify(report, null, 2)))
    .catch((error) => {
      console.error(error?.stack || error);
      process.exitCode = 1;
    });
}
