const CREATE_FIELDS = ['title', 'body', 'documentType', 'projectId', 'tags', 'sourceFilename'];
const UPDATE_COLUMN_MAP = {
  title: 'title',
  body: 'body',
  documentType: 'document_type',
  projectId: 'project_id',
  tags: 'tags',
  sourceFilename: 'source_filename',
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
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function buildCreateDocument(document) {
  return {
    text: `
      insert into markdown_documents (title, body, document_type, project_id, tags, source_filename)
      values ($1, $2, $3, $4, $5, $6)
      returning *
    `,
    values: valuesFor(CREATE_FIELDS, document),
  };
}

export function buildUpdateDocument(id, fields) {
  const entries = Object.entries(fields).filter(([key]) => UPDATE_COLUMN_MAP[key]);
  if (entries.length === 0) {
    throw new Error('No document fields provided');
  }

  const assignments = entries.map(([key], index) => `${UPDATE_COLUMN_MAP[key]} = $${index + 2}`);
  return {
    text: `
      update markdown_documents
      set ${assignments.join(', ')}, updated_at = now()
      where id = $1 and archived_at is null
      returning *
    `,
    values: [id, ...entries.map(([, value]) => value)],
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

export function createLibraryRepository(db) {
  return {
    async listDocuments(filters = {}) {
      const clauses = [];
      const values = [];

      if (filters.projectId) {
        values.push(filters.projectId);
        clauses.push(`project_id = $${values.length}`);
      }
      if (filters.documentType) {
        values.push(filters.documentType);
        clauses.push(`document_type = $${values.length}`);
      }
      if (filters.q) {
        const terms = String(filters.q).toLowerCase().match(/[a-z0-9]+/g) || [];
        if (terms.length) {
          values.push(terms.map(term => `${term}:*`).join(' & '));
          clauses.push(`to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, '')) @@ to_tsquery('english', $${values.length})`);
        }
      }
      if (filters.archived === true || filters.archived === 'true') {
        clauses.push('archived_at is not null');
      } else if (filters.archived !== 'all') {
        clauses.push('archived_at is null');
      }

      const where = clauses.length ? `where ${clauses.join(' and ')}` : '';
      const result = await db.query(`
        select * from markdown_documents
        ${where}
        order by project_id, document_type, updated_at desc, title
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
  };
}
