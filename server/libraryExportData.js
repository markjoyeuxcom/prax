import { normalizeExternalRefRow } from './documentExternalRefsRepository.js';
import { normalizeCodeRefRow } from './documentCodeRefsRepository.js';

// One bounded-parameter query per relation rather than one request per document.
export async function decorateExportDocuments(db, documents) {
  if (!db || !documents.length) return documents;
  const ids = JSON.stringify(documents.map(doc => doc.id));
  const [external, code, tasks] = await Promise.all([
    db.query('select * from document_external_refs where document_id in (select value from json_each($1)) order by document_id, url', [ids]),
    db.query('select * from document_code_refs where document_id in (select value from json_each($1)) order by document_id, path, start_line, id', [ids]),
    db.query('select * from task_documents where document_id in (select value from json_each($1)) order by document_id, task_id', [ids]),
  ]);
  const byId = new Map(documents.map(doc => [doc.id, { ...doc, externalRefs: [], codeRefs: [], taskIds: [] }]));
  for (const row of external.rows) byId.get(row.document_id).externalRefs.push(normalizeExternalRefRow(row));
  for (const row of code.rows) byId.get(row.document_id).codeRefs.push(normalizeCodeRefRow(row));
  for (const row of tasks.rows) byId.get(row.document_id).taskIds.push(row.task_id);
  return [...byId.values()];
}
