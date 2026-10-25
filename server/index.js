import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { assertSafeNetworkBinding, hostCheckEnabled, isAllowedHostHeader, isCrossSiteRequest, isLoopbackHost, loadConfig } from './config.js';
import { createDb } from './db.js';
import { runMigrations } from './migrate.js';
import { registerInboxRoutes } from './inboxRoutes.js';
import { registerWorkspaceBackupRoutes } from './workspaceBackup.js';
import { applyPendingRestore, registerGitBackupRoutes } from './gitBackup.js';
import { registerTasksRoutes } from './tasksRoutes.js';
import { registerLibraryRoutes } from './libraryRoutes.js';
import { registerMemoryChangesRoutes } from './memoryChangesRoutes.js';
import { registerStarterContentRoutes } from './starterContent.js';
import { registerProjectsRoutes } from './projectsRoutes.js';
import { registerChecklistRoutes } from './checklistRoutes.js';
import { createLibraryRepository } from './libraryRepository.js';
import { createAppSettingsRepository } from './appSettingsRepository.js';
import { createEmbedder } from './embedder/index.js';
import { createEmbedderProvider } from './embedderProvider.js';
import { createChatProvider } from './chatProvider.js';
import { registerSettingsRoutes } from './settingsRoutes.js';
import { registerGoogleCalendarRoutes } from './googleCalendarRoutes.js';
import { registerAssistantRoutes } from './assistantRoutes.js';
import { createRecallTelemetry } from './recallTelemetry.js';
import { registerLibrarianRoutes } from './librarianRoutes.js';
import {
  announceDesktopFailure,
  announceDesktopReady,
  reportDesktopStartupProgress,
  savedDesktopPort,
  persistDesktopPort,
  createGracefulShutdown,
  installDesktopStdinControl,
} from './desktopLifecycle.js';

// Drops Fastify's per-request info lines (incoming, completed, route not
// found), which carry full URLs including search terms, and keeps every
// error and warning line.
class QuietRequestLogController extends Fastify.LogController {
  incomingRequest() {}

  requestCompleted(error, request, reply, metadata) {
    if (error) super.requestCompleted(error, request, reply, metadata);
  }

  routeNotFound() {}
}

export async function buildApp(options = {}) {
  const config = options.config || loadConfig();
  const app = Fastify({
    logger: options.logger || false,
    logController: options.quietRequestLogging ? new QuietRequestLogController() : undefined,
  });
  // A restore staged from the git backup (server/gitBackup.js) is applied
  // here, before the database opens: the server never swaps the file it has
  // open. A failed apply keeps the previous database and records why.
  if (!options.db && !options.skipDb && options.applyPendingRestore !== false) {
    applyPendingRestore(config.databaseFile, { log: app.log });
  }
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

  // DNS rebinding: a page on attacker.example whose name resolves to this
  // machine is same-origin with itself, so a browser will send its requests
  // here — unauthenticated — with `Host: attacker.example`. On a loopback bind
  // the only honest Host names are loopback names, so anything else is refused
  // before routing. A loopback bind behind a local reverse proxy sees the
  // public name instead; that deployment acknowledges its exposure with
  // PRAX_ALLOW_UNAUTHENTICATED_NETWORK=true, which also lifts this check.
  // PRAX_ALLOWED_HOSTS turns the check on for any bind (the container image
  // listens on 0.0.0.0 but is published on loopback) and lists extra names.
  if (hostCheckEnabled(config)) {
    app.addHook('onRequest', async (request, reply) => {
      if (request.hostname && !isAllowedHostHeader(request.hostname, config)) {
        reply.code(403).send({ message: 'Host header must name this machine (loopback) or a name in PRAX_ALLOWED_HOSTS; see SECURITY.md on DNS rebinding' });
      }
    });
  }

  // Cross-site request forgery (see isCrossSiteRequest): a page on another
  // site may not change data here. Applies to every bind and survives
  // PRAX_ALLOWED_HOSTS=* — it guards the user's browser, not the network.
  app.addHook('onRequest', async (request, reply) => {
    if (!reply.sent && isCrossSiteRequest(request, config)) {
      return reply.code(403).send({ message: 'Cross-site requests cannot change Prax data; see SECURITY.md on cross-site requests' });
    }
  });

  if (db && !options.skipDb && !options.db) {
    let outcome;
    try {
      outcome = await runMigrations(db, {
        logger: app.log,
        onProgress: options.migrationProgress,
        signal: options.signal,
      });
    } catch (error) {
      await db.close?.();
      throw error;
    }
    if (outcome.stopped) {
      // A shutdown arrived between migrations: the finished ones are
      // committed, the rest run on the next start.
      await db.close?.();
      throw Object.assign(new Error('Startup stopped by a shutdown request'), { code: 'PRAX_STARTUP_STOPPED' });
    }
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
  app.decorate('documentCodeRefsRepository', options.documentCodeRefsRepository || null);
  app.decorate('embedder', embedder);
  app.decorate('embedderProvider', embedderProvider);
  app.decorate('chatProvider', chatProvider);
  app.decorate('appSettingsRepository', appSettingsRepository);
  app.decorate('embeddingService', embeddingService);
  // Recall telemetry needs the real database; an injected store (tests) wins.
  app.decorate('recallTelemetry', options.recallTelemetry !== undefined
    ? options.recallTelemetry
    : (db ? createRecallTelemetry(db, { enabled: config.recallTelemetry !== false }) : null));
  app.decorate('embeddingSearch', {
    minSimilarity: config.embeddingSearchMinSimilarity,
    minSimilarityExplicit: Boolean(config.embeddingSearchMinSimilarityExplicit),
    topDrop: config.embeddingSearchTopDrop,
  });
  await registerTasksRoutes(app, options);
  await registerLibraryRoutes(app, options);
  await registerMemoryChangesRoutes(app, options);
  await registerLibrarianRoutes(app, options);
  registerStarterContentRoutes(app);
  await registerProjectsRoutes(app, options);
  registerInboxRoutes(app, options);
  registerWorkspaceBackupRoutes(app);
  registerGitBackupRoutes(app, { config, appSettingsRepository, db, gitRunner: options.gitRunner, sweep: options.gitBackupSweep, sweepIntervalMs: options.gitBackupSweepIntervalMs });
  await registerChecklistRoutes(app, options);
  await registerSettingsRoutes(app, { config, appSettingsRepository, embedder: options.embedder, embedderProvider, chat: options.chat, chatProvider, libraryRepository });
  await registerGoogleCalendarRoutes(app, { ...options, appSettingsRepository });
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

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

async function main() {
  const config = loadConfig();
  const desktop = process.env.PRAX_DESKTOP_CONTROL === 'stdio';
  const desktopPortFile = desktop ? process.env.PRAX_DESKTOP_PORT_FILE : null;

  // Shutdown is wired before the database opens, not after listen. A long
  // upgrade migration can outlast a supervisor's startup budget; a quit
  // request, a closed stdin or a signal that arrives meanwhile stops the run
  // at the next migration boundary (each migration is its own transaction)
  // and closes the database instead of waiting for a force-kill.
  const startup = new AbortController();
  let building = null;
  const shutdown = createGracefulShutdown({
    async close() {
      startup.abort();
      const app = await building?.catch(() => null);
      await app?.close();
    },
    exit(code, error) {
      if (error) console.error('[prax] graceful shutdown failed', error);
      process.exit(code);
    },
  });
  if (desktop) installDesktopStdinControl({ input: process.stdin, shutdown });
  // Graceful shutdown: close Fastify (which closes the embedded database via
  // the onClose hook) before exiting. The desktop wrapper and orchestrators
  // send SIGTERM; Ctrl-C sends SIGINT.
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => { void shutdown(); });
  }

  try {
    if (desktopPortFile) config.port = savedDesktopPort(desktopPortFile);
    building = buildApp({
      config,
      logger: true,
      // The desktop log lives on the person's disk for the whole session. A
      // line per request, with CLI search terms in its query string, is noise
      // there; errors and lifecycle lines are still logged.
      quietRequestLogging: desktop,
      signal: startup.signal,
      // Each migration boundary yields to the event loop so the shutdown
      // wiring above can run; the desktop also reports it to the shell.
      migrationProgress: desktop
        ? (event) => reportDesktopStartupProgress(process.stdout, event)
        : yieldToEventLoop,
    });
    const app = await building;
    if (startup.signal.aborted) return;
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

    if (desktop) {
      persistDesktopPort(desktopPortFile, address);
      announceDesktopReady(process.stdout, address);
    }
  } catch (error) {
    if (startup.signal.aborted || error?.code === 'PRAX_STARTUP_STOPPED') {
      await shutdown();
      return;
    }
    // The stack goes to the log; the desktop shell reads the one structured
    // line and tells the person what to do about it.
    console.error('[prax] startup failed', error);
    if (desktop) announceDesktopFailure(process.stdout, error, config.port);
    const app = await building?.catch(() => null);
    await app?.close().catch(() => {});
    process.exit(1);
  }
}

function yieldToEventLoop() {
  return new Promise((resolve) => { setImmediate(resolve); });
}
