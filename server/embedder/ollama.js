export function createOllamaEmbedder({ url, model, fetch = globalThis.fetch } = {}) {
  // Ollama's native API lives at the root (/api/...), never under /v1 — that's
  // its OpenAI-compatible surface (use the llama.cpp/OpenAI provider for that).
  // Strip a trailing /v1 so a base URL copied from an OpenAI-style config still
  // works instead of 404ing at /v1/api/embeddings.
  const base = String(url || 'http://127.0.0.1:11434').replace(/\/+$/, '').replace(/\/v1$/, '');
  const embedModel = model || 'nomic-embed-text';
  return {
    backend: 'ollama',
    model: embedModel,
    async embed(text) {
      const res = await fetch(`${base}/api/embeddings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: embedModel, prompt: String(text ?? '') }),
      });
      if (!res.ok) throw new Error(`ollama embed failed: ${res.status}`);
      const data = await res.json();
      const vector = data.embedding;
      if (!Array.isArray(vector)) throw new Error('ollama returned no embedding array');
      return { vector, model: embedModel, dim: vector.length };
    },
    async isAvailable() {
      try {
        // Reachability + the configured model actually being pulled. /api/tags
        // returning 200 only means Ollama is up — embeds still 404 with "model
        // not found" if the model isn't pulled, which read as a misleading
        // "connected". So require the model to be present (Ollama resolves a
        // bare name to :latest, so match that too). If the list can't be read,
        // fall back to reachability rather than blocking.
        const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(1500) });
        if (!res.ok) return false;
        let models = null;
        try {
          const data = await res.json();
          if (Array.isArray(data?.models)) models = data.models;
        } catch { models = null; }
        if (!models) return true;
        const wanted = embedModel.includes(':') ? [embedModel] : [embedModel, `${embedModel}:latest`];
        return models.some((m) => wanted.includes(String(m?.name || m?.model || '')));
      } catch {
        return false;
      }
    },
  };
}
