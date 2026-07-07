// OpenAI-compatible embeddings (real OpenAI, llama.cpp, vLLM, LiteLLM, …).
// baseUrl includes /v1; the Authorization header is omitted when apiKey is empty
// so keyless local servers work (any key *requirement* is a settings-layer
// concern, not this client's). `backend`/`defaultModel` let llama.cpp reuse the
// client verbatim: with an empty model the field is omitted from the request so
// llama-server falls back to its loaded model. Mirrors the ollama adapter's
// shape + errors.
export function createOpenAiEmbedder({ baseUrl, apiKey, model, backend = 'openai', defaultModel = 'text-embedding-3-small', fetch = globalThis.fetch } = {}) {
  const base = String(baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const embedModel = model || defaultModel;
  const key = String(apiKey || '');

  function headers(extra = {}) {
    const h = { ...extra };
    if (key) h.authorization = `Bearer ${key}`;
    return h;
  }

  return {
    backend,
    async embed(text) {
      const body = { input: String(text ?? '') };
      if (embedModel) body.model = embedModel;
      const res = await fetch(`${base}/embeddings`, {
        method: 'POST',
        headers: headers({ 'content-type': 'application/json' }),
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`${backend} embed failed: ${res.status}`);
      const data = await res.json();
      const vector = data && Array.isArray(data.data) ? data.data[0]?.embedding : undefined;
      if (!Array.isArray(vector)) throw new Error(`${backend} returned no embedding array`);
      return { vector, model: embedModel, dim: vector.length };
    },
    async isAvailable() {
      try {
        // Cheap reachability probe with a short timeout so settings reads
        // never hang on a dead host.
        const res = await fetch(`${base}/models`, { headers: headers(), signal: AbortSignal.timeout(1500) });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}
