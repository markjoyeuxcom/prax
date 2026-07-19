import { createHash } from 'node:crypto';
import { ZipArchive } from 'archiver';
import { createLibraryRepository, documentMatchesCreateFields } from './libraryRepository.js';
import { createProjectsRepository } from './projectsRepository.js';
import { createTasksRepository } from './tasksRepository.js';
import { createDocumentLinksRepository, DOCUMENT_LINK_RELATIONS } from './documentLinksRepository.js';
import { addDaysUtc, compileWeeklyReview, isoWeekId, weekStartOf, weeklyReviewTitle } from './weeklyReview.js';
import { createDocumentExternalRefsRepository, sanitizeUrl, sanitizeLabel } from './documentExternalRefsRepository.js';
import {
  createRunbookRunsRepository,
  RunbookRunConflictError,
} from './runbookRunsRepository.js';
import { parseRunbookSteps } from './runbookSteps.js';
import {
  documentFilename,
  renderDocumentMarkdown,
  dedupeFilenames,
  libraryArchiveFilename,
  buildLinksFromGroups,
} from './libraryExport.js';
import { createEmbeddingService } from './embeddingService.js';
import { buildContextPack, renderContextPackMarkdown, contentLength, isSubstantive } from './contextPack.js';
import { buildAskMessages, buildAnswerContext, collectSources, validateAnswerCitations } from './askLibrary.js';
import { buildRunSummary, buildPostMortemMessages, fallbackPostMortem, postMortemTitle } from './postMortem.js';
import { buildRunbookMessages, parseGeneratedRunbook } from './generateRunbook.js';
import { suggestWikiLinks, applyWikiLink } from './wikiLinkSuggest.js';
import {
  MAX_SEED_DOCS, NEIGHBORS_PER_SEED, MAX_PAIRS, CONTRADICTION_MAXTOKENS, GAP_MAXTOKENS,
  selectContradictionPairs, buildContradictionMessages, parseContradiction, quoteIsGrounded,
  buildGapDigest, buildGapMessages, parseGaps,
} from './kbHealthReview.js';
import { isWritingAction, buildWritingMessages, stripCodeFence, WRITING_ACTIONS } from './writingActions.js';
import { DOCUMENT_TYPE_VALUES } from '../public/js/documentTypes.js';

// The taxonomy lives in the shared registry (public/js/documentTypes.js) —
// the DB CHECK was dropped in migration 0010; this is the enforcement point.
const DOCUMENT_TYPES = new Set(DOCUMENT_TYPE_VALUES);
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

function generationIntentHash(operation, intent) {
  return createHash('sha256')
    .update(JSON.stringify({ operation, ...intent }))
    .digest('hex');
}

function isValidTags(value) {
  return value === undefined || (Array.isArray(value) && value.every(tag => typeof tag === 'string' && tag.trim().length > 0));
}

function validateDocumentPayload(payload, { partial = false } = {}) {
  if (!isPlainObject(payload)) return 'document payload is invalid';
  if (!partial && payload.id !== undefined && !isValidUuid(payload.id)) return 'id is invalid';
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
    ...(payload.id ? { id: payload.id } : {}),
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
  const documentLinksRepository = options.documentLinksRepository || app.documentLinksRepository
    || (app.db ? createDocumentLinksRepository(app.db) : null);
  const documentExternalRefsRepository = options.documentExternalRefsRepository || app.documentExternalRefsRepository
    || (app.db ? createDocumentExternalRefsRepository(app.db) : null);

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

  async function generatedDocumentReplay(id, operation, intentHash) {
    if (!id) return { state: 'new' };
    if (typeof repository.getDocumentCreationReceipt !== 'function'
      || typeof repository.createDocumentIdempotent !== 'function') {
      return { state: 'unavailable' };
    }
    const document = await repository.getDocument(id);
    if (!document) return { state: 'new' };
    const receipt = await repository.getDocumentCreationReceipt(id);
    if (receipt?.operation === operation && receipt.intentHash === intentHash) {
      return { state: 'replay', document };
    }
    return { state: 'conflict' };
  }

  async function commitGeneratedDocument(candidate, { id, operation, intentHash }) {
    if (!id) {
      return { document: await repository.createDocument(candidate), created: true };
    }
    const result = await repository.createDocumentIdempotent({
      ...candidate,
      id,
      creationOperation: operation,
      creationIntentHash: intentHash,
    });
    if (result.created) return result;
    const receipt = await repository.getDocumentCreationReceipt(id);
    if (receipt?.operation === operation && receipt.intentHash === intentHash) return result;
    return { conflict: true };
  }

  function toRef(doc) {
    return {
      id: doc.id,
      title: doc.title,
      documentType: doc.documentType,
      projectId: doc.projectId,
      tags: doc.tags || [],
      kind: doc.kind || 'source',
      updatedBy: doc.updatedBy || null,
      verified: Boolean(doc.verified),
      verifiedAt: doc.verifiedAt || null,
      verifiedBy: doc.verifiedBy || null,
      stale: Boolean(doc.stale),
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
    const paged = request.query.page === 'true';
    // The legacy array response remains shape-compatible but must be complete;
    // only explicit paged mode is bounded. Ranking already evaluates every
    // candidate in the repository, so the unpaged slice can safely retain all
    // relevant hits rather than silently stopping at 20.
    let limit = Number.MAX_SAFE_INTEGER;
    let offset = 0;
    if (paged) {
      const requestedLimit = request.query.limit === undefined ? 20 : Number(request.query.limit);
      const requestedOffset = request.query.offset === undefined ? 0 : Number(request.query.offset);
      if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 50) {
        reply.code(400);
        return { message: 'limit must be an integer from 1 through 50' };
      }
      if (!Number.isInteger(requestedOffset) || requestedOffset < 0) {
        reply.code(400);
        return { message: 'offset must be a non-negative integer' };
      }
      limit = requestedLimit;
      offset = requestedOffset;
    }
    let docs;
    try {
      const { vector } = await embedder.embed(String(q), { query: true });
      const search = app.embeddingSearch || {};
      docs = await repository.searchDocumentsSemantic(vector, embedder.backend, {
        projectId,
        limit,
        offset,
        page: paged,
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
    if (!paged) return docs.map(toRef);

    // Tolerate array-returning injected repositories in tests/extensions while
    // the built-in repository supplies the exact total in paged mode.
    const items = Array.isArray(docs) ? docs : (Array.isArray(docs?.items) ? docs.items : []);
    const total = Number.isInteger(docs?.total) && docs.total >= 0 ? docs.total : items.length;
    const returned = items.length;
    const hasMore = offset + returned < total;
    return {
      items: items.map(toRef),
      page: {
        offset,
        limit,
        returned,
        total,
        hasMore,
        nextOffset: hasMore ? offset + returned : null,
      },
    };
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

  // Weekly review (2026-07-18 plan): one click compiles an honest
  // week-in-review and writes it into the Library, idempotent by ISO week —
  // regenerating updates the same document in place. Advisory regime: every
  // failure is a 200 { degraded, reason }, and a review the human VERIFIED is
  // refused rather than overwritten (the agent-edit trust rules would revoke
  // that blessing silently otherwise).
  app.post('/api/library/weekly-review', async (request) => {
    try {
      const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body) ? request.body : {};
      // Default anchor is YESTERDAY, so a Monday-morning run reviews last week.
      const anchor = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
        ? new Date(`${body.date}T00:00:00.000Z`)
        : new Date(Date.now() - 86_400_000);
      const weekStart = weekStartOf(anchor);
      const weekId = isoWeekId(anchor);
      const title = weeklyReviewTitle(weekId);

      if (!tasksRepository?.listActivityInRange) {
        return { degraded: true, reason: 'unavailable', message: 'weekly review needs the task chronicle' };
      }
      const [tasks, projects, documents, activity] = await Promise.all([
        tasksRepository.listTasks({ archived: 'all' }),
        projectsRepository.listProjects(),
        repository.listDocuments({}),
        tasksRepository.listActivityInRange(`${weekStart}T00:00:00.000Z`, `${addDaysUtc(weekStart, 7)}T00:00:00.000Z`),
      ]);
      const compiled = compileWeeklyReview({ tasks, activity, projects, documents, weekStart, now: new Date() });

      let markdown = compiled.markdown;
      let narrated = false;
      if (body.narrate === true) {
        const chat = await resolveChat();
        if (chat) {
          try {
            const { text } = await chat.complete([
              { role: 'system', content: 'You write short, honest weekly-review narratives. No cheerleading, no invented facts — only what the data below says. 4-7 sentences, first person.' },
              { role: 'user', content: markdown },
            ], { temperature: 0.4, maxTokens: 400 });
            if (text && text.trim()) {
              markdown += `\n\n## Narrative\n\n${text.trim()}\n\n*AI-narrated from the sections above.*`;
              narrated = true;
            }
          } catch { /* narration is optional; the deterministic review stands alone */ }
        }
      }

      const existing = documents.find((doc) => doc.title === title && !doc.archivedAt) || null;
      if (existing?.verified) {
        return {
          degraded: true,
          reason: 'verified-review',
          message: 'This week\'s review was verified by you — regenerating would revoke that. Unverify it first if you want a fresh one.',
          documentId: existing.id,
        };
      }
      let document;
      if (existing) {
        document = await repository.updateDocument(existing.id, {
          body: markdown, tags: ['weekly-review'], updatedBy: 'agent',
        });
      } else {
        // Documents are project-owned; the cross-project review lives in the
        // system Inbox (always present, guarded server-side).
        const inbox = await projectsRepository.resolveProject('inbox');
        if (!inbox) return { degraded: true, reason: 'unavailable', message: 'the system Inbox project is missing' };
        document = await repository.createDocument({
          title, body: markdown, documentType: 'note', projectId: inbox.id,
          tags: ['weekly-review'], updatedBy: 'agent', kind: 'synthesized',
        });
      }
      await embedOnWrite(document.id);
      return {
        documentId: document.id,
        created: !existing,
        updated: Boolean(existing),
        weekId,
        stats: compiled.stats,
        narrated,
        ...(body.narrate === true && !narrated ? { narrationDegraded: true, narrationReason: 'no-chat-model' } : {}),
      };
    } catch (err) {
      request.log?.error?.({ err }, 'weekly-review failed');
      return { degraded: true, reason: 'compile-failed', message: err?.message || 'weekly review failed' };
    }
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

    const candidate = { ...cleanDocumentPayload(request.body), updatedBy: originFrom(request) };
    if (candidate.id) {
      if (typeof repository.createDocumentIdempotent !== 'function') {
        reply.code(503);
        return { message: 'idempotent document creation is unavailable' };
      }
      const result = await repository.createDocumentIdempotent(candidate);
      if (!result.document || (!result.created && !documentMatchesCreateFields(result.document, candidate))) {
        reply.code(409);
        return { message: 'document id was already used for different content' };
      }
      reply.code(result.created ? 201 : 200);
      if (result.created) await embedOnWrite(result.document.id);
      return result.document;
    }
    reply.code(201);
    const created = await repository.createDocument(candidate);
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
    if (!(await repository.getDocument(request.params.id))) { reply.code(404); return { message: 'document not found' }; }
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
    if (doc.documentType !== 'runbook') { reply.code(409); return { message: 'only runbook documents can be started' }; }
    const steps = parseRunbookSteps(doc.body);
    const body = isPlainObject(request.body) ? request.body : {};
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (body.id !== undefined && !isValidUuid(body.id)) {
      reply.code(400); return { message: 'run id is invalid' };
    }
    try {
      const run = await runbookRunsRepository.createRun({
        id: body.id || null,
        documentId: doc.id,
        documentTitle: doc.title,
        projectId: doc.projectId,
        title,
        startedBy: originFrom(request),
        steps,
      });
      reply.code(run.alreadyStarted ? 200 : 201);
      return run;
    } catch (error) {
      if (!(error instanceof RunbookRunConflictError)) throw error;
      reply.code(409);
      return { message: error.message, reason: error.reason };
    }
  });

  app.get('/api/library/documents/:id/runs', async (request, reply) => {
    if (!isValidUuid(request.params.id)) { reply.code(400); return { message: 'document id is invalid' }; }
    if (!(await repository.getDocument(request.params.id))) { reply.code(404); return { message: 'document not found' }; }
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
    try {
      const step = await runbookRunsRepository.setStepChecked(request.params.runId, request.params.stepId, {
        checked: request.body.checked, checkedBy: originFrom(request),
      });
      if (!step) { reply.code(404); return { message: 'step not found' }; }
      return step;
    } catch (error) {
      if (!(error instanceof RunbookRunConflictError)) throw error;
      reply.code(409);
      return { message: error.message, reason: error.reason };
    }
  });

  app.patch('/api/library/runs/:runId', async (request, reply) => {
    if (!isValidUuid(request.params.runId)) { reply.code(400); return { message: 'run id is invalid' }; }
    if (!runbookRunsRepository) { reply.code(404); return { message: 'run not found' }; }
    const status = isPlainObject(request.body) ? request.body.status : undefined;
    if (!['running', 'completed', 'aborted'].includes(status)) {
      reply.code(400); return { message: 'status must be running, completed, or aborted' };
    }
    try {
      const run = await runbookRunsRepository.setRunStatus(request.params.runId, status, {
        changedBy: originFrom(request),
      });
      if (!run) { reply.code(404); return { message: 'run not found' }; }
      return run;
    } catch (error) {
      if (!(error instanceof RunbookRunConflictError)) throw error;
      reply.code(409);
      return { message: error.message, reason: error.reason };
    }
  });

  // Auto post-mortem: turn a run's chronicle into a drafted post-mortem document
  // (agent-written, unverified — a human reviews/verifies it). Uses the chat
  // model to narrate when configured; falls back to a deterministic template
  // built from the chronicle otherwise. Never 500s on the AI path.
  app.post('/api/library/runs/:runId/post-mortem', async (request, reply) => {
    if (!isValidUuid(request.params.runId)) { reply.code(400); return { message: 'run id is invalid' }; }
    const requestBody = isPlainObject(request.body) ? request.body : {};
    const resultId = requestBody.id;
    if (resultId !== undefined && !isValidUuid(resultId)) {
      reply.code(400); return { message: 'document id is invalid' };
    }
    if (!runbookRunsRepository) { reply.code(404); return { message: 'run not found' }; }
    const run = await runbookRunsRepository.getRun(request.params.runId);
    if (!run) { reply.code(404); return { message: 'run not found' }; }
    const doc = run.documentId ? await repository.getDocument(run.documentId) : null;
    const documentTitle = run.documentTitle || doc?.title || 'Deleted runbook';
    const projectId = run.projectId || doc?.projectId || null;
    const project = projectId ? await projectsRepository.resolveProject(projectId) : null;
    if (!project) { reply.code(409); return { message: 'the project this run came from no longer exists' }; }

    const operation = 'generate-post-mortem';
    const intentHash = generationIntentHash(operation, { runId: run.id, projectId: project.id });
    const prior = await generatedDocumentReplay(resultId, operation, intentHash);
    if (prior.state === 'unavailable') {
      reply.code(503); return { message: 'idempotent document generation is unavailable' };
    }
    if (prior.state === 'conflict') {
      reply.code(409); return { message: 'document id was already used for a different generation intent' };
    }
    if (prior.state === 'replay') {
      return { document: prior.document, generated: null, model: null, replayed: true };
    }

    const summary = buildRunSummary(run, documentTitle);
    let body = fallbackPostMortem(run, summary, documentTitle);
    let generated = false;
    let model = null;
    const chat = await resolveChat();
    if (chat) {
      try {
        const res = await chat.complete(buildPostMortemMessages(run, summary, documentTitle), { temperature: 0.3, maxTokens: 1500 });
        if (res && typeof res.text === 'string' && res.text.trim()) { body = res.text; generated = true; model = res.model || chat.model || null; }
      } catch (err) {
        request.log.error({ err }, 'post-mortem generation failed');
      }
    }

    const committed = await commitGeneratedDocument({
      title: postMortemTitle(run, documentTitle),
      body,
      // First-class type since migration 0010; the tag stays for continuity.
      documentType: 'post-mortem',
      projectId: project.id,
      tags: ['post-mortem'],
      kind: 'synthesized',
      updatedBy: 'agent', // AI-authored → lands agent-written, needs human verify
    }, { id: resultId, operation, intentHash });
    if (committed.conflict) {
      reply.code(409); return { message: 'document id was already used for a different generation intent' };
    }
    reply.code(committed.created ? 201 : 200);
    if (committed.created) await embedOnWrite(committed.document.id);
    return {
      document: committed.document,
      generated: committed.created ? generated : null,
      model: committed.created ? model : null,
      replayed: !committed.created,
    };
  });

  // Generate a runbook from an alert/incident description. Unlike ask/post-mortem
  // there's nothing to fall back to without a model (there's no source content to
  // template), so this requires a chat model (409) and surfaces a generation
  // failure (502). The draft lands agent-written + unverified for human review.
  app.post('/api/library/runbooks/generate', async (request, reply) => {
    const body = isPlainObject(request.body) ? request.body : null;
    if (!body) { reply.code(400); return { message: 'body is invalid' }; }
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (!description) { reply.code(400); return { message: 'description is required' }; }
    const resultId = body.id;
    if (resultId !== undefined && !isValidUuid(resultId)) {
      reply.code(400); return { message: 'document id is invalid' };
    }
    const projectId = await resolveProjectId(body.project);
    if (projectId === null) { reply.code(400); return { message: 'project is invalid' }; }
    if (projectId === undefined) { reply.code(400); return { message: 'project is required' }; }

    const operation = 'generate-runbook';
    const intentHash = generationIntentHash(operation, { description, projectId });
    const prior = await generatedDocumentReplay(resultId, operation, intentHash);
    if (prior.state === 'unavailable') {
      reply.code(503); return { message: 'idempotent document generation is unavailable' };
    }
    if (prior.state === 'conflict') {
      reply.code(409); return { message: 'document id was already used for a different generation intent' };
    }
    if (prior.state === 'replay') {
      return { document: prior.document, model: null, replayed: true };
    }

    const chat = await resolveChat();
    if (!chat) { reply.code(409); return { message: 'no AI model is configured — set one in Settings ▸ Intelligence' }; }
    let generated;
    try {
      generated = await chat.complete(buildRunbookMessages(description), { temperature: 0.3, maxTokens: 1500 });
    } catch (err) {
      request.log.error({ err }, 'runbook generation failed');
      reply.code(502); return { message: `generation failed: ${err?.message || 'unknown error'}` };
    }
    const { title, body: docBody } = parseGeneratedRunbook(generated?.text, description);

    const committed = await commitGeneratedDocument({
      title,
      body: docBody,
      documentType: 'runbook',
      projectId,
      tags: ['draft'],
      kind: 'synthesized',
      updatedBy: 'agent', // AI-authored → agent-written, needs human verify
    }, { id: resultId, operation, intentHash });
    if (committed.conflict) {
      reply.code(409); return { message: 'document id was already used for a different generation intent' };
    }
    reply.code(committed.created ? 201 : 200);
    if (committed.created) await embedOnWrite(committed.document.id);
    return {
      document: committed.document,
      model: committed.created ? (generated?.model || chat.model || null) : null,
      replayed: !committed.created,
    };
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
    if (body.contentHash !== undefined && !/^[0-9a-f]{64}$/i.test(body.contentHash)) {
      reply.code(400); return { message: 'contentHash is invalid' };
    }
    const verifiedBy = body.verified ? (typeof body.as === 'string' && body.as.trim() ? body.as.trim() : 'user') : null;
    // Stored hashes are lowercase hex; the format validation above accepts
    // either case, so normalize — an uppercase spelling of the CORRECT hash
    // must not read as "content changed since review".
    const expectedHash = body.verified ? (body.contentHash ? body.contentHash.toLowerCase() : null) : null;
    const document = await repository.verifyDocument(request.params.id, {
      verified: body.verified, verifiedBy, contentHash: expectedHash,
    });
    if (!document) {
      const current = await repository.getDocument(request.params.id);
      if (expectedHash && current && current.contentHash !== expectedHash) {
        reply.code(409); return { message: 'document changed since it was reviewed; review the current content before verifying' };
      }
      // Same-state verification replay is success without rewriting the first
      // reviewer/timestamp. This makes a lost response safe to retry.
      if (body.verified && current?.verified) return current;
      reply.code(404); return { message: 'document not found' };
    }
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
    const semanticReady = Boolean(query && embedder && await semanticEnabled());
    let retrieval = query
      ? {
        mode: 'recency',
        fallback: true,
        reason: !embedder ? 'semantic-not-configured' : (semanticReady ? 'semantic-no-match' : 'semantic-disabled'),
      }
      : { mode: 'recency', fallback: false, reason: null };
    if (semanticReady) {
      try {
        const { vector } = await embedder.embed(query, { query: true });
        const search = app.embeddingSearch || {};
        docs = await repository.searchDocumentsSemantic(vector, embedder.backend, {
          projectId: project.id,
          limit: 50,
          minSimilarity: search.minSimilarity,
          topDrop: search.topDrop,
        });
        if (docs.length > 0) retrieval = { mode: 'semantic', fallback: false, reason: null };
      } catch (err) {
        // Degrade to recency rather than fail — keyword/recency always works.
        request.log.error({ err }, 'context-pack semantic embed failed');
        docs = [];
        retrieval = { mode: 'recency', fallback: true, reason: 'semantic-unavailable' };
      }
    }
    if (docs.length === 0) {
      docs = await repository.listDocuments({ projectId: project.id, status: 'active' });
    }

    const pack = buildContextPack(docs, { project, query, limit, retrieval });
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
    let retrieval = { mode: 'keyword', fallback: true, reason: 'semantic-not-configured' };
    const embedder = await resolveEmbedder();
    const semanticReady = Boolean(embedder && await semanticEnabled());
    if (embedder && !semanticReady) retrieval.reason = 'semantic-disabled';
    if (semanticReady) {
      try {
        const { vector } = await embedder.embed(query, { query: true });
        const search = app.embeddingSearch || {};
        docs = await repository.searchDocumentsSemantic(vector, embedder.backend, {
          projectId, limit: 50, minSimilarity: search.minSimilarity, topDrop: search.topDrop,
        });
        if (docs.length > 0) retrieval = { mode: 'semantic', fallback: false, reason: null };
        else retrieval = { mode: 'keyword', fallback: true, reason: 'semantic-no-match' };
      } catch (err) {
        // Degrade to keyword rather than fail — FTS always works.
        request.log.error({ err }, 'library context-pack semantic embed failed');
        docs = [];
        retrieval = { mode: 'keyword', fallback: true, reason: 'semantic-unavailable' };
      }
    }
    if (docs.length === 0) {
      docs = await repository.listDocuments({ projectId, status: 'active', q: query });
    }

    const pack = buildContextPack(docs, { project, query, limit, retrieval });
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
    let retrieval = { mode: 'keyword', fallback: false, reason: null };
    const embedder = await resolveEmbedder();
    if (embedder && await semanticEnabled()) {
      try {
        const { vector } = await embedder.embed(query, { query: true });
        const search = app.embeddingSearch || {};
        docs = await repository.searchDocumentsSemantic(vector, embedder.backend, {
          projectId, limit: 50, minSimilarity: search.minSimilarity, topDrop: search.topDrop,
        });
        if (docs.length > 0) retrieval = { mode: 'semantic', fallback: false, reason: null };
        else retrieval = { mode: 'keyword', fallback: true, reason: 'semantic-no-match' };
      } catch (err) {
        request.log.error({ err }, 'library ask semantic embed failed');
        docs = [];
        retrieval = { mode: 'keyword', fallback: true, reason: 'semantic-unavailable' };
      }
    }
    if (docs.length === 0) {
      docs = await repository.listDocuments({ projectId, status: 'active', q: query });
    }

    const pack = buildContextPack(docs, { project, query, limit, retrieval });
    const markdown = renderContextPackMarkdown(pack);
    const sources = collectSources(pack);

    const chat = await resolveChat();
    if (!chat) {
      return { query, answer: null, degraded: true, reason: 'no-chat-model', markdown, sources, retrieval, model: null };
    }
    try {
      // Generate from the FULL bodies of the top docs (not the snippet pack), so
      // the answer is grounded in complete content — runbook steps, commands, etc.
      const context = buildAnswerContext(docs);
      const { text, model } = await chat.complete(buildAskMessages(query, context), { temperature: 0.2, maxTokens: 1024 });
      const citation = validateAnswerCitations(text, sources);
      if (!citation.valid) {
        return { query, answer: null, degraded: true, reason: 'citation-validation-failed', markdown, sources, retrieval, model };
      }
      return { query, answer: text, degraded: false, markdown, sources, retrieval, citation, model };
    } catch (err) {
      request.log.error({ err }, 'library ask generation failed');
      return { query, answer: null, degraded: true, reason: 'generation-failed', markdown, sources, retrieval, model: chat.model || null };
    }
  });

  // Narrate a structured daily brief into a short stand-up update. The brief is
  // built client-side from loaded state; this only rewrites it in prose when a
  // chat model is configured (degrades to no narrative otherwise). Facts-only.
  app.post('/api/brief/narrate', async (request, reply) => {
    const body = isPlainObject(request.body) ? request.body : null;
    const text = body && typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) { reply.code(400); return { message: 'text is required' }; }
    const chat = await resolveChat();
    if (!chat) return { narrative: null, degraded: true, reason: 'no-chat-model', model: null };
    try {
      const { text: narrative, model } = await chat.complete([
        { role: 'system', content: 'You are an SRE lead writing a short daily stand-up update from the structured brief below. Keep it to a few tight sentences and/or bullets in Markdown: what is on fire (overdue), the day\'s focus, and any on-call handoff worth flagging. Use ONLY the facts in the brief — do not invent tasks, owners, or status.' },
        { role: 'user', content: text },
      ], { temperature: 0.3, maxTokens: 600 });
      return { narrative, degraded: false, model };
    } catch (err) {
      request.log.error({ err }, 'brief narrate failed');
      return { narrative: null, degraded: true, reason: 'generation-failed', error: err?.message || 'failed', model: chat.model || null };
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
    if (!removed) {
      const [source, target] = await Promise.all([
        repository.getDocument(sourceId),
        repository.getDocument(targetId),
      ]);
      if (!source || !target) { reply.code(404); return { message: 'document not found' }; }
    }
    return documentLinksRepository.listDocumentLinks(sourceId, 'outbound');
  });

  // External references — a document points at outside material (a PR, a
  // dashboard, an upstream bug) without copying it. Separate table from
  // document_links (the target is a URL, not a local doc row).
  app.get('/api/library/documents/:id/external-refs', async (request, reply) => {
    if (!isValidUuid(request.params.id)) { reply.code(400); return { message: 'document id is invalid' }; }
    if (!(await repository.getDocument(request.params.id))) { reply.code(404); return { message: 'document not found' }; }
    return documentExternalRefsRepository.listExternalRefs(request.params.id);
  });

  app.post('/api/library/documents/:id/external-refs', async (request, reply) => {
    const documentId = request.params.id;
    if (!isValidUuid(documentId)) { reply.code(400); return { message: 'document id is invalid' }; }
    const url = sanitizeUrl(isPlainObject(request.body) ? request.body.url : null);
    if (!url) { reply.code(400); return { message: 'url is required' }; }
    const label = sanitizeLabel(isPlainObject(request.body) ? request.body.label : null);
    const { ref, alreadyExisted } = await documentExternalRefsRepository.addExternalRef(documentId, url, label);
    if (!ref) { reply.code(404); return { message: 'document not found' }; } // absent or archived
    reply.code(alreadyExisted ? 200 : 201);
    return documentExternalRefsRepository.listExternalRefs(documentId);
  });

  app.delete('/api/library/documents/:id/external-refs/:refId', async (request, reply) => {
    const documentId = request.params.id;
    if (!isValidUuid(documentId)) { reply.code(400); return { message: 'document id is invalid' }; }
    if (!isValidUuid(request.params.refId)) { reply.code(400); return { message: 'ref id is invalid' }; }
    const removed = await documentExternalRefsRepository.removeExternalRef(documentId, request.params.refId);
    if (!removed && !(await repository.getDocument(documentId))) {
      reply.code(404); return { message: 'document not found' };
    }
    return documentExternalRefsRepository.listExternalRefs(documentId);
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

  // Detached runs: operational records whose source runbook was deleted. They
  // survive with snapshot context (document_title, project, title), but the
  // per-document runs listing 404s once the doc is gone — this keeps them
  // reachable.
  app.get('/api/library/maintenance/detached-runs', async () => {
    if (!runbookRunsRepository) return [];
    return runbookRunsRepository.listDetachedRuns();
  });

  // Knowledge-base health: one call that surfaces the docs needing attention —
  // unverified drafts to review (esp. agent-written), stale derivations, orphans
  // with no links, and empty stubs. A curation dashboard over signals the
  // Library already tracks.
  app.get('/api/library/health', async (request, reply) => {
    let projectId;
    if (request.query.project) {
      projectId = await resolveProjectId(request.query.project);
      if (projectId === null) { reply.code(400); return { message: 'project is invalid' }; }
    }
    // listDocuments uses `id`; the link repo's stale/orphan rows use `documentId`.
    const healthRef = (d) => ({
      id: d.id ?? d.documentId, title: d.title, documentType: d.documentType, projectId: d.projectId,
      verified: Boolean(d.verified), updatedBy: d.updatedBy || null,
    });
    const [active, stale, orphans] = await Promise.all([
      repository.listDocuments({ projectId, status: 'active' }),
      documentLinksRepository.listStaleDocuments(projectId),
      documentLinksRepository.listOrphanDocuments(projectId),
    ]);
    const needsReview = active.filter((d) => !d.verified).map(healthRef);
    const empty = active.filter((d) => contentLength(d.body) === 0).map(healthRef);
    const sections = {
      needsReview,
      stale: (stale || []).map(healthRef),
      orphans: (orphans || []).map(healthRef),
      empty,
    };
    return {
      ...sections,
      counts: Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, v.length])),
    };
  });

  // Auto wiki-linking (Tier-2 #5): plain-text mentions of one doc's title inside
  // another that aren't yet [[linked]]. Deterministic; the human accepts each.
  app.get('/api/library/health/link-suggestions', async (request, reply) => {
    let projectId;
    if (request.query.project) {
      projectId = await resolveProjectId(request.query.project);
      if (projectId === null) { reply.code(400); return { message: 'project is invalid' }; }
    }
    const active = await repository.listDocuments({ projectId, status: 'active' });
    return suggestWikiLinks(active);
  });

  // Accept one suggestion: rewrite the first eligible plain-text mention of
  // `title` in this doc's body to a [[wiki-link]]. A user edit (verified stays).
  app.post('/api/library/documents/:id/wiki-link', async (request, reply) => {
    if (!isValidUuid(request.params.id)) { reply.code(400); return { message: 'document id is invalid' }; }
    const title = request.body && typeof request.body.title === 'string' ? request.body.title.trim() : '';
    if (!title) { reply.code(400); return { message: 'title is required' }; }
    const doc = await repository.getDocument(request.params.id);
    if (!doc) { reply.code(404); return { message: 'document not found' }; }
    const body = applyWikiLink(doc.body, title);
    if (body === null) { reply.code(409); return { message: 'no unlinked mention of that title remains' }; }
    return repository.updateDocument(request.params.id, { body, updatedBy: originFrom(request) });
  });

  // Editor writing actions (Tier-3 #7): draft / summarize / rewrite / checklist.
  // Stateless text transform — the result is returned for the human to review and
  // apply in the editor; this route NEVER touches a document. Degrades (no 500)
  // when no chat model is configured.
  app.post('/api/library/writing-action', async (request, reply) => {
    const b = isPlainObject(request.body) ? request.body : {};
    const action = typeof b.action === 'string' ? b.action : '';
    if (!isWritingAction(action)) { reply.code(400); return { message: 'action is invalid' }; }
    const text = typeof b.text === 'string' ? b.text : '';
    const title = typeof b.title === 'string' ? b.title : '';
    if (WRITING_ACTIONS[action].input === 'title' ? !title.trim() : !text.trim()) {
      reply.code(400); return { message: `${WRITING_ACTIONS[action].input} is required` };
    }
    const chat = await resolveChat();
    if (!chat) return { text: null, degraded: true, reason: 'no-chat-model', model: null };
    try {
      const messages = buildWritingMessages(action, { text, title, documentType: typeof b.documentType === 'string' ? b.documentType : '' });
      // 4096 keeps whole-document rewrites/drafts from truncating mid-doc; the
      // human reviews the full output in the preview before applying either way.
      const { text: out, model } = await chat.complete(messages, { temperature: action === 'rewrite' ? 0.3 : 0.4, maxTokens: 4096 });
      const clean = stripCodeFence(out);
      if (!clean) return { text: null, degraded: true, reason: 'generation-failed', model: model || chat.model || null };
      return { text: clean, degraded: false, model: model || chat.model || null };
    } catch (err) {
      request.log?.error?.({ err }, 'writing-action failed');
      return { text: null, degraded: true, reason: 'generation-failed', error: err?.message || 'failed', model: chat.model || null };
    }
  });

  // AI review (Tier-2 #5, part 2): on-demand contradiction + coverage-gap scan.
  // Advisory only — nothing mutates. Costs model tokens; bounded to ≤13 calls per
  // scan (MAX_PAIRS + 1). Never 500s on the AI path — every failure degrades to a
  // 200 the panel renders a reason from. See kbHealthReview.js for the pure parts.
  app.post('/api/library/health/ai-review', async (request, reply) => {
    const zeros = () => ({ documentsScanned: 0, pairsConsidered: 0, pairsJudged: 0, contradictionsFound: 0, gapsFound: 0 });
    try {
      // Project resolution lives INSIDE the try so a transient DB error degrades
      // to a 200 (never-500 contract); only an explicit invalid-project 400s.
      let projectId;
      if (request.body && typeof request.body === 'object' && request.body.project) {
        projectId = await resolveProjectId(request.body.project);
        if (projectId === null) { reply.code(400); return { message: 'project is invalid' }; }
      }
      const chat = await resolveChat();
      if (!chat) {
        return { model: null, degraded: true, reason: 'no-chat-model', contradictions: [], gaps: [],
          contradictionScan: { ran: false, degraded: true, reason: 'no-chat-model' },
          gapScan: { ran: false, reason: 'no-chat-model' }, stats: zeros() };
      }
      const active = await repository.listDocuments({ projectId, status: 'active' });
      const docs = (Array.isArray(active) ? active : []).filter(isSubstantive);
      const byId = new Map(docs.map((d) => [d.id, d]));
      if (docs.length === 0) {
        return { model: chat.model || null, degraded: false, reason: null, contradictions: [], gaps: [],
          contradictionScan: { ran: false, degraded: false, reason: 'empty' },
          gapScan: { ran: false, reason: 'empty' }, stats: zeros() };
      }

      let usedModel = null;
      // ---- contradictions (candidates from embeddings, judged pairwise) ----
      let contradictionScan = { ran: false, degraded: false, reason: null };
      const contradictions = [];
      let pairs = [];
      let pairsJudged = 0;
      const embedder = await resolveEmbedder();
      if (!embedder || !(await semanticEnabled())) {
        contradictionScan = { ran: false, degraded: true, reason: 'no-embedder' };
      } else {
        try {
          const search = app.embeddingSearch || {};
          const rawPairs = [];
          for (const seed of docs.slice(0, MAX_SEED_DOCS)) {
            const neighbors = await repository.findSimilarDocuments(seed.id, embedder.backend, {
              limit: NEIGHBORS_PER_SEED, projectId, minSimilarity: search.minSimilarity, topDrop: search.topDrop,
            });
            for (const n of neighbors || []) rawPairs.push({ aId: seed.id, bId: n.id, similarity: n.similarity });
          }
          pairs = selectContradictionPairs(rawPairs, byId, { maxPairs: MAX_PAIRS });
          for (const { a, b, similarity } of pairs) {
            try {
              const res = await chat.complete(buildContradictionMessages(a, b), { temperature: 0, maxTokens: CONTRADICTION_MAXTOKENS });
              pairsJudged += 1;
              usedModel = usedModel || res.model;
              const parsed = parseContradiction(res.text);
              if (parsed?.contradicts && quoteIsGrounded(a.body, parsed.quoteA) && quoteIsGrounded(b.body, parsed.quoteB)) {
                contradictions.push({
                  severity: parsed.severity, issue: parsed.issue, similarity,
                  a: { id: a.id, title: a.title, documentType: a.documentType, verified: Boolean(a.verified), quote: parsed.quoteA },
                  b: { id: b.id, title: b.title, documentType: b.documentType, verified: Boolean(b.verified), quote: parsed.quoteB },
                });
              }
            } catch (err) { request.log?.error?.({ err }, 'ai-review pair failed'); }
          }
          // If we had pairs to judge but every judgment call failed (chat outage
          // while embeddings were fine), that's a degraded scan, not "all clear".
          contradictionScan = (pairs.length > 0 && pairsJudged === 0)
            ? { ran: false, degraded: true, reason: 'judge-failed' }
            : { ran: true, degraded: false, reason: null };
        } catch (err) {
          request.log?.error?.({ err }, 'ai-review candidate generation failed');
          contradictionScan = { ran: false, degraded: true, reason: 'embed-failed' };
        }
      }

      // ---- coverage gaps (one call, from a trust-aware digest) ----
      let openTasks = [];
      if (tasksRepository?.listTasks) {
        try {
          const t = await tasksRepository.listTasks({ projectId });
          openTasks = (Array.isArray(t) ? t : []).filter((x) => !['completed', 'notes'].includes(x.status));
        } catch { openTasks = []; }
      }
      let gaps = [];
      let gapScan = { ran: false, reason: null };
      try {
        const res = await chat.complete(buildGapMessages(buildGapDigest(docs, openTasks)), { temperature: 0.2, maxTokens: GAP_MAXTOKENS });
        usedModel = usedModel || res.model;
        gaps = parseGaps(res.text);
        gapScan = { ran: true, reason: null };
      } catch (err) {
        request.log?.error?.({ err }, 'ai-review gaps failed');
        gapScan = { ran: false, reason: 'generation-failed' };
      }

      return {
        model: usedModel || chat.model || null,
        degraded: contradictionScan.degraded === true,
        reason: contradictionScan.degraded ? contradictionScan.reason : null,
        contradictions, gaps, contradictionScan, gapScan,
        stats: {
          documentsScanned: docs.length,
          pairsConsidered: pairs.length,
          pairsJudged,
          contradictionsFound: contradictions.length,
          gapsFound: gaps.length,
        },
      };
    } catch (err) {
      request.log?.error?.({ err }, 'ai-review failed');
      return { model: null, degraded: true, reason: 'ai-review-failed', contradictions: [], gaps: [],
        contradictionScan: { ran: false, degraded: true, reason: null }, gapScan: { ran: false, reason: null }, stats: zeros() };
    }
  });
}
