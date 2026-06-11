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

function valuesFor(fields, source) {
  return fields.map(field => source[field] ?? null);
}

export function normalizeDocumentRow(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    documentType: row.document_type,
    projectId: row.project_id,
    tags: row.tags || [],
    sourceFilename: row.source_filename,
    archivedAt: toIso(row.archived_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    contentHash: row.content_hash ?? null,
    updatedBy: row.updated_by,
    kind: row.kind,
    verified: row.verified ?? false,
    verifiedAt: toIso(row.verified_at) ?? null,
    verifiedBy: row.verified_by ?? null,
    status: row.status ?? 'active',
    stale: row.stale ?? false,
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
    values: [...valuesFor(CREATE_FIELDS, document), hashBody(document.body), document.updatedBy || 'user', document.kind || 'source', verified],
  };
}

export function buildUpdateDocument(id, fields) {
  const entries = Object.entries(fields).filter(([key]) => UPDATE_COLUMN_MAP[key]);
  if (entries.length === 0) {
    throw new Error('No document fields provided');
  }
  const values = [id, ...entries.map(([, value]) => value)];
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
      set ${assignments.join(', ')}, updated_at = now()
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
      set archived_at = now(), updated_at = now()
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
      set archived_at = null, updated_at = now()
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
        set verified = true, verified_at = now(), verified_by = $2
        where id = $1 and archived_at is null
        returning *
      `,
      values: [id, verifiedBy],
    };
  }
  return {
    text: `
      update markdown_documents
      set verified = false, verified_at = null, verified_by = null
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
      set status = 'superseded', updated_at = now()
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
      set status = 'active', updated_at = now()
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

export function buildSetDocumentEmbedding(id, { literal, backend, model, dim, contentHash }) {
  return {
    text: `
      update markdown_documents
      set embedding = $2::vector,
          embedding_backend = $3,
          embedding_model = $4,
          embedding_dim = $5,
          embedded_hash = $6,
          embedded_at = now()
      where id = $1
      returning id
    `,
    values: [id, literal, backend, model, dim, contentHash],
  };
}

export function buildSearchDocumentsSemantic(queryLiteral, backend, { projectId, limit = 20, includeRetired = false } = {}) {
  const values = [queryLiteral, backend];
  let where = `where archived_at is null and embedding is not null and embedding_backend = $2`;
  if (!includeRetired) {
    where += ` and status = 'active'`;
  }
  if (projectId) {
    values.push(projectId);
    where += ` and project_id = $${values.length}`;
  }
  values.push(limit);
  return {
    text: `
      select id, title, document_type, project_id, tags, body, kind, verified, status,
             1 - (embedding <=> $1::vector) as similarity
      from markdown_documents
      ${where}
      order by embedding <=> $1::vector
      limit $${values.length}
    `,
    values,
  };
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
      if (filters.q) {
        const terms = String(filters.q).toLowerCase().match(/[a-z0-9]+/g) || [];
        if (terms.length) {
          values.push(terms.map(term => `${term}:*`).join(' & '));
          clauses.push(`to_tsvector('english', coalesce(d.title, '') || ' ' || coalesce(d.body, '')) @@ to_tsquery('english', $${values.length})`);
        }
      }
      if (filters.archived === true || filters.archived === 'true') {
        clauses.push('d.archived_at is not null');
      } else if (filters.archived !== 'all') {
        clauses.push('d.archived_at is null');
      }

      const where = clauses.length ? `where ${clauses.join(' and ')}` : '';
      const result = await db.query(`
        select d.*, coalesce(s.is_stale, false) as stale
        from markdown_documents d
        left join lateral (
          select true as is_stale
          from document_links dl
          join markdown_documents tgt
            on tgt.id = dl.target_document_id and tgt.archived_at is null
          where dl.source_document_id = d.id
            and dl.relation = 'derived-from'
            and dl.target_hash is not null
            and tgt.content_hash is distinct from dl.target_hash
          limit 1
        ) s on true
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

    async searchDocumentsSemantic(queryLiteral, backend, opts = {}) {
      const q = buildSearchDocumentsSemantic(queryLiteral, backend, opts);
      const result = await db.query(q.text, q.values);
      const kept = applyRelevanceCutoff(result.rows, { minSimilarity: opts.minSimilarity, topDrop: opts.topDrop });
      return kept.map(normalizeDocumentRow);
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
