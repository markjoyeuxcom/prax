import { isEmbedderSettingsError } from './embedderProvider.js';

const SETTING_KEY = 'semantic_search_enabled';
// Generic fields plus the legacy aliases the shipped UI still sends; the
// provider maps aliases onto the right backend's config.
const PROVIDER_FIELDS = ['backend', 'model', 'baseUrl', 'apiKey', 'ollamaUrl', 'openaiBaseUrl', 'openaiApiKey'];

export async function registerSettingsRoutes(app, options = {}) {
  const appSettings = options.appSettingsRepository || app.appSettingsRepository;
  const library = options.libraryRepository || app.libraryRepository;
  const embedderProvider = options.embedderProvider ?? app.embedderProvider ?? null;
  // Behavioral tests may inject an embedder directly — it wins over the
  // runtime provider; the boot-time decorated embedder stays as the fallback.
  const injectedEmbedder = options.embedder ?? null;

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
}
