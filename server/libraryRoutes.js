import { ZipArchive } from 'archiver';
import { createLibraryRepository } from './libraryRepository.js';
import { createProjectsRepository } from './projectsRepository.js';
import { createTasksRepository } from './tasksRepository.js';
import { createDocumentLinksRepository, DOCUMENT_LINK_RELATIONS } from './documentLinksRepository.js';
import { createRunbookRunsRepository } from './runbookRunsRepository.js';
import { parseRunbookSteps } from './runbookSteps.js';
import {
  documentFilename,
  renderDocumentMarkdown,
  dedupeFilenames,
  libraryArchiveFilename,
  buildLinksFromGroups,
} from './libraryExport.js';
import { createEmbeddingService } from './embeddingService.js';
import { buildContextPack, renderContextPackMarkdown } from './contextPack.js';
import { buildAskMessages, collectSources } from './askLibrary.js';

const DOCUMENT_TYPES = new Set(['runbook', 'note']);
const DOCUMENT_KINDS = new Set(['source', 'synthesized']);
// 'project' (slug-or-id) is the client-facing field; 'projectId' is resolved
// server-side and injected into the patch by the handler — never accepted raw.
const PATCH_FIELDS = ['title', 'body', 'documentType', 'project', 'tags', 'sourceFilename', 'kind'];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isValidUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function originFrom(request) {
  // x-moomora-origin is the pre-rename header; still accepted so older
  // agents/CLIs keep stamping provenance correctly.
  const origin = request.headers['x-prax-origin'] ?? request.headers['x-moomora-origin'];
  return origin === 'agent' ? 'agent' : 'user';
}

function isValidTags(value) {
  return value === undefined || (Array.isArray(value) && value.every(tag => typeof tag === 'string' && tag.trim().length > 0));
}

function validateDocumentPayload(payload, { partial = false } = {}) {
  if (!isPlainObject(payload)) return 'document payload is invalid';
  if (!partial || payload.title !== undefined) {
    if (typeof payload.title !== 'string' || payload.title.trim().length === 0) return 'title is required';
  }
  if (!partial || payload.body !== undefined) {
    if (typeof payload.body !== 'string') return 'body is required';
  }
  if (!partial || payload.documentType !== undefined) {
    if (!DOCUMENT_TYPES.has(payload.documentType)) return 'documentType is invalid';
  }
  if (!partial) {
    if (typeof payload.project !== 'string' || payload.project.trim().length === 0) return 'project is required';
  } else if (payload.project !== undefined) {
    if (typeof payload.project !== 'string' || payload.project.trim().length === 0) return 'project is invalid';
  }
  if (!isValidTags(payload.tags)) return 'tags are invalid';
  if (payload.sourceFilename !== undefined && payload.sourceFilename !== null && typeof payload.sourceFilename !== 'string') {
    return 'sourceFilename is invalid';
  }
  if (payload.kind !== undefined && !DOCUMENT_KINDS.has(payload.kind)) return 'kind is invalid';
  if (partial && !PATCH_FIELDS.some(field => payload[field] !== undefined)) return 'document update is empty';
  return null;
}

function cleanTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags.map(tag => tag.trim()).filter(Boolean);
}

function cleanDocumentPayload(payload) {
  return {
    title: payload.title.trim(),
    body: payload.body,
    documentType: payload.documentType,
    projectId: payload.projectId,
    tags: cleanTags(payload.tags),
    sourceFilename: payload.sourceFilename ? payload.sourceFilename.trim() : null,
    ...(payload.kind !== undefined ? { kind: payload.kind } : {}),
  };
}

function cleanDocumentPatchPayload(payload) {
  return PATCH_FIELDS.reduce((patch, field) => {
    if (field === 'project') return patch; // slug only — projectId is resolved separately
    if (payload[field] === undefined) return patch;
    if (field === 'title') patch.title = payload.title.trim();
    else if (field === 'tags') patch.tags = cleanTags(payload.tags);
    else if (field === 'sourceFilename') patch.sourceFilename = payload.sourceFilename ? payload.sourceFilename.trim() : null;
    else patch[field] = payload[field];
    return patch;
  }, {});
}

export async function registerLibraryRoutes(app, options = {}) {
  const repository = options.libraryRepository || app.libraryRepository || createLibraryRepository(app.db);
  const projectsRepository = options.projectsRepository || app.projectsRepository || createProjectsRepository(app.db);
  const tasksRepository = options.tasksRepository || app.tasksRepository || (app.db ? createTasksRepository(app.db) : null);
  const runbookRunsRepository = options.runbookRunsRepository || app.runbookRunsRepository || (app.db ? createRunbookRunsRepository(app.db) : null);
  const documentLinksRepository = options.documentLinksRepository || app.documentLinksRepository || createDocumentLinksRepository(app.db);

  // Behavioral tests may inject an embedder/embeddingService directly — those
  // win. Otherwise the runtime provider resolves the current settings (cached
  // until they change); the boot-time decorated embedder stays as a fallback.
  const injectedEmbedder = options.embedder ?? null;
  const injectedEmbeddingService = options.embeddingService ?? app.embeddingService ?? null;
  const embedderProvider = options.embedderProvider ?? app.embedderProvider ?? null;
  const chatProvider = options.chatProvider ?? app.chatProvider ?? null;
  const injectedChat = options.chat ?? null;
  const appSettings = options.appSettingsRepository || app.appSettingsRepository;

  async function resolveEmbedder() {
    if (injectedEmbedder) return injectedEmbedder;
    if (embedderProvider) {
      try {
        return await embedderProvider.getEmbedder();
      } catch {
        return null;
      }
    }
    return app.embedder ?? null;
  }

  // The embedding service is bound to whichever embedder is current, so it is
  // built per use (cheap: a plain object) unless one was injected.
  function embeddingServiceFor(embedder) {
    if (injectedEmbeddingService) return injectedEmbeddingService;
    if (!embedder) return null;
    return createEmbeddingService({ repository, embedder });
  }

  // The active chat model (for grounded answers), mirroring resolveEmbedder:
  // injected wins, then the runtime provider, else null (feature degrades).
  async function resolveChat() {
    if (injectedChat) return injectedChat;
    if (chatProvider) {
      try { return await chatProvider.getChat(); } catch { return null; }
    }
    return null;
  }

  async function semanticEnabled() {
    if (!appSettings) return false;
    // Never throw from the gate: it runs on the document write path (the
    // un-awaited embed trigger), so a transient settings-read failure must not
    // be able to surface as a 500 on a create/update. Treat a failed read as
    // "not active" rather than propagating.
    return Boolean(await appSettings.getSetting('semantic_search_enabled', true).catch(() => false));
  }

  // Fires the fire-and-forget embed for a written document when semantic
  // search is configured + enabled. Deliberately not awaited by callers.
  async function embedOnWrite(documentId) {
    const embedder = await resolveEmbedder();
    if (!embedder || !(await semanticEnabled())) return;
    const service = embeddingServiceFor(embedder);
    if (service) service.embedDocument(documentId); // not awaited
  }

  function toRef(doc) {
    return {
      id: doc.id,
      title: doc.title,
      documentType: doc.documentType,
      projectId: doc.projectId,
      tags: doc.tags || [],
      verified: Boolean(doc.verified),
      status: doc.status || 'active',
      snippet: String(doc.body || '').slice(0, 200),
      // The semantic ranker computes a real cosine similarity per hit; surface
      // it so the client can show "why it matched" honestly. Omitted on the
      // keyword/archive paths, where doc.similarity is undefined.
      ...(Number.isFinite(doc.similarity) ? { similarity: doc.similarity } : {}),
    };
  }

  async function resolveProjectId(value) {
    if (value === undefined || value === null || value === '') return undefined;
    const project = await projectsRepository.resolveProject(String(value));
    return project ? project.id : null; // null signals "given but not found"
  }

  app.get('/api/library/export', async (request, reply) => {
    const projectParam = request.query.project;
    let projectId;
    let scope = 'all';

    if (projectParam && projectParam !== 'all') {
      const resolved = await projectsRepository.resolveProject(String(projectParam));
      if (!resolved) {
        reply.code(400);
        return { message: 'project is invalid' };
      }
      projectId = resolved.id;
      scope = resolved.slug;
    }

    const documents = await repository.listActiveDocumentsForExport({ projectId });
    const isAll = scope === 'all';

    const entries = documents.map((doc) => ({
      doc,
      path: isAll ? `${doc.projectSlug || 'unknown'}/` : '',
      filename: documentFilename(doc),
    }));
    dedupeFilenames(entries);

    const docIds = entries.map((e) => e.doc.id);
    const outboundByDocId = await documentLinksRepository.listOutboundLinksForDocuments(docIds);
    const refScope = isAll ? 'all' : 'single-project';

    const filename = libraryArchiveFilename(scope);
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);

    const archive = new ZipArchive({ zlib: { level: 6 } });
    archive.on('error', (err) => {
      request.log.error({ err }, 'library export archive error');
    });

    for (const entry of entries) {
      const groups = outboundByDocId.get(entry.doc.id) || { 'derived-from': [], supersedes: [] };
      const links = buildLinksFromGroups(groups, { scope: refScope, currentDocProjectSlug: entry.doc.projectSlug });
      const content = renderDocumentMarkdown(entry.doc, entry.doc.projectSlug, links);
      archive.append(content, { name: `${entry.path}${entry.filename}` });
    }
    archive.finalize().catch((err) => {
      request.log.error({ err }, 'library export archive finalize rejected');
    });

    return reply.send(archive);
  });

  app.get('/api/library/documents', async (request, reply) => {
    if (request.query.kind !== undefined && !DOCUMENT_KINDS.has(request.query.kind)) {
      reply.code(400);
      return { message: 'kind is invalid' };
    }
    let projectId;
    if (request.query.project && request.query.project !== 'all') {
      projectId = await resolveProjectId(request.query.project);
      if (projectId === null) { reply.code(400); return { message: 'project is invalid' }; }
    }
    return repository.listDocuments({ ...request.query, projectId });
  });

  app.get('/api/library/documents/semantic-search', async (request, reply) => {
    const embedder = await resolveEmbedder();
    if (!embedder || !(await semanticEnabled())) {
      reply.code(409);
      return { message: 'semantic search is not enabled' };
    }
    const q = request.query.q;
    if (!q || !String(q).trim()) { reply.code(400); return { message: 'q is required' }; }

    let projectId;
    if (request.query.project && request.query.project !== 'all') {
      projectId = await resolveProjectId(request.query.project);
      if (projectId === null) { reply.code(400); return { message: 'project is invalid' }; }
    }

    const includeRetired = request.query.all === 'true';
    let docs;
    try {
      const { vector } = await embedder.embed(String(q), { query: true });
      const search = app.embeddingSearch || {};
      docs = await repository.searchDocumentsSemantic(vector, embedder.backend, {
        projectId,
        limit: 20,
        minSimilarity: search.minSimilarity,
        topDrop: search.topDrop,
        includeRetired,
      });
    } catch (err) {
      // Feature is configured + enabled, but the backend is unreachable or
      // errored. Degrade cleanly rather than 500 — the rest of the feature
      // gates the same way. The error message never carries secrets (URLs /
      // keys are never in the embedder's thrown messages), but we don't echo
      // it to the client regardless.
      request.log.error({ err }, 'semantic search embed failed');
      reply.code(503);
      return { message: 'semantic search backend is unavailable' };
    }
    return docs.map(toRef);
  });

  app.post('/api/library/embeddings/reindex', async (request, reply) => {
    const embedder = await resolveEmbedder();
    if (!embedder) { reply.code(409); return { message: 'semantic search is not configured' }; }
    const service = embeddingServiceFor(embedder);
    if (!service) { reply.code(409); return { message: 'semantic search is not configured' }; }
    const force = request.query.force === 'true' || request.query.force === true;
    const result = await service.reindex({ force });
    return result;
  });

  app.post('/api/library/documents', async (request, reply) => {
    const validationError = validateDocumentPayload(request.body);
    if (validationError) {
      reply.code(400);
      return { message: validationError };
    }

    const resolvedId = await resolveProjectId(request.body.project);
    if (resolvedId === null) { reply.code(400); return { message: 'project is invalid' }; }
    request.body.projectId = resolvedId;

    reply.code(201);
    const created = await repository.createDocument({ ...cleanDocumentPayload(request.body), updatedBy: originFrom(request) });
    await embedOnWrite(created.id); // gate awaited; the embed itself is not
    return created;
  });

  app.patch('/api/library/documents/:id/restore', async (request, reply) => {
    if (!isValidUuid(request.params.id)) {
      reply.code(400);
      return { message: 'document id is invalid' };
    }

    const document = await repository.restoreDocument(request.params.id);
    if (!document) {
      reply.code(404);
      return { message: 'document not found' };
    }
    return document;
  });

  app.delete('/api/library/documents/:id/permanent', async (request, reply) => {
    if (!isValidUuid(request.params.id)) {
      reply.code(400);
      return { message: 'document id is invalid' };
    }

    const document = await repository.deleteDocument(request.params.id);
    if (!document) {
      reply.code(404);
      return { message: 'document not found' };
    }
    return document;
  });

  app.patch('/api/library/documents/:id', async (request, reply) => {
    if (!isValidUuid(request.params.id)) {
      reply.code(400);
      return { message: 'document id is invalid' };
    }

    const validationError = validateDocumentPayload(request.body, { partial: true });
    if (validationError) {
      reply.code(400);
      return { message: validationError };
    }

    const fields = cleanDocumentPatchPayload(request.body);
    if (Object.prototype.hasOwnProperty.call(request.body, 'project')) {
      const resolvedId = await resolveProjectId(request.body.project);
      if (resolvedId === null) { reply.code(400); return { message: 'project is invalid' }; }
      fields.projectId = resolvedId;
    }

    fields.updatedBy = originFrom(request);
    const document = await repository.updateDocument(request.params.id, fields);
    if (!document) {
      reply.code(404);
      return { message: 'document not found' };
    }
    if (Object.prototype.hasOwnProperty.call(request.body, 'title') || Object.prototype.hasOwnProperty.call(request.body, 'body')) {
      await embedOnWrite(document.id); // gate awaited; the embed itself is not
    }
    return document;
  });

  app.delete('/api/library/documents/:id', async (request, reply) => {
    if (!isValidUuid(request.params.id)) {
      reply.code(400);
      return { message: 'document id is invalid' };
    }

    const document = await repository.archiveDocument(request.params.id);
    if (!document) {
      reply.code(404);
      return { message: 'document not found' };
    }
    return document;
  });

  app.get('/api/library/documents/:id', async (request, reply) => {
    if (!isValidUuid(request.params.id)) { reply.code(400); return { message: 'document id is invalid' }; }
    const document = await repository.getDocument(request.params.id);
    if (!document) { reply.code(404); return { message: 'document not found' }; }
    return document;
  });

  app.get('/api/library/documents/:id/links', async (request, reply) => {
    if (!isValidUuid(request.params.id)) { reply.code(400); return { message: 'document id is invalid' }; }
    const direction = request.query.direction || 'both';
    if (!['outbound', 'inbound', 'both'].includes(direction)) { reply.code(400); return { message: 'direction is invalid' }; }
    return documentLinksRepository.listDocumentLinks(request.params.id, direction);
  });

  // Non-archived tasks that reference this document — the editor's backlinks.
  app.get('/api/library/documents/:id/tasks', async (request, reply) => {
    if (!isValidUuid(request.params.id)) { reply.code(400); return { message: 'document id is invalid' }; }
    if (typeof tasksRepository?.listTasksForDocument !== 'function') return [];
    return tasksRepository.listTasksForDocument(request.params.id);
  });

  // ---- Runbook execution (runs) ----------------------------------------------
  // A run snapshots the document's checkbox steps at start time; checking them
  // off timestamps an incident chronicle without touching the source document.

  app.post('/api/library/documents/:id/runs', async (request, reply) => {
    if (!isValidUuid(request.params.id)) { reply.code(400); return { message: 'document id is invalid' }; }
    if (!runbookRunsRepository) { reply.code(409); return { message: 'runs are not available' }; }
    const doc = await repository.getDocument(request.params.id);
    if (!doc || doc.archivedAt) { reply.code(404); return { message: 'document not found' }; }
    const steps = parseRunbookSteps(doc.body);
    const title = isPlainObject(request.body) && typeof request.body.title === 'string' ? request.body.title.trim() : '';
    const run = await runbookRunsRepository.createRun({ documentId: doc.id, title, startedBy: originFrom(request), steps });
    reply.code(201);
    return run;
  });

  app.get('/api/library/documents/:id/runs', async (request, reply) => {
    if (!isValidUuid(request.params.id)) { reply.code(400); return { message: 'document id is invalid' }; }
    if (!runbookRunsRepository) return [];
    return runbookRunsRepository.listRunsForDocument(request.params.id);
  });

  app.get('/api/library/runs/:runId', async (request, reply) => {
    if (!isValidUuid(request.params.runId)) { reply.code(400); return { message: 'run id is invalid' }; }
    if (!runbookRunsRepository) { reply.code(404); return { message: 'run not found' }; }
    const run = await runbookRunsRepository.getRun(request.params.runId);
    if (!run) { reply.code(404); return { message: 'run not found' }; }
    return run;
  });

  app.patch('/api/library/runs/:runId/steps/:stepId', async (request, reply) => {
    if (!isValidUuid(request.params.runId) || !isValidUuid(request.params.stepId)) {
      reply.code(400); return { message: 'id is invalid' };
    }
    if (!runbookRunsRepository) { reply.code(404); return { message: 'run not found' }; }
    if (!isPlainObject(request.body) || typeof request.body.checked !== 'boolean') {
      reply.code(400); return { message: 'checked (boolean) is required' };
    }
    const step = await runbookRunsRepository.setStepChecked(request.params.runId, request.params.stepId, {
      checked: request.body.checked, checkedBy: originFrom(request),
    });
    if (!step) { reply.code(404); return { message: 'step not found' }; }
    return step;
  });

  app.patch('/api/library/runs/:runId', async (request, reply) => {
    if (!isValidUuid(request.params.runId)) { reply.code(400); return { message: 'run id is invalid' }; }
    if (!runbookRunsRepository) { reply.code(404); return { message: 'run not found' }; }
    const status = isPlainObject(request.body) ? request.body.status : undefined;
    if (!['running', 'completed', 'aborted'].includes(status)) {
      reply.code(400); return { message: 'status must be running, completed, or aborted' };
    }
    const run = await runbookRunsRepository.setRunStatus(request.params.runId, status);
    if (!run) { reply.code(404); return { message: 'run not found' }; }
    return run;
  });

  // "More like this" — documents most similar to this one by embedding. Reuses
  // the document's own stored vector (no new embedding call). Empty when
  // semantic search is off or the document has no embedding.
  app.get('/api/library/documents/:id/similar', async (request, reply) => {
    if (!isValidUuid(request.params.id)) { reply.code(400); return { message: 'document id is invalid' }; }
    const embedder = await resolveEmbedder();
    if (!embedder || !(await semanticEnabled())) return [];
    const search = app.embeddingSearch || {};
    const docs = await repository.findSimilarDocuments(request.params.id, embedder.backend, {
      limit: 5,
      minSimilarity: search.minSimilarity,
      topDrop: search.topDrop,
    });
    return docs.map(toRef);
  });

  app.get('/api/library/documents/:id/export', async (request, reply) => {
    if (!isValidUuid(request.params.id)) { reply.code(400); return { message: 'document id is invalid' }; }
    const doc = await repository.getDocument(request.params.id);
    if (!doc || doc.archivedAt) { reply.code(404); return { message: 'document not found' }; }

    // The by-id query does not join projects, so projectSlug may be absent.
    // Resolve it from projectId when missing.
    if (!doc.projectSlug) {
      const project = await projectsRepository.resolveProject(doc.projectId);
      doc.projectSlug = project ? project.slug : 'unknown';
    }

    const outboundByDocId = await documentLinksRepository.listOutboundLinksForDocuments([doc.id]);
    const groups = outboundByDocId.get(doc.id) || { 'derived-from': [], supersedes: [] };
    const links = buildLinksFromGroups(groups, { scope: 'single-project', currentDocProjectSlug: doc.projectSlug });
    const filename = documentFilename(doc);
    const content = renderDocumentMarkdown(doc, doc.projectSlug, links);
    reply.header('Content-Type', 'text/markdown; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    return content;
  });

  app.post('/api/library/documents/:id/verify', async (request, reply) => {
    if (!isValidUuid(request.params.id)) { reply.code(400); return { message: 'document id is invalid' }; }
    const body = isPlainObject(request.body) ? request.body : {};
    if (typeof body.verified !== 'boolean') { reply.code(400); return { message: 'verified must be a boolean' }; }
    const verifiedBy = body.verified ? (typeof body.as === 'string' && body.as.trim() ? body.as.trim() : 'user') : null;
    const document = await repository.verifyDocument(request.params.id, { verified: body.verified, verifiedBy });
    if (!document) { reply.code(404); return { message: 'document not found' }; }
    return document;
  });

  app.post('/api/library/documents/:id/supersede', async (request, reply) => {
    const oldId = request.params.id;
    const newId = isPlainObject(request.body) ? request.body.supersededBy : undefined;
    if (!isValidUuid(oldId)) { reply.code(400); return { message: 'document id is invalid' }; }
    if (!isValidUuid(newId)) { reply.code(400); return { message: 'supersededBy is invalid' }; }
    if (oldId === newId) { reply.code(400); return { message: 'a document cannot supersede itself' }; }
    const link = await documentLinksRepository.linkDocuments(newId, oldId, 'supersedes');
    if (!link.linked) { reply.code(404); return { message: 'document not found' }; }
    await repository.markDocumentSuperseded(oldId);
    return repository.getDocument(oldId);
  });

  app.get('/api/projects/:idOrSlug/context-pack', async (request, reply) => {
    const project = await projectsRepository.resolveProject(String(request.params.idOrSlug));
    if (!project) { reply.code(404); return { message: 'project not found' }; }

    const rawLimit = Number(request.query.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 50) : 12;
    const query = request.query.query ? String(request.query.query) : '';

    let docs = [];
    const embedder = query ? await resolveEmbedder() : null;
    if (query && embedder && await semanticEnabled()) {
      try {
        const { vector } = await embedder.embed(query, { query: true });
        const search = app.embeddingSearch || {};
        docs = await repository.searchDocumentsSemantic(vector, embedder.backend, {
          projectId: project.id,
          limit: 50,
          minSimilarity: search.minSimilarity,
          topDrop: search.topDrop,
        });
      } catch (err) {
        // Degrade to recency rather than fail — keyword/recency always works.
        request.log.error({ err }, 'context-pack semantic embed failed');
        docs = [];
      }
    }
    if (docs.length === 0) {
      docs = await repository.listDocuments({ projectId: project.id, status: 'active' });
    }

    const pack = buildContextPack(docs, { project, query, limit });
    if (request.query.format === 'json') return pack;
    reply.header('Content-Type', 'text/markdown; charset=utf-8');
    return renderContextPackMarkdown(pack);
  });

  // Library-wide, query-scoped context pack: "what do we know about X?" without
  // needing document ids or a project. Semantic when configured (keyword FTS
  // fallback otherwise), optionally narrowed to one project. Returns markdown by
  // default (format=json for the structured pack) — the agent-facing MCP tool
  // consumes the markdown.
  app.get('/api/library/context-pack', async (request, reply) => {
    const query = request.query.q ? String(request.query.q).trim() : '';
    if (!query) { reply.code(400); return { message: 'q is required' }; }

    let project = null;
    let projectId;
    if (request.query.project && request.query.project !== 'all') {
      project = await projectsRepository.resolveProject(String(request.query.project));
      if (!project) { reply.code(400); return { message: 'project is invalid' }; }
      projectId = project.id;
    }

    const rawLimit = Number(request.query.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 50) : 12;

    let docs = [];
    const embedder = await resolveEmbedder();
    if (embedder && await semanticEnabled()) {
      try {
        const { vector } = await embedder.embed(query, { query: true });
        const search = app.embeddingSearch || {};
        docs = await repository.searchDocumentsSemantic(vector, embedder.backend, {
          projectId, limit: 50, minSimilarity: search.minSimilarity, topDrop: search.topDrop,
        });
      } catch (err) {
        // Degrade to keyword rather than fail — FTS always works.
        request.log.error({ err }, 'library context-pack semantic embed failed');
        docs = [];
      }
    }
    if (docs.length === 0) {
      docs = await repository.listDocuments({ projectId, status: 'active', q: query });
    }

    const pack = buildContextPack(docs, { project, query, limit });
    if (request.query.format === 'json') return pack;
    reply.header('Content-Type', 'text/markdown; charset=utf-8');
    return renderContextPackMarkdown(pack);
  });

  // Ask Prax: retrieve the trust-aware context pack (same pipeline as the pack
  // route) and, when a chat model is configured, generate a grounded, cited
  // answer from it. Degrades to returning the raw pack (what "Brief me" shows)
  // when no chat model is set or generation fails — never 500s on the AI path.
  app.post('/api/library/ask', async (request, reply) => {
    const body = isPlainObject(request.body) ? request.body : null;
    if (!body) { reply.code(400); return { message: 'body is invalid' }; }
    const query = typeof body.q === 'string' ? body.q.trim()
      : (typeof body.query === 'string' ? body.query.trim() : '');
    if (!query) { reply.code(400); return { message: 'q is required' }; }

    let project = null;
    let projectId;
    if (body.project && body.project !== 'all') {
      project = await projectsRepository.resolveProject(String(body.project));
      if (!project) { reply.code(400); return { message: 'project is invalid' }; }
      projectId = project.id;
    }
    const rawLimit = Number(body.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 50) : 12;

    let docs = [];
    const embedder = await resolveEmbedder();
    if (embedder && await semanticEnabled()) {
      try {
        const { vector } = await embedder.embed(query, { query: true });
        const search = app.embeddingSearch || {};
        docs = await repository.searchDocumentsSemantic(vector, embedder.backend, {
          projectId, limit: 50, minSimilarity: search.minSimilarity, topDrop: search.topDrop,
        });
      } catch (err) {
        request.log.error({ err }, 'library ask semantic embed failed');
        docs = [];
      }
    }
    if (docs.length === 0) {
      docs = await repository.listDocuments({ projectId, status: 'active', q: query });
    }

    const pack = buildContextPack(docs, { project, query, limit });
    const markdown = renderContextPackMarkdown(pack);
    const sources = collectSources(pack);

    const chat = await resolveChat();
    if (!chat) {
      return { query, answer: null, degraded: true, reason: 'no-chat-model', markdown, sources, model: null };
    }
    try {
      const { text, model } = await chat.complete(buildAskMessages(query, markdown), { temperature: 0.2, maxTokens: 1024 });
      return { query, answer: text, degraded: false, markdown, sources, model };
    } catch (err) {
      request.log.error({ err }, 'library ask generation failed');
      return { query, answer: null, degraded: true, reason: 'generation-failed', markdown, sources, model: chat.model || null };
    }
  });

  app.post('/api/library/documents/:id/links', async (request, reply) => {
    const sourceId = request.params.id;
    const { targetId, relation } = request.body || {};
    if (!isValidUuid(sourceId)) { reply.code(400); return { message: 'document id is invalid' }; }
    if (!isValidUuid(targetId)) { reply.code(400); return { message: 'targetId is invalid' }; }
    if (!DOCUMENT_LINK_RELATIONS.includes(relation)) { reply.code(400); return { message: 'relation is invalid' }; }
    if (sourceId === targetId) { reply.code(400); return { message: 'a document cannot link to itself' }; }
    const result = await documentLinksRepository.linkDocuments(sourceId, targetId, relation);
    if (!result.linked) { reply.code(404); return { message: 'document not found' }; }
    reply.code(result.alreadyLinked ? 200 : 201);
    return documentLinksRepository.listDocumentLinks(sourceId, 'outbound');
  });

  app.delete('/api/library/documents/:id/links/:targetId', async (request, reply) => {
    const sourceId = request.params.id;
    const { targetId } = request.params;
    const relation = request.query.relation;
    if (!isValidUuid(sourceId)) { reply.code(400); return { message: 'document id is invalid' }; }
    if (!isValidUuid(targetId)) { reply.code(400); return { message: 'targetId is invalid' }; }
    if (!DOCUMENT_LINK_RELATIONS.includes(relation)) { reply.code(400); return { message: 'relation is invalid' }; }
    const removed = await documentLinksRepository.unlinkDocuments(sourceId, targetId, relation);
    if (!removed) { reply.code(404); return { message: 'link not found' }; }
    if (relation === 'supersedes') {
      await repository.revertSupersededIfOrphan(targetId);
    }
    return documentLinksRepository.listDocumentLinks(sourceId, 'outbound');
  });

  app.get('/api/library/maintenance/stale', async (request, reply) => {
    let projectId;
    if (request.query.project) {
      projectId = await resolveProjectId(request.query.project);
      if (projectId === null) { reply.code(400); return { message: 'project is invalid' }; }
    }
    return documentLinksRepository.listStaleDocuments(projectId);
  });

  app.get('/api/library/maintenance/orphans', async (request, reply) => {
    let projectId;
    if (request.query.project) {
      projectId = await resolveProjectId(request.query.project);
      if (projectId === null) { reply.code(400); return { message: 'project is invalid' }; }
    }
    return documentLinksRepository.listOrphanDocuments(projectId);
  });
}
