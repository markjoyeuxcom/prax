import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDb } from '../../server/db.js';
import { buildApp } from '../../server/index.js';
import { loadConfig } from '../../server/config.js';
import {
  QUALITY_FIXTURE_PROFILES,
  createQualityFixture,
  parseQualityFixtureArgs,
  verifyQualityFixture,
} from '../../scripts/create-quality-fixture.js';

function fixturePath(name) {
  return join(mkdtempSync(join(tmpdir(), 'prax-quality-test-')), `${name}.db`);
}

test('quality fixture profiles pin the initial CI and large scale targets', () => {
  assert.deepEqual(QUALITY_FIXTURE_PROFILES.ci, {
    tasks: 200,
    documents: 50,
    checklistItems: 150,
    activityEvents: 300,
    taskDocumentLinks: 100,
    documentLinks: 80,
    externalRefs: 20,
    runs: 20,
    runStepsPerRun: 4,
  });
  assert.equal(QUALITY_FIXTURE_PROFILES.large.tasks, 5000);
  assert.equal(QUALITY_FIXTURE_PROFILES.large.documents, 750);
  assert.equal(QUALITY_FIXTURE_PROFILES.large.documentLinks, 1000);
  assert.equal(QUALITY_FIXTURE_PROFILES.large.runs, 250);
});

test('quality fixture CLI parsing keeps historical, embedding, and verification modes explicit', () => {
  assert.deepEqual(
    parseQualityFixtureArgs([
      '--profile', 'ci', '--output', '/tmp/prax.db', '--through', '0009',
      '--upgrade', '--embeddings', '--seed', '42', '--force',
    ]),
    {
      profile: 'ci',
      databaseFile: '/tmp/prax.db',
      through: '0009',
      upgrade: true,
      embeddings: true,
      seed: 42,
      force: true,
    },
  );
  assert.deepEqual(
    parseQualityFixtureArgs(['--verify', '--output', '/tmp/restored.db', '--manifest', '/tmp/source.json']),
    { verify: true, databaseFile: '/tmp/restored.db', manifestFile: '/tmp/source.json' },
  );
  assert.throws(() => parseQualityFixtureArgs(['--unknown']), /Unknown quality fixture option/);
});

test('current CI fixture is deterministic, rich, self-verifying, and detects semantic corruption', async () => {
  const firstPath = fixturePath('current-a');
  const secondPath = fixturePath('current-b');
  const first = await createQualityFixture({ databaseFile: firstPath, profile: 'ci', embeddings: true });
  const second = await createQualityFixture({ databaseFile: secondPath, profile: 'ci', embeddings: true });

  assert.deepEqual(first.manifest, second.manifest, 'same clock/seed/profile yields an identical manifest');
  assert.equal(
    readFileSync(first.manifestFile, 'utf8'),
    readFileSync(second.manifestFile, 'utf8'),
    'published manifests are byte-identical',
  );
  assert.deepEqual(first.manifest.expected.counts, {
    schemaMigrations: 25,
    projects: 5,
    tasks: 200,
    checklistItems: 150,
    activityEvents: 300,
    documents: 50,
    taskDocumentLinks: 100,
    documentLinks: 80,
    externalRefs: 20,
    runbookRuns: 20,
    runbookRunSteps: 80,
    runbookRunEvents: 73,
    embeddings: 50,
    currentEmbeddings: 50,
  });
  assert.deepEqual(Object.keys(first.manifest.expected.states.taskStatuses).sort(), [
    'completed', 'high-priority', 'in-progress', 'notes', 'planned',
  ]);
  assert.deepEqual(Object.keys(first.manifest.expected.states.taskRecurrences).sort(), [
    'daily', 'every:2w', 'every:3d', 'monthly', 'none', 'weekly',
  ]);
  assert.deepEqual(Object.keys(first.manifest.expected.states.taskDueStates).sort(), [
    'future', 'none', 'past', 'today',
  ]);
  assert.deepEqual(Object.keys(first.manifest.expected.states.taskSnoozeStates).sort(), [
    'future', 'none', 'past',
  ]);
  assert.deepEqual(Object.keys(first.manifest.expected.states.documentTypes).sort(), [
    'decision', 'known-issue', 'note', 'post-mortem', 'reference', 'runbook',
  ]);
  assert.deepEqual(Object.keys(first.manifest.expected.states.runStatuses).sort(), [
    'aborted', 'completed', 'running',
  ]);
  assert.deepEqual(first.manifest.expected.states.runEventTypes, {
    aborted: 6,
    completed: 7,
    started: 20,
    'step-checked': 40,
  });
  assert.ok(first.manifest.expected.states.archivedTasks > 0);
  assert.ok(first.manifest.expected.states.snoozedTasks > 0);
  assert.ok(first.manifest.expected.states.staleDerivedLinks > 0);

  const verified = await verifyQualityFixture({ databaseFile: firstPath, manifestFile: first.manifestFile });
  assert.equal(verified.ok, true);

  const app = await buildApp({ config: loadConfig({ PRAX_DB_FILE: firstPath, EMBEDDING_BACKEND: 'none' }) });
  const tasks = await app.inject({ method: 'GET', url: '/api/tasks?archived=all' });
  assert.equal(tasks.statusCode, 200);
  assert.equal(tasks.json().length, 200);
  const fts = await app.inject({ method: 'GET', url: '/api/library/documents?q=qualitysentineldoc&archived=all' });
  assert.equal(fts.statusCode, 200);
  assert.equal(fts.json()[0].id, first.manifest.expected.sentinels.runbook.id);
  await app.close();

  const db = createDb(firstPath);
  await db.query(
    'update tasks set title = $1 where id = $2',
    ['silently corrupted', first.manifest.expected.sentinels.unicodeTask.id],
  );
  await db.close();
  await assert.rejects(
    () => verifyQualityFixture({ databaseFile: firstPath, manifest: first.manifest }),
    /Unicode task title/,
  );
  await assert.rejects(
    () => createQualityFixture({ databaseFile: secondPath, profile: 'ci' }),
    /Refusing to overwrite/,
  );
});

test('historical CI fixture upgrades from 0009 through the taxonomy rebuild without semantic loss', async () => {
  const databaseFile = fixturePath('upgrade-0009');
  const result = await createQualityFixture({
    databaseFile,
    profile: 'ci',
    through: '0009',
    upgrade: true,
  });

  assert.equal(result.manifest.schema.seededThrough, '0009_add_project_repo_url.sql');
  assert.equal(result.manifest.schema.finalVersion, '0025_assistant_write_receipts.sql');
  assert.equal(result.manifest.schema.upgraded, true);
  assert.equal(result.manifest.expected.counts.documents, 50);
  assert.equal(result.manifest.expected.counts.documentLinks, 80);
  assert.equal(result.manifest.expected.counts.taskDocumentLinks, 100);
  assert.equal(result.manifest.expected.counts.runbookRuns, 20);
  assert.equal(result.manifest.expected.counts.runbookRunSteps, 80);
  assert.equal(result.manifest.expected.counts.runbookRunEvents, 73);
  assert.equal(result.manifest.expected.counts.externalRefs, 0, 'newer-only rows are not fabricated after upgrade');
  assert.equal(result.manifest.expected.sentinels.taxonomyDocument.documentType, 'post-mortem');
  assert.deepEqual(Object.keys(result.manifest.expected.states.documentTypes).sort(), [
    'note', 'post-mortem', 'runbook',
  ]);

  const verification = await verifyQualityFixture({ databaseFile, manifest: result.manifest });
  assert.equal(verification.ok, true);
});

// C10 fixture integration: a current-schema fixture must seed vectors that the
// app treats as CURRENT (embedded_hash = revision), while a fixture seeded on a
// pre-0023 schema and upgraded keeps its body-hash vectors pending until a
// reindex — and its manifest says so.
test('seeded embeddings are current on the current schema and honestly pending after a 0009 upgrade', async () => {
  const { createLibraryRepository } = await import('../../server/libraryRepository.js');
  const currentPath = fixturePath('current-embeddings');
  const current = await createQualityFixture({ databaseFile: currentPath, profile: 'ci', embeddings: true });
  assert.equal(current.manifest.expected.counts.currentEmbeddings, 50);
  assert.equal(current.manifest.features.seeded.documentRevision, true);
  let db = createDb(currentPath);
  try {
    const stale = await db.query('select count(*) as n from markdown_documents where embedding is not null and embedded_hash is distinct from revision');
    assert.equal(stale.rows[0].n, 0, 'every seeded vector is keyed by the document revision');
    const counts = await createLibraryRepository(db).countEmbeddings('quality-fixture', 'deterministic-v1');
    assert.deepEqual(counts, { total: 48, embedded: 48 }, 'the repository sees every non-archived vector as current');
  } finally { await db.close(); }

  const upgradedPath = fixturePath('upgraded-embeddings');
  const upgraded = await createQualityFixture({ databaseFile: upgradedPath, profile: 'ci', through: '0009', upgrade: true, embeddings: true });
  assert.equal(upgraded.manifest.features.seeded.documentRevision, false);
  assert.equal(upgraded.manifest.features.final.documentRevision, true);
  assert.equal(upgraded.manifest.expected.counts.embeddings, 50);
  assert.equal(upgraded.manifest.expected.counts.currentEmbeddings, 0, 'body-hash vectors cannot claim to cover the reviewed title');
  assert.equal((await verifyQualityFixture({ databaseFile: upgradedPath, manifest: upgraded.manifest })).ok, true);
  db = createDb(upgradedPath);
  try {
    const repo = createLibraryRepository(db);
    const counts = await repo.countEmbeddings('quality-fixture', 'deterministic-v1');
    assert.equal(counts.embedded, 0);
    assert.ok((await repo.listDocumentsNeedingEmbedding('quality-fixture', 'deterministic-v1')).length >= 48, 'all legacy vectors are listed for reindex');
  } finally { await db.close(); }
});
