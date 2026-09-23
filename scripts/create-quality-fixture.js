#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDb } from '../server/db.js';
import { documentRevision } from '../server/libraryRepository.js';
import {
  DEFAULT_MIGRATIONS_DIR,
  migrationBoundary,
  orderedMigrations,
  runMigrations,
} from '../server/migrate.js';

export const QUALITY_FIXTURE_FORMAT = 'prax.quality-fixture';
export const QUALITY_FIXTURE_VERSION = 1;
export const DEFAULT_QUALITY_CLOCK = '2026-07-13T12:00:00.000Z';
export const DEFAULT_QUALITY_SEED = 20260713;

export const QUALITY_FIXTURE_PROFILES = Object.freeze({
  ci: Object.freeze({
    tasks: 200,
    documents: 50,
    checklistItems: 150,
    activityEvents: 300,
    taskDocumentLinks: 100,
    documentLinks: 80,
    externalRefs: 20,
    runs: 20,
    runStepsPerRun: 4,
  }),
  large: Object.freeze({
    tasks: 5000,
    documents: 750,
    checklistItems: 3750,
    activityEvents: 7500,
    taskDocumentLinks: 1500,
    documentLinks: 1000,
    externalRefs: 300,
    runs: 250,
    runStepsPerRun: 5,
  }),
});

const SILENT_LOGGER = { info() {}, error() {} };
const TASK_STATUSES = ['high-priority', 'in-progress', 'planned', 'completed', 'notes'];
const PRIORITIES = ['high', 'medium', 'low'];
const RECURRENCES = [null, 'daily', 'weekly', 'monthly', 'every:3d', 'every:2w'];
const DOCUMENT_TYPES = ['runbook', 'note', 'decision', 'known-issue', 'reference', 'post-mortem'];
const ACTIVITY_TYPES = ['created', 'status_changed', 'note_updated', 'scheduled'];
const STALE_HASH = 'f'.repeat(64);
const PROJECTS = Object.freeze({
  inbox: { id: '00000000-0000-4000-8000-000000000001', name: 'Inbox', status: 'active', sortOrder: -1 },
  personal: { id: '00000000-0000-4000-8000-000000000002', name: 'Personal', status: 'completed', sortOrder: 0 },
  work: { id: '00000000-0000-4000-8000-000000000003', name: 'Work', status: 'active', sortOrder: 1 },
  homelab: { id: '00000000-0000-4000-8000-000000000004', name: 'Homelab', status: 'on-hold', sortOrder: 2 },
  'quality-lab': { id: '00000000-0000-4000-8000-000000000005', name: 'Quality Lab', status: 'active', sortOrder: 3 },
});

const LONG_TASK_DESCRIPTION = [
  'First line with punctuation: commas, colons, #hashes, "quotes", and \\slashes.',
  'Second line preserves deliberate whitespace and Unicode: café 東京 🧪.',
  `Long payload boundary: ${'0123456789abcdef'.repeat(160)}`,
].join('\n');

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function fixedUuid(namespace, index) {
  return `${namespace}-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function isoAt(clock, minutes) {
  return new Date(Date.parse(clock) + (minutes * 60_000)).toISOString();
}

function dateAt(clock, days) {
  return new Date(Date.parse(clock) + (days * 86_400_000)).toISOString().slice(0, 10);
}

function schemaFeatures(ordinal) {
  return {
    inboxProject: ordinal >= 2,
    taskSnooze: ordinal >= 3,
    projectOperations: ordinal >= 4,
    runbookRuns: ordinal >= 5,
    taskRecurrence: ordinal >= 6,
    taskLabels: ordinal >= 7,
    taskDueTime: ordinal >= 8,
    projectRepoUrl: ordinal >= 9,
    documentTaxonomy: ordinal >= 10,
    externalRefs: ordinal >= 11,
    durableRunChronicle: ordinal >= 13,
    // 0023: markdown_documents.revision (sha256 over title + body). A seeded
    // vector is CURRENT only when embedded_hash carries that token; older
    // schemas keep the body hash and their vectors stay pending after upgrade.
    documentRevision: ordinal >= 23,
    // 0030: the reserved Memory system project (slug 'memory') is seeded by
    // migration, so a workspace upgraded past it holds one more project row.
    memoryProject: ordinal >= 30,
    // 0037: tasks.recurrence_anchor_day, the day a monthly series returns to.
    taskRecurrenceAnchor: ordinal >= 37,
  };
}

function countBy(rows, field) {
  const counts = {};
  for (const row of rows) {
    const key = row[field];
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function countValues(values) {
  return countBy(values.map((value) => ({ value })), 'value');
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)]),
  );
}

function expectEqual(actual, expected, label) {
  if (JSON.stringify(canonical(actual)) !== JSON.stringify(canonical(expected))) {
    throw new Error(
      `Quality fixture verification failed for ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function migrationCatalog() {
  const migrations = orderedMigrations(readdirSync(DEFAULT_MIGRATIONS_DIR));
  if (migrations.length === 0) throw new Error('No Prax migrations found');
  return migrations;
}

function normalizeGenerationOptions(options = {}) {
  const profileName = options.profile || 'ci';
  const profile = QUALITY_FIXTURE_PROFILES[profileName];
  if (!profile) throw new Error(`Unknown quality fixture profile: ${profileName}`);
  if (!options.databaseFile) throw new Error('databaseFile is required');

  const parsedClock = new Date(options.clock || DEFAULT_QUALITY_CLOCK);
  if (!Number.isFinite(parsedClock.getTime())) throw new Error('clock must be a valid date-time');
  const clock = parsedClock.toISOString();

  const seed = options.seed === undefined ? DEFAULT_QUALITY_SEED : Number(options.seed);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new Error('seed must be an integer from 0 through 4294967295');
  }

  const databaseFile = resolve(options.databaseFile);
  const manifestFile = resolve(options.manifestFile || `${databaseFile}.manifest.json`);
  if (databaseFile === manifestFile) throw new Error('databaseFile and manifestFile must differ');

  return {
    profileName,
    profile,
    clock,
    seed,
    databaseFile,
    manifestFile,
    through: options.through || 'current',
    upgrade: Boolean(options.upgrade),
    embeddings: Boolean(options.embeddings),
    force: Boolean(options.force),
  };
}

function clearOwnedArtifacts(databaseFile, manifestFile, force) {
  const paths = [databaseFile, `${databaseFile}-wal`, `${databaseFile}-shm`, manifestFile, `${manifestFile}.tmp`];
  const existing = paths.filter(existsSync);
  if (existing.length > 0 && !force) {
    throw new Error(`Refusing to overwrite existing quality fixture artifact: ${existing[0]}`);
  }
  for (const path of existing) unlinkSync(path);
}

async function insertRow(client, table, row) {
  if (!/^[a-z_]+$/.test(table)) throw new Error(`Unsafe fixture table name: ${table}`);
  const entries = Object.entries(row);
  for (const [column] of entries) {
    if (!/^[a-z_]+$/.test(column)) throw new Error(`Unsafe fixture column name: ${column}`);
  }
  const columns = entries.map(([column]) => column);
  const placeholders = entries.map((_, index) => `$${index + 1}`);
  await client.query(
    `insert into ${table} (${columns.join(', ')}) values (${placeholders.join(', ')})`,
    entries.map(([, value]) => value),
  );
}

async function seedProjects(client, features, clock) {
  const existing = await client.query('select slug from projects');
  const slugs = new Set(existing.rows.map((row) => row.slug));
  for (const slug of ['personal', 'work', 'homelab', 'inbox']) {
    if (!slugs.has(slug)) continue;
    const project = PROJECTS[slug];
    await client.query(
      `update projects
         set id = $1, name = $2, status = $3, sort_order = $4, created_at = $5, updated_at = $5
       where slug = $6`,
      [project.id, project.name, project.status, project.sortOrder, clock, slug],
    );
  }

  const quality = PROJECTS['quality-lab'];
  await insertRow(client, 'projects', {
    id: quality.id,
    name: quality.name,
    slug: 'quality-lab',
    status: quality.status,
    sort_order: quality.sortOrder,
    created_at: clock,
    updated_at: clock,
  });

  if (features.projectOperations) {
    await client.query(
      'update projects set on_call = $1, handoff_notes = $2 where slug = $3',
      ['Quality Engineer', 'Handoff sentinel: verify restore, migration, and stale knowledge.', 'homelab'],
    );
  }
  if (features.projectRepoUrl) {
    await client.query(
      'update projects set repo_url = $1 where slug = $2',
      ['https://github.com/awaybreaktoday/prax.git', 'quality-lab'],
    );
  }

  const rows = await client.query('select id, slug from projects order by sort_order, slug');
  return rows.rows;
}

function buildTasks(profile, projectRows, features, clock, random) {
  const projectIds = projectRows.map((project) => project.id);
  const rows = [];
  for (let index = 0; index < profile.tasks; index += 1) {
    const token = Math.floor(random() * 0xffffffff).toString(36).padStart(7, '0');
    const duePattern = index % 5;
    const row = {
      id: fixedUuid('10000000', index),
      title: index === 0 ? 'QUALITY SENTINEL — Unicode 🧪 café 東京' : `Quality task ${String(index + 1).padStart(5, '0')} · ${token}`,
      description: index === 0 ? LONG_TASK_DESCRIPTION : `Deterministic task ${index + 1} for fixture seed coverage.`,
      notes: index === 0 ? 'Sentinel notes: preserve\nline breaks and exact meaning.' : (index % 7 === 0 ? `Operational note ${index + 1}` : ''),
      priority: index === 0 ? 'high' : PRIORITIES[index % PRIORITIES.length],
      status: index === 0 ? 'planned' : TASK_STATUSES[index % TASK_STATUSES.length],
      project_id: index === 0 ? PROJECTS.homelab.id : projectIds[index % projectIds.length],
      due_date: duePattern === 0 ? null : dateAt(clock, [-3, 0, 2, 30][duePattern - 1]),
      sort_order: index,
      archived_at: index % 17 === 1 ? isoAt(clock, -1440 - index) : null,
      created_at: isoAt(clock, -(index + 1) * 5),
      updated_at: isoAt(clock, -index * 2),
    };
    if (index === 0) row.due_date = dateAt(clock, 0);
    if (features.taskSnooze) {
      row.deferred_until = index % 10 === 0
        ? isoAt(clock, 1440 + index)
        : (index % 10 === 1 ? isoAt(clock, -1440 - index) : null);
    }
    if (features.taskRecurrence) {
      row.recurrence = index === 0 ? 'every:3d' : RECURRENCES[index % RECURRENCES.length];
    }
    if (features.taskRecurrenceAnchor) {
      // A dated monthly task anchored on the 31st: its due date is (or will be)
      // a clamped day, so the anchor is data the due date cannot reconstruct.
      row.recurrence_anchor_day = row.recurrence === 'monthly' && row.due_date ? 31 : null;
    }
    if (features.taskLabels) {
      row.labels = JSON.stringify(index === 0
        ? ['waiting', 'unicode-東京']
        : (index % 4 === 0 ? ['waiting', `team-${index % 7}`] : []));
    }
    if (features.taskDueTime) {
      row.due_time = row.due_date && index % 3 === 0 ? ['00:00', '09:30', '23:59'][index % 3] : null;
      if (index === 0) row.due_time = '09:30';
    }
    rows.push(row);
  }
  return rows;
}

function buildDocuments(profile, projectRows, features, clock, random, embeddings) {
  const projectIds = projectRows.map((project) => project.id);
  const lifecycle = [
    { kind: 'source', status: 'active', updatedBy: 'user', verified: 1 },
    { kind: 'synthesized', status: 'active', updatedBy: 'agent', verified: 0 },
    { kind: 'source', status: 'superseded', updatedBy: 'user', verified: 1 },
    { kind: 'source', status: 'deprecated', updatedBy: 'user', verified: 0 },
    { kind: 'source', status: 'active', updatedBy: 'user', verified: 1 },
    { kind: 'synthesized', status: 'active', updatedBy: 'agent', verified: 0 },
  ];
  const rows = [];
  for (let index = 0; index < profile.documents; index += 1) {
    const token = Math.floor(random() * 0xffffffff).toString(36).padStart(7, '0');
    const state = lifecycle[index % lifecycle.length];
    let documentType = features.documentTaxonomy
      ? DOCUMENT_TYPES[index % DOCUMENT_TYPES.length]
      : (index % 3 === 0 ? 'runbook' : 'note');
    let tags = [`quality-${index % 5}`, index % 2 === 0 ? 'operations' : 'knowledge'];
    let title = `Quality document ${String(index + 1).padStart(4, '0')} · ${token}`;
    let body = `# ${title}\n\nDeterministic fixture content for document ${index + 1}.\n`;
    if (index === 0) {
      documentType = 'runbook';
      title = 'QUALITY RUNBOOK — Restore café 東京';
      tags = ['quality-sentinel', 'restore', 'unicode-東京'];
      body = '# Quality restore runbook\n\nqualitysentineldoc\n\n- [ ] Stop writes\n- [ ] Restore snapshot\n- [ ] Verify checksums 🧪\n';
    } else if (index === 1) {
      documentType = features.documentTaxonomy ? 'post-mortem' : 'note';
      title = 'QUALITY POST-MORTEM — Migration sentinel';
      tags = ['post-mortem', 'quality-sentinel'];
      body = '# Migration sentinel\n\nPreserve this document and its links across the taxonomy table rebuild.\n';
    } else if (index === 2) {
      body += `\n${'Long document boundary with Unicode Δ and Markdown **content**.\n'.repeat(120)}`;
    }
    const contentHash = sha256(body);
    const row = {
      id: fixedUuid('20000000', index),
      title,
      body,
      document_type: documentType,
      project_id: index === 0 ? PROJECTS.homelab.id : projectIds[index % projectIds.length],
      tags: JSON.stringify(tags),
      source_filename: index === 0 ? 'Quality Sentinel 🧪.md' : null,
      archived_at: index % 23 === 22 ? isoAt(clock, -2880 - index) : null,
      content_hash: contentHash,
      updated_by: state.updatedBy,
      kind: state.kind,
      verified: state.verified,
      verified_at: state.verified ? isoAt(clock, -index) : null,
      verified_by: state.verified ? 'quality-fixture' : null,
      status: state.status,
      embedding: null,
      embedding_backend: null,
      embedding_model: null,
      embedding_dim: null,
      embedded_hash: null,
      embedded_at: null,
      created_at: isoAt(clock, -(index + 1) * 30),
      updated_at: isoAt(clock, -index * 10),
    };
    if (features.documentRevision) row.revision = documentRevision({ title, body });
    if (embeddings) {
      const vector = index === 0
        ? [1, 0, 0, 0]
        : [0, 1, 2, 3].map((offset) => Number((((index + 1) * (offset + 3)) % 17 / 17).toFixed(6)));
      row.embedding = JSON.stringify(vector);
      row.embedding_backend = 'quality-fixture';
      row.embedding_model = 'deterministic-v1';
      row.embedding_dim = vector.length;
      // The vector describes the full embedded input, so on a revision-aware
      // schema it is keyed by the revision (current), not the body hash.
      row.embedded_hash = features.documentRevision ? row.revision : contentHash;
      row.embedded_at = clock;
    }
    rows.push(row);
  }
  return rows;
}

function pairFromPools(sources, targets, index) {
  const sourceIndex = index % sources.length;
  const targetRound = Math.floor(index / sources.length);
  return [sources[sourceIndex], targets[(sourceIndex + targetRound) % targets.length]];
}

function buildDocumentLinks(profile, documents, clock) {
  const activeSources = documents.filter((doc) => doc.kind === 'source' && doc.status === 'active' && !doc.archived_at);
  const synthesized = documents.filter((doc) => doc.kind === 'synthesized' && doc.status === 'active' && !doc.archived_at);
  const superseded = documents.filter((doc) => doc.status === 'superseded' && !doc.archived_at);
  if (!activeSources.length || !synthesized.length || !superseded.length) {
    throw new Error('Quality fixture document pools cannot express required graph states');
  }
  const links = [];
  let derivedIndex = 0;
  let supersedeIndex = 0;
  for (let index = 0; index < profile.documentLinks; index += 1) {
    const relation = index === 0 || index % 5 !== 0 ? 'derived-from' : 'supersedes';
    const [source, target] = relation === 'derived-from'
      ? pairFromPools(synthesized, activeSources, derivedIndex++)
      : pairFromPools(activeSources, superseded, supersedeIndex++);
    const stale = relation === 'derived-from' && (index === 0 || derivedIndex % 4 === 0);
    links.push({
      source_document_id: source.id,
      target_document_id: target.id,
      relation,
      target_hash: relation === 'derived-from' ? (stale ? STALE_HASH : target.content_hash) : null,
      created_at: isoAt(clock, -index),
      stale,
    });
  }
  return links;
}

function buildTaskDocumentLinks(profile, tasks, documents, clock) {
  const availableDocuments = documents.filter((doc) => !doc.archived_at);
  const links = [];
  for (let index = 0; index < profile.taskDocumentLinks; index += 1) {
    const [task, document] = pairFromPools(tasks, availableDocuments, index);
    links.push({ task_id: task.id, document_id: document.id, created_at: isoAt(clock, -index) });
  }
  return links;
}

function buildRuns(profile, documents, features, clock) {
  if (!features.runbookRuns) return { runs: [], steps: [], events: [] };
  const runbooks = documents.filter((doc) => doc.document_type === 'runbook' && !doc.archived_at);
  if (!runbooks.length) throw new Error('Quality fixture requires at least one runbook');
  const runs = [];
  const steps = [];
  const events = [];
  let eventIndex = 0;
  const statuses = ['running', 'completed', 'aborted'];
  for (let index = 0; index < profile.runs; index += 1) {
    const status = statuses[index % statuses.length];
    const runbook = runbooks[index % runbooks.length];
    const run = {
      id: fixedUuid('60000000', index),
      document_id: runbook.id,
      ...(features.durableRunChronicle ? {
        document_title: runbook.title,
        project_id: runbook.project_id,
      } : {}),
      title: index === 0 ? 'QUALITY RUN SENTINEL — restore drill' : `Quality run ${index + 1}`,
      status,
      started_by: index % 2 === 0 ? 'user' : 'agent',
      started_at: isoAt(clock, -(index + 1) * 60),
      finished_at: status === 'running' ? null : isoAt(clock, -(index + 1) * 60 + 20),
      ...(features.durableRunChronicle ? {
        finished_by: status === 'running' ? null : (index % 2 === 0 ? 'user' : 'agent'),
      } : {}),
    };
    runs.push(run);
    const runSteps = [];
    for (let position = 0; position < profile.runStepsPerRun; position += 1) {
      const checked = position < (index % (profile.runStepsPerRun + 1));
      const step = {
        id: fixedUuid('70000000', (index * profile.runStepsPerRun) + position),
        run_id: run.id,
        position,
        text: position === 0 ? 'Preserve semantic sentinel records' : `Deterministic run step ${position + 1}`,
        checked_at: checked ? isoAt(clock, -(index + 1) * 60 + position + 1) : null,
        checked_by: checked ? (index % 2 === 0 ? 'user' : 'agent') : null,
      };
      steps.push(step);
      runSteps.push(step);
    }
    if (features.durableRunChronicle) {
      let sequence = 0;
      events.push({
        id: fixedUuid('80000000', eventIndex++),
        run_id: run.id,
        sequence: sequence++,
        event_type: 'started',
        step_id: null,
        step_text: null,
        actor: run.started_by,
        created_at: run.started_at,
      });
      for (const step of runSteps.filter((candidate) => candidate.checked_at)) {
        events.push({
          id: fixedUuid('80000000', eventIndex++),
          run_id: run.id,
          sequence: sequence++,
          event_type: 'step-checked',
          step_id: step.id,
          step_text: step.text,
          actor: step.checked_by,
          created_at: step.checked_at,
        });
      }
      if (status !== 'running') {
        events.push({
          id: fixedUuid('80000000', eventIndex++),
          run_id: run.id,
          sequence,
          event_type: status,
          step_id: null,
          step_text: null,
          actor: run.finished_by,
          created_at: run.finished_at,
        });
      }
    }
  }
  return { runs, steps, events };
}

function buildExternalRefs(profile, documents, features, clock) {
  if (!features.externalRefs) return [];
  const available = documents.filter((doc) => !doc.archived_at);
  return Array.from({ length: profile.externalRefs }, (_, index) => ({
    id: fixedUuid('50000000', index),
    document_id: available[index % available.length].id,
    url: index === 0 ? 'https://github.com/awaybreaktoday/prax/issues/quality-sentinel' : `https://example.test/quality/${index + 1}`,
    label: index === 0 ? 'Quality fixture sentinel' : `Reference ${index + 1}`,
    created_at: isoAt(clock, -index),
  }));
}

async function seedWorkspace(client, profile, sourceFeatures, clock, seed, embeddings) {
  const random = mulberry32(seed);
  const projects = await seedProjects(client, sourceFeatures, clock);
  const tasks = buildTasks(profile, projects, sourceFeatures, clock, random);
  const documents = buildDocuments(profile, projects, sourceFeatures, clock, random, embeddings);

  for (const task of tasks) await insertRow(client, 'tasks', task);
  for (let index = 0; index < profile.checklistItems; index += 1) {
    const task = tasks[index % tasks.length];
    await insertRow(client, 'task_checklist_items', {
      id: fixedUuid('30000000', index),
      task_id: task.id,
      label: index === 0 ? 'Verify Unicode 🧪 and long-text sentinel' : `Checklist item ${index + 1}`,
      completed: index % 3 === 0 ? 1 : 0,
      sort_order: Math.floor(index / tasks.length),
      created_at: isoAt(clock, -index),
      updated_at: isoAt(clock, -index),
    });
  }
  for (let index = 0; index < profile.activityEvents; index += 1) {
    const task = tasks[index % tasks.length];
    await insertRow(client, 'task_activity', {
      id: fixedUuid('40000000', index),
      task_id: task.id,
      event_type: ACTIVITY_TYPES[index % ACTIVITY_TYPES.length],
      message: index === 0 ? 'QUALITY ACTIVITY SENTINEL — task created' : `Deterministic activity event ${index + 1}`,
      created_at: isoAt(clock, -index),
    });
  }
  for (const document of documents) await insertRow(client, 'markdown_documents', document);

  const taskDocumentLinks = buildTaskDocumentLinks(profile, tasks, documents, clock);
  for (const link of taskDocumentLinks) await insertRow(client, 'task_documents', link);

  const documentLinks = buildDocumentLinks(profile, documents, clock);
  for (const { stale: _stale, ...link } of documentLinks) await insertRow(client, 'document_links', link);

  const externalRefs = buildExternalRefs(profile, documents, sourceFeatures, clock);
  for (const ref of externalRefs) await insertRow(client, 'document_external_refs', ref);

  const { runs, steps, events } = buildRuns(profile, documents, sourceFeatures, clock);
  for (const run of runs) await insertRow(client, 'runbook_runs', run);
  for (const step of steps) await insertRow(client, 'runbook_run_steps', step);
  for (const event of events) await insertRow(client, 'runbook_run_events', event);

  return { projects, tasks, documents, taskDocumentLinks, documentLinks, externalRefs, runs, steps, events };
}

async function normalizeFinalProjectMetadata(db, finalFeatures, clock) {
  const client = await db.connect();
  try {
    await client.query('begin immediate');
    await client.query('update projects set created_at = $1, updated_at = $1', [clock]);
    if (finalFeatures.projectOperations) {
      await client.query(
        'update projects set on_call = $1, handoff_notes = $2 where slug = $3',
        ['Quality Engineer', 'Handoff sentinel: verify restore, migration, and stale knowledge.', 'homelab'],
      );
    }
    if (finalFeatures.projectRepoUrl) {
      await client.query(
        'update projects set repo_url = $1 where slug = $2',
        ['https://github.com/awaybreaktoday/prax.git', 'quality-lab'],
      );
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function finalDocumentModels(documents, sourceOrdinal, finalOrdinal) {
  if (sourceOrdinal >= 10 || finalOrdinal < 10) return documents;
  return documents.map((document) => {
    const tags = JSON.parse(document.tags);
    return tags.includes('post-mortem') ? { ...document, document_type: 'post-mortem' } : document;
  });
}

function expectedRunEventTypes(seeded, finalFeatures) {
  if (!finalFeatures.durableRunChronicle || !seeded.runs.length) return {};
  if (seeded.events.length) return countBy(seeded.events, 'event_type');
  const types = seeded.runs.map(() => 'started');
  types.push(...seeded.steps.filter((step) => step.checked_at).map(() => 'step-checked'));
  types.push(...seeded.runs.filter((run) => run.status !== 'running').map((run) => run.status));
  return countValues(types);
}

function buildManifest({
  profileName,
  profile,
  clock,
  seed,
  embeddings,
  sourceBoundary,
  finalBoundary,
  migrations,
  seeded,
}) {
  const sourceFeatures = schemaFeatures(sourceBoundary.ordinal);
  const finalFeatures = schemaFeatures(finalBoundary.ordinal);
  const documents = finalDocumentModels(seeded.documents, sourceBoundary.ordinal, finalBoundary.ordinal);
  const expectedProjectCount = 3 + (finalFeatures.inboxProject ? 1 : 0) + (finalFeatures.memoryProject ? 1 : 0) + 1;
  const expectedCounts = {
    schemaMigrations: migrations.filter((migration) => migration.ordinal <= finalBoundary.ordinal).length,
    projects: expectedProjectCount,
    tasks: profile.tasks,
    checklistItems: profile.checklistItems,
    activityEvents: profile.activityEvents,
    documents: profile.documents,
    taskDocumentLinks: profile.taskDocumentLinks,
    documentLinks: profile.documentLinks,
    externalRefs: sourceFeatures.externalRefs ? profile.externalRefs : 0,
    runbookRuns: sourceFeatures.runbookRuns ? profile.runs : 0,
    runbookRunSteps: sourceFeatures.runbookRuns ? profile.runs * profile.runStepsPerRun : 0,
    runbookRunEvents: finalFeatures.durableRunChronicle && sourceFeatures.runbookRuns
      ? seeded.runs.length
        + seeded.steps.filter((step) => step.checked_at).length
        + seeded.runs.filter((run) => run.status !== 'running').length
      : 0,
    embeddings: embeddings ? profile.documents : 0,
    // Vectors current for the document revision (0023+). A fixture seeded on an
    // older schema and upgraded keeps body-hash vectors, which are pending until
    // a reindex — so its current count is honestly 0.
    ...(finalFeatures.documentRevision
      ? { currentEmbeddings: embeddings && sourceFeatures.documentRevision ? profile.documents : 0 }
      : {}),
  };
  const expectedStates = {
    taskStatuses: countBy(seeded.tasks, 'status'),
    taskPriorities: countBy(seeded.tasks, 'priority'),
    taskRecurrences: countValues(seeded.tasks.map((task) => task.recurrence || 'none')),
    taskDueStates: countValues(seeded.tasks.map((task) => {
      if (!task.due_date) return 'none';
      if (task.due_date < clock.slice(0, 10)) return 'past';
      if (task.due_date > clock.slice(0, 10)) return 'future';
      return 'today';
    })),
    taskSnoozeStates: countValues(seeded.tasks.map((task) => {
      if (!task.deferred_until) return 'none';
      return task.deferred_until > clock ? 'future' : 'past';
    })),
    archivedTasks: seeded.tasks.filter((task) => task.archived_at).length,
    snoozedTasks: seeded.tasks.filter((task) => task.deferred_until).length,
    recurringTasks: seeded.tasks.filter((task) => task.recurrence).length,
    labeledTasks: seeded.tasks.filter((task) => task.labels && JSON.parse(task.labels).length > 0).length,
    timedTasks: seeded.tasks.filter((task) => task.due_time).length,
    checklistStates: {
      completed: Math.ceil(profile.checklistItems / 3),
      open: profile.checklistItems - Math.ceil(profile.checklistItems / 3),
    },
    activityTypes: countValues(Array.from(
      { length: profile.activityEvents },
      (_, index) => ACTIVITY_TYPES[index % ACTIVITY_TYPES.length],
    )),
    documentTypes: countBy(documents, 'document_type'),
    documentKinds: countBy(documents, 'kind'),
    documentStatuses: countBy(documents, 'status'),
    archivedDocuments: documents.filter((document) => document.archived_at).length,
    verifiedDocuments: documents.filter((document) => document.verified === 1).length,
    documentRelations: countBy(seeded.documentLinks, 'relation'),
    staleDerivedLinks: seeded.documentLinks.filter((link) => link.stale).length,
    runStatuses: countBy(seeded.runs, 'status'),
    runEventTypes: expectedRunEventTypes(seeded, finalFeatures),
  };
  const unicodeTask = seeded.tasks[0];
  const runbook = documents[0];
  const taxonomyDocument = documents[1];

  return {
    format: QUALITY_FIXTURE_FORMAT,
    version: QUALITY_FIXTURE_VERSION,
    profile: profileName,
    clock,
    seed,
    generatedAt: clock,
    schema: {
      seededThrough: sourceBoundary.version,
      seededOrdinal: sourceBoundary.ordinal,
      finalVersion: finalBoundary.version,
      finalOrdinal: finalBoundary.ordinal,
      upgraded: finalBoundary.ordinal > sourceBoundary.ordinal,
      appliedMigrations: migrations
        .filter((migration) => migration.ordinal <= finalBoundary.ordinal)
        .map((migration) => migration.version),
    },
    features: {
      seeded: { ...sourceFeatures, deterministicEmbeddings: embeddings },
      final: { ...finalFeatures, deterministicEmbeddings: embeddings },
    },
    expected: {
      counts: expectedCounts,
      states: expectedStates,
      sentinels: {
        unicodeTask: {
          id: unicodeTask.id,
          title: unicodeTask.title,
          projectId: unicodeTask.project_id,
          descriptionHash: sha256(unicodeTask.description),
          descriptionLength: unicodeTask.description.length,
          notes: unicodeTask.notes,
          labels: finalFeatures.taskLabels ? (sourceFeatures.taskLabels ? JSON.parse(unicodeTask.labels) : []) : undefined,
          recurrence: finalFeatures.taskRecurrence ? (sourceFeatures.taskRecurrence ? unicodeTask.recurrence : null) : undefined,
          dueTime: finalFeatures.taskDueTime ? (sourceFeatures.taskDueTime ? unicodeTask.due_time : null) : undefined,
        },
        archivedTask: { id: seeded.tasks.find((task) => task.archived_at).id },
        runbook: {
          id: runbook.id,
          title: runbook.title,
          bodyHash: sha256(runbook.body),
          contentHash: runbook.content_hash,
          documentType: runbook.document_type,
        },
        taxonomyDocument: {
          id: taxonomyDocument.id,
          documentType: taxonomyDocument.document_type,
        },
        staleLink: {
          sourceDocumentId: seeded.documentLinks[0].source_document_id,
          targetDocumentId: seeded.documentLinks[0].target_document_id,
          relation: seeded.documentLinks[0].relation,
          targetHash: seeded.documentLinks[0].target_hash,
        },
        taskDocumentLink: {
          taskId: seeded.taskDocumentLinks[0].task_id,
          documentId: seeded.taskDocumentLinks[0].document_id,
        },
        run: seeded.runs.length ? {
          id: seeded.runs[0].id,
          documentId: seeded.runs[0].document_id,
          status: seeded.runs[0].status,
          stepCount: profile.runStepsPerRun,
          eventCount: finalFeatures.durableRunChronicle
            ? 1
              + seeded.steps.filter((step) => step.run_id === seeded.runs[0].id && step.checked_at).length
              + (seeded.runs[0].status === 'running' ? 0 : 1)
            : 0,
        } : null,
        externalRef: seeded.externalRefs.length ? {
          id: seeded.externalRefs[0].id,
          documentId: seeded.externalRefs[0].document_id,
          url: seeded.externalRefs[0].url,
        } : null,
      },
    },
  };
}

async function tableExists(db, table) {
  const result = await db.query("select name from sqlite_master where type = 'table' and name = $1", [table]);
  return result.rows.length > 0;
}

async function countTable(db, table) {
  if (!(await tableExists(db, table))) return 0;
  const result = await db.query(`select count(*) as total from ${table}`);
  return Number(result.rows[0].total);
}

async function countWhere(db, table, where) {
  if (!(await tableExists(db, table))) return 0;
  const result = await db.query(`select count(*) as total from ${table} where ${where}`);
  return Number(result.rows[0].total);
}

async function groupedCounts(db, table, expression) {
  if (!(await tableExists(db, table))) return {};
  const result = await db.query(`select ${expression} as value, count(*) as total from ${table} group by ${expression} order by ${expression}`);
  return Object.fromEntries(result.rows.map((row) => [row.value, Number(row.total)]));
}

async function taskDueStates(db, clock) {
  const date = String(clock).slice(0, 10);
  const result = await db.query(
    `select
       count(*) filter (where due_date is null) as none,
       count(*) filter (where due_date < $1) as past,
       count(*) filter (where due_date = $1) as today,
       count(*) filter (where due_date > $1) as future
     from tasks`,
    [date],
  );
  const row = result.rows[0];
  return Object.fromEntries(
    ['none', 'past', 'today', 'future']
      .map((key) => [key, Number(row[key])])
      .filter(([, total]) => total > 0),
  );
}

async function taskSnoozeStates(db, clock, enabled) {
  if (!enabled) return { none: await countTable(db, 'tasks') };
  const result = await db.query(
    `select
       count(*) filter (where deferred_until is null) as none,
       count(*) filter (where deferred_until <= $1) as past,
       count(*) filter (where deferred_until > $1) as future
     from tasks`,
    [clock],
  );
  const row = result.rows[0];
  return Object.fromEntries(
    ['none', 'past', 'future']
      .map((key) => [key, Number(row[key])])
      .filter(([, total]) => total > 0),
  );
}

async function verifyQualityFixtureDb(db, manifest) {
  expectEqual(manifest.format, QUALITY_FIXTURE_FORMAT, 'manifest format');
  expectEqual(manifest.version, QUALITY_FIXTURE_VERSION, 'manifest version');

  const applied = await db.query('select version from schema_migrations order by version');
  expectEqual(applied.rows.map((row) => row.version), manifest.schema.appliedMigrations, 'applied migrations');

  const finalFeatures = manifest.features.final;
  const counts = {
    schemaMigrations: await countTable(db, 'schema_migrations'),
    projects: await countTable(db, 'projects'),
    tasks: await countTable(db, 'tasks'),
    checklistItems: await countTable(db, 'task_checklist_items'),
    activityEvents: await countTable(db, 'task_activity'),
    documents: await countTable(db, 'markdown_documents'),
    taskDocumentLinks: await countTable(db, 'task_documents'),
    documentLinks: await countTable(db, 'document_links'),
    externalRefs: await countTable(db, 'document_external_refs'),
    runbookRuns: await countTable(db, 'runbook_runs'),
    runbookRunSteps: await countTable(db, 'runbook_run_steps'),
    runbookRunEvents: await countTable(db, 'runbook_run_events'),
    embeddings: await countWhere(db, 'markdown_documents', 'embedding is not null'),
    ...(finalFeatures.documentRevision
      ? { currentEmbeddings: await countWhere(db, 'markdown_documents', 'embedding is not null and embedded_hash is not distinct from revision') }
      : {}),
  };
  expectEqual(counts, manifest.expected.counts, 'row counts');

  const states = {
    taskStatuses: await groupedCounts(db, 'tasks', 'status'),
    taskPriorities: await groupedCounts(db, 'tasks', 'priority'),
    taskRecurrences: finalFeatures.taskRecurrence
      ? await groupedCounts(db, 'tasks', "coalesce(recurrence, 'none')")
      : { none: counts.tasks },
    taskDueStates: await taskDueStates(db, manifest.clock),
    taskSnoozeStates: await taskSnoozeStates(db, manifest.clock, finalFeatures.taskSnooze),
    archivedTasks: await countWhere(db, 'tasks', 'archived_at is not null'),
    snoozedTasks: finalFeatures.taskSnooze ? await countWhere(db, 'tasks', 'deferred_until is not null') : 0,
    recurringTasks: finalFeatures.taskRecurrence ? await countWhere(db, 'tasks', 'recurrence is not null') : 0,
    labeledTasks: finalFeatures.taskLabels ? await countWhere(db, 'tasks', "labels <> '[]'") : 0,
    timedTasks: finalFeatures.taskDueTime ? await countWhere(db, 'tasks', 'due_time is not null') : 0,
    checklistStates: await groupedCounts(
      db,
      'task_checklist_items',
      "case when completed = 1 then 'completed' else 'open' end",
    ),
    activityTypes: await groupedCounts(db, 'task_activity', 'event_type'),
    documentTypes: await groupedCounts(db, 'markdown_documents', 'document_type'),
    documentKinds: await groupedCounts(db, 'markdown_documents', 'kind'),
    documentStatuses: await groupedCounts(db, 'markdown_documents', 'status'),
    archivedDocuments: await countWhere(db, 'markdown_documents', 'archived_at is not null'),
    verifiedDocuments: await countWhere(db, 'markdown_documents', 'verified = 1'),
    documentRelations: await groupedCounts(db, 'document_links', 'relation'),
    staleDerivedLinks: Number((await db.query(
      `select count(*) as total
         from document_links l
         join markdown_documents target on target.id = l.target_document_id
        where l.relation = 'derived-from'
          and l.target_hash is not null
          and l.target_hash <> coalesce(target.content_hash, '')`,
    )).rows[0].total),
    runStatuses: await groupedCounts(db, 'runbook_runs', 'status'),
    runEventTypes: await groupedCounts(db, 'runbook_run_events', 'event_type'),
  };
  expectEqual(states, manifest.expected.states, 'semantic state counts');

  const sentinels = manifest.expected.sentinels;
  const taskResult = await db.query('select * from tasks where id = $1', [sentinels.unicodeTask.id]);
  const task = taskResult.rows[0];
  if (!task) throw new Error('Quality fixture verification failed: Unicode task sentinel is missing');
  expectEqual(task.title, sentinels.unicodeTask.title, 'Unicode task title');
  expectEqual(task.project_id, sentinels.unicodeTask.projectId, 'Unicode task project');
  expectEqual(sha256(task.description), sentinels.unicodeTask.descriptionHash, 'long task description hash');
  expectEqual(task.description.length, sentinels.unicodeTask.descriptionLength, 'long task description length');
  expectEqual(task.notes, sentinels.unicodeTask.notes, 'task notes');
  if (finalFeatures.taskLabels) expectEqual(JSON.parse(task.labels), sentinels.unicodeTask.labels, 'task labels');
  if (finalFeatures.taskRecurrence) expectEqual(task.recurrence, sentinels.unicodeTask.recurrence, 'task recurrence');
  if (finalFeatures.taskDueTime) expectEqual(task.due_time, sentinels.unicodeTask.dueTime, 'task due time');

  const archived = await db.query('select archived_at from tasks where id = $1', [sentinels.archivedTask.id]);
  if (!archived.rows[0]?.archived_at) throw new Error('Quality fixture verification failed: archived task sentinel is not archived');

  const runbookResult = await db.query('select * from markdown_documents where id = $1', [sentinels.runbook.id]);
  const runbook = runbookResult.rows[0];
  if (!runbook) throw new Error('Quality fixture verification failed: runbook sentinel is missing');
  expectEqual(runbook.title, sentinels.runbook.title, 'runbook title');
  expectEqual(sha256(runbook.body), sentinels.runbook.bodyHash, 'runbook body hash');
  expectEqual(runbook.content_hash, sentinels.runbook.contentHash, 'runbook content hash');
  expectEqual(runbook.document_type, sentinels.runbook.documentType, 'runbook type');

  const taxonomy = await db.query('select document_type from markdown_documents where id = $1', [sentinels.taxonomyDocument.id]);
  expectEqual(taxonomy.rows[0]?.document_type, sentinels.taxonomyDocument.documentType, 'taxonomy migration sentinel');

  const fts = await db.query(
    `select d.id
       from markdown_documents_fts
       join markdown_documents d on d.rowid = markdown_documents_fts.rowid
      where markdown_documents_fts match $1`,
    ['qualitysentineldoc'],
  );
  if (!fts.rows.some((row) => row.id === sentinels.runbook.id)) {
    throw new Error('Quality fixture verification failed: FTS sentinel is missing');
  }

  const stale = await db.query(
    `select target_hash from document_links
      where source_document_id = $1 and target_document_id = $2 and relation = $3`,
    [sentinels.staleLink.sourceDocumentId, sentinels.staleLink.targetDocumentId, sentinels.staleLink.relation],
  );
  expectEqual(stale.rows[0]?.target_hash, sentinels.staleLink.targetHash, 'stale document link');

  const taskDocument = await db.query(
    'select 1 as linked from task_documents where task_id = $1 and document_id = $2',
    [sentinels.taskDocumentLink.taskId, sentinels.taskDocumentLink.documentId],
  );
  if (!taskDocument.rows[0]) throw new Error('Quality fixture verification failed: task-document sentinel link is missing');

  if (sentinels.run) {
    const run = await db.query(
      `select r.document_id, r.status,
              (select count(*) from runbook_run_steps s where s.run_id = r.id) as step_count,
              ${finalFeatures.durableRunChronicle
                ? '(select count(*) from runbook_run_events e where e.run_id = r.id)'
                : '0'} as event_count
         from runbook_runs r where r.id = $1`,
      [sentinels.run.id],
    );
    expectEqual(
      {
        documentId: run.rows[0]?.document_id,
        status: run.rows[0]?.status,
        stepCount: Number(run.rows[0]?.step_count),
        eventCount: Number(run.rows[0]?.event_count),
      },
      {
        documentId: sentinels.run.documentId,
        status: sentinels.run.status,
        stepCount: sentinels.run.stepCount,
        eventCount: sentinels.run.eventCount,
      },
      'runbook run sentinel',
    );
  }

  if (sentinels.externalRef) {
    const ref = await db.query('select document_id, url from document_external_refs where id = $1', [sentinels.externalRef.id]);
    expectEqual(
      { documentId: ref.rows[0]?.document_id, url: ref.rows[0]?.url },
      { documentId: sentinels.externalRef.documentId, url: sentinels.externalRef.url },
      'external-reference sentinel',
    );
  }

  const foreignKeys = await db.query('pragma foreign_key_check');
  expectEqual(foreignKeys.rows, [], 'foreign key check');
  return { ok: true, counts, states };
}

export async function verifyQualityFixture({ databaseFile, manifest, manifestFile } = {}) {
  if (!databaseFile) throw new Error('databaseFile is required for verification');
  const path = resolve(databaseFile);
  if (!existsSync(path)) throw new Error(`Quality fixture database does not exist: ${path}`);
  const parsedManifest = manifest || JSON.parse(readFileSync(resolve(manifestFile || `${path}.manifest.json`), 'utf8'));
  const db = createDb(path);
  try {
    return await verifyQualityFixtureDb(db, parsedManifest);
  } finally {
    await db.close();
  }
}

export async function createQualityFixture(options = {}) {
  const normalized = normalizeGenerationOptions(options);
  const migrations = migrationCatalog();
  const sourceBoundary = migrationBoundary(migrations.map((migration) => migration.version), normalized.through);
  const currentBoundary = migrations.at(-1);
  clearOwnedArtifacts(normalized.databaseFile, normalized.manifestFile, normalized.force);

  const db = createDb(normalized.databaseFile);
  let seeded;
  let finalBoundary = sourceBoundary;
  try {
    await runMigrations(db, {
      logger: SILENT_LOGGER,
      through: sourceBoundary.version,
    });
    const sourceFeatures = schemaFeatures(sourceBoundary.ordinal);
    const client = await db.connect();
    try {
      await client.query('begin immediate');
      seeded = await seedWorkspace(
        client,
        normalized.profile,
        sourceFeatures,
        normalized.clock,
        normalized.seed,
        normalized.embeddings,
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    } finally {
      client.release();
    }

    if (normalized.upgrade && sourceBoundary.ordinal < currentBoundary.ordinal) {
      await runMigrations(db, { logger: SILENT_LOGGER });
      finalBoundary = currentBoundary;
    }
    await normalizeFinalProjectMetadata(db, schemaFeatures(finalBoundary.ordinal), normalized.clock);
  } finally {
    await db.close();
  }

  const manifest = buildManifest({
    ...normalized,
    sourceBoundary,
    finalBoundary,
    migrations,
    seeded,
  });
  const verification = await verifyQualityFixture({ databaseFile: normalized.databaseFile, manifest });
  writeFileSync(`${normalized.manifestFile}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  renameSync(`${normalized.manifestFile}.tmp`, normalized.manifestFile);
  return {
    databaseFile: normalized.databaseFile,
    manifestFile: normalized.manifestFile,
    manifest,
    verification,
  };
}

export function parseQualityFixtureArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--upgrade') options.upgrade = true;
    else if (arg === '--embeddings') options.embeddings = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--verify') options.verify = true;
    else if (['--profile', '--output', '--manifest', '--through', '--clock', '--seed'].includes(arg)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      index += 1;
      if (arg === '--profile') options.profile = value;
      else if (arg === '--output') options.databaseFile = value;
      else if (arg === '--manifest') options.manifestFile = value;
      else if (arg === '--through') options.through = value;
      else if (arg === '--clock') options.clock = value;
      else if (arg === '--seed') options.seed = Number(value);
    } else {
      throw new Error(`Unknown quality fixture option: ${arg}`);
    }
  }
  return options;
}

const HELP = `Usage:
  npm run fixture:quality -- --profile ci|large --output <database> [options]
  npm run fixture:quality -- --verify --output <database> [--manifest <manifest>]

Options:
  --through <ordinal|filename>  Seed at a declared historical migration.
  --upgrade                     Upgrade a historical fixture through current.
  --embeddings                  Include deterministic embedding vectors.
  --clock <ISO-8601>            Override the fixed fixture clock.
  --seed <uint32>               Override the fixed random seed.
  --manifest <path>             Override the neighbouring manifest path.
  --force                       Replace only the exact output artifacts.
`;

async function main() {
  const options = parseQualityFixtureArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }
  if (!options.databaseFile) throw new Error('--output is required');
  if (options.verify) {
    const verification = await verifyQualityFixture(options);
    process.stdout.write(`${JSON.stringify({ databaseFile: resolve(options.databaseFile), ...verification }, null, 2)}\n`);
    return;
  }
  const result = await createQualityFixture(options);
  process.stdout.write(`${JSON.stringify({
    databaseFile: result.databaseFile,
    manifestFile: result.manifestFile,
    profile: result.manifest.profile,
    schema: result.manifest.schema,
    counts: result.manifest.expected.counts,
  }, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
