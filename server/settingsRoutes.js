const SETTING_KEY = 'semantic_search_enabled';

export async function registerSettingsRoutes(app, options = {}) {
  const appSettings = options.appSettingsRepository || app.appSettingsRepository;
  const embedder = options.embedder ?? app.embedder ?? null;
  const library = options.libraryRepository || app.libraryRepository;

  async function semanticStatus() {
    const available = Boolean(embedder);
    const enabled = available ? Boolean(await appSettings.getSetting(SETTING_KEY, true)) : false;
    let connected = false;
    let counts = { total: 0, embedded: 0 };
    if (available) {
      connected = await embedder.isAvailable().catch(() => false);
      if (library.countEmbeddings) counts = await library.countEmbeddings(embedder.backend).catch(() => counts);
    }
    return {
      available,
      enabled,
      backend: available ? embedder.backend : null,
      connected,
      embeddedCount: counts.embedded,
      totalCount: counts.total,
    };
  }

  app.get('/api/settings/semantic-search', async () => semanticStatus());

  app.put('/api/settings/semantic-search', async (request, reply) => {
    if (!embedder) { reply.code(409); return { message: 'semantic search is not configured' }; }
    const enabled = Boolean(request.body && request.body.enabled);
    await appSettings.putSetting(SETTING_KEY, enabled);
    return semanticStatus();
  });

  // Expose for other routes to gate on.
  app.decorate('semanticEnabled', async () => {
    if (!embedder) return false;
    return Boolean(await appSettings.getSetting(SETTING_KEY, true));
  });
}
