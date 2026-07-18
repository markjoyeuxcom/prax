-- Close the archived-target gaps in the 0012 supersession lifecycle.
--
-- 0012's triggers keep a target's status coherent while it is LIVE, but two
-- transitions strand it: (1) restoring a superseded target from archive fires
-- nothing (buildRestoreDocument only clears archived_at), and (2) trigger 3
-- flips an ARCHIVED target to 'active' when its superseder is archived, after
-- which trigger 4 skips archived targets on the superseder's restore. Either
-- way a restored target can sit live + 'active' with a live inbound
-- supersedes edge — the exact stuck state the review reproduced.
--
-- The fix: on restore, a document recomputes its OWN status from its live
-- inbound supersedes edges. Only 'active'/'superseded' participate —
-- 'deprecated' is a manual state the lifecycle never overwrites, matching
-- 0012's triggers. The no-op guard keeps updated_at honest.
create trigger if not exists markdown_documents_target_restored
after update of archived_at on markdown_documents
when old.archived_at is not null and new.archived_at is null
begin
  update markdown_documents
  set status = case when exists (
        select 1
        from document_links link
        join markdown_documents source
          on source.id = link.source_document_id
         and source.archived_at is null
        where link.target_document_id = new.id
          and link.relation = 'supersedes'
      ) then 'superseded' else 'active' end,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  where id = new.id
    and status in ('active', 'superseded')
    and status <> case when exists (
        select 1
        from document_links link
        join markdown_documents source
          on source.id = link.source_document_id
         and source.archived_at is null
        where link.target_document_id = new.id
          and link.relation = 'supersedes'
      ) then 'superseded' else 'active' end;
end;

-- Repair rows already stranded by the gaps above: re-run 0012's forward
-- reconcile (its archived_at guard skipped targets that were archived at
-- migration time and have since been restored) and its reverse pass.
update markdown_documents
set status = 'superseded',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
where status = 'active'
  and archived_at is null
  and exists (
    select 1
    from document_links link
    join markdown_documents source
      on source.id = link.source_document_id
     and source.archived_at is null
    where link.target_document_id = markdown_documents.id
      and link.relation = 'supersedes'
  );

update markdown_documents
set status = 'active',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
where status = 'superseded'
  and archived_at is null
  and not exists (
    select 1
    from document_links link
    join markdown_documents source
      on source.id = link.source_document_id
     and source.archived_at is null
    where link.target_document_id = markdown_documents.id
      and link.relation = 'supersedes'
  );
