import { splitSystemRich, toMessages } from './messages.js';
import {
  openaiResponseInput,
  openaiResponseTools,
  parseOpenaiResponse,
} from './toolProtocol.js';

// Real OpenAI uses the Responses API so current reasoning models can call tools.
// llama.cpp and other callers selecting the explicit llamacpp backend retain
// Chat Completions compatibility, including its optional model field.
export function createOpenAiChat({ baseUrl, apiKey, model, backend = 'openai', defaultModel = 'gpt-4o-mini', fetch = globalThis.fetch } = {}) {
  const base = String(baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const chatModel = model || defaultModel;
  const key = String(apiKey || '');

  function headers(extra = {}) {
    const h = { ...extra };
    if (key) h.authorization = `Bearer ${key}`;
    return h;
  }

  async function providerError(res) {
    let detail = '';
    try {
      const raw = typeof res.text === 'function' ? await res.text() : '';
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          detail = typeof parsed?.error?.message === 'string' ? parsed.error.message : '';
        } catch {
          detail = '';
        }
      }
    } catch {
      detail = '';
    }
    const suffix = detail ? ` (${detail.replace(/\s+/g, ' ').slice(0, 500)})` : '';
    return new Error(`${backend} chat failed: ${res.status}${suffix}`);
  }

  async function completeChatCompletions(messages, opts) {
    const body = { messages: toMessages(messages) };
    if (chatModel) body.model = chatModel;
    if (opts.temperature != null) body.temperature = opts.temperature;
    if (opts.maxTokens != null) body.max_tokens = opts.maxTokens;
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: headers({ 'content-type': 'application/json' }),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await providerError(res);
    const data = await res.json();
    const message = data?.choices?.[0]?.message;
    const text = message?.content;
    if (typeof text !== 'string') throw new Error(`${backend} returned no message content`);
    return { text, model: chatModel };
  }

  async function completeResponses(messages, opts) {
    const tools = Array.isArray(opts.tools) && opts.tools.length ? opts.tools : null;
    const { system, turns } = splitSystemRich(messages);
    const body = {
      model: chatModel,
      input: openaiResponseInput(turns),
      // Preserve Chat Completions' non-retaining behavior. Reasoning items in
      // providerOutput are replayed explicitly for stateless tool continuations.
      store: false,
    };
    if (system) body.instructions = system;
    if (opts.maxTokens != null) body.max_output_tokens = opts.maxTokens;
    if (tools) body.tools = openaiResponseTools(tools);
    // Current reasoning models can reject non-default sampling controls. Prax's
    // temperature hints are optional, so omit them on the Responses API.

    const res = await fetch(`${base}/responses`, {
      method: 'POST',
      headers: headers({ 'content-type': 'application/json' }),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await providerError(res);
    const data = await res.json();
    const { text, toolCalls, providerOutput } = parseOpenaiResponse(data);
    if (!text && !toolCalls.length) throw new Error(`${backend} returned no message content`);
    return {
      text,
      model: chatModel,
      toolCalls: toolCalls.length ? toolCalls : null,
      stopReason: data?.status,
      providerOutput,
    };
  }

  return {
    backend,
    model: chatModel,
    supportsTools: backend === 'openai',
    async complete(messages, opts = {}) {
      return backend === 'openai'
        ? completeResponses(messages, opts)
        : completeChatCompletions(messages, opts);
    },
    async isAvailable() {
      try {
        const res = await fetch(`${base}/models`, { headers: headers(), signal: AbortSignal.timeout(1500) });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}
