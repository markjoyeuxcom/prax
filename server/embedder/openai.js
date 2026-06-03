// OpenAI-compatible embeddings (real OpenAI, llama.cpp, vLLM, LiteLLM, …).
// baseUrl includes /v1; the Authorization header is omitted when apiKey is empty
// so keyless local servers work. Mirrors the ollama adapter's shape + errors.
export function createOpenAiEmbedder({ baseUrl, apiKey, model, fetch = globalThis.fetch } = {}) {
  const base = String(baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const embedModel = model || 'text-embedding-3-small';
  const key = String(apiKey || '');

  function headers(extra = {}) {
    const h = { ...extra };
    if (key) h.authorization = `Bearer ${key}`;
    return h;
  }

  return {
    backend: 'openai',
    async embed(text) {
      const res = await fetch(`${base}/embeddings`, {
        method: 'POST',
        headers: headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({ model: embedModel, input: String(text ?? '') }),
      });
      if (!res.ok) throw new Error(`openai embed failed: ${res.status}`);
      const data = await res.json();
      const vector = data && Array.isArray(data.data) ? data.data[0]?.embedding : undefined;
      if (!Array.isArray(vector)) throw new Error('openai returned no embedding array');
      return { vector, model: embedModel, dim: vector.length };
    },
    async isAvailable() {
      try {
        const res = await fetch(`${base}/models`, { headers: headers() });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}
