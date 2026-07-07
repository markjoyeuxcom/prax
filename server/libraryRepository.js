import { createHash } from 'node:crypto';
import { toIso } from './columnTypes.js';

const DEFAULT_MIN_SIMILARITY = 0.45;
const DEFAULT_TOP_DROP = 0.20;

function hashBody(body) {
  return createHash('sha256').update(String(body ?? '')).digest('hex');
}

const CREATE_FIELDS = ['title', 'body', 'documentType', 'projectId', 'tags', 'sourceFilename'];
const UPDATE_COLUMN_MAP = {
  title: 'title',
  body: 'body',
  documentType: 'document_type',
  projectId: 'project_id',
  tags: 'tags',
  sourceFilename: 'source_filename',
  kind: 'kind',
};

// tags live in a TEXT column as a JSON array (pg's text[] auto-parsed on
// read; SQLite hands back the raw text). Malformed text degrades to [].
function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || value === '') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function serializeTags(tags) {
  return JSON.stringify(Array.isArray(tags) ? tags : []);
}

export function normalizeDocumentRow(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    documentType: row.document_type,
    projectId: row.project_id,
    tags: parseJsonArray(row.tags),
    sourceFilename: row.source_filename,
    archivedAt: toIso(row.archived_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    contentHash: row.content_hash ?? null,
    updatedBy: row.updated_by,
    kind: row.kind,
    // SQLite stores booleans as 0/1; pg returned real booleans — normalize.
    verified: Boolean(row.verified ?? false),
    verifiedAt: toIso(row.verified_at) ?? null,
    verifiedBy: row.verified_by ?? null,
    status: row.status ?? 'active',
    stale: Boolean(row.stale ?? false),
    ...(row.project_slug !== undefined ? { projectSlug: row.project_slug } : {}),
  };
}

export function buildCreateDocument(document) {
  const verified = (document.updatedBy || 'user') !== 'agent';
  return {
    text: `
      insert into markdown_documents (title, body, document_type, project_id, tags, source_filename, content_hash, updated_by, kind, verified)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      returning *
    `,
    values: [
      ...CREATE_FIELDS.map((field) => (field === 'tags' ? serializeTags(document.tags) : (document[field] ?? null))),
      hashBody(document.body), document.updatedBy || 'user', document.kind || 'source', verified,
    ],
  };
}

export function buildUpdateDocument(id, fields) {
  const entries = Object.entries(fields).filter(([key]) => UPDATE_COLUMN_MAP[key]);
  if (entries.length === 0) {
    throw new Error('No document fields provided');
  }
  const values = [id, ...entries.map(([key, value]) => (key === 'tags' ? serializeTags(value) : value))];
  const assignments = entries.map(([key], index) => `${UPDATE_COLUMN_MAP[key]} = $${index + 2}`);

  values.push(fields.updatedBy || 'user');
  assignments.push(`updated_by = $${values.length}`);

  if (Object.prototype.hasOwnProperty.call(fields, 'body')) {
    values.push(hashBody(fields.body));
    assignments.push(`content_hash = $${values.length}`);
  }

  return {
    text: `
      update markdown_documents
      set ${assignments.join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      where id = $1 and archived_at is null
      returning *
    `,
    values,
  };
}

export function buildArchiveDocument(id) {
  return {
    text: `
      update markdown_documents
      set archived_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      where id = $1 and archived_at is null
      returning *
    `,
    values: [id],
  };
}

export function buildRestoreDocument(id) {
  return {
    text: `
      update markdown_documents
      set archived_at = null, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      where id = $1 and archived_at is not null
      returning *
    `,
    values: [id],
  };
}

export function buildDeleteArchivedDocument(id) {
  return {
    text: `
      delete from markdown_documents
      where id = $1 and archived_at is not null
      returning *
    `,
    values: [id],
  };
}

export function buildGetDocument(id) {
  return { text: 'select * from markdown_documents where id = $1 limit 1', values: [id] };
}

export function buildVerifyDocument(id, { verified, verifiedBy = null } = {}) {
  if (verified) {
    return {
      text: `
        update markdown_documents
        set verified = 1, verified_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), verified_by = $2
        where id = $1 and archived_at is null
        returning *
      `,
      values: [id, verifiedBy],
    };
  }
  return {
    text: `
      update markdown_documents
      set verified = 0, verified_at = null, verified_by = null
      where id = $1 and archived_at is null
      returning *
    `,
    values: [id],
  };
}

export function buildMarkSuperseded(id) {
  return {
    text: `
      update markdown_documents
      set status = 'superseded', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      where id = $1 and status = 'active'
      returning *
    `,
    values: [id],
  };
}

export function buildRevertSupersededIfOrphan(id) {
  // A supersedes link whose source document is archived no longer "holds"
  // the target superseded — only links from live documents count.
  return {
    text: `
      update markdown_documents
      set status = 'active', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      where id = $1 and status = 'superseded'
        and not exists (
          select 1
          from document_links dl
          join markdown_documents src on src.id = dl.source_document_id
          where dl.target_document_id = $1
            and dl.relation = 'supersedes'
            and src.archived_at is null
        )
      returning *
    `,
    values: [id],
  };
}

export function buildListActiveDocumentsForExport({ projectId } = {}) {
  const values = [];
  let where = 'where d.archived_at is null';
  if (projectId) {
    values.push(projectId);
    where += ` and d.project_id = $${values.length}`;
  }
  return {
    text: `
      select d.*, p.slug as project_slug
      from markdown_documents d
      join projects p on p.id = d.project_id
      ${where}
      order by p.slug, d.title
    `,
    values,
  };
}

export function buildSetDocumentEmbedding(id, { vector, backend, model, dim, contentHash }) {
  // Embeddings are stored as JSON text (a JSON.stringify'd float array) in the
  // TEXT column; the JS cosine search path parses them back at query time.
  if (!Array.isArray(vector) || vector.some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
    throw new Error('vector must be an array of finite numbers');
  }
  return {
    text: `
      update markdown_documents
      set embedding = $2,
          embedding_backend = $3,
          embedding_model = $4,
          embedding_dim = $5,
          embedded_hash = $6,
          embedded_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      where id = $1
      returning id
    `,
    values: [id, JSON.stringify(vector), backend, model, dim, contentHash],
  };
}

// Candidate query for semantic search: same filters and columns the old pg
// query used, minus the pgvector distance — ranking happens in JS (SQLite has
// no vector operator), so the embedding column rides along to be scored.
export function buildSearchDocumentsSemantic(backend, { projectId, includeRetired = false } = {}) {
  const values = [backend];
  let where = 'where archived_at is null and embedding is not null and embedding_backend = $1';
  if (!includeRetired) {
    where += ` and status = 'active'`;
  }
  if (projectId) {
    values.push(projectId);
    where += ` and project_id = $${values.length}`;
  }
  return {
    text: `
      select id, title, document_type, project_id, tags, body, kind, verified, status, embedding
      from markdown_documents
      ${where}
    `,
    values,
  };
}

// Stored embeddings are JSON text; malformed or non-array content degrades to
// null (the row is skipped) rather than breaking the whole search.
function parseEmbedding(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || value === '') return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// Plain-JS cosine similarity. Returns null (not 0) for unusable pairs —
// mismatched dimensions, empty/zero vectors — so callers can drop the row.
export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) return null;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    // A single null/NaN/non-number entry makes the vector unusable — bail rather
    // than let `null * null === 0` yield a finite-but-wrong score.
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (!denominator) return null;
  return dot / denominator;
}

export function buildListDocumentsNeedingEmbedding(backend) {
  return {
    text: `
      select id, content_hash
      from markdown_documents
      where archived_at is null
        and (
          embedding is null
          or embedded_hash is distinct from content_hash
          or embedding_backend is distinct from $1
        )
      order by updated_at desc
    `,
    values: [backend],
  };
}

export function buildCountEmbeddings(backend) {
  return {
    text: `
      select
        count(*) filter (where archived_at is null) as total,
        count(*) filter (where archived_at is null and embedding is not null and embedding_backend = $1 and embedded_hash is not distinct from content_hash) as embedded
      from markdown_documents
    `,
    values: [backend],
  };
}

// Gap-based relevance cutoff: keep rows within DROP of the best similarity, but
// never below an absolute FLOOR (kills nonsense queries). Rows arrive ordered by
// similarity desc (the SQL orders by cosine distance asc). Pure + side-effect free.
export function applyRelevanceCutoff(rows, { minSimilarity = DEFAULT_MIN_SIMILARITY, topDrop = DEFAULT_TOP_DROP } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const top = Number(rows[0].similarity);
  const threshold = Math.max(minSimilarity, top - topDrop);
  return rows.filter((r) => Number(r.similarity) >= threshold);
}

export function createLibraryRepository(db) {
  return {
    async listDocuments(filters = {}) {
      const clauses = [];
      const values = [];

      if (filters.projectId) {
        values.push(filters.projectId);
        clauses.push(`d.project_id = $${values.length}`);
      }
      if (filters.documentType) {
        values.push(filters.documentType);
        clauses.push(`d.document_type = $${values.length}`);
      }
      if (filters.kind) {
        values.push(filters.kind);
        clauses.push(`d.kind = $${values.length}`);
      }
      if (filters.status && ['active', 'superseded', 'deprecated'].includes(filters.status)) {
        values.push(filters.status);
        clauses.push(`d.status = $${values.length}`);
      }
      // Full-text search via the external-content FTS5 table (replaces pg's
      // to_tsvector/to_tsquery). The sanitizer keeps only lowercase [a-z0-9]+
      // runs, so every token is a safe FTS5 bareword; `term*` keeps the old
      // prefix-match behavior and whitespace joins as implicit AND. A query
      // with no alphanumeric terms adds no clause at all (same as before).
      // No alias on the FTS join: MATCH resolves its LHS as the hidden column
      // named after the table, so it must read `markdown_documents_fts match`.
      let ftsJoin = '';
      if (filters.q) {
        const terms = String(filters.q).toLowerCase().match(/[a-z0-9]+/g) || [];
        if (terms.length) {
          values.push(terms.map(term => `${term}*`).join(' '));
          ftsJoin = 'join markdown_documents_fts on markdown_documents_fts.rowid = d.rowid';
          clauses.push(`markdown_documents_fts match $${values.length}`);
        }
      }
      if (filters.archived === true || filters.archived === 'true') {
        clauses.push('d.archived_at is not null');
      } else if (filters.archived !== 'all') {
        clauses.push('d.archived_at is null');
      }

      const where = clauses.length ? `where ${clauses.join(' and ')}` : '';
      // stale: pg used a LEFT JOIN LATERAL (... limit 1); SQLite ports it to a
      // scalar EXISTS subquery in the select list (0/1, normalized to boolean).
      const result = await db.query(`
        select d.*, exists (
          select 1
          from document_links dl
          join markdown_documents tgt
            on tgt.id = dl.target_document_id and tgt.archived_at is null
          where dl.source_document_id = d.id
            and dl.relation = 'derived-from'
            and dl.target_hash is not null
            and tgt.content_hash is distinct from dl.target_hash
        ) as stale
        from markdown_documents d
        ${ftsJoin}
        ${where}
        order by d.project_id, d.document_type, d.updated_at desc, d.title
      `, values);
      return result.rows.map(normalizeDocumentRow);
    },

    async createDocument(document) {
      const query = buildCreateDocument(document);
      const result = await db.query(query.text, query.values);
      return normalizeDocumentRow(result.rows[0]);
    },

    async updateDocument(id, fields) {
      const query = buildUpdateDocument(id, fields);
      const result = await db.query(query.text, query.values);
      return result.rows[0] ? normalizeDocumentRow(result.rows[0]) : null;
    },

    async archiveDocument(id) {
      const query = buildArchiveDocument(id);
      const result = await db.query(query.text, query.values);
      return result.rows[0] ? normalizeDocumentRow(result.rows[0]) : null;
    },

    async restoreDocument(id) {
      const query = buildRestoreDocument(id);
      const result = await db.query(query.text, query.values);
      return result.rows[0] ? normalizeDocumentRow(result.rows[0]) : null;
    },

    async deleteArchivedDocument(id) {
      const query = buildDeleteArchivedDocument(id);
      const result = await db.query(query.text, query.values);
      return result.rows[0] ? normalizeDocumentRow(result.rows[0]) : null;
    },

    async listActiveDocumentsForExport(filters = {}) {
      const query = buildListActiveDocumentsForExport(filters);
      const result = await db.query(query.text, query.values);
      return result.rows.map(normalizeDocumentRow);
    },

    async getDocument(id) {
      const query = buildGetDocument(id);
      const result = await db.query(query.text, query.values);
      return result.rows[0] ? normalizeDocumentRow(result.rows[0]) : null;
    },

    async verifyDocument(id, payload) {
      const q = buildVerifyDocument(id, payload);
      const result = await db.query(q.text, q.values);
      return result.rows[0] ? normalizeDocumentRow(result.rows[0]) : null;
    },

    async markDocumentSuperseded(id) {
      const q = buildMarkSuperseded(id);
      const result = await db.query(q.text, q.values);
      return result.rows[0] ? normalizeDocumentRow(result.rows[0]) : null;
    },

    async revertSupersededIfOrphan(id) {
      const q = buildRevertSupersededIfOrphan(id);
      const result = await db.query(q.text, q.values);
      return result.rows[0] ? normalizeDocumentRow(result.rows[0]) : null;
    },

    async setDocumentEmbedding(id, payload) {
      const q = buildSetDocumentEmbedding(id, payload);
      const result = await db.query(q.text, q.values);
      return result.rows[0] ? result.rows[0].id : null;
    },

    // JS-side vector search: fetch candidates, cosine-rank against the query
    // vector, keep the top `limit`, then apply the same relevance cutoff the
    // pg path used. Rows come back normalized (tags parsed, embedding never
    // leaks) plus a `similarity` float.
    async searchDocumentsSemantic(queryVector, backend, opts = {}) {
      const q = buildSearchDocumentsSemantic(backend, { projectId: opts.projectId, includeRetired: opts.includeRetired });
      const result = await db.query(q.text, q.values);
      const limit = Number.isFinite(Number(opts.limit)) && Number(opts.limit) > 0 ? Number(opts.limit) : 20;
      const ranked = [];
      for (const row of result.rows) {
        const similarity = cosineSimilarity(queryVector, parseEmbedding(row.embedding));
        if (similarity === null || !Number.isFinite(similarity)) continue;
        ranked.push({ ...row, similarity });
      }
      ranked.sort((a, b) => b.similarity - a.similarity);
      const kept = applyRelevanceCutoff(ranked.slice(0, limit), { minSimilarity: opts.minSimilarity, topDrop: opts.topDrop });
      return kept.map((row) => ({ ...normalizeDocumentRow(row), similarity: row.similarity }));
    },

    // "More like this": rank documents by similarity to one document's OWN
    // stored embedding — no new embedding call, just reuse the vector we saved.
    // Returns [] when the document has no embedding for `backend`.
    async findSimilarDocuments(id, backend, opts = {}) {
      const q = buildSearchDocumentsSemantic(backend, { projectId: opts.projectId, includeRetired: opts.includeRetired });
      const result = await db.query(q.text, q.values);
      const rows = result.rows;
      const self = rows.find((row) => row.id === id);
      const queryVector = self ? parseEmbedding(self.embedding) : null;
      if (!queryVector) return [];
      const limit = Number.isFinite(Number(opts.limit)) && Number(opts.limit) > 0 ? Number(opts.limit) : 5;
      const ranked = [];
      for (const row of rows) {
        if (row.id === id) continue; // never suggest the document itself
        const similarity = cosineSimilarity(queryVector, parseEmbedding(row.embedding));
        if (similarity === null || !Number.isFinite(similarity)) continue;
        ranked.push({ ...row, similarity });
      }
      ranked.sort((a, b) => b.similarity - a.similarity);
      const kept = applyRelevanceCutoff(ranked.slice(0, limit), { minSimilarity: opts.minSimilarity, topDrop: opts.topDrop });
      return kept.map((row) => ({ ...normalizeDocumentRow(row), similarity: row.similarity }));
    },

    async listDocumentsNeedingEmbedding(backend) {
      const q = buildListDocumentsNeedingEmbedding(backend);
      const result = await db.query(q.text, q.values);
      return result.rows.map((r) => ({ id: r.id, contentHash: r.content_hash }));
    },

    async countEmbeddings(backend) {
      const q = buildCountEmbeddings(backend);
      const result = await db.query(q.text, q.values);
      const row = result.rows[0] || {};
      return { total: Number(row.total || 0), embedded: Number(row.embedded || 0) };
    },
  };
}
