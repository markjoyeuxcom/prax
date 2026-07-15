-- A supersedes edge is the source of truth for lifecycle status. Keep the
-- target row coherent in the same SQLite statement that changes the edge or
-- replacement visibility, so every HTTP/MCP/repository path gets one atomic
-- outcome and foreign-key cascades cannot strand a false status.

create trigger if not exists document_links_supersedes_insert
after insert on document_links
when new.relation = 'supersedes'
begin
  update markdown_documents
  set status = 'superseded',
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  where id = new.target_document_id
    and status = 'active'
    and archived_at is null
    and exists (
      select 1
      from markdown_documents source
      where source.id = new.source_document_id
        and source.archived_at is null
    );
end;

create trigger if not exists document_links_supersedes_delete
after delete on document_links
when old.relation = 'supersedes'
begin
  update markdown_documents
  set status = 'active',
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

create trigger if not exists markdown_documents_superseder_archived
after update of archived_at on markdown_documents
when old.archived_at is null and new.archived_at is not null
begin
  update markdown_documents
  set status = 'active',
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

create trigger if not exists markdown_documents_superseder_restored
after update of archived_at on markdown_documents
when old.archived_at is not null and new.archived_at is null
begin
  update markdown_documents
  set status = 'superseded',
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

-- Reconcile databases created before the invariant existed. A live edge wins;
-- an orphaned superseded status is returned to active (there is no public path
-- for setting that status without a replacement edge).
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
  and not exists (
    select 1
    from document_links link
    join markdown_documents source
      on source.id = link.source_document_id
     and source.archived_at is null
    where link.target_document_id = markdown_documents.id
      and link.relation = 'supersedes'
  );
