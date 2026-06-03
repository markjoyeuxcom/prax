import { ZipArchive } from 'archiver';
import { createLibraryRepository } from './libraryRepository.js';
import { createProjectsRepository } from './projectsRepository.js';
import { createDocumentLinksRepository, DOCUMENT_LINK_RELATIONS } from './documentLinksRepository.js';
import {
  documentFilename,
  renderDocumentMarkdown,
  dedupeFilenames,
  libraryArchiveFilename,
  buildLinksFromGroups,
} from './libraryExport.js';
import { toVectorLiteral } from './vectorLiteral.js';

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
  return request.headers['x-moomora-origin'] === 'agent' ? 'agent' : 'user';
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
  const documentLinksRepository = options.documentLinksRepository || app.documentLinksRepository || createDocumentLinksRepository(app.db);

  const embedder = options.embedder ?? app.embedder ?? null;
  const embeddingService = options.embeddingService ?? app.embeddingService ?? null;
  const appSettings = options.appSettingsRepository || app.appSettingsRepository;

  async function semanticActive() {
    if (!embedder || !appSettings) return false;
    // Never throw from the gate: it runs on the document write path (the
    // un-awaited embed trigger), so a transient settings-read failure must not
    // be able to surface as a 500 on a create/update. Treat a failed read as
    // "not active" rather than propagating.
    return Boolean(await appSettings.getSetting('semantic_search_enabled', true).catch(() => false));
  }

  function toRef(doc) {
    return {
      id: doc.id,
      title: doc.title,
      documentType: doc.documentType,
      projectId: doc.projectId,
      tags: doc.tags || [],
      snippet: String(doc.body || '').slice(0, 200),
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
    if (!(await semanticActive())) {
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

    let docs;
    try {
      const { vector } = await embedder.embed(String(q), { query: true });
      const search = app.embeddingSearch || {};
      docs = await repository.searchDocumentsSemantic(toVectorLiteral(vector), embedder.backend, {
        projectId,
        limit: 20,
        minSimilarity: search.minSimilarity,
        topDrop: search.topDrop,
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
    if (!embedder) { reply.code(409); return { message: 'semantic search is not configured' }; }
    if (!embeddingService) { reply.code(409); return { message: 'semantic search is not configured' }; }
    const result = await embeddingService.reindex();
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
    if (embeddingService && embedder && await semanticActive()) {
      embeddingService.embedDocument(created.id);  // not awaited
    }
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

    const document = await repository.deleteArchivedDocument(request.params.id);
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
    if (Object.prototype.hasOwnProperty.call(request.body, 'body') && embeddingService && embedder && await semanticActive()) {
      embeddingService.embedDocument(document.id);  // not awaited
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
