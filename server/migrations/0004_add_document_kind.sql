alter table markdown_documents
  add column if not exists kind text not null default 'source';

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'markdown_documents_kind_check'
  ) then
    alter table markdown_documents
      add constraint markdown_documents_kind_check
      check (kind in ('source', 'synthesized'));
  end if;
end $$;
