import { createLibraryRepository } from './libraryRepository.js';

const CONTEXTS = new Set(['personal', 'work', 'homelab']);
const DOCUMENT_TYPES = new Set(['runbook', 'note']);
const PATCH_FIELDS = ['title', 'body', 'documentType', 'context', 'tags', 'sourceFilename'];

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
  if (!partial || payload.context !== undefined) {
    if (!CONTEXTS.has(payload.context)) return 'context is invalid';
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
    context: payload.context,
    tags: cleanTags(payload.tags),
    sourceFilename: payload.sourceFilename ? payload.sourceFilename.trim() : null,
  };
}

function cleanDocumentPatchPayload(payload) {
  return PATCH_FIELDS.reduce((patch, field) => {
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

  app.get('/api/library/documents', async (request) => {
    return repository.listDocuments(request.query);
  });

  app.post('/api/library/documents', async (request, reply) => {
    const validationError = validateDocumentPayload(request.body);
    if (validationError) {
      reply.code(400);
      return { message: validationError };
    }

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

    const document = await repository.updateDocument(request.params.id, cleanDocumentPatchPayload(request.body));
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
