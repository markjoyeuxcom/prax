export function createOllamaEmbedder({ url, model, fetch = globalThis.fetch } = {}) {
  const base = String(url || 'http://127.0.0.1:11434').replace(/\/+$/, '');
  const embedModel = model || 'nomic-embed-text';
  return {
    backend: 'ollama',
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
        // Cheap reachability probe with a short timeout so settings reads
        // never hang on a dead host.
        const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(1500) });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}
