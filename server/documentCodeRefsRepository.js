// Code-citation data layer — mirrors documentExternalRefsRepository.js: pure
// build* query builders returning { text, values }, a boundary normalizer, and
// a createDocumentCodeRefsRepository(db) factory.
//
// Where an external ref points at a URL and therefore has no staleness (nothing
// is copied), a code ref pins CONTENT: the sha256 of the cited lines. Checking
// happens wherever the checkout is — see cli/lib/codeRefs.js — because only a
// working tree can answer whether the code still says what it said.

const MAX_PATH = 1024;

export function normalizeCodeRefRow(row) {
  return {
    id: row.id,
    documentId: row.document_id,
    path: row.path,
    // Null bounds mean "the whole file"; 0 would be a line number and is wrong.
    startLine: row.start_line ?? null,
    endLine: row.end_line ?? null,
    commitSha: row.commit_sha ?? null,
    contentHash: row.content_hash,
    // Hybrid anchors (migration 0039). null normalizedHash = a legacy pin,
    // checked by its line hash alone until recall backfills it; once it is
    // set, a null symbol means the heuristic found no enclosing definition.
    normalizedHash: row.normalized_hash ?? null,
    symbol: row.symbol ?? null,
    createdAt: row.created_at,
  };
}

// The document a citation belongs to, as `prax check` reports it: enough to
// name the memory, weigh its trust, and decide whether its project's
// repository is the checkout being checked.
export function normalizeCitingDocument(row) {
  return {
    id: row.document_id,
    title: row.document_title,
    documentType: row.document_type,
    status: row.document_status,
    verified: Boolean(row.document_verified),
    verifiedBy: row.document_verified_by ?? null,
    updatedAt: row.document_updated_at ?? null,
    projectId: row.project_id ?? null,
    projectSlug: row.project_slug ?? null,
    projectRepoUrl: row.project_repo_url ?? null,
  };
}

export const MAX_PATHS_PER_QUERY = 200;

// Citations on any of `paths`, from live active documents — archived,
// superseded and deprecated memories need no refreshing. Optionally narrowed
// to one project. Served by the path index from migration 0039.
export function buildListCodeRefsByPath(paths, { projectId } = {}) {
  const values = [JSON.stringify(paths)];
  let projectClause = '';
  if (projectId) {
    values.push(projectId);
    projectClause = 'and d.project_id = $2';
  }
  return {
    text: `
      select r.*, d.title as document_title, d.document_type, d.status as document_status,
             d.verified as document_verified, d.verified_by as document_verified_by,
             d.updated_at as document_updated_at, d.project_id,
             p.slug as project_slug, p.repo_url as project_repo_url
      from document_code_refs r
      join markdown_documents d on d.id = r.document_id
      left join projects p on p.id = d.project_id
      where r.path in (select value from json_each($1))
        and d.archived_at is null
        and d.status = 'active'
        ${projectClause}
      order by r.path, coalesce(r.start_line, 0), d.title, r.id
    `,
    values,
  };
}

// Lazy backfill of the 0039 anchors, compare-and-set: written only while the
// row still pins `contentHash` (the content the caller hashed) and has no
// anchors yet, so a retry or a race can never attach anchors to other content.
export function buildBackfillCodeRefAnchors(documentId, id, { contentHash, normalizedHash, symbol = null }) {
  return {
    text: `
      update document_code_refs
         set normalized_hash = $4, symbol = $5
       where document_id = $1 and id = $2 and content_hash = $3 and normalized_hash is null
      returning *
    `,
    values: [documentId, id, contentHash, normalizedHash, symbol],
  };
}

export function buildListCodeRefs(documentId) {
  return {
    text: `select * from document_code_refs where document_id = $1 order by path, start_line`,
    values: [documentId],
  };
}

// Upsert on (document_id, path, range). Re-citing a range after the code moved
// on refreshes the pin — which is what a human re-verifying a memory is doing —
// instead of erroring or accumulating near-duplicates. Gated on the document
// being live, matching the links and external-ref conventions.
//
// The conflict target is the NULL-safe unique index from migration 0029, not
// the column list: a whole-file citation stores NULL bounds, and SQLite treats
// NULLs as distinct in a plain UNIQUE constraint, so the column-list target
// never fired for it and every re-cite inserted another row.
//
// The upsert overwrites the 0039 anchors too: a re-cite from an older client
// that sends none stores nulls, which is right — the old anchors described the
// old content.
export function buildAddCodeRef(documentId, {
  path, startLine = null, endLine = null, commitSha = null, contentHash, normalizedHash = null, symbol = null,
}) {
  if (typeof path !== 'string' || !path || path.length > MAX_PATH) {
    throw new Error('a code citation needs a repository-relative path');
  }
  if (typeof contentHash !== 'string' || !contentHash) {
    throw new Error('a code citation needs the content hash it was pinned at');
  }
  return {
    text: `
      insert into document_code_refs (document_id, path, start_line, end_line, commit_sha, content_hash, normalized_hash, symbol)
      select $1, $2, $3, $4, $5, $6, $7, $8
      where exists (select 1 from markdown_documents where id = $1 and archived_at is null)
      on conflict (document_id, path, coalesce(start_line, 0), coalesce(end_line, 0)) do update
        set content_hash = excluded.content_hash,
            commit_sha = excluded.commit_sha,
            normalized_hash = excluded.normalized_hash,
            symbol = excluded.symbol
      returning *
    `,
    values: [documentId, path, startLine, endLine, commitSha, contentHash, normalizedHash, symbol],
  };
}

export function buildRemoveCodeRef(documentId, id) {
  return {
    text: `delete from document_code_refs where document_id = $1 and id = $2 returning id`,
    values: [documentId, id],
  };
}

export function createDocumentCodeRefsRepository(db) {
  return {
    async listCodeRefs(documentId) {
      const q = buildListCodeRefs(documentId);
      const res = await db.query(q.text, q.values);
      return res.rows.map(normalizeCodeRefRow);
    },

    async addCodeRef(documentId, citation) {
      const q = buildAddCodeRef(documentId, citation);
      const res = await db.query(q.text, q.values);
      return res.rows[0] ? normalizeCodeRefRow(res.rows[0]) : null;
    },

    async listCodeRefsByPath(paths, options = {}) {
      const q = buildListCodeRefsByPath(paths, options);
      const res = await db.query(q.text, q.values);
      return res.rows.map((row) => ({ ...normalizeCodeRefRow(row), document: normalizeCitingDocument(row) }));
    },

    // { ref, updated }: ref null when no such citation exists on the document.
    async backfillCodeRefAnchors(documentId, id, anchors) {
      const q = buildBackfillCodeRefAnchors(documentId, id, anchors);
      const res = await db.query(q.text, q.values);
      if (res.rows[0]) return { ref: normalizeCodeRefRow(res.rows[0]), updated: true };
      const current = await db.query('select * from document_code_refs where document_id = $1 and id = $2', [documentId, id]);
      return { ref: current.rows[0] ? normalizeCodeRefRow(current.rows[0]) : null, updated: false };
    },

    async removeCodeRef(documentId, id) {
      const q = buildRemoveCodeRef(documentId, id);
      const res = await db.query(q.text, q.values);
      return Boolean(res.rows[0]);
    },
  };
}
