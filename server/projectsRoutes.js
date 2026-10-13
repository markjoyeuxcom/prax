import { createProjectsRepository } from './projectsRepository.js';
import { getSystemProject } from '../public/js/systemProject.js';
import { ensureProjectOverview } from './projectOverview.js';
import { originFrom, agentFrom } from './tasksRoutes.js';

const STATUSES = new Set(['active', 'on-hold', 'completed', 'archived']);

function isValidUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export async function registerProjectsRoutes(app, options = {}) {
  const repository = options.projectsRepository || app.projectsRepository || createProjectsRepository(app.db);
  // The library holds each project's overview document; an app built without
  // one (a bare projects-only app) creates projects without a card. The demo's
  // in-memory library counts as one.
  const libraryRepository = options.libraryRepository || app.libraryRepository || null;

  const actorOf = (request) => ({ updatedBy: originFrom(request), updatedByAgent: agentFrom(request) });
  // The library routes' fire-and-forget embed, passed explicitly or taken from
  // the app they decorated (absent on a bare app: the card is then embedded by
  // the next reindex).
  const embedOnWrite = options.embedOnWrite || app.embedOnWrite || null;
  const embedLater = (documentId) => { Promise.resolve(embedOnWrite?.(documentId)).catch(() => {}); };

  // Best-effort seed of the new project's overview: the project create must
  // not fail because its starter could not be filed, but the caller is told.
  // Returns { document } or { error }.
  async function seedOverview(project, request) {
    if (!libraryRepository) return { document: null };
    try {
      const result = await ensureProjectOverview({ libraryRepository, project, actor: actorOf(request) });
      if (result.created && result.document) embedLater(result.document.id);
      return { document: result.document || null };
    } catch (err) {
      app.log?.warn?.({ err, project: project.slug }, 'project overview was not seeded');
      return { error: 'The overview document could not be created; POST /api/projects/:id/overview creates it.' };
    }
  }

  // Refuse mutations to the reserved system projects. Returns a response body
  // when blocked (caller returns it), or null when the id is a normal project.
  // A missing project falls through so the normal 404 path still applies.
  async function refuseSystemProject(id, reply, verb) {
    const project = await repository.resolveProject(id);
    const system = getSystemProject(project);
    if (system) {
      reply.code(403);
      return { message: `The ${system.name} project is reserved for ${system.purpose} and can’t be ${verb}.` };
    }
    return null;
  }

  app.get('/api/projects', async (request) => {
    return repository.listProjects(request.query.status);
  });

  app.post('/api/projects', async (request, reply) => {
    const body = request.body;
    if (!isPlainObject(body) || typeof body.name !== 'string' || body.name.trim() === '') {
      reply.code(400);
      return { message: 'name is required' };
    }
    if (body.status !== undefined && !STATUSES.has(body.status)) {
      reply.code(400);
      return { message: 'status is invalid' };
    }
    const project = await repository.createProject({ name: body.name.trim(), status: body.status });
    reply.code(201);
    // Every project starts with its overview document (its master page),
    // unless the caller opts out (`overview: false`, for imports).
    if (body.overview === false) return project;
    const seeded = await seedOverview(project, request);
    if (seeded.document) return { ...project, overviewDocumentId: seeded.document.id };
    return seeded.error ? { ...project, overviewError: seeded.error } : project;
  });

  // The project's overview document, created from the bundled starter when
  // the project has none: 201 with the new card, 200 with the existing one
  // (a verified project-card first, then the newest, then the exact title).
  // The seed is unverified whoever asks; an agent request is attributed.
  app.post('/api/projects/:id/overview', async (request, reply) => {
    if (!isValidUuid(request.params.id)) {
      reply.code(400);
      return { message: 'project id is invalid' };
    }
    const blocked = await refuseSystemProject(request.params.id, reply, 'given an overview');
    if (blocked) return blocked;
    const project = await repository.resolveProject(request.params.id);
    if (!project) {
      reply.code(404);
      return { message: 'project not found' };
    }
    if (!libraryRepository) {
      reply.code(409);
      return { message: 'the library is unavailable, so no overview can be filed' };
    }
    const result = await ensureProjectOverview({ libraryRepository, project, actor: actorOf(request) });
    if (result.archived) {
      reply.code(409);
      return { message: `The overview of "${project.name}" is in the Library archive: restore it (or delete it) before a new one is created.`, document: result.document };
    }
    if (result.created && result.document) embedLater(result.document.id);
    reply.code(result.created ? 201 : 200);
    return { project: { id: project.id, slug: project.slug, name: project.name }, document: result.document, created: result.created };
  });

  app.patch('/api/projects/:id', async (request, reply) => {
    if (!isValidUuid(request.params.id)) {
      reply.code(400);
      return { message: 'project id is invalid' };
    }
    const body = request.body;
    if (!isPlainObject(body)) {
      reply.code(400);
      return { message: 'project update is invalid' };
    }
    const fields = {};
    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim() === '') {
        reply.code(400);
        return { message: 'name is invalid' };
      }
      fields.name = body.name.trim();
    }
    if (body.status !== undefined) {
      if (!STATUSES.has(body.status)) {
        reply.code(400);
        return { message: 'status is invalid' };
      }
      fields.status = body.status;
    }
    if (body.sortOrder !== undefined) {
      if (!Number.isInteger(body.sortOrder)) {
        reply.code(400);
        return { message: 'sortOrder is invalid' };
      }
      fields.sortOrder = body.sortOrder;
    }
    // On-call owner, handoff notes, and the repo URL are free text; '' clears
    // them to null. The repo URL is stored AS ENTERED — matching normalizes at
    // lookup time (server/repoUrl.js), so an odd URL never 400s, it just never
    // matches.
    for (const key of ['onCall', 'handoffNotes', 'repoUrl']) {
      if (body[key] !== undefined) {
        if (typeof body[key] !== 'string') {
          reply.code(400);
          return { message: `${key} is invalid` };
        }
        const trimmed = body[key].trim();
        fields[key] = trimmed === '' ? null : trimmed;
      }
    }
    // Area is a section HEADER in the panel — bounded so one typo cannot
    // become a paragraph-wide heading. '' clears, like the other ops fields.
    if (body.area !== undefined) {
      if (typeof body.area !== 'string' || body.area.trim().length > 60) {
        reply.code(400);
        return { message: 'area is invalid' };
      }
      const trimmedArea = body.area.trim();
      fields.area = trimmedArea === '' ? null : trimmedArea;
    }
    if (Object.keys(fields).length === 0) {
      reply.code(400);
      return { message: 'project update requires at least one field' };
    }
    const blocked = await refuseSystemProject(request.params.id, reply, 'renamed or changed');
    if (blocked) return blocked;
    const project = await repository.updateProject(request.params.id, fields);
    if (!project) {
      reply.code(404);
      return { message: 'project not found' };
    }
    return project;
  });

  app.delete('/api/projects/:id', async (request, reply) => {
    if (!isValidUuid(request.params.id)) {
      reply.code(400);
      return { message: 'project id is invalid' };
    }
    const blocked = await refuseSystemProject(request.params.id, reply, 'archived');
    if (blocked) return blocked;
    const project = await repository.archiveProject(request.params.id);
    if (!project) {
      reply.code(404);
      return { message: 'project not found' };
    }
    return project;
  });

  // Permanent delete removes the project AND everything filed under it (tasks,
  // documents, staged imports) in one transaction — any project except the
  // system projects can go. The response carries what was removed so the UI can
  // report it; the UI gates the call behind a confirmation.
  app.delete('/api/projects/:id/permanent', async (request, reply) => {
    if (!isValidUuid(request.params.id)) {
      reply.code(400);
      return { message: 'project id is invalid' };
    }
    const blocked = await refuseSystemProject(request.params.id, reply, 'deleted');
    if (blocked) return blocked;
    const result = await repository.deleteProject(request.params.id);
    if (!result) {
      reply.code(404);
      return { message: 'project not found' };
    }
    if (result.deleted.tasks > 0) app.calendarPusher?.notifyBulkChange();
    return { ...result.project, deleted: result.deleted };
  });
}
