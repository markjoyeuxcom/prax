// Voyage AI embeddings (Anthropic's official embeddings partner). Bearer-key
// API with an explicit query/document input_type. Mirrors the ollama adapter's
// shape + errors.
export function createVoyageEmbedder({ baseUrl, apiKey, model, fetch = globalThis.fetch } = {}) {
  const base = String(baseUrl || 'https://api.voyageai.com/v1').replace(/\/+$/, '');
  const embedModel = model || 'voyage-3-large';
  const key = String(apiKey || '');

  function headers(extra = {}) {
    const h = { ...extra };
    if (key) h.authorization = `Bearer ${key}`;
    return h;
  }

  return {
    backend: 'voyage',
    model: embedModel,
    async embed(text, opts = {}) {
      const res = await fetch(`${base}/embeddings`, {
        method: 'POST',
        headers: headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          model: embedModel,
          input: [String(text ?? '')],
          input_type: opts.query ? 'query' : 'document',
        }),
      });
      if (!res.ok) throw new Error(`voyage embed failed: ${res.status}`);
      const data = await res.json();
      const vector = data && Array.isArray(data.data) ? data.data[0]?.embedding : undefined;
      if (!Array.isArray(vector)) throw new Error('voyage returned no embedding array');
      return { vector, model: embedModel, dim: vector.length };
    },
    async isAvailable() {
      // Voyage exposes no cheap GET; a one-token embeddings POST doubles as
      // the reachability probe (same short timeout as the other adapters).
      try {
        const res = await fetch(`${base}/embeddings`, {
          method: 'POST',
          headers: headers({ 'content-type': 'application/json' }),
          body: JSON.stringify({ model: embedModel, input: ['ping'] }),
          signal: AbortSignal.timeout(1500),
        });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}
