import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { registerTasksRoutes } from './tasksRoutes.js';
import { registerLibraryRoutes } from './libraryRoutes.js';
import { registerProjectsRoutes } from './projectsRoutes.js';

export async function buildApp(options = {}) {
  const config = options.config || loadConfig();
  const app = Fastify({ logger: options.logger || false });
  const db = options.db || (options.skipDb ? null : createDb(config.databaseUrl));

  app.decorate('db', db);

  app.get('/healthz', async () => ({ status: 'ok' }));

  app.get('/readyz', async (_request, reply) => {
    try {
      if (db) await db.checkReady();
      return { status: 'ready' };
    } catch {
      reply.code(503);
      return { status: 'not-ready' };
    }
  });

  app.decorate('tasksRepository', options.tasksRepository || null);
  app.decorate('libraryRepository', options.libraryRepository || null);
  app.decorate('projectsRepository', options.projectsRepository || null);
  await registerTasksRoutes(app, options);
  await registerLibraryRoutes(app, options);
  await registerProjectsRoutes(app, options);

  await app.register(fastifyStatic, {
    root: config.publicDir,
    prefix: '/',
  });

  app.addHook('onClose', async () => {
    if (db?.close) await db.close();
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  const app = await buildApp({ config, logger: true });
  await app.listen({ host: config.host, port: config.port });
}
