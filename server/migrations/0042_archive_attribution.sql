-- Who archived a document (QINV-11), on its own columns: a lifecycle event is
-- not an edit, so it no longer rewrites updated_by / updated_by_agent, which
-- record who wrote the CONTENT and decide review-queue membership. Restore
-- clears both. Runtime metadata; not part of the portable export.
alter table markdown_documents add column archived_by text;
alter table markdown_documents add column archived_by_agent text;
