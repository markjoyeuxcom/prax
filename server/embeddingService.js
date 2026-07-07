// The text we embed for a document: title + body together, so a query matching
// the title (high-signal, especially for short notes) retrieves it. Trims and
// drops empty parts.
export function embeddableText(doc) {
  return [doc?.title, doc?.body]
    .map((s) => String(s ?? '').trim())
    .filter(Boolean)
    .join('\n\n');
}

export function createEmbeddingService({ repository, embedder, concurrency = 4, logger = console }) {
  async function embedOne(id, knownContentHash) {
    if (!embedder) return false;
    const doc = await repository.getDocument(id);
    if (!doc) return false;
    const { vector, model, dim } = await embedder.embed(embeddableText(doc));
    await repository.setDocumentEmbedding(id, {
      vector,
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
    async reindex({ force = false } = {}) {
      if (!embedder) return { embedded: 0, failed: 0 };
      const pending = force
        ? await repository.listDocuments({})
        : await repository.listDocumentsNeedingEmbedding(embedder.backend, embedder.model);
      let embedded = 0;
      let failed = 0;
      let sampleError = null; // first failure's message, surfaced so a systemic
      // cause (e.g. a gateway timeout) is visible instead of a bare "N failed".
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
              if (!sampleError) sampleError = String(r.reason?.message || r.reason);
              logger.error('reindex item failed', { err: String(r.reason) });
            }
          }
        }
      }
      return sampleError ? { embedded, failed, sampleError } : { embedded, failed };
    },
  };
}
