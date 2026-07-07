// Google Gemini embeddings (Generative Language API). The key travels in the
// x-goog-api-key header; queries and documents carry distinct task types so
// retrieval-tuned models rank properly. Mirrors the ollama adapter's shape.
export function createGeminiEmbedder({ baseUrl, apiKey, model, fetch = globalThis.fetch } = {}) {
  const base = String(baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
  const embedModel = model || 'gemini-embedding-001';
  const key = String(apiKey || '');

  function headers(extra = {}) {
    const h = { ...extra };
    if (key) h['x-goog-api-key'] = key;
    return h;
  }

  return {
    backend: 'gemini',
    async embed(text, opts = {}) {
      const res = await fetch(`${base}/models/${embedModel}:embedContent`, {
        method: 'POST',
        headers: headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          content: { parts: [{ text: String(text ?? '') }] },
          taskType: opts.query ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT',
        }),
      });
      if (!res.ok) throw new Error(`gemini embed failed: ${res.status}`);
      const data = await res.json();
      const vector = data && data.embedding ? data.embedding.values : undefined;
      if (!Array.isArray(vector)) throw new Error('gemini returned no embedding array');
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
