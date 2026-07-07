import { createFakeEmbedder } from './fake.js';
import { createOllamaEmbedder } from './ollama.js';
import { createOpenAiEmbedder } from './openai.js';
import { createGeminiEmbedder } from './gemini.js';
import { createVoyageEmbedder } from './voyage.js';

// Prepend a query instruction to SEARCH-query embeddings only (opts.query), never
// to document embeddings. Pass-through when no prefix is configured. Model-agnostic:
// e.g. qwen3 "Instruct: …\nQuery:", nomic "search_query: ".
function withQueryPrefix(embedder, prefix) {
  if (!embedder || !prefix) return embedder;
  return {
    ...embedder,
    async embed(text, opts = {}) {
      const input = opts.query ? `${prefix}${text}` : text;
      // Forward opts so backends with a native query/document distinction
      // (gemini taskType, voyage input_type) still see the flag.
      return embedder.embed(input, opts);
    },
  };
}

function resolveBackend(config) {
  const backend = config.embeddingBackend || 'none';
  const model = config.embeddingModel;
  // Generic per-backend fields from the runtime provider; the legacy env-named
  // fields (ollamaUrl/openaiBaseUrl/openaiApiKey) remain as fallbacks for
  // direct env construction.
  const { baseUrl, apiKey, fetch } = config;
  switch (backend) {
    case 'none':
      return null;
    case 'fake':
      return createFakeEmbedder({ dim: 64 });
    case 'ollama':
      return createOllamaEmbedder({ url: baseUrl || config.ollamaUrl, model, fetch });
    case 'openai':
      return createOpenAiEmbedder({ baseUrl: baseUrl || config.openaiBaseUrl, apiKey: apiKey ?? config.openaiApiKey, model, fetch });
    case 'llamacpp':
      // llama.cpp's server speaks the OpenAI embeddings API: key optional,
      // and with no model configured the server's loaded model applies.
      return createOpenAiEmbedder({ backend: 'llamacpp', baseUrl: baseUrl || 'http://127.0.0.1:8080/v1', apiKey, model, defaultModel: '', fetch });
    case 'gemini':
      return createGeminiEmbedder({ baseUrl, apiKey, model, fetch });
    case 'voyage':
      return createVoyageEmbedder({ baseUrl, apiKey, model, fetch });
    default:
      throw new Error(`unknown embedding backend: ${backend}`);
  }
}

// Resolve the active embedder from config, or null when disabled.
export function createEmbedder(config = {}) {
  return withQueryPrefix(resolveBackend(config), config.embeddingQueryPrefix || '');
}
