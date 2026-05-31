create table if not exists document_links (
  source_document_id uuid not null references markdown_documents(id) on delete cascade,
  target_document_id uuid not null references markdown_documents(id) on delete cascade,
  relation text not null,
  created_at timestamptz not null default now(),
  primary key (source_document_id, target_document_id, relation),
  check (source_document_id <> target_document_id)
);

create index if not exists idx_document_links_target on document_links (target_document_id, relation);
