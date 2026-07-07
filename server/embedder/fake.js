import { createHash } from 'node:crypto';

// Deterministic, NON-semantic embedder for tests and offline dev.
// Maps text -> a fixed-dimension unit-ish vector seeded from sha-256(text),
// so identical text yields identical vectors (a doc is its own nearest
// neighbour) and the whole embed->store->rank pipeline is testable with no
// external service.
export function createFakeEmbedder({ dim = 64 } = {}) {
  return {
    backend: 'fake',
    model: `fake-${dim}`,
    async embed(text) {
      const vector = [];
      let i = 0;
      while (vector.length < dim) {
        const h = createHash('sha256').update(`${i}:${String(text ?? '')}`).digest();
        for (let b = 0; b < h.length && vector.length < dim; b += 1) {
          vector.push((h[b] / 255) * 2 - 1); // [-1, 1]
        }
        i += 1;
      }
      return { vector, model: `fake-${dim}`, dim };
    },
    async isAvailable() {
      return true;
    },
  };
}
