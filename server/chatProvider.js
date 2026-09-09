import { createChat } from './chat/index.js';

// Runtime-configurable chat (LLM answer) provider — the generation-side mirror of
// embedderProvider. The active backend plus one config per backend
// ({ baseUrl, apiKey, model }) live in app_settings under this key so the desktop
// app can switch models without a restart. Env config (loadConfig) supplies the
// defaults, so env-only deployments behave predictably.
export const CHAT_PROVIDER_KEY = 'chat_provider';

const BACKENDS = new Set(['none', 'fake', 'ollama', 'openai', 'llamacpp', 'anthropic', 'gemini', 'claude-cli', 'copilot-cli']);
// Hosted APIs refuse anonymous calls; local/offline backends work keyless.
const KEY_REQUIRED = new Set(['openai', 'anthropic', 'gemini']);

function settingsError(message) {
  const err = new Error(message);
  err.name = 'ChatSettingsError';
  err.statusCode = 400; // routes translate this into a 400 response
  return err;
}

export function isChatSettingsError(err) {
  return Boolean(err) && err.name === 'ChatSettingsError';
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
  if (typeof cfg.binaryPath === 'string') out.binaryPath = cfg.binaryPath;
  return out;
}

// Stored settings are user data: take only the keys we understand, with the
// right types; anything else falls back to env-derived defaults.
function sanitizeStored(stored) {
  const out = { configs: {} };
  if (!isPlainObject(stored)) return out;
  if (typeof stored.backend === 'string' && BACKENDS.has(stored.backend)) out.backend = stored.backend;
  if (isPlainObject(stored.configs)) {
    for (const backend of BACKENDS) {
      const cfg = sanitizeConfig(stored.configs[backend]);
      if (Object.keys(cfg).length > 0) out.configs[backend] = cfg;
    }
  }
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
  if (patch.binaryPath !== undefined) {
    // A filesystem path, not a URL; '' means auto-detect.
    if (typeof patch.binaryPath !== 'string' || patch.binaryPath.length > 500) throw settingsError('binaryPath is invalid');
    out.binaryPath = patch.binaryPath.trim();
  }
  return out;
}

export function createChatProvider({ appSettingsRepository = null, config = {} } = {}) {
  const defaultBackend = BACKENDS.has(config.chatBackend) ? config.chatBackend : 'none';
  // Per-backend defaults. Env config seeds ollama/openai/anthropic; the others
  // ship static defaults (no env surface). Chat models default to fast, cheap
  // options suited to grounded RAG answering.
  const defaults = {
    none: {},
    fake: {},
    ollama: {
      baseUrl: config.ollamaUrl || 'http://127.0.0.1:11434',
      model: 'llama3.1',
    },
    openai: {
      baseUrl: config.openaiBaseUrl || 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: typeof config.openaiApiKey === 'string' ? config.openaiApiKey : '',
    },
    llamacpp: { baseUrl: 'http://127.0.0.1:8080/v1', model: '' },
    anthropic: {
      baseUrl: config.anthropicBaseUrl || 'https://api.anthropic.com',
      model: 'claude-haiku-4-5-20251001',
      apiKey: typeof config.anthropicApiKey === 'string' ? config.anthropicApiKey : '',
    },
    gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash' },
    // The local `claude` login is the credential: keyless by design. 'haiku'
    // is a CLI model alias — fast enough for the interactive NL surfaces.
    'claude-cli': { model: 'haiku', binaryPath: '' },
    'copilot-cli': { model: 'auto', binaryPath: '' },
  };
  // CHAT_MODEL follows the env-selected backend so an env-only deployment keeps
  // its exact model.
  if (config.chatModel && defaults[defaultBackend]?.model !== undefined) {
    defaults[defaultBackend] = { ...defaults[defaultBackend], model: config.chatModel };
  }

  // Cache the constructed chat model until settings change (a `null` model for
  // backend 'none' is a valid cached value, hence the wrapper object).
  let cached = null;

  function mergedConfig(backend, configs) {
    return { ...defaults[backend], ...(configs[backend] || {}) };
  }

  async function resolveState() {
    const stored = appSettingsRepository
      ? await appSettingsRepository.getSetting(CHAT_PROVIDER_KEY, null).catch(() => null)
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
      binaryPath: active.binaryPath || '',
    };
  }

  return {
    async getChat() {
      if (cached) return cached.chat;
      const state = await resolveState();
      const active = mergedConfig(state.backend, state.configs);
      const chat = createChat({
        chatBackend: state.backend,
        chatModel: active.model || '',
        baseUrl: active.baseUrl,
        apiKey: active.apiKey,
        binaryPath: active.binaryPath,
      });
      cached = { chat };
      return chat;
    },

    async getSettings() {
      return redact(await resolveState());
    },

    async putSettings(patch) {
      const validated = validatePatch(patch);
      const state = await resolveState();
      const backend = validated.backend ?? state.backend;
      const configs = { ...state.configs };
      const apply = (key, value) => {
        configs[backend] = { ...configs[backend], [key]: value };
      };
      if (validated.baseUrl !== undefined) apply('baseUrl', validated.baseUrl);
      if (validated.model !== undefined) apply('model', validated.model);
      if (validated.apiKey !== undefined) apply('apiKey', validated.apiKey);
      if (validated.binaryPath !== undefined) apply('binaryPath', validated.binaryPath);
      const next = { backend, configs };
      if (Object.keys(validated).length > 0) {
        if (!appSettingsRepository) throw new Error('settings repository is unavailable');
        await appSettingsRepository.putSetting(CHAT_PROVIDER_KEY, next);
        cached = null;
      }
      return redact(next);
    },

    invalidate() {
      cached = null;
    },
  };
}
