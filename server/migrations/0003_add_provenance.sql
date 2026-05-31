alter table markdown_documents add column if not exists content_hash text;
alter table markdown_documents add column if not exists updated_by text not null default 'user';
alter table document_links add column if not exists target_hash text;
