import { splitSystemRich, toMessages } from './messages.js';
import {
  openaiResponseInput,
  openaiResponseTools,
  parseOpenaiResponse,
} from './toolProtocol.js';
import { fetchWithTimeout, finish, resolveTimeout } from './request.js';

// Real OpenAI uses the Responses API so current reasoning models can call tools.
// llama.cpp and other callers selecting the explicit llamacpp backend retain
// Chat Completions compatibility, including its optional model field.
export function createOpenAiChat({ baseUrl, apiKey, model, backend = 'openai', defaultModel = 'gpt-4o-mini', fetch = globalThis.fetch, timeoutMs } = {}) {
  const base = String(baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const chatModel = model || defaultModel;
  const key = String(apiKey || '');
  // Stateless (store:false) reasoning continuations need the encrypted
  // reasoning payload. Requested by default; dropped for the rest of this
  // adapter's life if the endpoint rejects the include (see completeResponses).
  let requestEncryptedReasoning = true;

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
    const error = new Error(`${backend} chat failed: ${res.status}${suffix}`);
    error.status = res.status;
    error.detail = detail;
    return error;
  }

  function post(path, body, opts) {
    return fetchWithTimeout(fetch, `${base}${path}`, {
      method: 'POST',
      headers: headers({ 'content-type': 'application/json' }),
      body: JSON.stringify(body),
    }, { backend, timeoutMs: resolveTimeout(timeoutMs, opts) });
  }

  async function completeChatCompletions(messages, opts) {
    const body = { messages: toMessages(messages) };
    if (chatModel) body.model = chatModel;
    if (opts.temperature != null) body.temperature = opts.temperature;
    if (opts.maxTokens != null) body.max_tokens = opts.maxTokens;
    const res = await post('/chat/completions', body, opts);
    if (!res.ok) throw await providerError(res);
    const data = await res.json();
    const message = data?.choices?.[0]?.message;
    const text = message?.content;
    if (typeof text !== 'string') throw new Error(`${backend} returned no message content`);
    // finish_reason 'length' marks the result truncated.
    return { text, model: chatModel, ...finish(data?.choices?.[0]?.finish_reason) };
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

    // With store:false the API keeps nothing, so a replayed reasoning item is
    // only resolvable when it carries its encrypted_content — which the API
    // returns only when asked. Without it a continuation fails with "Item …
    // not found. Items are not persisted when store is false".
    let res = await post('/responses', requestEncryptedReasoning
      ? { ...body, include: ['reasoning.encrypted_content'] }
      : body, opts);
    if (!res.ok && requestEncryptedReasoning && res.status === 400) {
      const error = await providerError(res);
      // An OpenAI-compatible endpoint (or model) that does not know the
      // include value: retry once without it and stop asking. Reasoning items
      // it returns then lack encrypted_content and are dropped on replay.
      if (!/include|encrypted/i.test(error.detail || '')) throw error;
      requestEncryptedReasoning = false;
      res = await post('/responses', body, opts);
    }
    if (!res.ok) throw await providerError(res);
    const data = await res.json();
    const { text, toolCalls, providerOutput } = parseOpenaiResponse(data);
    // status 'incomplete' (max_output_tokens, content_filter) means the output
    // stopped early; function-call arguments in it may be cut mid-JSON.
    const truncated = data?.status === 'incomplete';
    if (!text && !toolCalls.length) {
      throw new Error(truncated
        ? `${backend} reply was cut off (${data?.incomplete_details?.reason || 'incomplete'}) before any content`
        : `${backend} returned no message content`);
    }
    return {
      text,
      model: chatModel,
      toolCalls: toolCalls.length ? toolCalls : null,
      stopReason: data?.status,
      finishReason: data?.incomplete_details?.reason || data?.status || null,
      truncated,
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
