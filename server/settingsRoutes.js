import { isEmbedderSettingsError } from './embedderProvider.js';
import { isChatSettingsError } from './chatProvider.js';
import { isLoopbackHost } from './config.js';

const SETTING_KEY = 'semantic_search_enabled';
// Generic fields plus the legacy aliases the shipped UI still sends; the
// provider maps aliases onto the right backend's config.
const PROVIDER_FIELDS = ['backend', 'model', 'baseUrl', 'apiKey', 'ollamaUrl', 'openaiBaseUrl', 'openaiApiKey'];
// Chat provider fields (no legacy aliases — the chat provider is greenfield).
const CHAT_FIELDS = ['backend', 'model', 'baseUrl', 'apiKey', 'binaryPath'];

export async function registerSettingsRoutes(app, options = {}) {
  const config = options.config || {};
  const appSettings = options.appSettingsRepository || app.appSettingsRepository;
  const library = options.libraryRepository || app.libraryRepository;
  const embedderProvider = options.embedderProvider ?? app.embedderProvider ?? null;
  const chatProvider = options.chatProvider ?? app.chatProvider ?? null;
  // Behavioral tests may inject an embedder directly — it wins over the
  // runtime provider; the boot-time decorated embedder stays as the fallback.
  const injectedEmbedder = options.embedder ?? null;
  const injectedChat = options.chat ?? null;

  app.get('/api/settings/deployment', async () => {
    const bindHost = config.host || '127.0.0.1';
    return {
      authentication: 'none',
      bindHost,
      networkScope: isLoopbackHost(bindHost) ? 'local' : 'network',
      networkAcknowledged: Boolean(config.allowUnauthenticatedNetwork),
    };
  });

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

  async function semanticStatus() {
    const embedder = await resolveEmbedder();
    const settings = embedderProvider ? await embedderProvider.getSettings().catch(() => null) : null;
    const available = Boolean(embedder);
    const enabled = available
      ? Boolean(await appSettings.getSetting(SETTING_KEY, true).catch(() => false))
      : false;
    let connected = false;
    let counts = { total: 0, embedded: 0 };
    if (available) {
      connected = await embedder.isAvailable().catch(() => false);
      if (library.countEmbeddings) counts = await library.countEmbeddings(embedder.backend, embedder.model).catch(() => counts);
    }
    return {
      available,
      enabled,
      backend: available ? embedder.backend : null,
      connected,
      embeddedCount: counts.embedded,
      totalCount: counts.total,
      model: settings ? settings.model : '',
      baseUrl: settings ? settings.baseUrl : '',
      keyRequired: settings ? settings.keyRequired : false,
      hasApiKey: settings ? settings.hasApiKey : false,
      // Deprecated aliases (mapped from the ollama/openai configs) — kept for
      // one release so the current UI keeps working until it reads baseUrl.
      ollamaUrl: settings ? settings.ollamaUrl : '',
      openaiBaseUrl: settings ? settings.openaiBaseUrl : '',
    };
  }

  async function resolveChat() {
    if (injectedChat) return injectedChat;
    if (chatProvider) {
      try { return await chatProvider.getChat(); } catch { return null; }
    }
    return null;
  }

  // Status of the chat (LLM-answer) provider. `available` means a chat model is
  // configured (backend !== 'none'); `connected` means its host answered a cheap
  // reachability probe. Mirrors semanticStatus.
  async function chatStatus() {
    const chat = await resolveChat();
    const settings = chatProvider ? await chatProvider.getSettings().catch(() => null) : null;
    const available = Boolean(chat);
    const connected = available ? await chat.isAvailable().catch(() => false) : false;
    return {
      available,
      backend: settings ? settings.backend : (available ? chat.backend : 'none'),
      connected,
      model: settings ? settings.model : (available ? chat.model : ''),
      baseUrl: settings ? settings.baseUrl : '',
      keyRequired: settings ? settings.keyRequired : false,
      hasApiKey: settings ? settings.hasApiKey : false,
      binaryPath: settings ? (settings.binaryPath || '') : '',
    };
  }

  app.get('/api/settings/ai-answers', async () => chatStatus());

  app.put('/api/settings/ai-answers', async (request, reply) => {
    const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body) ? request.body : {};
    const patch = {};
    for (const field of CHAT_FIELDS) {
      if (body[field] !== undefined) patch[field] = body[field];
    }
    if (Object.keys(patch).length === 0) { reply.code(400); return { message: 'no settings provided' }; }
    if (!chatProvider) { reply.code(409); return { message: 'AI answers are not configured' }; }
    try {
      await chatProvider.putSettings(patch);
    } catch (err) {
      if (isChatSettingsError(err)) { reply.code(400); return { message: err.message }; }
      throw err;
    }
    return chatStatus();
  });

  app.get('/api/settings/semantic-search', async () => semanticStatus());

  app.put('/api/settings/semantic-search', async (request, reply) => {
    const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body) ? request.body : {};
    const patch = {};
    for (const field of PROVIDER_FIELDS) {
      if (body[field] !== undefined) patch[field] = body[field];
    }

    if (Object.keys(patch).length > 0) {
      // Provider reconfiguration: valid even when the current backend is
      // 'none' — this is how semantic search gets configured in the first
      // place. Invalid values map to 400.
      if (!embedderProvider) { reply.code(409); return { message: 'semantic search is not configured' }; }
      try {
        await embedderProvider.putSettings(patch);
      } catch (err) {
        if (isEmbedderSettingsError(err)) { reply.code(400); return { message: err.message }; }
        throw err;
      }
      if (body.enabled !== undefined) {
        await appSettings.putSetting(SETTING_KEY, Boolean(body.enabled));
      }
      return semanticStatus();
    }

    // Legacy shape: a bare { enabled } toggle, 409 when nothing is configured.
    const embedder = await resolveEmbedder();
    if (!embedder) { reply.code(409); return { message: 'semantic search is not configured' }; }
    await appSettings.putSetting(SETTING_KEY, Boolean(body.enabled));
    return semanticStatus();
  });

  // ---- Desktop capture shortcut ---------------------------------------------
  // The chord lives in app_settings (travels with backups, one source of
  // truth); the desktop shell fetches it once the server is ready and
  // re-registers live when the UI saves a change. '' means disabled — the
  // tray Capture item always works regardless.
  const CAPTURE_SHORTCUT_KEY = 'capture_shortcut';
  const CAPTURE_SHORTCUT_DEFAULT = 'CmdOrCtrl+Shift+Space';

  app.get('/api/settings/capture-shortcut', async () => {
    const stored = await appSettings.getSetting(CAPTURE_SHORTCUT_KEY, null).catch(() => null);
    return {
      shortcut: typeof stored === 'string' ? stored : CAPTURE_SHORTCUT_DEFAULT,
      default: CAPTURE_SHORTCUT_DEFAULT,
    };
  });

  app.put('/api/settings/capture-shortcut', async (request, reply) => {
    const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body) ? request.body : {};
    if (typeof body.shortcut !== 'string' || body.shortcut.length > 64) {
      reply.code(400);
      return { message: 'shortcut must be a string of at most 64 characters' };
    }
    // Stored as typed (trimmed); chord VALIDITY is the shell's verdict — it
    // is the only party that can truly know, and it reports failure honestly.
    await appSettings.putSetting(CAPTURE_SHORTCUT_KEY, body.shortcut.trim());
    const stored = await appSettings.getSetting(CAPTURE_SHORTCUT_KEY, null).catch(() => null);
    return { shortcut: typeof stored === 'string' ? stored : CAPTURE_SHORTCUT_DEFAULT, default: CAPTURE_SHORTCUT_DEFAULT };
  });
}
