-- Repairs for data written before the rules that now prevent it
-- (2026-09-22 review). Each statement only touches rows in the old state.

-- 1. Supersession cycles created before 0031. 0031 refuses a new edge that
-- would close a cycle but left existing cycles in place: with A > B and B > A
-- both documents stay superseded and drop out of every active listing.
-- An edge is in a cycle when its predecessor already reaches its replacement.
-- Within a cycle, keep only the edges that point from the newer document to
-- the older (by created_at, then id, so the order is total) and remove the
-- rest: a replacement is written after what it replaces, and edges that all
-- point to older documents cannot form a cycle, so one pass repairs any cycle.
-- Edges outside a cycle are never touched. The 0012 delete trigger returns a
-- predecessor that no live edge still supersedes to active.
with recursive reaches(origin, id) as (
  select source_document_id, target_document_id
  from document_links
  where relation = 'supersedes'
  union
  select reaches.origin, link.target_document_id
  from reaches
  join document_links link
    on link.source_document_id = reaches.id
   and link.relation = 'supersedes'
)
delete from document_links
where relation = 'supersedes'
  and exists (
    select 1 from reaches
    where reaches.origin = document_links.target_document_id
      and reaches.id = document_links.source_document_id
  )
  and (
    select (source.created_at, source.id) < (target.created_at, target.id)
    from markdown_documents source, markdown_documents target
    where source.id = document_links.source_document_id
      and target.id = document_links.target_document_id
  );

-- 2. Assistant write receipts kept each approved tool's full output, so a
-- document's body outlived its permanent deletion in the receipt. A receipt
-- now keeps only the outcome (server/assistant/writeReceipts.js,
-- compactReceiptResult); these notes must match RECEIPT_NOTES there.
update assistant_write_receipts
set result = json_object(
  'id', json_extract(result, '$.id'),
  'name', json_extract(result, '$.name'),
  'content', case when json_extract(result, '$.isError')
    then 'This approved action already ran and reported an error. Its original output is not kept; check the affected records before trying again.'
    else 'This approved action already ran and completed. Its original output is not kept; read the affected records for their current state.'
  end,
  'isError', json(case when json_extract(result, '$.isError') then 'true' else 'false' end)
)
where status = 'completed'
  and result is not null
  and json_valid(result)
  and json_type(result, '$.content') is not null;

-- 3. Task import receipts kept a full copy of every imported task. Keep the
-- ids instead; a replay reads the tasks' current rows (server/tasksRepository.js).
update task_import_operations
set result_json = json_set(
  json_remove(result_json, '$.tasks'),
  '$.taskIds',
  json((
    select json_group_array(json_extract(task.value, '$.id'))
    from json_each(task_import_operations.result_json, '$.tasks') task
  ))
)
where json_valid(result_json)
  and json_type(result_json, '$.tasks') = 'array';
