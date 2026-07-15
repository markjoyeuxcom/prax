-- Generated-document retries need to distinguish the same machine intent from a
-- caller reusing a result UUID for a different prompt. These internal receipt
-- fields are runtime metadata and are intentionally absent from portable export.
alter table markdown_documents add column creation_operation text;
alter table markdown_documents add column creation_intent_hash text;
