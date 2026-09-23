import { createHash } from 'node:crypto';
import { toIso } from './columnTypes.js';
import { fuseHybrid } from './hybridRanking.js';
import { normalizeTitle } from './documentTitle.js';
import { GONE, buildReadReceipt, createRecordOnce, creationIntentHash, intentHash as ledgerIntentHash, runOnce, runOnceInTransaction, withOperationTransaction } from './operationLedger.js';

const DEFAULT_MIN_SIMILARITY = 0.45;
const DEFAULT_TOP_DROP = 0.20;

function hashBody(body) {
  return createHash('sha256').update(String(body ?? '')).digest('hex');
}

// The revision token: sha256 over the stored title AND body, framed as a JSON
// array so no byte sequence in one field can masquerade as the other. It is
// the exact content a person reviews when verifying (QINV-04), the baseline a
// conditional editor write is guarded by (QINV-09), and the input an embedding
// is computed from — one token for all three. `contentHash` keeps its body-only
// meaning for export front matter and derived-from staleness snapshots.
export function documentRevision(doc) {
  return createHash('sha256')
    .update(JSON.stringify([String(doc?.title ?? ''), String(doc?.body ?? '')]))
    .digest('hex');
}

export const REVISION_TOKEN_RE = /^[0-9a-f]{64}$/i;

// Thrown by updateDocument when the caller's `ifRevision` baseline no longer
// matches. Carries the current record so the caller can reconcile (keep a
// remote title, re-send its own body) instead of overwriting blindly.
export class DocumentRevisionConflictError extends Error {
  constructor(current) {
    super('document changed since this draft was loaded; reload before saving');
    this.name = 'DocumentRevisionConflictError';
    this.code = 'DOCUMENT_REVISION_CONFLICT';
    this.reason = 'revision-mismatch';
    this.current = current;
  }
}

export class DocumentUpdateConflictError extends Error {
  constructor(reason) {
    super(reason === 'update-result-gone'
      ? 'this update already committed, but its document has since been deleted'
      : 'operationId was already used for a different document update');
    this.name = 'DocumentUpdateConflictError';
    this.reason = reason;
  }
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

// Every markdown_documents column except `embedding`. A stored vector is JSON
// text (about 30 KB at 1536 dimensions), and only the similarity paths read it:
// listing 2,000 documents with d.* carried 60 MB of vectors nobody used.
// tests/backend/libraryRepository.test.js keeps this in step with the schema.
export const DOCUMENT_LISTING_COLUMNS = Object.freeze([
  'id', 'title', 'body', 'document_type', 'project_id', 'tags', 'source_filename', 'archived_at',
  'content_hash', 'updated_by', 'updated_by_agent', 'kind', 'verified', 'verified_at', 'verified_by',
  'status', 'embedding_backend', 'embedding_model', 'embedding_dim', 'embedded_hash', 'embedded_at',
  'created_at', 'updated_at', 'creation_operation', 'creation_intent_hash', 'revision',
]);

function documentListingColumns(alias) {
  return DOCUMENT_LISTING_COLUMNS.map((column) => `${alias}.${column}`).join(', ');
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
    // The agent CLI behind an agent write ('claude', 'codex', …); null for a
    // human edit or an agent that did not identify itself (migration 0026).
    updatedByAgent: row.updated_by_agent ?? null,
    kind: row.kind,
    // SQLite stores booleans as 0/1; pg returned real booleans — normalize.
    verified: Boolean(row.verified ?? false),
    verifiedAt: toIso(row.verified_at) ?? null,
    verifiedBy: row.verified_by ?? null,
    status: row.status ?? 'active',
    stale: Boolean(row.stale ?? false),
    // Rows written before migration 0023 carry no stored token until the
    // repository backfills them; deriving it here keeps every read truthful.
    revision: typeof row.revision === 'string' && row.revision ? row.revision : documentRevision(row),
    ...(row.project_slug !== undefined ? { projectSlug: row.project_slug } : {}),
  };
}

export function buildCreateDocument(document, { ignoreIdConflict = false } = {}) {
  // Every write path (routes, Inbox filing, generated drafts) stores a
  // single-line title; the revision is computed over the stored value.
  if (typeof document.title === 'string') document = { ...document, title: normalizeTitle(document.title) };
  // A human may create a template-derived draft without vouching for its content.
  // Explicit false only lowers trust; it can never verify an agent-origin write.
  const verified = (document.updatedBy || 'user') !== 'agent' && document.verified !== false;
  const idColumn = document.id ? 'id, ' : '';
  const internalColumns = document.creationOperation || document.creationIntentHash
    ? ', creation_operation, creation_intent_hash'
    : '';
  // Only an IDENTIFIED agent write carries the column; a human create or an
  // anonymous agent leaves it NULL (the column default), so the SQL shape of
  // every other create is unchanged.
  const agentColumn = document.updatedBy === 'agent'
    && typeof document.updatedByAgent === 'string' && document.updatedByAgent
    ? ', updated_by_agent'
    : '';
  const values = [
    ...(document.id ? [document.id] : []),
    ...CREATE_FIELDS.map((field) => (field === 'tags' ? serializeTags(document.tags) : (document[field] ?? null))),
    hashBody(document.body), document.updatedBy || 'user', document.kind || 'source', verified,
    documentRevision(document),
    ...(internalColumns ? [document.creationOperation || null, document.creationIntentHash || null] : []),
    ...(agentColumn ? [document.updatedByAgent] : []),
  ];
  const placeholders = values.map((_, index) => `$${index + 1}`);
  return {
    text: `
      insert into markdown_documents (${idColumn}title, body, document_type, project_id, tags, source_filename, content_hash, updated_by, kind, verified, revision${internalColumns}${agentColumn})
      values (${placeholders.join(', ')})
      ${ignoreIdConflict ? 'on conflict(id) do nothing' : ''}
      returning *
    `,
    values,
  };
}

// What an upsert-by-title operation asked for, hashed so a replay can be told
// apart from a reused id carrying different content. Authorship headers are
// not intent: the same agent retrying the same remember is still a replay.
export function upsertIntentHash(document) {
  const tags = Array.isArray(document.tags) ? document.tags : [];
  return ledgerIntentHash([
    document.projectId,
    document.title,
    String(document.body ?? ''),
    tags,
    document.documentType ?? null,
    document.kind ?? null,
  ]);
}

export function documentMatchesCreateFields(document, fields) {
  if (!document || !fields) return false;
  const tags = Array.isArray(fields.tags) ? fields.tags : [];
  return (!fields.id || document.id === fields.id)
    && document.title === fields.title
    && document.body === fields.body
    && document.documentType === fields.documentType
    && document.projectId === fields.projectId
    && Array.isArray(document.tags)
    && document.tags.length === tags.length
    && document.tags.every((tag, index) => tag === tags[index])
    && (document.sourceFilename || null) === (fields.sourceFilename || null)
    && document.kind === (fields.kind || 'source')
    && document.updatedBy === (fields.updatedBy || 'user')
    && (document.updatedByAgent ?? null) === (fields.updatedByAgent ?? null);
}

// `revision` is the token for the MERGED title/body the repository computed
// after reading the row; `expectRevision` (undefined = unconditional) pins the
// write to the stored token the repository read inside the same transaction,
// so a baseline check can never race a concurrent writer. A NULL stored token
// (pre-0023 row) is matched with IS so the write also heals it.
export function buildUpdateDocument(id, fields, { revision, expectRevision } = {}) {
  const entries = Object.entries(fields).filter(([key]) => UPDATE_COLUMN_MAP[key]);
  if (entries.length === 0) {
    throw new Error('No document fields provided');
  }
  const values = [id, ...entries.map(([key, value]) => (key === 'tags' ? serializeTags(value) : value))];
  const assignments = entries.map(([key], index) => `${UPDATE_COLUMN_MAP[key]} = $${index + 2}`);

  values.push(fields.updatedBy || 'user');
  assignments.push(`updated_by = $${values.length}`);

  // Threaded by the routes on every write: the vendor id for an identified
  // agent edit, NULL otherwise — so a human edit after an agent edit never
  // leaves a stale agent id describing a revision it did not write.
  if (fields.updatedByAgent !== undefined) {
    values.push(fields.updatedBy === 'agent' ? (fields.updatedByAgent || null) : null);
    assignments.push(`updated_by_agent = $${values.length}`);
  }

  if (revision !== undefined) {
    values.push(revision);
    assignments.push(`revision = $${values.length}`);
  }
  let guard = '';
  if (expectRevision !== undefined) {
    values.push(expectRevision);
    guard = ` and revision is $${values.length}`;
  }

  const bodyProvided = Object.prototype.hasOwnProperty.call(fields, 'body');
  let hashIndex = null;
  if (bodyProvided) {
    values.push(hashBody(fields.body));
    hashIndex = values.length;
    assignments.push(`content_hash = $${hashIndex}`);
  }

  // An agent-origin mutation revokes a prior human verification ONLY when it
  // actually changes what the human blessed: the body (compared via
  // content_hash) or the TITLE — retitling a verified runbook changes its
  // identity for retrieval, citations, and wiki-links just as surely as a
  // body edit. Pure metadata (retag, project move) or byte-identical values
  // keep the badge. SET expressions evaluate against the pre-update row, so
  // content_hash/title below are the STORED values compared to the incoming
  // ones. A legacy NULL stored hash compares unequal and revokes — the safe
  // default.
  const titleEntryIndex = entries.findIndex(([key]) => key === 'title');
  const agentContentGuards = [];
  if (bodyProvided) agentContentGuards.push(`content_hash = $${hashIndex}`);
  if (titleEntryIndex !== -1) agentContentGuards.push(`title = $${titleEntryIndex + 2}`);
  if (fields.updatedBy === 'agent' && agentContentGuards.length) {
    const unchanged = agentContentGuards.join(' and ');
    assignments.push(
      `verified = case when ${unchanged} then verified else 0 end`,
      `verified_at = case when ${unchanged} then verified_at else null end`,
      `verified_by = case when ${unchanged} then verified_by else null end`,
    );
  }

  return {
    text: `
      update markdown_documents
      set ${assignments.join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      where id = $1 and archived_at is null${guard}
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

// Permanent delete of any document, archived or active — "delete" is offered
// alongside "archive" so a document can be removed outright without first being
// archived. Callers gate it behind a confirmation.
export function buildDeleteDocument(id) {
  return {
    text: `
      delete from markdown_documents
      where id = $1
      returning *
    `,
    values: [id],
  };
}

export function buildGetDocument(id) {
  return { text: 'select * from markdown_documents where id = $1 limit 1', values: [id] };
}

// A generated document's creation receipt (the 'document-generation' ledger kind).
export function buildGetDocumentCreationReceipt(id) {
  return buildReadReceipt('document-generation', id);
}

// A receipt's replay: the document it produced as it is now, or GONE after a
// permanent delete.
async function currentDocument(q, id, wrap) {
  const query = buildGetDocument(id);
  const row = (await q.query(query.text, query.values)).rows[0];
  return row ? wrap(normalizeDocumentRow(row)) : GONE;
}

// `revision` binds the blessing to the exact title+body the person reviewed
// (the route requires it for verified:true); `contentHash` remains an optional
// extra body guard for callers that still send it.
export function buildVerifyDocument(id, { verified, verifiedBy = null, revision = null, contentHash = null } = {}) {
  if (verified) {
    const values = [id, verifiedBy];
    let guard = '';
    if (revision) {
      values.push(revision);
      guard += ` and revision = $${values.length}`;
    }
    if (contentHash) {
      values.push(contentHash);
      guard += ` and content_hash = $${values.length}`;
    }
    return {
      text: `
        update markdown_documents
        set verified = 1, verified_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), verified_by = $2
        where id = $1 and archived_at is null${guard}
          and not (verified = 1 and verified_by is $2)
        returning *
      `,
      values,
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

export function buildListActiveDocumentsForExport({ projectId, includeArchived = false } = {}) {
  const values = [];
  let where = includeArchived ? 'where 1 = 1' : 'where d.archived_at is null';
  if (projectId) {
    values.push(projectId);
    where += ` and d.project_id = $${values.length}`;
  }
  return {
    text: `
      select ${documentListingColumns('d')}, p.slug as project_slug
      from markdown_documents d
      join projects p on p.id = d.project_id
      ${where}
      order by p.slug, d.title
    `,
    values,
  };
}

// The write is conditional on the document's revision — the token over the
// full embedded input (title + body). A job that embedded an older title or
// body therefore cannot overwrite a newer vector (QINV-09), and embedded_hash
// records exactly which revision the stored vector describes.
// The FTS half of hybrid retrieval: Unicode letter/digit runs (CJK and accented
// words included, C15), each an FTS5 phrase with a prefix star. null = the query
// carries no usable term, which must read as "ask nothing", never as "match
// everything".
//
// Terms are joined with OR, unlike the LISTING path's implicit AND. A listing is
// a filter — "show me the documents matching all of this" — but the keyword half
// of a ranking is a signal, and BM25 already rewards documents that match more
// terms and rarer ones. Under AND a natural-language recall query ("how do we
// publish a release") requires every word to appear and matches nothing at all,
// which is precisely the query shape this path exists to serve.
export function ftsMatchExpression(q) {
  if (q === undefined || q === null) return null;
  const terms = String(q).match(/[\p{L}\p{N}]+/gu) || [];
  if (!terms.length) return null;
  return terms.map((term) => `"${term}"*`).join(' OR ');
}

// Candidates ordered by BM25 relevance. Deliberately NOT the listing query:
// that one orders by project/type/updated_at, which is a browsing order, not a
// relevance order, and Reciprocal Rank Fusion is only meaningful over ranks
// that mean "how well does this match".
export function buildSearchDocumentsKeyword(q, { projectId, includeRetired = false, limit = 50, preparedMatch = false } = {}) {
  const match = preparedMatch ? (q || null) : ftsMatchExpression(q);
  if (!match) return null;
  const values = [match];
  let where = `where d.archived_at is null and markdown_documents_fts match $1`;
  if (!includeRetired) where += ` and d.status = 'active'`;
  if (projectId) {
    values.push(projectId);
    where += ` and d.project_id = $${values.length}`;
  }
  return {
    text: `
      select d.id, d.title, d.document_type, d.project_id, d.tags, d.body,
             d.kind, d.updated_by, d.updated_by_agent, d.updated_at,
             d.verified, d.verified_at, d.verified_by,
             d.status, d.revision,
             bm25(markdown_documents_fts) as bm25_score,
             exists (
               select 1
               from document_links dl
               join markdown_documents target
                 on target.id = dl.target_document_id and target.archived_at is null
               where dl.source_document_id = d.id
                 and dl.relation = 'derived-from'
                 and dl.target_hash is not null
                 and target.content_hash is distinct from dl.target_hash
             ) as stale
      from markdown_documents d
      join markdown_documents_fts on markdown_documents_fts.rowid = d.rowid
      ${where}
      order by bm25(markdown_documents_fts)
      limit ${Number.isInteger(limit) && limit > 0 ? limit : 50}
    `,
    values,
  };
}

export function buildSetDocumentEmbedding(id, { vector, backend, model, dim, revision }) {
  // Embeddings are stored as JSON text (a JSON.stringify'd float array) in the
  // TEXT column; the JS cosine search path parses them back at query time.
  if (!Array.isArray(vector) || vector.some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
    throw new Error('vector must be an array of finite numbers');
  }
  if (typeof revision !== 'string' || !REVISION_TOKEN_RE.test(revision)) {
    throw new Error('revision must be the document revision the vector was computed from');
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
      where id = $1 and revision = $6
      returning id
    `,
    values: [id, JSON.stringify(vector), backend, model, dim, revision],
  };
}

// A vector is current only when it was computed from the row's present
// revision (title + body) and by the active backend AND model: vectors from a
// different model share no space, and a same-dimension switch would otherwise
// rank nonsense (C10). `model` undefined = backend-only (legacy callers).
function currentVectorClause(alias, backendParam, modelParam) {
  const prefix = alias ? `${alias}.` : '';
  return `${prefix}embedding is not null`
    + ` and ${prefix}embedding_backend = ${backendParam}`
    + ` and ${prefix}embedded_hash is not distinct from ${prefix}revision`
    + (modelParam ? ` and ${prefix}embedding_model is not distinct from ${modelParam}` : '');
}

export function buildHasCurrentEmbedding(id, backend, model) {
  const hasModel = typeof model === 'string';
  return {
    text: `select 1 from markdown_documents d where d.id = $1 and ${currentVectorClause('d', '$2', hasModel ? '$3' : null)}`,
    values: hasModel ? [id, backend, model] : [id, backend],
  };
}

// Candidate query for semantic search: same filters and columns the old pg
// query used, minus the pgvector distance — ranking happens in JS (SQLite has
// no vector operator), so the embedding column rides along to be scored.
export function buildSearchDocumentsSemantic(backend, { projectId, includeRetired = false, model } = {}) {
  const values = [backend];
  const hasModel = typeof model === 'string';
  if (hasModel) values.push(model);
  let where = `where d.archived_at is null and ${currentVectorClause('d', '$1', hasModel ? '$2' : null)}`;
  if (!includeRetired) {
    where += ` and d.status = 'active'`;
  }
  if (projectId) {
    values.push(projectId);
    where += ` and d.project_id = $${values.length}`;
  }
  return {
    text: `
      select d.id, d.title, d.document_type, d.project_id, d.tags, d.body,
             d.kind, d.updated_by, d.updated_by_agent, d.updated_at,
             d.verified, d.verified_at, d.verified_by,
             d.status, d.revision, d.embedding,
             exists (
               select 1
               from document_links dl
               join markdown_documents target
                 on target.id = dl.target_document_id and target.archived_at is null
               where dl.source_document_id = d.id
                 and dl.relation = 'derived-from'
                 and dl.target_hash is not null
                 and target.content_hash is distinct from dl.target_hash
             ) as stale
      from markdown_documents d
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

export function buildListDocumentsNeedingEmbedding(backend, model) {
  // A model change *within* a backend (e.g. openai text-embedding-3-small ->
  // -3-large, a different dimension) must also re-embed — otherwise stale
  // vectors silently drop out of search (dim mismatch) or mis-rank (same dim).
  // The clause is added only when a model is given (typeof string, '' included
  // for llama.cpp's server-default): with no model it must not compare against
  // a null and mark every row stale.
  const hasModel = typeof model === 'string';
  const modelClause = hasModel ? '\n          or embedding_model is distinct from $2' : '';
  return {
    text: `
      select id, title, body, revision, content_hash
      from markdown_documents
      where archived_at is null
        and (
          embedding is null
          or embedded_hash is distinct from revision
          or embedding_backend is distinct from $1${modelClause}
        )
      order by updated_at desc
    `,
    values: hasModel ? [backend, model] : [backend],
  };
}

export function buildCountEmbeddings(backend, model) {
  // "embedded" counts only rows current for the ACTIVE config, so the status
  // reads honestly after a model change (a doc on the old model is stale, not
  // embedded — mirrors buildListDocumentsNeedingEmbedding's model clause). The
  // model term is added only when a model is given, so the no-model call site
  // doesn't compare against a null.
  const hasModel = typeof model === 'string';
  return {
    text: `
      select
        count(*) filter (where archived_at is null) as total,
        count(*) filter (where archived_at is null and ${currentVectorClause('', '$1', hasModel ? '$2' : null)}) as embedded
      from markdown_documents
    `,
    values: hasModel ? [backend, model] : [backend],
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

// Rows written before migration 0023 have no stored revision. SQLite cannot
// hash, so the repository computes and stores the token on first use (one
// session transaction, idempotent, no updated_at bump, no FTS trigger — title
// and body are untouched). embedded_hash is deliberately NOT re-keyed: a
// body-only hash cannot prove which title was embedded (the C09 defect class),
// so legacy vectors stay pending until a reindex and are disclosed as such.
async function backfillDocumentRevisions(db) {
  const client = await db.connect();
  try {
    await client.query('begin immediate');
    try {
      const pending = await client.query(
        'select id, title, body from markdown_documents where revision is null',
      );
      for (const row of pending.rows) {
        await client.query(
          'update markdown_documents set revision = $2 where id = $1 and revision is null',
          [row.id, documentRevision(row)],
        );
      }
      await client.query('commit');
      return pending.rows.length;
    } catch (err) {
      await client.query('rollback').catch(() => {});
      throw err;
    }
  } finally {
    client.release();
  }
}

// Every query builder still gets exact placeholder tests against a fake `db`;
// the backfill only runs on a real handle (one that can open a session).
export function ensureDocumentRevisions(db) {
  if (typeof db?.connect !== 'function') return Promise.resolve(0);
  return backfillDocumentRevisions(db);
}

export function createLibraryRepository(db) {
  let readyPromise = null;
  function ready() {
    if (!readyPromise) {
      readyPromise = ensureDocumentRevisions(db).catch((err) => {
        readyPromise = null; // let the next call retry instead of poisoning the repository
        throw err;
      });
    }
    return readyPromise;
  }

  // Merged title/body → next revision, guarded by the token read in the same
  // session. `ifRevision` is the caller's baseline (undefined = unconditional).
  async function updateDocumentOn(queryable, id, fields, { ifRevision } = {}) {
    if (typeof fields.title === 'string') fields = { ...fields, title: normalizeTitle(fields.title) };
    const currentRes = await queryable.query('select * from markdown_documents where id = $1 limit 1', [id]);
    const currentRow = currentRes.rows[0];
    if (!currentRow || currentRow.archived_at) return null;
    const current = normalizeDocumentRow(currentRow);
    if (ifRevision !== undefined && String(ifRevision).toLowerCase() !== current.revision) {
      throw new DocumentRevisionConflictError(current);
    }
    const revision = documentRevision({
      title: Object.prototype.hasOwnProperty.call(fields, 'title') ? fields.title : currentRow.title,
      body: Object.prototype.hasOwnProperty.call(fields, 'body') ? fields.body : currentRow.body,
    });
    const query = buildUpdateDocument(id, fields, { revision, expectRevision: currentRow.revision ?? null });
    const result = await queryable.query(query.text, query.values);
    if (!result.rows[0]) throw new DocumentRevisionConflictError(current);
    return normalizeDocumentRow(result.rows[0]);
  }

  // Rank the vector candidates by cosine — the semantic half of the hybrid,
  // factored out so both paths score identically. A closure, like ready() and
  // updateDocumentOn(), so the method works however the caller obtained it.
  async function rankSemanticCandidates(queryVector, backend, opts = {}) {
    const q = buildSearchDocumentsSemantic(backend, {
      projectId: opts.projectId, includeRetired: opts.includeRetired, model: opts.model,
    });
    const result = await db.query(q.text, q.values);
    const ranked = [];
    for (const r of result.rows) {
      const similarity = cosineSimilarity(queryVector, parseEmbedding(r.embedding));
      if (similarity === null || !Number.isFinite(similarity)) continue;
      ranked.push({ ...r, similarity });
    }
    ranked.sort((a, b) => b.similarity - a.similarity);
    return applyRelevanceCutoff(ranked, { minSimilarity: opts.minSimilarity, topDrop: opts.topDrop })
      .map((r) => ({ ...normalizeDocumentRow(r), similarity: r.similarity }));
  }

  // Keep only the keyword matches that are actually competitive with the best
  // one. OR-matching is what lets a natural-language query match at all, but it
  // also admits every document containing "a" — and a weak match presented
  // confidently costs an agent more than an honest miss. BM25 already weights
  // by inverse document frequency, so the ranking is trustworthy; what is
  // needed is a floor, not a term filter. (A document-frequency filter was
  // tried first and is wrong in a specific way: it cannot tell a rare function
  // word from a rare content word, so on a small library "how" looks more
  // discriminating than "release".)
  //
  // SQLite's bm25() is negative, better matches being more negative.
  function keywordRelevanceCutoff(rows, { dropFraction = 0.5 } = {}) {
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const scored = rows
      .map((r) => ({ row: r, score: Number(r.bm25_score) }))
      .filter((r) => Number.isFinite(r.score));
    if (!scored.length) return rows; // no scores available: trust the SQL order
    const best = Math.min(...scored.map((r) => r.score));
    const window = Math.abs(best) * dropFraction;
    return scored.filter((r) => r.score - best <= window).map((r) => r.row);
  }

  return {
    async listDocuments(filters = {}) {
      await ready();
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
      // to_tsvector/to_tsquery). Terms are Unicode letter/digit runs — CJK,
      // accented and other non-ASCII words included (C15) — each quoted as an
      // FTS5 phrase with a trailing `*` for the old prefix-match behaviour;
      // whitespace joins as implicit AND, and the tokenizer's own case/diacritic
      // folding applies to query and index alike. Quoting makes every term
      // syntax-safe (the regex admits no quote character). A non-blank query
      // with no usable term matches NOTHING: silently dropping the predicate
      // turned an unsupported search into an unfiltered listing.
      // No alias on the FTS join: MATCH resolves its LHS as the hidden column
      // named after the table, so it must read `markdown_documents_fts match`.
      let ftsJoin = '';
      if (filters.q !== undefined && filters.q !== null && String(filters.q).trim() !== '') {
        const terms = String(filters.q).match(/[\p{L}\p{N}]+/gu) || [];
        if (terms.length) {
          values.push(terms.map(term => `"${term}"*`).join(' '));
          ftsJoin = 'join markdown_documents_fts on markdown_documents_fts.rowid = d.rowid';
          clauses.push(`markdown_documents_fts match $${values.length}`);
        } else {
          clauses.push('0 = 1');
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
        select ${documentListingColumns('d')}, p.slug as project_slug, exists (
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
        join projects p on p.id = d.project_id
        ${ftsJoin}
        ${where}
        order by d.project_id, d.document_type, d.updated_at desc, d.title
      `, values);
      return result.rows.map(normalizeDocumentRow);
    },

    async createDocument(document) {
      await ready();
      const query = buildCreateDocument(document);
      const result = await db.query(query.text, query.values);
      return normalizeDocumentRow(result.rows[0]);
    },

    // `receipt: true` (ID-only HTTP creates) judges a retry by the durable
    // creation receipt, as task creates do: `replayed` returns the current
    // document after edits, `gone` refuses to recreate a deleted one. Without
    // it (generated documents, which carry their own row receipt) and for rows
    // created before 0034, the caller compares content.
    async createDocumentIdempotent(document, { receipt = false } = {}) {
      if (!document?.id) throw new Error('Idempotent document creation requires an id');
      await ready();
      if (receipt) {
        const result = await createRecordOnce(db, {
          recordKind: 'document',
          id: document.id,
          intentHash: creationIntentHash('document', document.id, [
            ...CREATE_FIELDS.map(key => document[key] ?? null), document.kind ?? 'source', document.verified === false,
            document.updatedBy ?? 'user', document.updatedByAgent ?? null,
          ]),
          async load(client) {
            const query = buildGetDocument(document.id);
            return (await client.query(query.text, query.values)).rows[0] || null;
          },
          async insert(client) {
            const query = buildCreateDocument(document, { ignoreIdConflict: true });
            return (await client.query(query.text, query.values)).rows[0] || null;
          },
        });
        const { row, ...outcome } = result;
        return row === undefined ? outcome : { ...outcome, document: row ? normalizeDocumentRow(row) : null };
      }
      const createQuery = buildCreateDocument(document, { ignoreIdConflict: true });
      const created = await db.query(createQuery.text, createQuery.values);
      if (created.rows[0]) return { document: normalizeDocumentRow(created.rows[0]), created: true };
      const getQuery = buildGetDocument(document.id);
      const existing = await db.query(getQuery.text, getQuery.values);
      return {
        document: existing.rows[0] ? normalizeDocumentRow(existing.rows[0]) : null,
        created: false,
      };
    },

    // Shares the upsert operation id space (the 'document-upsert' ledger kind)
    // with a domain-separated intent hash. The receipt survives permanent
    // deletion, unlike a row ID.
    async createDocumentExactlyOnce(document, operationId) {
      await ready();
      return runOnceInTransaction(db, {
        kind: 'document-upsert',
        key: operationId,
        intentHash: ledgerIntentHash([
          'create-document', document.id, ...CREATE_FIELDS.map(key => document[key] ?? null),
          document.kind ?? 'source', document.verified === false,
        ]),
        conflict: () => ({ conflict: true }),
        replay: (receipt, q) => currentDocument(q, receipt.document_id, (row) => ({ document: row, created: false, replayed: true })),
        async execute({ q, record }) {
          const query = buildCreateDocument(document, { ignoreIdConflict: true });
          const rows = await q.query(query.text, query.values);
          if (!rows.rows[0]) return { conflict: true };
          await record({ document_id: document.id });
          return { document: normalizeDocumentRow(rows.rows[0]), created: true };
        },
      });
    },

    // Atomic "remember": create-or-update by EXACT title within a project, in
    // one `begin immediate` session. Concurrent callers serialize on the
    // session mutex, so a title can never be created twice by two agents
    // racing (the old client-side list-then-write could). Only an ACTIVE
    // document counts as the match: a superseded/deprecated title is never
    // revived — the new memory becomes a fresh active document and the retired
    // one keeps its body. `documentType` retypes only when explicit; a create
    // defaults to 'note'. A caller id makes a lost-response retry return the
    // document it already created (`replayed`) instead of a duplicate.
    async upsertDocumentByTitle(document) {
      await ready();
      // The caller id is an OPERATION id, not only a create id: it also names
      // an update-in-place, so a lost-response retry of either is exact-once.
      const operationId = document.id || null;
      // Without an id the write is not retry-safe and records nothing.
      const unrecorded = async () => {};
      const run = async (queryable, recordReceipt = unrecorded) => {
        const found = await queryable.query(
          `select * from markdown_documents
           where project_id = $1 and title = $2 and archived_at is null and status = 'active'
           order by updated_at desc limit 1`,
          [document.projectId, document.title],
        );
        const row = found.rows[0];
        if (row) {
          const fields = {
            body: document.body,
            // Tags left out of the request keep the stored ones; an explicit
            // array (even empty) replaces them.
            ...(Array.isArray(document.tags) ? { tags: document.tags } : {}),
            updatedBy: document.updatedBy || 'user',
            updatedByAgent: document.updatedByAgent ?? null,
            ...(document.documentType ? { documentType: document.documentType } : {}),
            ...(document.kind ? { kind: document.kind } : {}),
          };
          const updated = await updateDocumentOn(queryable, row.id, fields);
          await recordReceipt(updated.id);
          return { document: updated, created: false };
        }
        const candidate = { ...document, documentType: document.documentType || 'note' };
        if (candidate.id) {
          const createQuery = buildCreateDocument(candidate, { ignoreIdConflict: true });
          const created = await queryable.query(createQuery.text, createQuery.values);
          if (created.rows[0]) {
            await recordReceipt(candidate.id);
            return { document: normalizeDocumentRow(created.rows[0]), created: true };
          }
          // A document already carries this id without a receipt (created
          // before receipts existed): the stored fields are the only intent.
          const getQuery = buildGetDocument(candidate.id);
          const prior = await queryable.query(getQuery.text, getQuery.values);
          const existing = prior.rows[0] ? normalizeDocumentRow(prior.rows[0]) : null;
          if (!existing || !documentMatchesCreateFields(existing, candidate)) return { document: existing, created: false, conflict: true };
          await recordReceipt(existing.id);
          return { document: existing, created: false, replayed: true };
        }
        const createQuery = buildCreateDocument(candidate);
        const created = await queryable.query(createQuery.text, createQuery.values);
        return { document: normalizeDocumentRow(created.rows[0]), created: true };
      };
      return withOperationTransaction(db, (queryable) => {
        if (!operationId) return run(queryable);
        // A receipt for this operation wins over the title lookup: replaying a
        // completed remember returns what it produced and never re-applies its
        // old body over a newer accepted write (QINV-03); the same id with
        // different content is a conflict, never a second update.
        return runOnce(queryable, {
          kind: 'document-upsert',
          key: operationId,
          intentHash: upsertIntentHash(document),
          conflict: () => ({ document: null, created: false, conflict: true }),
          replay: (receipt, q) => currentDocument(q, receipt.document_id, (current) => ({ document: current, created: false, replayed: true })),
          gone: () => ({ document: null, created: false, replayed: true, gone: true }),
          execute: ({ q, record }) => run(q, (documentId) => record({ document_id: documentId })),
        });
      });
    },

    // Read-merge-write in one session so the baseline check (`ifRevision`)
    // and the new revision are computed against the row that is actually
    // overwritten (C03). Throws DocumentRevisionConflictError with the current
    // record when the baseline is stale; returns null for a missing or
    // archived document.
    async updateDocument(id, fields, options = {}) {
      await ready();
      const { operationId } = options;
      return withOperationTransaction(db, (queryable) => {
        if (!operationId) return updateDocumentOn(queryable, id, fields, options);
        return runOnce(queryable, {
          kind: 'document-update',
          key: operationId,
          intentHash: ledgerIntentHash([
            id,
            // Baseline and actor are not new intent: an already committed update
            // keeps its first attribution even if another client reconciles it.
            Object.keys(fields).filter(key => Object.hasOwn(UPDATE_COLUMN_MAP, key)).sort().map(key => [key, fields[key]]),
          ]),
          conflict: () => { throw new DocumentUpdateConflictError('update-intent-mismatch'); },
          replay: (receipt, q) => currentDocument(q, receipt.document_id, (current) => ({ ...current, replayed: true })),
          gone: () => { throw new DocumentUpdateConflictError('update-result-gone'); },
          async execute({ q, record }) {
            const document = await updateDocumentOn(q, id, fields, options);
            if (document) await record({ document_id: id });
            return document;
          },
        });
      });
    },

    async archiveDocument(id) {
      await ready();
      const query = buildArchiveDocument(id);
      const result = await db.query(query.text, query.values);
      return result.rows[0] ? normalizeDocumentRow(result.rows[0]) : null;
    },

    async restoreDocument(id) {
      await ready();
      const query = buildRestoreDocument(id);
      const result = await db.query(query.text, query.values);
      if (!result.rows[0]) return null;
      // RETURNING reflects only this statement's write — the 0018 restore
      // trigger recomputes status AFTER it, so the returned row can carry a
      // stale lifecycle state. Re-read so every consumer (route, cache, UI)
      // sees what is actually stored.
      const fresh = await db.query('select * from markdown_documents where id = $1', [id]);
      return normalizeDocumentRow(fresh.rows[0] || result.rows[0]);
    },

    async deleteDocument(id) {
      await ready();
      const query = buildDeleteDocument(id);
      const result = await db.query(query.text, query.values);
      return result.rows[0] ? normalizeDocumentRow(result.rows[0]) : null;
    },

    async listActiveDocumentsForExport(filters = {}) {
      await ready();
      const query = buildListActiveDocumentsForExport(filters);
      const result = await db.query(query.text, query.values);
      return result.rows.map(normalizeDocumentRow);
    },

    async getDocument(id) {
      await ready();
      const query = buildGetDocument(id);
      const result = await db.query(query.text, query.values);
      return result.rows[0] ? normalizeDocumentRow(result.rows[0]) : null;
    },

    async getDocumentCreationReceipt(id) {
      await ready();
      const query = buildGetDocumentCreationReceipt(id);
      const result = await db.query(query.text, query.values);
      const row = result.rows[0];
      return row ? {
        operation: row.creation_operation || null,
        intentHash: row.creation_intent_hash || null,
      } : null;
    },

    async verifyDocument(id, payload) {
      await ready();
      const q = buildVerifyDocument(id, payload);
      const result = await db.query(q.text, q.values);
      return result.rows[0] ? normalizeDocumentRow(result.rows[0]) : null;
    },

    async markDocumentSuperseded(id) {
      await ready();
      const q = buildMarkSuperseded(id);
      const result = await db.query(q.text, q.values);
      return result.rows[0] ? normalizeDocumentRow(result.rows[0]) : null;
    },

    async revertSupersededIfOrphan(id) {
      await ready();
      const q = buildRevertSupersededIfOrphan(id);
      const result = await db.query(q.text, q.values);
      return result.rows[0] ? normalizeDocumentRow(result.rows[0]) : null;
    },

    // Returns the id when the vector was stored, null when the document's
    // revision moved on since the vector was computed (the write is dropped).
    async setDocumentEmbedding(id, payload) {
      await ready();
      const q = buildSetDocumentEmbedding(id, payload);
      const result = await db.query(q.text, q.values);
      return result.rows[0] ? result.rows[0].id : null;
    },

    async hasCurrentEmbedding(id, backend, model) {
      await ready();
      const q = buildHasCurrentEmbedding(id, backend, model);
      const result = await db.query(q.text, q.values);
      return result.rows.length > 0;
    },

    // JS-side vector search: fetch candidates, cosine-rank against the query
    // vector, then apply the relevance cutoff. The normal path returns the
    // requested slice; opts.page returns that slice plus the exact number of
    // relevant candidates so MCP can enumerate every page. Rows come back
    // normalized (tags parsed, embedding never leaks) plus a `similarity` float.
    // Only vectors current for the document's revision and the active
    // backend/model (opts.model) are candidates; stale ones are pending, not
    // ranked (C10).
    async searchDocumentsSemantic(queryVector, backend, opts = {}) {
      await ready();
      const q = buildSearchDocumentsSemantic(backend, { projectId: opts.projectId, includeRetired: opts.includeRetired, model: opts.model });
      const result = await db.query(q.text, q.values);
      const limit = Number.isFinite(Number(opts.limit)) && Number(opts.limit) > 0 ? Number(opts.limit) : 20;
      const offset = Number.isInteger(Number(opts.offset)) && Number(opts.offset) >= 0 ? Number(opts.offset) : 0;
      const ranked = [];
      for (const row of result.rows) {
        const similarity = cosineSimilarity(queryVector, parseEmbedding(row.embedding));
        if (similarity === null || !Number.isFinite(similarity)) continue;
        ranked.push({ ...row, similarity });
      }
      ranked.sort((a, b) => b.similarity - a.similarity);
      const kept = applyRelevanceCutoff(ranked, { minSimilarity: opts.minSimilarity, topDrop: opts.topDrop });
      const items = kept.slice(offset, offset + limit)
        .map((row) => ({ ...normalizeDocumentRow(row), similarity: row.similarity }));
      return opts.page ? { items, total: kept.length } : items;
    },

    rankSemanticCandidates,
    keywordRelevanceCutoff,

    // Hybrid retrieval: fuse the cosine ranking with the BM25 ranking, then
    // weight by trust. This is what the memory path uses, because the two
    // failure modes it fixes are memory-shaped — a document whose vector is
    // pending is invisible to cosine alone, and an exact term (an error code, a
    // flag, a filename) is what embeddings are worst at.
    async searchDocumentsHybrid(queryVector, queryText, backend, opts = {}) {
      await ready();
      const semantic = await rankSemanticCandidates(queryVector, backend, opts);

      let keyword = [];
      const keywordQuery = buildSearchDocumentsKeyword(queryText, {
        projectId: opts.projectId, includeRetired: opts.includeRetired,
      });
      if (keywordQuery) {
        const kw = await db.query(keywordQuery.text, keywordQuery.values);
        keyword = keywordRelevanceCutoff(kw.rows, { dropFraction: opts.keywordDropFraction })
          .map(normalizeDocumentRow);
      }

      const fused = fuseHybrid({ semantic, keyword }, {
        now: opts.now instanceof Date ? opts.now : new Date(),
        trust: opts.trust !== false,
        unverifiedHalfLifeDays: opts.unverifiedHalfLifeDays,
      });

      const limit = Number.isFinite(Number(opts.limit)) && Number(opts.limit) > 0 ? Number(opts.limit) : 20;
      const offset = Number.isInteger(Number(opts.offset)) && Number(opts.offset) >= 0 ? Number(opts.offset) : 0;
      const items = fused.slice(offset, offset + limit);
      return opts.page ? { items, total: fused.length } : items;
    },

    // "More like this": rank documents by similarity to one document's OWN
    // stored embedding — no new embedding call, just reuse the vector we saved.
    // Returns [] when the document has no CURRENT embedding for `backend`
    // (and opts.model): a stale self-vector would compare apples to oranges.
    async findSimilarDocuments(id, backend, opts = {}) {
      await ready();
      const q = buildSearchDocumentsSemantic(backend, { projectId: opts.projectId, includeRetired: opts.includeRetired, model: opts.model });
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

    // Rows whose stored vector is missing, from an older revision, or from a
    // different backend/model. `revision` is informational: the embedding
    // service re-reads each document and guards the write on what it read.
    async listDocumentsNeedingEmbedding(backend, model) {
      await ready();
      const q = buildListDocumentsNeedingEmbedding(backend, model);
      const result = await db.query(q.text, q.values);
      return result.rows.map((r) => ({
        id: r.id,
        revision: typeof r.revision === 'string' && r.revision ? r.revision : documentRevision(r),
        contentHash: r.content_hash,
      }));
    },

    async countEmbeddings(backend, model) {
      await ready();
      const q = buildCountEmbeddings(backend, model);
      const result = await db.query(q.text, q.values);
      const row = result.rows[0] || {};
      return { total: Number(row.total || 0), embedded: Number(row.embedded || 0) };
    },
  };
}
