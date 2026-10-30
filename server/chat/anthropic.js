import { splitSystem, splitSystemRich } from './messages.js';
import { anthropicMessages, anthropicTools, parseAnthropic } from './toolProtocol.js';
import { fetchWithTimeout, finish, resolveTimeout } from './request.js';

// Anthropic Messages API (Claude). The key travels in the x-api-key header with
// a pinned anthropic-version; the system prompt is a top-level field, not a turn,
// and max_tokens is required. Response text is the concatenation of the `text`
// content blocks. stop_reason 'max_tokens' marks the result truncated.

// Claude Opus 4.7 and every later model (Sonnet 5.x, Haiku 5.x, Opus 5.x,
// Fable, Mythos) answer a non-default temperature with a 400, so the hint is
// sent only to the older models known to accept it: Claude 3.x and Claude 4
// through 4.6, with or without a date suffix. Unknown ids get no temperature.
const SAMPLING_MODEL = /^claude-(3[-.]|(opus|sonnet|haiku)-(3|4(-[0-6])?)(-\d{8})?$)/;

export function acceptsTemperature(model) {
  return SAMPLING_MODEL.test(String(model || ''));
}

// The API's own error message ("temperature is not supported…") is what makes a
// 400 explainable; keep it, bounded, alongside the status.
async function providerError(res) {
  let detail = '';
  try {
    const raw = typeof res.text === 'function' ? await res.text() : '';
    const parsed = raw ? JSON.parse(raw) : null;
    detail = typeof parsed?.error?.message === 'string' ? parsed.error.message : '';
  } catch {
    detail = '';
  }
  const suffix = detail ? ` (${detail.replace(/\s+/g, ' ').slice(0, 500)})` : '';
  const error = new Error(`anthropic chat failed: ${res.status}${suffix}`);
  error.status = res.status;
  error.detail = detail;
  return error;
}

export function createAnthropicChat({ baseUrl, apiKey, model, fetch = globalThis.fetch, timeoutMs } = {}) {
  const base = String(baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
  const chatModel = model || 'claude-haiku-4-5-20251001';
  const key = String(apiKey || '');

  function headers(extra = {}) {
    const h = { ...extra };
    if (key) {
      h['x-api-key'] = key;
      h['anthropic-version'] = '2023-06-01';
    }
    return h;
  }

  return {
    backend: 'anthropic',
    model: chatModel,
    supportsTools: true,
    async complete(messages, opts = {}) {
      const tools = Array.isArray(opts.tools) && opts.tools.length ? opts.tools : null;
      const { system, turns } = tools ? splitSystemRich(messages) : splitSystem(messages);
      const body = {
        model: chatModel,
        max_tokens: opts.maxTokens ?? 1024,
        messages: tools
          ? anthropicMessages(turns)
          : turns.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
      };
      if (system) body.system = system;
      if (opts.temperature != null && acceptsTemperature(chatModel)) body.temperature = opts.temperature;
      if (tools) body.tools = anthropicTools(tools);
      const res = await fetchWithTimeout(fetch, `${base}/v1/messages`, {
        method: 'POST',
        headers: headers({ 'content-type': 'application/json' }),
        body: JSON.stringify(body),
      }, { backend: 'anthropic', timeoutMs: resolveTimeout(timeoutMs, opts) });
      if (!res.ok) throw await providerError(res);
      const data = await res.json();
      const stop = finish(data?.stop_reason);
      if (tools) {
        const { text, toolCalls } = parseAnthropic(data);
        if (!text && !toolCalls.length) throw new Error(stop.truncated ? 'anthropic reply was cut off by the token limit before any content' : 'anthropic returned no content');
        return { text, model: chatModel, toolCalls: toolCalls.length ? toolCalls : null, stopReason: data?.stop_reason, ...stop };
      }
      const text = Array.isArray(data?.content)
        ? data.content.filter((b) => b?.type === 'text').map((b) => b.text).join('')
        : undefined;
      if (typeof text !== 'string' || !text) throw new Error('anthropic returned no text content');
      return { text, model: chatModel, ...stop };
    },
    async isAvailable() {
      try {
        // GET /v1/models is a cheap, non-billable reachability + auth probe.
        const res = await fetch(`${base}/v1/models`, { headers: headers(), signal: AbortSignal.timeout(1500) });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}
