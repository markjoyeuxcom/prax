import { createEmbedder } from './embedder/index.js';

// Runtime-configurable embedding provider. The active backend/model/urls/key
// live in app_settings under this key so the desktop app can switch providers
// without a restart; env config (loadConfig) supplies the defaults, so
// deployments that never touch the settings behave exactly as before.
export const EMBEDDING_PROVIDER_KEY = 'embedding_provider';

const BACKENDS = new Set(['none', 'fake', 'ollama', 'openai']);
const URL_FIELDS = ['ollamaUrl', 'openaiBaseUrl'];

function settingsError(message) {
  const err = new Error(message);
  err.name = 'EmbedderSettingsError';
  err.statusCode = 400; // routes translate this into a 400 response
  return err;
}

export function isEmbedderSettingsError(err) {
  return Boolean(err) && err.name === 'EmbedderSettingsError';
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// Stored settings are user data (and survive version changes): take only the
// keys we understand, with the right types. Anything else falls back to the
// env-derived defaults rather than breaking embedder construction.
function sanitizeStored(stored) {
  if (!isPlainObject(stored)) return {};
  const out = {};
  if (typeof stored.backend === 'string' && BACKENDS.has(stored.backend)) out.backend = stored.backend;
  if (typeof stored.model === 'string') out.model = stored.model;
  for (const field of URL_FIELDS) {
    if (typeof stored[field] === 'string' && isHttpUrl(stored[field])) out[field] = stored[field];
  }
  if (typeof stored.openaiApiKey === 'string') out.openaiApiKey = stored.openaiApiKey;
  return out;
}

function validatePatch(patch) {
  if (!isPlainObject(patch)) throw settingsError('settings payload is invalid');
  const out = {};
  if (patch.backend !== undefined) {
    if (typeof patch.backend !== 'string' || !BACKENDS.has(patch.backend)) throw settingsError('backend is invalid');
    out.backend = patch.backend;
  }
  if (patch.model !== undefined) {
    if (typeof patch.model !== 'string') throw settingsError('model is invalid');
    out.model = patch.model.trim();
  }
  for (const field of URL_FIELDS) {
    if (patch[field] !== undefined) {
      if (typeof patch[field] !== 'string' || !isHttpUrl(patch[field].trim())) throw settingsError(`${field} is invalid`);
      out[field] = patch[field].trim();
    }
  }
  if (patch.openaiApiKey !== undefined) {
    // Empty string explicitly clears the key; undefined leaves it unchanged.
    if (typeof patch.openaiApiKey !== 'string') throw settingsError('openaiApiKey is invalid');
    out.openaiApiKey = patch.openaiApiKey;
  }
  return out;
}

export function createEmbedderProvider({ appSettingsRepository = null, config = {} } = {}) {
  const defaults = {
    backend: BACKENDS.has(config.embeddingBackend) ? config.embeddingBackend : 'none',
    model: typeof config.embeddingModel === 'string' ? config.embeddingModel : '',
    ollamaUrl: config.ollamaUrl || 'http://127.0.0.1:11434',
    openaiBaseUrl: config.openaiBaseUrl || 'https://api.openai.com/v1',
    openaiApiKey: typeof config.openaiApiKey === 'string' ? config.openaiApiKey : '',
  };
  const queryPrefix = config.embeddingQueryPrefix || '';

  // Cache the constructed embedder (a `null` embedder for backend 'none' is a
  // valid cached value, hence the wrapper object) until settings change.
  let cached = null;

  async function resolveSettings() {
    const stored = appSettingsRepository
      ? await appSettingsRepository.getSetting(EMBEDDING_PROVIDER_KEY, null).catch(() => null)
      : null;
    return { ...defaults, ...sanitizeStored(stored) };
  }

  function redact(settings) {
    return {
      backend: settings.backend,
      model: settings.model,
      ollamaUrl: settings.ollamaUrl,
      openaiBaseUrl: settings.openaiBaseUrl,
      hasApiKey: Boolean(settings.openaiApiKey),
    };
  }

  return {
    async getEmbedder() {
      if (cached) return cached.embedder;
      const settings = await resolveSettings();
      const embedder = createEmbedder({
        embeddingBackend: settings.backend,
        embeddingModel: settings.model,
        ollamaUrl: settings.ollamaUrl,
        openaiBaseUrl: settings.openaiBaseUrl,
        openaiApiKey: settings.openaiApiKey,
        embeddingQueryPrefix: queryPrefix,
      });
      cached = { embedder };
      return embedder;
    },

    // The api key never leaves the provider — callers get `hasApiKey` only.
    async getSettings() {
      return redact(await resolveSettings());
    },

    async putSettings(patch) {
      const validated = validatePatch(patch);
      const current = await resolveSettings();
      const next = { ...current, ...validated };
      if (Object.keys(validated).length > 0) {
        if (!appSettingsRepository) throw new Error('settings repository is unavailable');
        await appSettingsRepository.putSetting(EMBEDDING_PROVIDER_KEY, next);
        cached = null;
      }
      return redact(next);
    },

    invalidate() {
      cached = null;
    },
  };
}
