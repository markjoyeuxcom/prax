alter table markdown_documents
  add column if not exists verified     boolean not null default false,
  add column if not exists verified_at  timestamptz,
  add column if not exists verified_by  text,
  add column if not exists status       text not null default 'active';

alter table markdown_documents
  drop constraint if exists markdown_documents_status_check;
alter table markdown_documents
  add constraint markdown_documents_status_check
  check (status in ('active', 'superseded', 'deprecated'));

-- Backfill existing rows conservatively: human-authored memory is trusted,
-- agent-authored memory starts unverified.
update markdown_documents set verified = true  where updated_by = 'user';
update markdown_documents set verified = false where updated_by = 'agent';

-- Mark already-superseded docs (targets of a supersedes link) as superseded.
update markdown_documents d set status = 'superseded'
  where exists (
    select 1 from document_links l
    where l.target_document_id = d.id and l.relation = 'supersedes'
  );
