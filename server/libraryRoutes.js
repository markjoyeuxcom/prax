import { createLibraryRepository } from './libraryRepository.js';
import { createProjectsRepository } from './projectsRepository.js';

const DOCUMENT_TYPES = new Set(['runbook', 'note']);
// 'project' (slug-or-id) is the client-facing field; 'projectId' is resolved
// server-side and injected into the patch by the handler — never accepted raw.
const PATCH_FIELDS = ['title', 'body', 'documentType', 'project', 'tags', 'sourceFilename'];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isValidUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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

  async function resolveProjectId(value) {
    if (value === undefined || value === null || value === '') return undefined;
    const project = await projectsRepository.resolveProject(String(value));
    return project ? project.id : null; // null signals "given but not found"
  }

  app.get('/api/library/documents', async (request, reply) => {
    let projectId;
    if (request.query.project && request.query.project !== 'all') {
      projectId = await resolveProjectId(request.query.project);
      if (projectId === null) { reply.code(400); return { message: 'project is invalid' }; }
    }
    return repository.listDocuments({ ...request.query, projectId });
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
    return repository.createDocument(cleanDocumentPayload(request.body));
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

    const document = await repository.updateDocument(request.params.id, fields);
    if (!document) {
      reply.code(404);
      return { message: 'document not found' };
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
}
