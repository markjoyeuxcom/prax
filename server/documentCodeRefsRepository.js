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
    createdAt: row.created_at,
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
export function buildAddCodeRef(documentId, { path, startLine = null, endLine = null, commitSha = null, contentHash }) {
  if (typeof path !== 'string' || !path || path.length > MAX_PATH) {
    throw new Error('a code citation needs a repository-relative path');
  }
  if (typeof contentHash !== 'string' || !contentHash) {
    throw new Error('a code citation needs the content hash it was pinned at');
  }
  return {
    text: `
      insert into document_code_refs (document_id, path, start_line, end_line, commit_sha, content_hash)
      select $1, $2, $3, $4, $5, $6
      where exists (select 1 from markdown_documents where id = $1 and archived_at is null)
      on conflict (document_id, path, coalesce(start_line, 0), coalesce(end_line, 0)) do update
        set content_hash = excluded.content_hash,
            commit_sha = excluded.commit_sha
      returning *
    `,
    values: [documentId, path, startLine, endLine, commitSha, contentHash],
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

    async removeCodeRef(documentId, id) {
      const q = buildRemoveCodeRef(documentId, id);
      const res = await db.query(q.text, q.values);
      return Boolean(res.rows[0]);
    },
  };
}
