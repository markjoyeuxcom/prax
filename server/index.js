import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { assertSafeNetworkBinding, isLoopbackHost, loadConfig } from './config.js';
import { createDb } from './db.js';
import { runMigrations } from './migrate.js';
import { registerTasksRoutes } from './tasksRoutes.js';
import { registerLibraryRoutes } from './libraryRoutes.js';
import { registerProjectsRoutes } from './projectsRoutes.js';
import { registerChecklistRoutes } from './checklistRoutes.js';
import { createLibraryRepository } from './libraryRepository.js';
import { createAppSettingsRepository } from './appSettingsRepository.js';
import { createEmbedder } from './embedder/index.js';
import { createEmbedderProvider } from './embedderProvider.js';
import { createChatProvider } from './chatProvider.js';
import { registerSettingsRoutes } from './settingsRoutes.js';
import { registerAssistantRoutes } from './assistantRoutes.js';
import {
  announceDesktopReady,
  createGracefulShutdown,
  installDesktopStdinControl,
} from './desktopLifecycle.js';

export async function buildApp(options = {}) {
  const config = options.config || loadConfig();
  const app = Fastify({ logger: options.logger || false });
  const db = options.db || (options.skipDb ? null : createDb(config.databaseFile));

  // The desktop webview exposes a deliberately tiny native IPC surface, so
  // served content must not be able to load arbitrary script or embed Prax in
  // another page. `unsafe-inline` remains style-only because the current UI
  // uses constrained inline layout/custom-property values; scripts are local.
  app.addHook('onSend', async (_request, reply, payload) => {
    reply
      .header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' ipc: http://ipc.localhost; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
      .header('Referrer-Policy', 'no-referrer')
      .header('X-Content-Type-Options', 'nosniff')
      .header('X-Frame-Options', 'DENY');
    return payload;
  });

  if (db && !options.skipDb && !options.db) {
    await runMigrations(db, { logger: app.log });
  }

  const libraryRepository = options.libraryRepository || (db ? createLibraryRepository(db) : null);
  const embedder = options.embedder ?? createEmbedder(config);
  const appSettingsRepository = options.appSettingsRepository || (db ? createAppSettingsRepository(db) : null);
  // Runtime provider config (app_settings) with env config as the defaults.
  // Routes resolve their embedder through this per request; an embedder
  // injected via options still wins inside the routes (test compatibility).
  const embedderProvider = options.embedderProvider ?? createEmbedderProvider({ appSettingsRepository, config });
  // Runtime chat (LLM-answer) provider — the generation-side mirror of the
  // embedder provider. Routes resolve their chat model through this per request.
  const chatProvider = options.chatProvider ?? createChatProvider({ appSettingsRepository, config });
  // The embedding service is built per use by the routes so it always binds
  // the currently configured embedder; injected services are honoured as-is.
  const embeddingService = options.embeddingService ?? null;

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
  app.decorate('documentExternalRefsRepository', options.documentExternalRefsRepository || null);
  app.decorate('embedder', embedder);
  app.decorate('embedderProvider', embedderProvider);
  app.decorate('chatProvider', chatProvider);
  app.decorate('appSettingsRepository', appSettingsRepository);
  app.decorate('embeddingService', embeddingService);
  app.decorate('embeddingSearch', {
    minSimilarity: config.embeddingSearchMinSimilarity,
    topDrop: config.embeddingSearchTopDrop,
  });
  await registerTasksRoutes(app, options);
  await registerLibraryRoutes(app, options);
  await registerProjectsRoutes(app, options);
  await registerChecklistRoutes(app, options);
  await registerSettingsRoutes(app, { config, appSettingsRepository, embedder: options.embedder, embedderProvider, chat: options.chat, chatProvider, libraryRepository });
  registerAssistantRoutes(app, options);

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
  // The refusal lives on the listen path, not in loadConfig: non-listening
  // CLIs (backup, migrate) read the same env and must keep working under a
  // HOST=0.0.0.0 deployment.
  assertSafeNetworkBinding(config);
  const address = await app.listen({ host: config.host, port: config.port });
  // The bind must be loud: a container publishing a loopback-bound port
  // black-holes with otherwise healthy logs, and a non-loopback bind exposes
  // an API with no built-in authentication.
  app.log.info(`Prax bound to host ${config.host} port ${config.port} (${address})`);
  if (!isLoopbackHost(config.host)) {
    app.log.warn(
      `Prax is reachable beyond this machine on host ${config.host} and has no built-in `
      + 'authentication; restrict exposure at the network boundary (container/firewall/proxy)',
    );
  }

  const shutdown = createGracefulShutdown({
    close: () => app.close(),
    exit(code, error) {
      if (error) app.log.error({ err: error }, 'graceful shutdown failed');
      process.exit(code);
    },
  });

  if (process.env.PRAX_DESKTOP_CONTROL === 'stdio') {
    installDesktopStdinControl({ input: process.stdin, shutdown });
    announceDesktopReady(process.stdout, address);
  }

  // Graceful shutdown: close Fastify (which closes the embedded database via
  // the onClose hook) before exiting. The desktop wrapper and orchestrators
  // send SIGTERM; Ctrl-C sends SIGINT.
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => { void shutdown(); });
  }
}
