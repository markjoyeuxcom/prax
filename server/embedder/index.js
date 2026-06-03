import { createFakeEmbedder } from './fake.js';
import { createOllamaEmbedder } from './ollama.js';

// Resolve the active embedder from config, or null when disabled.
// Adding openai/gemini/voyage (v0.13.1) = one import + one case here.
export function createEmbedder(config = {}) {
  const backend = config.embeddingBackend || 'none';
  switch (backend) {
    case 'none':
      return null;
    case 'fake':
      return createFakeEmbedder({ dim: config.embeddingDim || 64 });
    case 'ollama':
      return createOllamaEmbedder({ url: config.ollamaUrl, model: config.embeddingModel });
    default:
      throw new Error(`unknown embedding backend: ${backend}`);
  }
}
