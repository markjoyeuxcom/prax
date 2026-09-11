import { createEmbedder } from './embedder/index.js';

// Runtime-configurable embedding provider. The active backend plus one config
// per backend ({ baseUrl, apiKey, model }) live in app_settings under this key
// so the desktop app can switch providers without a restart — and switching
// back to a backend restores whatever the user entered for it. Env config
// (loadConfig) supplies the defaults, so deployments that never touch the
// settings behave exactly as before.
import { LOCAL_DEFAULT_MODEL } from './embedder/local.js';

export const EMBEDDING_PROVIDER_KEY = 'embedding_provider';

const BACKENDS = new Set(['none', 'fake', 'local', 'ollama', 'openai', 'llamacpp', 'gemini', 'voyage']);
// Hosted APIs refuse anonymous calls; local/offline backends work keyless.
const KEY_REQUIRED = new Set(['openai', 'gemini', 'voyage']);
// Pre-generalization field names the current UI still sends: each one maps
// onto a fixed backend's config, regardless of the active backend.
const LEGACY_ALIASES = [
  { field: 'ollamaUrl', backend: 'ollama', key: 'baseUrl' },
  { field: 'openaiBaseUrl', backend: 'openai', key: 'baseUrl' },
  { field: 'openaiApiKey', backend: 'openai', key: 'apiKey' },
];

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

// Take only the per-backend config keys we understand, with the right types.
function sanitizeConfig(cfg) {
  if (!isPlainObject(cfg)) return {};
  const out = {};
  if (typeof cfg.baseUrl === 'string' && isHttpUrl(cfg.baseUrl)) out.baseUrl = cfg.baseUrl;
  if (typeof cfg.model === 'string') out.model = cfg.model;
  if (typeof cfg.apiKey === 'string') out.apiKey = cfg.apiKey;
  return out;
}

// Stored settings are user data (and survive version changes): take only the
// keys we understand, with the right types. Anything else falls back to the
// env-derived defaults rather than breaking embedder construction. Reads also
// migrate the previous flat shape ({ backend, model, ollamaUrl, openaiBaseUrl,
// openaiApiKey }) into per-backend configs transparently.
function sanitizeStored(stored) {
  const out = { configs: {} };
  if (!isPlainObject(stored)) return out;
  if (typeof stored.backend === 'string' && BACKENDS.has(stored.backend)) out.backend = stored.backend;
  if (isPlainObject(stored.configs)) {
    for (const backend of BACKENDS) {
      const cfg = sanitizeConfig(stored.configs[backend]);
      if (Object.keys(cfg).length > 0) out.configs[backend] = cfg;
    }
    return out;
  }
  // Legacy flat shape: urls/key belong to their respective backend; the shared
  // model sticks to the backend it was active for.
  const ollama = sanitizeConfig({ baseUrl: stored.ollamaUrl });
  const openai = sanitizeConfig({ baseUrl: stored.openaiBaseUrl, apiKey: stored.openaiApiKey });
  if (typeof stored.model === 'string' && (out.backend === 'ollama' || out.backend === 'openai')) {
    (out.backend === 'ollama' ? ollama : openai).model = stored.model;
  }
  if (Object.keys(ollama).length > 0) out.configs.ollama = ollama;
  if (Object.keys(openai).length > 0) out.configs.openai = openai;
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
  if (patch.baseUrl !== undefined) {
    if (typeof patch.baseUrl !== 'string' || !isHttpUrl(patch.baseUrl.trim())) throw settingsError('baseUrl is invalid');
    out.baseUrl = patch.baseUrl.trim();
  }
  if (patch.apiKey !== undefined) {
    // Empty string explicitly clears the key; undefined leaves it unchanged.
    if (typeof patch.apiKey !== 'string') throw settingsError('apiKey is invalid');
    out.apiKey = patch.apiKey;
  }
  const aliases = [];
  for (const { field, backend, key } of LEGACY_ALIASES) {
    if (patch[field] === undefined) continue;
    if (typeof patch[field] !== 'string') throw settingsError(`${field} is invalid`);
    const value = key === 'baseUrl' ? patch[field].trim() : patch[field];
    if (key === 'baseUrl' && !isHttpUrl(value)) throw settingsError(`${field} is invalid`);
    aliases.push({ backend, key, value });
  }
  if (aliases.length > 0) out.aliases = aliases;
  return out;
}

export function createEmbedderProvider({ appSettingsRepository = null, config = {} } = {}) {
  const defaultBackend = BACKENDS.has(config.embeddingBackend) ? config.embeddingBackend : 'none';
  // Per-backend defaults. Env config keeps seeding ollama/openai like before;
  // the newer backends ship static defaults (no env surface).
  const defaults = {
    none: {},
    fake: {},
    ollama: {
      baseUrl: config.ollamaUrl || 'http://127.0.0.1:11434',
      model: config.embeddingModel || 'nomic-embed-text',
    },
    openai: {
      baseUrl: config.openaiBaseUrl || 'https://api.openai.com/v1',
      model: 'text-embedding-3-small',
      apiKey: typeof config.openaiApiKey === 'string' ? config.openaiApiKey : '',
    },
    // In-process embeddings: no base URL, because there is no server to reach.
    local: { baseUrl: '', model: LOCAL_DEFAULT_MODEL },
    llamacpp: { baseUrl: 'http://127.0.0.1:8080/v1', model: '' },
    gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-embedding-001' },
    voyage: { baseUrl: 'https://api.voyageai.com/v1', model: 'voyage-3-large' },
  };
  // EMBEDDING_MODEL follows the env-selected backend so pre-existing env
  // deployments (e.g. openai + a custom model) keep their exact behavior.
  if (config.embeddingModel && defaults[defaultBackend]?.model !== undefined) {
    defaults[defaultBackend] = { ...defaults[defaultBackend], model: config.embeddingModel };
  }
  const queryPrefix = config.embeddingQueryPrefix || '';

  // Cache the constructed embedder (a `null` embedder for backend 'none' is a
  // valid cached value, hence the wrapper object) until settings change.
  let cached = null;

  function mergedConfig(backend, configs) {
    return { ...defaults[backend], ...(configs[backend] || {}) };
  }

  async function resolveState() {
    const stored = appSettingsRepository
      ? await appSettingsRepository.getSetting(EMBEDDING_PROVIDER_KEY, null).catch(() => null)
      : null;
    const sane = sanitizeStored(stored);
    return { backend: sane.backend || defaultBackend, configs: sane.configs };
  }

  // The api key never leaves the provider — callers get `hasApiKey` only.
  function redact(state) {
    const active = mergedConfig(state.backend, state.configs);
    return {
      backend: state.backend,
      baseUrl: active.baseUrl || '',
      model: active.model || '',
      hasApiKey: Boolean(active.apiKey),
      keyRequired: KEY_REQUIRED.has(state.backend),
      // Deprecated aliases the shipped UI still reads — served for one release
      // until the frontend switches to the generic baseUrl field.
      ollamaUrl: mergedConfig('ollama', state.configs).baseUrl,
      openaiBaseUrl: mergedConfig('openai', state.configs).baseUrl,
    };
  }

  return {
    async getEmbedder() {
      if (cached) return cached.embedder;
      const state = await resolveState();
      const active = mergedConfig(state.backend, state.configs);
      const embedder = createEmbedder({
        embeddingBackend: state.backend,
        embeddingModel: active.model || '',
        baseUrl: active.baseUrl,
        apiKey: active.apiKey,
        embeddingQueryPrefix: queryPrefix,
      });
      cached = { embedder };
      return embedder;
    },

    async getSettings() {
      return redact(await resolveState());
    },

    // Generic fields ({ backend?, baseUrl?, apiKey?, model? }) apply to the
    // (possibly newly selected) active backend's config; legacy aliases apply
    // to their own backend. Other backends' configs are left untouched.
    async putSettings(patch) {
      const validated = validatePatch(patch);
      const state = await resolveState();
      const backend = validated.backend ?? state.backend;
      const configs = { ...state.configs };
      const apply = (target, key, value) => {
        configs[target] = { ...configs[target], [key]: value };
      };
      if (validated.baseUrl !== undefined) apply(backend, 'baseUrl', validated.baseUrl);
      if (validated.model !== undefined) apply(backend, 'model', validated.model);
      if (validated.apiKey !== undefined) apply(backend, 'apiKey', validated.apiKey);
      for (const { backend: target, key, value } of validated.aliases || []) apply(target, key, value);
      const next = { backend, configs };
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
