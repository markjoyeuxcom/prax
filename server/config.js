export function loadConfig(env = process.env) {
  return {
    host: env.HOST || '0.0.0.0',
    port: Number(env.PORT || 3000),
    databaseUrl: env.DATABASE_URL || '',
    publicDir: env.PUBLIC_DIR || new URL('../public', import.meta.url).pathname,
    embeddingBackend: env.EMBEDDING_BACKEND || 'none',
    embeddingModel: env.EMBEDDING_MODEL || '',
    ollamaUrl: env.OLLAMA_URL || 'http://127.0.0.1:11434',
    embeddingSearchMinSimilarity: env.EMBEDDING_SEARCH_MIN_SIMILARITY ? Number(env.EMBEDDING_SEARCH_MIN_SIMILARITY) : 0.45,
    embeddingSearchTopDrop: env.EMBEDDING_SEARCH_TOP_DROP ? Number(env.EMBEDDING_SEARCH_TOP_DROP) : 0.20,
  };
}
