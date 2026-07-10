-- migrate:fk=off
-- Memory type taxonomy: document_type grows beyond ('runbook','note') to a
-- richer first-class set (decision, known-issue, reference, post-mortem).
-- SQLite cannot ALTER a CHECK constraint, so this is the standard table
-- rebuild — and the CHECK is DROPPED rather than extended: the vocabulary now
-- lives in one app-layer registry (public/js/documentTypes.js, enforced by the
-- routes like task statuses are), so future types never need a rebuild again.
--
-- The fk=off marker makes the runner disable foreign_keys around this file
-- (child tables document_links/runs reference markdown_documents with ON
-- DELETE CASCADE — a DROP with FKs on would cascade their rows away) and run
-- foreign_key_check before commit.
--
-- rowid is copied explicitly: the FTS5 external-content index is keyed on it.
-- The FTS 'rebuild' at the end re-derives the index either way.

create table markdown_documents_new (
  id text primary key default (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  title text not null,
  body text not null default '',
  document_type text not null,
  project_id text not null references projects(id),
  tags text not null default '[]',
  source_filename text,
  archived_at text,
  content_hash text,
  updated_by text not null default 'user',
  kind text not null default 'source' check (kind in ('source', 'synthesized')),
  verified integer not null default 0,
  verified_at text,
  verified_by text,
  status text not null default 'active' check (status in ('active', 'superseded', 'deprecated')),
  embedding text,
  embedding_backend text,
  embedding_model text,
  embedding_dim integer,
  embedded_hash text,
  embedded_at text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

insert into markdown_documents_new (
  rowid, id, title, body, document_type, project_id, tags, source_filename,
  archived_at, content_hash, updated_by, kind, verified, verified_at,
  verified_by, status, embedding, embedding_backend, embedding_model,
  embedding_dim, embedded_hash, embedded_at, created_at, updated_at
)
select
  rowid, id, title, body, document_type, project_id, tags, source_filename,
  archived_at, content_hash, updated_by, kind, verified, verified_at,
  verified_by, status, embedding, embedding_backend, embedding_model,
  embedding_dim, embedded_hash, embedded_at, created_at, updated_at
from markdown_documents;

drop table markdown_documents;
alter table markdown_documents_new rename to markdown_documents;

create index if not exists idx_markdown_documents_project_type on markdown_documents (project_id, document_type);
create index if not exists idx_markdown_documents_archived_at on markdown_documents (archived_at);

create trigger if not exists markdown_documents_fts_ai after insert on markdown_documents begin
  insert into markdown_documents_fts (rowid, title, body)
  values (new.rowid, new.title, new.body);
end;

create trigger if not exists markdown_documents_fts_ad after delete on markdown_documents begin
  insert into markdown_documents_fts (markdown_documents_fts, rowid, title, body)
  values ('delete', old.rowid, old.title, old.body);
end;

create trigger if not exists markdown_documents_fts_au after update of title, body on markdown_documents begin
  insert into markdown_documents_fts (markdown_documents_fts, rowid, title, body)
  values ('delete', old.rowid, old.title, old.body);
  insert into markdown_documents_fts (rowid, title, body)
  values (new.rowid, new.title, new.body);
end;

insert into markdown_documents_fts (markdown_documents_fts) values ('rebuild');

-- Post-mortems graduate from a tag convention to a first-class type. The tag
-- stays on the rows for continuity (searches and older references keep working).
update markdown_documents
  set document_type = 'post-mortem'
  where document_type = 'note' and tags like '%"post-mortem"%';
