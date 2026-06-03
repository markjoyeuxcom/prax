import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { runMigrations } from './migrate.js';
import { registerTasksRoutes } from './tasksRoutes.js';
import { registerLibraryRoutes } from './libraryRoutes.js';
import { registerProjectsRoutes } from './projectsRoutes.js';
import { registerChecklistRoutes } from './checklistRoutes.js';
import { createLibraryRepository } from './libraryRepository.js';
import { createAppSettingsRepository } from './appSettingsRepository.js';
import { createEmbedder } from './embedder/index.js';
import { createEmbeddingService } from './embeddingService.js';
import { registerSettingsRoutes } from './settingsRoutes.js';

export async function buildApp(options = {}) {
  const config = options.config || loadConfig();
  const app = Fastify({ logger: options.logger || false });
  const db = options.db || (options.skipDb ? null : createDb(config.databaseUrl));

  if (db && !options.skipDb && !options.db) {
    await runMigrations(db, { logger: app.log });
  }

  const libraryRepository = options.libraryRepository || (db ? createLibraryRepository(db) : null);
  const embedder = options.embedder ?? createEmbedder(config);
  const appSettingsRepository = options.appSettingsRepository || (db ? createAppSettingsRepository(db) : null);
  const embeddingService = options.embeddingService ?? (embedder && libraryRepository ? createEmbeddingService({ repository: libraryRepository, embedder }) : null);

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
  app.decorate('libraryRepository', libraryRepository);
  app.decorate('projectsRepository', options.projectsRepository || null);
  app.decorate('checklistRepository', options.checklistRepository || null);
  app.decorate('documentLinksRepository', options.documentLinksRepository || null);
  app.decorate('embedder', embedder);
  app.decorate('appSettingsRepository', appSettingsRepository);
  app.decorate('embeddingService', embeddingService);
  await registerTasksRoutes(app, options);
  await registerLibraryRoutes(app, options);
  await registerProjectsRoutes(app, options);
  await registerChecklistRoutes(app, options);
  await registerSettingsRoutes(app, { appSettingsRepository, embedder, libraryRepository });

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
