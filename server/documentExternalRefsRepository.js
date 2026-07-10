// External-reference data layer — mirrors documentLinksRepository.js: pure
// build* query builders returning { text, values }, a boundary normalizer, and
// a createDocumentExternalRefsRepository(db) factory. A ref points a document
// at an outside URL; nothing is copied, so there is no target join and no
// staleness. Adds gate on the source document being live (not archived).

const MAX_URL = 2048;
const MAX_LABEL = 200;

export function normalizeExternalRefRow(row) {
  return {
    id: row.id,
    documentId: row.document_id,
    url: row.url,
    label: row.label ?? null,
    createdAt: row.created_at,
  };
}

export function buildListExternalRefs(documentId) {
  return {
    text: `select * from document_external_refs where document_id = $1 order by created_at, url`,
    values: [documentId],
  };
}

// Upsert on (document_id, url): re-adding a URL updates its label rather than
// erroring, so an add is idempotent. Gated on the document existing and not
// archived. Returns the row so the route can tell insert from update via the
// caller's pre-probe (SQLite has no xmax), matching the links convention.
export function buildAddExternalRef(documentId, url, label) {
  return {
    text: `
      insert into document_external_refs (document_id, url, label)
      select $1, $2, $3
      where exists (select 1 from markdown_documents where id = $1 and archived_at is null)
      on conflict (document_id, url) do update set label = excluded.label
      returning *
    `,
    values: [documentId, url, label ?? null],
  };
}

export function buildExternalRefExists(documentId, url) {
  return {
    text: `select 1 from document_external_refs where document_id = $1 and url = $2`,
    values: [documentId, url],
  };
}

export function buildRemoveExternalRef(documentId, refId) {
  return {
    text: `delete from document_external_refs where id = $1 and document_id = $2 returning id`,
    values: [refId, documentId],
  };
}

// Batch fetch for many documents (export / list decoration): Map<docId, refs[]>.
export function buildListExternalRefsForDocuments(documentIds) {
  const placeholders = documentIds.map((_, i) => `$${i + 1}`).join(', ');
  return {
    text: `select * from document_external_refs where document_id in (${placeholders}) order by created_at, url`,
    values: documentIds,
  };
}

// Control whitespace is stripped from URLs and collapsed in labels — the
// editor round-trips refs through a one-line-per-ref textarea, so a stored
// newline would split one ref into two lines and resurface as a phantom ref
// on the next save. (Newlines are never meaningful in either field.)
export function sanitizeUrl(value) {
  const url = String(value ?? '').replace(/[\r\n\t]+/g, '').trim();
  if (!url || url.length > MAX_URL) return null;
  return url;
}

export function sanitizeLabel(value) {
  if (value === undefined || value === null) return null;
  const label = String(value).replace(/\s+/g, ' ').trim();
  return label ? label.slice(0, MAX_LABEL) : null;
}

export function createDocumentExternalRefsRepository(db) {
  return {
    async listExternalRefs(documentId) {
      const q = buildListExternalRefs(documentId);
      const result = await db.query(q.text, q.values);
      return result.rows.map(normalizeExternalRefRow);
    },
    // Returns { ref, alreadyExisted } — alreadyExisted drives the route's
    // 200-vs-201 status, like the document-links add.
    async addExternalRef(documentId, url, label) {
      const probe = buildExternalRefExists(documentId, url);
      const existed = (await db.query(probe.text, probe.values)).rows.length > 0;
      const q = buildAddExternalRef(documentId, url, label);
      const result = await db.query(q.text, q.values);
      const row = result.rows[0];
      return { ref: row ? normalizeExternalRefRow(row) : null, alreadyExisted: existed };
    },
    async removeExternalRef(documentId, refId) {
      const q = buildRemoveExternalRef(documentId, refId);
      const result = await db.query(q.text, q.values);
      return result.rows.length > 0;
    },
    async listExternalRefsForDocuments(documentIds) {
      const ids = Array.isArray(documentIds) ? documentIds : [];
      const map = new Map(ids.map((id) => [id, []]));
      if (!ids.length) return map;
      const q = buildListExternalRefsForDocuments(ids);
      const result = await db.query(q.text, q.values);
      for (const row of result.rows) {
        const ref = normalizeExternalRefRow(row);
        (map.get(ref.documentId) || map.set(ref.documentId, []).get(ref.documentId)).push(ref);
      }
      return map;
    },
  };
}
