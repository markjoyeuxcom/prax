import { splitSystem, splitSystemRich } from './messages.js';
import { geminiContents, geminiTools, parseGemini } from './toolProtocol.js';

// Google Gemini chat (Generative Language API, :generateContent). The key travels
// in the x-goog-api-key header; the system prompt is a top-level systemInstruction
// and assistant turns use the role 'model'. Mirrors the gemini embedder's shape.
export function createGeminiChat({ baseUrl, apiKey, model, fetch = globalThis.fetch } = {}) {
  const base = String(baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
  const chatModel = model || 'gemini-2.5-flash';
  const key = String(apiKey || '');

  function headers(extra = {}) {
    const h = { ...extra };
    if (key) h['x-goog-api-key'] = key;
    return h;
  }

  return {
    backend: 'gemini',
    model: chatModel,
    supportsTools: true,
    async complete(messages, opts = {}) {
      const tools = Array.isArray(opts.tools) && opts.tools.length ? opts.tools : null;
      const { system, turns } = tools ? splitSystemRich(messages) : splitSystem(messages);
      const body = {
        contents: tools
          ? geminiContents(turns)
          : turns.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      };
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      if (tools) body.tools = geminiTools(tools);
      const generationConfig = {};
      if (opts.temperature != null) generationConfig.temperature = opts.temperature;
      if (opts.maxTokens != null) generationConfig.maxOutputTokens = opts.maxTokens;
      if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;
      const res = await fetch(`${base}/models/${chatModel}:generateContent`, {
        method: 'POST',
        headers: headers({ 'content-type': 'application/json' }),
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`gemini chat failed: ${res.status}`);
      const data = await res.json();
      if (tools) {
        const { text, toolCalls } = parseGemini(data);
        if (!text && !toolCalls.length) throw new Error('gemini returned no content');
        return { text, model: chatModel, toolCalls: toolCalls.length ? toolCalls : null, stopReason: data?.candidates?.[0]?.finishReason };
      }
      const parts = data?.candidates?.[0]?.content?.parts;
      const text = Array.isArray(parts) ? parts.map((p) => p?.text || '').join('') : undefined;
      if (typeof text !== 'string' || !text) throw new Error('gemini returned no text content');
      return { text, model: chatModel };
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
