import { toVectorLiteral } from './vectorLiteral.js';

export function createEmbeddingService({ repository, embedder, concurrency = 4, logger = console }) {
  async function embedOne(id, knownContentHash) {
    if (!embedder) return false;
    const doc = await repository.getDocument(id);
    if (!doc) return false;
    const { vector, model, dim } = await embedder.embed(doc.body || '');
    await repository.setDocumentEmbedding(id, {
      literal: toVectorLiteral(vector),
      backend: embedder.backend,
      model,
      dim,
      contentHash: knownContentHash ?? doc.contentHash,
    });
    return true;
  }

  return {
    // Fire-and-forget friendly: callers await or not. Errors are swallowed +
    // logged so a write path never fails on an embedding error.
    async embedDocument(id) {
      try {
        return await embedOne(id);
      } catch (err) {
        logger.error('embedDocument failed', { id, err: String(err) });
        return false;
      }
    },
    async reindex() {
      if (!embedder) return { embedded: 0, failed: 0 };
      const pending = await repository.listDocumentsNeedingEmbedding(embedder.backend);
      let embedded = 0;
      let failed = 0;
      for (let i = 0; i < pending.length; i += concurrency) {
        const batch = pending.slice(i, i + concurrency);
        const results = await Promise.allSettled(
          batch.map((d) => embedOne(d.id, d.contentHash)),
        );
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value) {
            embedded += 1;
          } else {
            failed += 1;
            if (r.status === 'rejected') {
              logger.error('reindex item failed', { err: String(r.reason) });
            }
          }
        }
      }
      return { embedded, failed };
    },
  };
}
