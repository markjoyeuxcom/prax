import { createFakeChat } from './fake.js';
import { createOllamaChat } from './ollama.js';
import { createOpenAiChat } from './openai.js';
import { createAnthropicChat } from './anthropic.js';
import { createGeminiChat } from './gemini.js';
import { createClaudeCliChat } from './claudeCli.js';
import { createCopilotCliChat } from './copilotCli.js';

// Resolve a chat backend string to its adapter. The generic per-backend fields
// (baseUrl/apiKey) come from the runtime provider; legacy env-named fields
// (ollamaUrl/openaiBaseUrl/openaiApiKey/anthropicBaseUrl/anthropicApiKey) remain
// as fallbacks for direct env construction. Mirrors embedder/index.js.
function resolveBackend(config) {
  const backend = config.chatBackend || 'none';
  const model = config.chatModel;
  const { baseUrl, apiKey, fetch } = config;
  switch (backend) {
    case 'none':
      return null;
    case 'fake':
      return createFakeChat();
    case 'ollama':
      return createOllamaChat({ url: baseUrl || config.ollamaUrl, model, fetch });
    case 'openai':
      return createOpenAiChat({ baseUrl: baseUrl || config.openaiBaseUrl, apiKey: apiKey ?? config.openaiApiKey, model, fetch });
    case 'llamacpp':
      // llama.cpp's server speaks the OpenAI chat API: key optional, and with no
      // model configured the server's loaded model applies.
      return createOpenAiChat({ backend: 'llamacpp', baseUrl: baseUrl || 'http://127.0.0.1:8080/v1', apiKey, model, defaultModel: '', fetch });
    case 'anthropic':
      return createAnthropicChat({ baseUrl: baseUrl || config.anthropicBaseUrl, apiKey: apiKey ?? config.anthropicApiKey, model, fetch });
    case 'gemini':
      return createGeminiChat({ baseUrl, apiKey, model, fetch });
    case 'claude-cli':
      // The user's local `claude` login is the credential — no key, no URL.
      return createClaudeCliChat({ binaryPath: config.binaryPath, model, spawn: config.spawn, exists: config.exists });
    case 'copilot-cli':
      return createCopilotCliChat({ binaryPath: config.binaryPath, model, spawn: config.spawn, exists: config.exists });
    default:
      throw new Error(`unknown chat backend: ${backend}`);
  }
}

// Resolve the active chat model from config, or null when disabled ('none').
export function createChat(config = {}) {
  return resolveBackend(config);
}
