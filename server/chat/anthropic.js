import { splitSystem, splitSystemRich } from './messages.js';
import { anthropicMessages, anthropicTools, parseAnthropic } from './toolProtocol.js';

// Anthropic Messages API (Claude). The key travels in the x-api-key header with
// a pinned anthropic-version; the system prompt is a top-level field, not a turn,
// and max_tokens is required. Response text is the concatenation of the `text`
// content blocks.
export function createAnthropicChat({ baseUrl, apiKey, model, fetch = globalThis.fetch } = {}) {
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
      if (opts.temperature != null) body.temperature = opts.temperature;
      if (tools) body.tools = anthropicTools(tools);
      const res = await fetch(`${base}/v1/messages`, {
        method: 'POST',
        headers: headers({ 'content-type': 'application/json' }),
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`anthropic chat failed: ${res.status}`);
      const data = await res.json();
      if (tools) {
        const { text, toolCalls } = parseAnthropic(data);
        if (!text && !toolCalls.length) throw new Error('anthropic returned no content');
        return { text, model: chatModel, toolCalls: toolCalls.length ? toolCalls : null, stopReason: data?.stop_reason };
      }
      const text = Array.isArray(data?.content)
        ? data.content.filter((b) => b?.type === 'text').map((b) => b.text).join('')
        : undefined;
      if (typeof text !== 'string' || !text) throw new Error('anthropic returned no text content');
      return { text, model: chatModel };
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
