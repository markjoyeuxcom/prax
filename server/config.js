import { fileURLToPath } from 'node:url';

// Parse a numeric env var, falling back to the default for anything that isn't a
// finite number. A bare Number() would turn garbage ('abc') into NaN, which in the
// relevance-cutoff math (max(NaN, …) → NaN; x >= NaN → false) would silently make
// semantic search return zero results for every query — a safe default beats that.
function isNumberEnv(value) {
  return value != null && value !== '' && Number.isFinite(Number(value));
}

function numberFromEnv(value, fallback) {
  return isNumberEnv(value) ? Number(value) : fallback;
}

// Prax has no built-in authentication. Keep host classification deliberately
// conservative: an arbitrary hostname may resolve beyond this machine, so only
// the conventional localhost name and literal loopback ranges are local.
export function isLoopbackHost(value) {
  const host = String(value || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  if (/^127(?:\.\d{1,3}){3}$/.test(host)) {
    return host.split('.').every((part) => Number(part) >= 0 && Number(part) <= 255);
  }
  if (host.startsWith('::ffff:')) return isLoopbackHost(host.slice('::ffff:'.length));
  return false;
}

// Must run immediately before every listen call — never inside loadConfig.
// Non-listening CLIs (backup, migrate) load the same env-derived config, and a
// listener-only safety check must not cost a HOST=0.0.0.0 deployment its
// backup tooling.
export function assertSafeNetworkBinding(config) {
  if (isLoopbackHost(config.host) || config.allowUnauthenticatedNetwork === true) return;
  throw new Error(
    `Refusing to bind unauthenticated Prax to non-loopback host "${config.host}". `
    + 'Prax has no built-in authentication. Use HOST=127.0.0.1, or set '
    + 'PRAX_ALLOW_UNAUTHENTICATED_NETWORK=true only for a trusted network or behind an '
    + 'authenticated TLS proxy.',
  );
}

export function loadConfig(env = process.env) {
  const config = {
    // Secure local-first default. Containers/orchestrators that need pod-level
    // reachability must set HOST=0.0.0.0 and explicitly acknowledge the
    // resulting unauthenticated network listener.
    host: env.HOST || '127.0.0.1',
    port: Number(env.PORT || 3000),
    allowUnauthenticatedNetwork: env.PRAX_ALLOW_UNAUTHENTICATED_NETWORK === 'true',
    // Embedded SQLite file. PRAX_DB_FILE is canonical; DATABASE_URL is still
    // read as a plain file path so pre-rename setups keep working. The
    // desktop wrapper points this at the OS app-data directory.
    databaseFile: env.PRAX_DB_FILE || env.DATABASE_URL || 'prax.db',
    publicDir: env.PUBLIC_DIR || fileURLToPath(new URL('../public', import.meta.url)),
    embeddingBackend: env.EMBEDDING_BACKEND || 'none',
    embeddingModel: env.EMBEDDING_MODEL || '',
    ollamaUrl: env.OLLAMA_URL || 'http://127.0.0.1:11434',
    openaiBaseUrl: env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    openaiApiKey: env.OPENAI_API_KEY || '',
    embeddingQueryPrefix: env.EMBEDDING_QUERY_PREFIX || '',
    embeddingSearchMinSimilarity: numberFromEnv(env.EMBEDDING_SEARCH_MIN_SIMILARITY, 0.45),
    // Whether an operator actually chose that floor. Without this the route
    // cannot tell a deliberate 0.45 from the default, and a backend that knows
    // its own vectors better would either be ignored or would silently override
    // a setting someone made on purpose. Only a value that PARSED counts:
    // garbage falls back to the default above and must not also pin it.
    embeddingSearchMinSimilarityExplicit: isNumberEnv(env.EMBEDDING_SEARCH_MIN_SIMILARITY),
    embeddingSearchTopDrop: numberFromEnv(env.EMBEDDING_SEARCH_TOP_DROP, 0.20),
    // Chat / LLM-answer provider (generation layer). Env supplies defaults; the
    // runtime chatProvider persists per-backend overrides in app_settings.
    // openai/ollama chat reuse the OPENAI_*/OLLAMA_URL vars above.
    chatBackend: env.CHAT_BACKEND || 'none',
    chatModel: env.CHAT_MODEL || '',
    anthropicBaseUrl: env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
    anthropicApiKey: env.ANTHROPIC_API_KEY || '',
  };
  return config;
}
