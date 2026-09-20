export const DOCUMENT_LINK_RELATIONS = ['derived-from', 'supersedes'];

export function buildLinkDocuments(sourceId, targetId, relation) {
  if (relation === 'derived-from') {
    // Upsert refreshes the target_hash snapshot on re-link. SQLite has no
    // pg xmax trick to tell insert from update, so linkDocuments() probes
    // with buildLinkExists first and derives the alreadyLinked flag there.
    return {
      text: `
        insert into document_links (source_document_id, target_document_id, relation, target_hash)
        select $1, $2, $3, (select content_hash from markdown_documents where id = $2)
        where exists (select 1 from markdown_documents where id = $1 and archived_at is null)
          and exists (select 1 from markdown_documents where id = $2 and archived_at is null)
        on conflict (source_document_id, target_document_id, relation)
          do update set target_hash = excluded.target_hash
        returning source_document_id
      `,
      values: [sourceId, targetId, relation],
    };
  }
  return {
    text: `
      insert into document_links (source_document_id, target_document_id, relation)
      select $1, $2, $3
      where exists (select 1 from markdown_documents where id = $1 and archived_at is null)
        and exists (select 1 from markdown_documents where id = $2 and archived_at is null)
      on conflict (source_document_id, target_document_id, relation) do nothing
      returning source_document_id
    `,
    values: [sourceId, targetId, relation],
  };
}

export function buildLinkExists(sourceId, targetId, relation) {
  return {
    text: `
      select 1
      from document_links dl
      join markdown_documents s on s.id = dl.source_document_id and s.archived_at is null
      join markdown_documents t on t.id = dl.target_document_id and t.archived_at is null
      where dl.source_document_id = $1 and dl.target_document_id = $2 and dl.relation = $3
    `,
    values: [sourceId, targetId, relation],
  };
}

export function buildUnlinkDocuments(sourceId, targetId, relation) {
  return {
    text: `delete from document_links where source_document_id = $1 and target_document_id = $2 and relation = $3 returning source_document_id`,
    values: [sourceId, targetId, relation],
  };
}

export function buildListDocumentLinks(documentId, direction = 'both') {
  const outbound = `
    select dl.relation, 'outbound' as direction, d.id, d.title, d.document_type, d.project_id
    from document_links dl
    join markdown_documents d on d.id = dl.target_document_id and d.archived_at is null
    where dl.source_document_id = $1`;
  const inbound = `
    select dl.relation, 'inbound' as direction, d.id, d.title, d.document_type, d.project_id
    from document_links dl
    join markdown_documents d on d.id = dl.source_document_id and d.archived_at is null
    where dl.target_document_id = $1`;
  let text;
  if (direction === 'outbound') text = outbound;
  else if (direction === 'inbound') text = inbound;
  else text = `${outbound}\n    union all${inbound}`;
  return { text: `${text}\n    order by relation, direction`, values: [documentId] };
}

export function normalizeLinkRow(row) {
  return {
    documentId: row.id,
    title: row.title,
    documentType: row.document_type,
    projectId: row.project_id,
    relation: row.relation,
    direction: row.direction,
  };
}

export function buildListStaleDocuments(projectId) {
  const filter = projectId ? 'and d.project_id = $1' : '';
  return {
    text: `
      select d.id, d.title, d.document_type, d.project_id, d.updated_by, d.kind,
             json_group_array(json_object('documentId', tgt.id, 'title', tgt.title)) as stale_sources
      from document_links dl
      join markdown_documents d on d.id = dl.source_document_id and d.archived_at is null
      join markdown_documents tgt on tgt.id = dl.target_document_id and tgt.archived_at is null
      where dl.relation = 'derived-from'
        and dl.target_hash is not null
        and tgt.content_hash is distinct from dl.target_hash
        ${filter}
      group by d.id, d.title, d.document_type, d.project_id, d.updated_by, d.kind
      order by d.title
    `,
    values: projectId ? [projectId] : [],
  };
}

export function buildListOutboundLinksForDocuments(docIds) {
  // pg took a uuid[] via = any($1); SQLite binds the id list as JSON text and
  // expands it with json_each.
  return {
    text: `
      select dl.source_document_id,
             dl.relation,
             dl.target_hash,
             t.id as target_id,
             p.slug as target_project_slug,
             t.source_filename as target_source_filename,
             t.title as target_title
      from document_links dl
      join markdown_documents t on t.id = dl.target_document_id
      join projects p on p.id = t.project_id
      where dl.source_document_id in (select value from json_each($1))
      order by dl.source_document_id, dl.relation, t.title
    `,
    values: [JSON.stringify(docIds)],
  };
}

// json_group_array returns TEXT (pg's json_agg auto-parsed on read); parse at
// the boundary, degrading malformed text to [].
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

export function normalizeStaleRow(row) {
  return {
    documentId: row.id,
    title: row.title,
    documentType: row.document_type,
    projectId: row.project_id,
    updatedBy: row.updated_by,
    kind: row.kind,
    staleSources: parseJsonArray(row.stale_sources),
  };
}

export function createDocumentLinksRepository(db) {
  return {
    async linkDocuments(sourceId, targetId, relation) {
      if (relation === 'derived-from') {
        // Probe before the upsert: no xmax in SQLite, so inserted-vs-refreshed
        // comes from whether a live link already existed. (Single-writer
        // embedded db — no meaningful probe/upsert race.)
        const existsQuery = buildLinkExists(sourceId, targetId, relation);
        const existsResult = await db.query(existsQuery.text, existsQuery.values);
        const alreadyLinked = existsResult.rows.length > 0;
        const query = buildLinkDocuments(sourceId, targetId, relation);
        const result = await db.query(query.text, query.values);
        if (result.rows.length === 0) return { linked: false };
        return alreadyLinked ? { linked: true, alreadyLinked: true } : { linked: true };
      }
      const query = buildLinkDocuments(sourceId, targetId, relation);
      let result;
      try {
        result = await db.query(query.text, query.values);
      } catch (error) {
        if (relation === 'supersedes' && error.message === 'supersession cycle') return { linked: false, cycle: true };
        throw error;
      }
      if (result.rows.length > 0) return { linked: true };
      const existsQuery = buildLinkExists(sourceId, targetId, relation);
      const existsResult = await db.query(existsQuery.text, existsQuery.values);
      if (existsResult.rows.length > 0) return { linked: true, alreadyLinked: true };
      return { linked: false };
    },
    async unlinkDocuments(sourceId, targetId, relation) {
      const query = buildUnlinkDocuments(sourceId, targetId, relation);
      const result = await db.query(query.text, query.values);
      return result.rows.length > 0;
    },
    async listDocumentLinks(documentId, direction = 'both') {
      const query = buildListDocumentLinks(documentId, direction);
      const result = await db.query(query.text, query.values);
      return result.rows.map(normalizeLinkRow);
    },
    async listStaleDocuments(projectId) {
      const query = buildListStaleDocuments(projectId);
      const result = await db.query(query.text, query.values);
      return result.rows.map(normalizeStaleRow);
    },
    async listOutboundLinksForDocuments(docIds) {
      const grouped = new Map();
      if (!Array.isArray(docIds) || docIds.length === 0) return grouped;
      const query = buildListOutboundLinksForDocuments(docIds);
      const result = await db.query(query.text, query.values);
      for (const row of result.rows) {
        if (!grouped.has(row.source_document_id)) {
          grouped.set(row.source_document_id, { 'derived-from': [], supersedes: [] });
        }
        const bucket = grouped.get(row.source_document_id);
        const entry = {
          targetId: row.target_id,
          ...(row.target_hash !== undefined ? { targetHash: row.target_hash } : {}),
          targetProjectSlug: row.target_project_slug,
          targetSourceFilename: row.target_source_filename,
          targetTitle: row.target_title,
        };
        if (row.relation === 'derived-from' || row.relation === 'supersedes') {
          bucket[row.relation].push(entry);
        }
      }
      return grouped;
    },
  };
}
