// Librarian routes (spec: docs/superpowers/specs/2026-09-23-librarian-design.md):
// recall telemetry (used signals, status, clear), the knowledge-gaps queue,
// recall counts, prune candidates, the consolidation pass that drafts
// proposals, the human decisions on them, the read-only report behind
// `prax doctor`, and the daily sweep.
//
// Proposal-only: nothing here supersedes, merges, edits or archives a source
// document except the approve route, which a person calls after verifying the
// proposal. The pure clustering lives in librarian.js.
import { createLibraryRepository, buildCreateDocument, buildSearchDocumentsSemantic, normalizeDocumentRow } from './libraryRepository.js';
import { createProjectsRepository } from './projectsRepository.js';
import { createDocumentLinksRepository } from './documentLinksRepository.js';
import { createEmbeddingService } from './embeddingService.js';
import { contentLength } from './contextPack.js';
import {
  selectCandidates, findDuplicatePairs, clusterPairs, classifyClusters, buildProposalDocument,
  EMBEDDING_MIN_SIM, SHINGLE_MIN_JACCARD,
} from './librarian.js';

export const SCHEDULE_SETTING = 'librarian_schedule_enabled';
export const LAST_SCHEDULED_RUN_SETTING = 'librarian_last_scheduled_run_at';
export const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly check
export const SCHEDULED_RUN_EVERY_MS = 24 * 60 * 60 * 1000; // daily pass

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AGENT_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

function isAgentOrigin(request) {
  return (request.headers['x-prax-origin'] ?? request.headers['x-moomora-origin']) === 'agent';
}

function agentFrom(request) {
  if (!isAgentOrigin(request)) return null;
  const raw = request.headers['x-prax-agent'];
  const value = String(Array.isArray(raw) ? raw[0] : raw ?? '').trim().toLowerCase();
  return AGENT_ID_RE.test(value) ? value : null;
}

function parseVector(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value) return null;
  try { const v = JSON.parse(value); return Array.isArray(v) ? v : null; } catch { return null; }
}

function parseIds(value) {
  try { const v = JSON.parse(value); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; }
}

function proposalFromRow(row) {
  return {
    documentId: row.document_id,
    clusterKey: row.cluster_key,
    projectId: row.project_id,
    sourceIds: parseIds(row.source_ids),
    method: row.method,
    status: row.status,
    createdAt: row.created_at,
    decidedAt: row.decided_at ?? null,
  };
}

const HUMAN_ONLY = { message: 'a person must make this decision; agent requests cannot approve or dismiss proposals', reason: 'human-approval-required' };

export async function registerLibrarianRoutes(app, options = {}) {
  const db = options.db ?? app.db ?? null;
  const repository = options.libraryRepository || app.libraryRepository || (db ? createLibraryRepository(db) : null);
  const projectsRepository = options.projectsRepository || app.projectsRepository || (db ? createProjectsRepository(db) : null);
  const linksRepository = options.documentLinksRepository || app.documentLinksRepository || (db ? createDocumentLinksRepository(db) : null);
  const telemetry = options.recallTelemetry !== undefined ? options.recallTelemetry : (app.recallTelemetry ?? null);
  const appSettings = options.appSettingsRepository || app.appSettingsRepository || null;
  const embedderProvider = options.embedderProvider ?? app.embedderProvider ?? null;
  const injectedEmbedder = options.embedder ?? null;
  const injectedEmbeddingService = options.embeddingService ?? app.embeddingService ?? null;

  async function resolveEmbedder() {
    if (injectedEmbedder) return injectedEmbedder;
    if (embedderProvider) {
      try { return await embedderProvider.getEmbedder(); } catch { return null; }
    }
    return app.embedder ?? null;
  }

  async function activeEmbedder() {
    const embedder = await resolveEmbedder();
    if (!embedder || !appSettings) return null;
    const enabled = await appSettings.getSetting('semantic_search_enabled', true).catch(() => false);
    return enabled ? embedder : null;
  }

  async function resolveProjectId(value) {
    if (value === undefined || value === null || value === '' || value === 'all') return undefined;
    if (!projectsRepository) return null;
    const project = await projectsRepository.resolveProject(String(value));
    return project ? project.id : null;
  }

  function telemetryUnavailable(reply) {
    reply.code(409);
    return telemetry
      ? { message: 'recall telemetry is turned off (PRAX_RECALL_TELEMETRY=off)', reason: 'telemetry-off' }
      : { message: 'recall telemetry needs the database', reason: 'unavailable' };
  }

  async function listProposals({ status } = {}) {
    if (!db) return [];
    const rows = status
      ? await db.query('select * from librarian_proposals where status = $1 order by created_at desc', [status])
      : await db.query('select * from librarian_proposals order by created_at desc');
    return rows.rows.map(proposalFromRow);
  }

  async function getProposal(id) {
    const rows = await db.query('select * from librarian_proposals where document_id = $1', [id]);
    return rows.rows[0] ? proposalFromRow(rows.rows[0]) : null;
  }

  // Current vectors (same backend, model and revision recall ranks) by id.
  async function loadVectors(embedder, projectId) {
    const q = buildSearchDocumentsSemantic(embedder.backend, { projectId, model: embedder.model });
    const rows = await db.query(q.text, q.values);
    const vectors = new Map();
    for (const row of rows.rows) {
      const vector = parseVector(row.embedding);
      if (vector) vectors.set(row.id, vector);
    }
    return vectors;
  }

  // Cluster the library. Read-only unless `write`, which files one proposal
  // per new cluster. Serialized so two runs never propose the same cluster.
  let running = Promise.resolve();
  function runLibrarian(args) {
    const next = running.then(() => runLibrarianOnce(args));
    running = next.catch(() => {});
    return next;
  }

  async function runLibrarianOnce({
    projectId, write = false, embeddingThreshold = EMBEDDING_MIN_SIM, shingleThreshold = SHINGLE_MIN_JACCARD, log,
  } = {}) {
    const docs = await repository.listDocuments({ projectId, status: 'active' });
    const { candidates, truncated, eligible } = selectCandidates(docs);
    const embedder = await activeEmbedder();
    let embeddings = false;
    let vectorCount = 0;
    if (embedder) {
      try {
        const vectors = await loadVectors(embedder, projectId);
        for (const doc of candidates) {
          const vector = vectors.get(doc.id);
          if (vector) { doc.vector = vector; vectorCount += 1; }
        }
        embeddings = true;
      } catch (err) {
        log?.warn?.({ err }, 'librarian could not read vectors; using shingles');
      }
    }
    const pairs = findDuplicatePairs(candidates, { embeddings, embeddingThreshold, shingleThreshold });
    const byId = new Map(candidates.map((doc) => [doc.id, doc]));
    const clusters = classifyClusters(clusterPairs(pairs), await listProposals());
    const created = [];
    if (write) {
      for (const cluster of clusters) {
        if (cluster.status !== 'new') continue;
        const proposal = await fileProposal(cluster, byId);
        if (!proposal) { cluster.status = 'proposed'; continue; }
        cluster.status = 'proposed';
        cluster.proposalId = proposal.id;
        created.push({ id: proposal.id, title: proposal.title, projectId: proposal.projectId, sourceIds: cluster.ids });
      }
    }
    const describe = (id) => {
      const doc = byId.get(id);
      return doc ? { id, title: doc.title, documentType: doc.documentType, verified: Boolean(doc.verified), updatedAt: doc.updatedAt || null } : { id };
    };
    return {
      method: embeddings ? 'embedding' : 'shingle',
      thresholds: { embedding: embeddingThreshold, shingle: shingleThreshold },
      documentsScanned: candidates.length,
      documentsEligible: eligible,
      documentsWithVectors: vectorCount,
      truncated,
      clusters: clusters.map((c) => ({
        key: c.key,
        status: c.status,
        method: c.method,
        proposalId: c.proposalId ?? null,
        projectId: byId.get(c.ids[0])?.projectId ?? null,
        documents: c.ids.map(describe),
        edges: c.edges.map((e) => ({ a: e.a, b: e.b, similarity: Number(e.similarity.toFixed(4)), method: e.method })),
        truncatedFrom: c.truncatedFrom,
      })),
      created,
    };
  }

  // One proposal document plus its librarian_proposals row, in one
  // transaction that re-checks the cluster key (a concurrent run or another
  // process may have filed it). Then derived-from links and the embedding,
  // both best-effort. Never a supersedes link.
  async function fileProposal(cluster, byId) {
    const draft = buildProposalDocument(cluster, byId);
    const client = await db.connect();
    let row;
    try {
      await client.query('begin immediate');
      try {
        const exists = await client.query('select 1 from librarian_proposals where cluster_key = $1', [cluster.key]);
        if (exists.rows.length) { await client.query('rollback'); return null; }
        const insert = buildCreateDocument({
          title: draft.title,
          body: draft.body,
          documentType: draft.documentType,
          projectId: draft.projectId,
          tags: draft.tags,
          sourceFilename: null,
          kind: draft.kind,
          updatedBy: draft.updatedBy,
          updatedByAgent: draft.updatedByAgent,
          verified: false,
        });
        row = (await client.query(insert.text, insert.values)).rows[0];
        await client.query(
          `insert into librarian_proposals (document_id, cluster_key, project_id, source_ids, method)
           values ($1, $2, $3, $4, $5)`,
          [row.id, cluster.key, draft.projectId, JSON.stringify(draft.sourceIds), cluster.method],
        );
        await client.query('commit');
      } catch (err) {
        await client.query('rollback').catch(() => {});
        throw err;
      }
    } finally {
      client.release();
    }
    const document = normalizeDocumentRow(row);
    for (const sourceId of draft.sourceIds) {
      await linksRepository?.linkDocuments(document.id, sourceId, 'derived-from', { updatedBy: 'agent', updatedByAgent: draft.updatedByAgent })
        .catch(() => {});
    }
    embedLater(document.id);
    return document;
  }

  async function embedLater(documentId) {
    try {
      const embedder = await activeEmbedder();
      if (!embedder) return;
      const service = injectedEmbeddingService || createEmbeddingService({ repository, embedder });
      Promise.resolve(service.embedDocument(documentId)).catch(() => {});
    } catch { /* the reindex path catches up */ }
  }

  async function healthCounts(projectId) {
    const active = await repository.listDocuments({ projectId, status: 'active' });
    const stale = linksRepository ? await linksRepository.listStaleDocuments(projectId) : [];
    return {
      needsReview: active.filter((d) => !d.verified).length,
      empty: active.filter((d) => contentLength(d.body) === 0).length,
      stale: (stale || []).length,
    };
  }

  async function indexCoverage() {
    const embedder = await activeEmbedder();
    if (!embedder || typeof repository.countEmbeddings !== 'function') return null;
    const counts = await repository.countEmbeddings(embedder.backend, embedder.model).catch(() => null);
    if (!counts) return null;
    const total = Number(counts.total || 0);
    const embedded = Number(counts.embedded || 0);
    return { total, embedded, pending: Math.max(0, total - embedded), backend: embedder.backend, model: embedder.model ?? null };
  }

  // The read-only report `prax doctor` prints. `warn` checks fail CI (exit 2);
  // `info` checks are listed only.
  async function buildReport({ projectId, log } = {}) {
    const [health, index, pass, proposals] = await Promise.all([
      healthCounts(projectId),
      indexCoverage(),
      runLibrarian({ projectId, write: false, log }),
      listProposals({ status: 'open' }),
    ]);
    const openProposals = projectId ? proposals.filter((p) => p.projectId === projectId) : proposals;
    let gaps = null;
    let prune = null;
    let telemetryStats = null;
    if (telemetry) {
      [gaps, prune, telemetryStats] = await Promise.all([
        telemetry.gaps(), telemetry.neverRecalled({ projectId }), telemetry.stats(),
      ]);
    }
    const unproposed = pass.clusters.filter((c) => c.status === 'new').length;
    const check = (id, level, count, message) => ({ id, level: count > 0 ? level : 'ok', count, message });
    const checks = [
      index
        ? check('index', 'warn', index.pending, `${index.pending} of ${index.total} documents have no current embedding`)
        : { id: 'index', level: 'info', count: 0, message: 'semantic search is off; duplicates were found by shingles' },
      check('stale', 'warn', health.stale, `${health.stale} stale derivation(s)`),
      check('empty', 'warn', health.empty, `${health.empty} empty document(s)`),
      check('duplicates', 'warn', unproposed, `${unproposed} duplicate cluster(s) without a proposal (run the librarian)`),
      check('proposals', 'info', openProposals.length, `${openProposals.length} open proposal(s) awaiting review`),
      check('needs-review', 'info', health.needsReview, `${health.needsReview} unverified document(s)`),
      telemetry && telemetry.enabled
        ? check('gaps', 'info', gaps.items.length, `${gaps.items.length} knowledge gap(s)`)
        : { id: 'gaps', level: 'info', count: 0, message: 'recall telemetry is off' },
      prune?.ready
        ? check('prune', 'info', prune.items.length, `${prune.items.length} agent memor(ies) never recalled in ${prune.coverageDays} days`)
        : { id: 'prune', level: 'ok', count: 0, message: `prune candidates need ${prune?.minAgeDays ?? 30} days of telemetry (have ${prune?.coverageDays ?? 0})` },
    ];
    const status = checks.some((c) => c.level === 'warn') ? 'warn' : 'ok';
    return {
      status,
      checks,
      health,
      index,
      clusters: pass,
      proposals: { open: openProposals.length },
      gaps: gaps ? { count: gaps.items.length, usedSignals: gaps.usedSignals, items: gaps.items.slice(0, 10) } : null,
      prune: prune ? { ready: prune.ready, coverageDays: prune.coverageDays, count: prune.items.length, items: prune.items.slice(0, 10) } : null,
      telemetry: telemetryStats,
    };
  }

  function requireDb(reply) {
    if (db && repository) return true;
    reply.code(409);
    reply.send({ message: 'the librarian needs the database', reason: 'unavailable' });
    return false;
  }

  function thresholdsFrom(source, reply) {
    const out = {};
    for (const [field, key] of [['embeddingThreshold', 'embeddingThreshold'], ['shingleThreshold', 'shingleThreshold']]) {
      if (source?.[field] === undefined) continue;
      const value = Number(source[field]);
      if (!Number.isFinite(value) || value < 0.5 || value > 0.999) {
        reply.code(400);
        return { error: { message: `${field} must be a number from 0.5 to 0.999` } };
      }
      out[key] = value;
    }
    return { thresholds: out };
  }

  // ---- telemetry -----------------------------------------------------------

  app.post('/api/library/telemetry/used', async (request, reply) => {
    const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body) ? request.body : {};
    const documentId = body.documentId;
    if (typeof documentId !== 'string' || !UUID_RE.test(documentId)) { reply.code(400); return { message: 'documentId is invalid' }; }
    if (!telemetry || !telemetry.enabled) return telemetryUnavailable(reply);
    const doc = await repository.getDocument(documentId);
    if (!doc) { reply.code(404); return { message: 'document not found' }; }
    const source = typeof body.source === 'string' && /^[a-z]{1,16}$/.test(body.source) ? body.source : 'cli';
    const use = await telemetry.recordUse({ documentId, agent: agentFrom(request), source });
    return { ...use, title: doc.title };
  });

  app.get('/api/library/telemetry', async (_request, reply) => {
    if (!telemetry) return telemetryUnavailable(reply);
    return telemetry.stats();
  });

  // Clearing is allowed even when recording is off: it is the documented way
  // to remove what was recorded.
  app.delete('/api/library/telemetry', async (_request, reply) => {
    if (!telemetry) return telemetryUnavailable(reply);
    return { cleared: await telemetry.clear() };
  });

  // ---- librarian reads ------------------------------------------------------

  app.get('/api/library/librarian/gaps', async (_request, reply) => {
    if (!telemetry) return telemetryUnavailable(reply);
    return { ...(await telemetry.gaps()), enabled: telemetry.enabled };
  });

  app.get('/api/library/librarian/recall-counts', async (_request, reply) => {
    if (!telemetry) return telemetryUnavailable(reply);
    return telemetry.recallCounts();
  });

  app.get('/api/library/librarian/prune-candidates', async (request, reply) => {
    if (!telemetry) return telemetryUnavailable(reply);
    const projectId = await resolveProjectId(request.query.project);
    if (projectId === null) { reply.code(400); return { message: 'project is invalid' }; }
    return telemetry.neverRecalled({ projectId });
  });

  app.get('/api/library/librarian/proposals', async (request, reply) => {
    if (!requireDb(reply)) return reply;
    const status = request.query.status;
    if (status !== undefined && !['open', 'approved', 'dismissed'].includes(status)) {
      reply.code(400); return { message: 'status must be open, approved or dismissed' };
    }
    const proposals = await listProposals({ status });
    const items = [];
    for (const p of proposals) {
      const doc = await repository.getDocument(p.documentId);
      items.push({
        ...p,
        title: doc?.title ?? null,
        verified: Boolean(doc?.verified),
        archived: Boolean(doc?.archivedAt),
        revision: doc?.revision ?? null,
      });
    }
    return { items };
  });

  app.get('/api/library/librarian/report', async (request, reply) => {
    if (!requireDb(reply)) return reply;
    const projectId = await resolveProjectId(request.query.project);
    if (projectId === null) { reply.code(400); return { message: 'project is invalid' }; }
    return buildReport({ projectId, log: request.log });
  });

  // ---- the pass ---------------------------------------------------------------

  app.post('/api/library/librarian/run', async (request, reply) => {
    if (!requireDb(reply)) return reply;
    const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body) ? request.body : {};
    const projectId = await resolveProjectId(body.project);
    if (projectId === null) { reply.code(400); return { message: 'project is invalid' }; }
    const parsed = thresholdsFrom(body, reply);
    if (parsed.error) return parsed.error;
    const result = await runLibrarian({ projectId, write: true, ...parsed.thresholds, log: request.log });
    if (telemetry) await telemetry.prune().catch(() => {});
    return result;
  });

  // ---- decisions (a person only) ------------------------------------------------

  app.post('/api/library/librarian/proposals/:id/approve', async (request, reply) => {
    const id = request.params.id;
    if (!UUID_RE.test(id)) { reply.code(400); return { message: 'proposal id is invalid' }; }
    if (!requireDb(reply)) return reply;
    if (isAgentOrigin(request)) { reply.code(403); return HUMAN_ONLY; }
    const proposal = await getProposal(id);
    if (!proposal) { reply.code(404); return { message: 'proposal not found' }; }
    if (proposal.status === 'approved') return { proposal, results: [], replayed: true };
    if (proposal.status !== 'open') { reply.code(409); return { message: `the proposal was ${proposal.status}`, reason: 'not-open' }; }
    const doc = await repository.getDocument(id);
    if (!doc || doc.archivedAt) { reply.code(409); return { message: 'the proposal document is archived or gone', reason: 'proposal-archived' }; }
    if (!doc.verified) {
      reply.code(409);
      return { message: 'review and verify the proposal before approving it', reason: 'verify-first' };
    }
    const results = [];
    for (const sourceId of proposal.sourceIds) {
      const source = await repository.getDocument(sourceId);
      if (!source) { results.push({ id: sourceId, outcome: 'missing' }); continue; }
      if (source.archivedAt) { results.push({ id: sourceId, outcome: 'archived' }); continue; }
      const link = await linksRepository.linkDocuments(id, sourceId, 'supersedes', { updatedBy: 'user', updatedByAgent: null });
      if (link.cycle) results.push({ id: sourceId, outcome: 'cycle' });
      else if (!link.linked) results.push({ id: sourceId, outcome: 'missing' });
      else results.push({ id: sourceId, outcome: link.alreadyLinked ? 'already-superseded' : 'superseded' });
    }
    await db.query(
      "update librarian_proposals set status = 'approved', decided_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') where document_id = $1 and status = 'open'",
      [id],
    );
    return { proposal: await getProposal(id), results };
  });

  app.post('/api/library/librarian/proposals/:id/dismiss', async (request, reply) => {
    const id = request.params.id;
    if (!UUID_RE.test(id)) { reply.code(400); return { message: 'proposal id is invalid' }; }
    if (!requireDb(reply)) return reply;
    if (isAgentOrigin(request)) { reply.code(403); return HUMAN_ONLY; }
    const proposal = await getProposal(id);
    if (!proposal) { reply.code(404); return { message: 'proposal not found' }; }
    if (proposal.status === 'dismissed') return { proposal, replayed: true };
    if (proposal.status !== 'open') { reply.code(409); return { message: `the proposal was ${proposal.status}`, reason: 'not-open' }; }
    await db.query(
      "update librarian_proposals set status = 'dismissed', decided_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') where document_id = $1 and status = 'open'",
      [id],
    );
    await repository.archiveDocument(id);
    return { proposal: await getProposal(id) };
  });

  // ---- schedule -------------------------------------------------------------------

  app.get('/api/library/librarian/settings', async () => ({
    scheduleEnabled: Boolean(await appSettings?.getSetting(SCHEDULE_SETTING, false).catch(() => false)),
    lastScheduledRunAt: (await appSettings?.getSetting(LAST_SCHEDULED_RUN_SETTING, null).catch(() => null)) ?? null,
    telemetryEnabled: Boolean(telemetry?.enabled),
  }));

  app.put('/api/library/librarian/settings', async (request, reply) => {
    const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body) ? request.body : {};
    if (typeof body.scheduleEnabled !== 'boolean') { reply.code(400); return { message: 'scheduleEnabled must be true or false' }; }
    if (!appSettings) { reply.code(409); return { message: 'settings need the database', reason: 'unavailable' }; }
    await appSettings.putSetting(SCHEDULE_SETTING, body.scheduleEnabled);
    return {
      scheduleEnabled: body.scheduleEnabled,
      lastScheduledRunAt: (await appSettings.getSetting(LAST_SCHEDULED_RUN_SETTING, null).catch(() => null)) ?? null,
      telemetryEnabled: Boolean(telemetry?.enabled),
    };
  });

  // The daily sweep, after the Google Calendar reconcile pattern: an unref'd
  // timer stopped on close. Each hourly tick prunes telemetry; once a day,
  // and only when the person turned the schedule on, it runs the pass.
  async function sweep(now = Date.now()) {
    if (telemetry) await telemetry.prune().catch(() => {});
    if (!db || !repository || !appSettings) return { ran: false };
    const enabled = await appSettings.getSetting(SCHEDULE_SETTING, false).catch(() => false);
    if (!enabled) return { ran: false };
    const last = Date.parse(await appSettings.getSetting(LAST_SCHEDULED_RUN_SETTING, '').catch(() => '') || '');
    if (Number.isFinite(last) && now - last < SCHEDULED_RUN_EVERY_MS) return { ran: false };
    await appSettings.putSetting(LAST_SCHEDULED_RUN_SETTING, new Date(now).toISOString());
    const result = await runLibrarian({ write: true, log: app.log });
    return { ran: true, created: result.created.length };
  }
  app.decorate('librarianSweep', sweep);
  if (db && options.librarianSweep !== false) {
    const timer = setInterval(() => { sweep().catch((err) => app.log?.warn?.({ err }, 'librarian sweep failed')); }, options.librarianSweepIntervalMs ?? SWEEP_INTERVAL_MS);
    timer.unref?.();
    app.addHook('onClose', async () => clearInterval(timer));
  }
}
