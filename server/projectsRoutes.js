import { createProjectsRepository } from './projectsRepository.js';

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
    reply.code(201);
    return repository.createProject({ name: body.name.trim(), status: body.status });
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
    if (Object.keys(fields).length === 0) {
      reply.code(400);
      return { message: 'project update requires at least one field' };
    }
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
    const project = await repository.archiveProject(request.params.id);
    if (!project) {
      reply.code(404);
      return { message: 'project not found' };
    }
    return project;
  });

  app.delete('/api/projects/:id/permanent', async (request, reply) => {
    if (!isValidUuid(request.params.id)) {
      reply.code(400);
      return { message: 'project id is invalid' };
    }
    const dependents = await repository.countProjectDependents(request.params.id);
    if (dependents > 0) {
      reply.code(409);
      return { message: 'project still has tasks or documents' };
    }
    let project;
    try {
      project = await repository.deleteProject(request.params.id);
    } catch (err) {
      // A dependent added between the count check and the delete trips the FK
      // (23503); surface it as the same 409 rather than a 500.
      if (err && err.code === '23503') {
        reply.code(409);
        return { message: 'project still has tasks or documents' };
      }
      throw err;
    }
    if (!project) {
      reply.code(404);
      return { message: 'project not found' };
    }
    return project;
  });
}
