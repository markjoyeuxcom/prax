-- Who retired a document by superseding it, on its own columns (review of the
-- 0.44.0 fix batch). A supersedes edge is a lifecycle event, not an edit, so it
-- no longer rewrites updated_by / updated_by_agent, which record who wrote the
-- CONTENT and decide review-queue membership: an unreviewed agent note that a
-- person supersedes and later unlinks comes back still owing its review.
-- Reviving a document (the edge removed, or the superseder archived) clears
-- both. Runtime metadata; not part of the portable export.
alter table markdown_documents add column retired_by text;
alter table markdown_documents add column retired_by_agent text;

drop trigger if exists document_links_supersedes_delete;
create trigger document_links_supersedes_delete
after delete on document_links
when old.relation = 'supersedes'
begin
  update markdown_documents
  set status = 'active',
      retired_by = null,
      retired_by_agent = null,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  where id = old.target_document_id
    and status = 'superseded'
    and not exists (
      select 1
      from document_links link
      join markdown_documents source
        on source.id = link.source_document_id
       and source.archived_at is null
      where link.target_document_id = old.target_document_id
        and link.relation = 'supersedes'
    );
end;

drop trigger if exists markdown_documents_superseder_archived;
create trigger markdown_documents_superseder_archived
after update of archived_at on markdown_documents
when old.archived_at is null and new.archived_at is not null
begin
  update markdown_documents
  set status = 'active',
      retired_by = null,
      retired_by_agent = null,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  where id in (
      select link.target_document_id
      from document_links link
      where link.source_document_id = new.id
        and link.relation = 'supersedes'
    )
    and status = 'superseded'
    and not exists (
      select 1
      from document_links live_link
      join markdown_documents live_source
        on live_source.id = live_link.source_document_id
       and live_source.archived_at is null
      where live_link.target_document_id = markdown_documents.id
        and live_link.relation = 'supersedes'
    );
end;

-- The edge itself carries its actor, so a restore that re-retires a target
-- (its superseder restored, or the target restored under a live edge) can
-- attribute the retirement to the person or agent who made the edge.
alter table document_links add column created_by text;
alter table document_links add column created_by_agent text;

drop trigger if exists markdown_documents_superseder_restored;
create trigger markdown_documents_superseder_restored
after update of archived_at on markdown_documents
when old.archived_at is not null and new.archived_at is null
begin
  update markdown_documents
  set status = 'superseded',
      retired_by = (select link.created_by from document_links link
                    where link.source_document_id = new.id and link.target_document_id = markdown_documents.id and link.relation = 'supersedes'),
      retired_by_agent = (select link.created_by_agent from document_links link
                          where link.source_document_id = new.id and link.target_document_id = markdown_documents.id and link.relation = 'supersedes'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  where id in (
      select link.target_document_id
      from document_links link
      where link.source_document_id = new.id
        and link.relation = 'supersedes'
    )
    and status = 'active'
    and archived_at is null;
end;

drop trigger if exists markdown_documents_target_restored;
create trigger markdown_documents_target_restored
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
      retired_by = (select link.created_by
        from document_links link
        join markdown_documents source
          on source.id = link.source_document_id
         and source.archived_at is null
        where link.target_document_id = new.id
          and link.relation = 'supersedes'
        order by link.created_at desc limit 1),
      retired_by_agent = (select link.created_by_agent
        from document_links link
        join markdown_documents source
          on source.id = link.source_document_id
         and source.archived_at is null
        where link.target_document_id = new.id
          and link.relation = 'supersedes'
        order by link.created_at desc limit 1),
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
