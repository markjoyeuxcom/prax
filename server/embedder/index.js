import { createFakeEmbedder } from './fake.js';
import { createOllamaEmbedder } from './ollama.js';
import { createOpenAiEmbedder } from './openai.js';

// Prepend a query instruction to SEARCH-query embeddings only (opts.query), never
// to document embeddings. Pass-through when no prefix is configured. Model-agnostic:
// e.g. qwen3 "Instruct: …\nQuery:", nomic "search_query: ".
function withQueryPrefix(embedder, prefix) {
  if (!embedder || !prefix) return embedder;
  return {
    ...embedder,
    async embed(text, opts = {}) {
      const input = opts.query ? `${prefix}${text}` : text;
      return embedder.embed(input);
    },
  };
}

function resolveBackend(config) {
  const backend = config.embeddingBackend || 'none';
  switch (backend) {
    case 'none':
      return null;
    case 'fake':
      return createFakeEmbedder({ dim: 64 });
    case 'ollama':
      return createOllamaEmbedder({ url: config.ollamaUrl, model: config.embeddingModel });
    case 'openai':
      return createOpenAiEmbedder({ baseUrl: config.openaiBaseUrl, apiKey: config.openaiApiKey, model: config.embeddingModel });
    default:
      throw new Error(`unknown embedding backend: ${backend}`);
  }
}

// Resolve the active embedder from config, or null when disabled.
export function createEmbedder(config = {}) {
  return withQueryPrefix(resolveBackend(config), config.embeddingQueryPrefix || '');
}
