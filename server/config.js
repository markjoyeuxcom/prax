// Parse a numeric env var, falling back to the default for anything that isn't a
// finite number. A bare Number() would turn garbage ('abc') into NaN, which in the
// relevance-cutoff math (max(NaN, …) → NaN; x >= NaN → false) would silently make
// semantic search return zero results for every query — a safe default beats that.
function numberFromEnv(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && value !== '' && value != null ? n : fallback;
}

export function loadConfig(env = process.env) {
  return {
    host: env.HOST || '0.0.0.0',
    port: Number(env.PORT || 3000),
    // Embedded SQLite file. PRAX_DB_FILE is canonical; DATABASE_URL is still
    // read as a plain file path so pre-rename setups keep working. The
    // desktop wrapper points this at the OS app-data directory.
    databaseFile: env.PRAX_DB_FILE || env.DATABASE_URL || 'prax.db',
    publicDir: env.PUBLIC_DIR || new URL('../public', import.meta.url).pathname,
    embeddingBackend: env.EMBEDDING_BACKEND || 'none',
    embeddingModel: env.EMBEDDING_MODEL || '',
    ollamaUrl: env.OLLAMA_URL || 'http://127.0.0.1:11434',
    openaiBaseUrl: env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    openaiApiKey: env.OPENAI_API_KEY || '',
    embeddingQueryPrefix: env.EMBEDDING_QUERY_PREFIX || '',
    embeddingSearchMinSimilarity: numberFromEnv(env.EMBEDDING_SEARCH_MIN_SIMILARITY, 0.45),
    embeddingSearchTopDrop: numberFromEnv(env.EMBEDDING_SEARCH_TOP_DROP, 0.20),
  };
}
