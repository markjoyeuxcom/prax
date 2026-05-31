export const DOCUMENT_LINK_RELATIONS = ['derived-from', 'supersedes'];

export function buildLinkDocuments(sourceId, targetId, relation) {
  return {
    text: `
      insert into document_links (source_document_id, target_document_id, relation)
      select $1, $2, $3
      where exists (select 1 from markdown_documents where id = $1 and archived_at is null)
        and exists (select 1 from markdown_documents where id = $2 and archived_at is null)
      on conflict (source_document_id, target_document_id, relation) do nothing
      returning source_document_id, target_document_id, relation
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

export function createDocumentLinksRepository(db) {
  return {
    async linkDocuments(sourceId, targetId, relation) {
      const query = buildLinkDocuments(sourceId, targetId, relation);
      const result = await db.query(query.text, query.values);
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
  };
}
