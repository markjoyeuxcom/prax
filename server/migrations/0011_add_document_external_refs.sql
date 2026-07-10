-- External references: a document can point at outside material — the PR that
-- implemented a decision, the dashboard a runbook watches, the upstream bug a
-- known-issue tracks — WITHOUT copying the content. Unlike document_links
-- (which join two local documents), a ref's target is a URL with no row to
-- join, so it needs its own table. URLs are stored AS ENTERED; a display "kind"
-- (github/gitlab/generic) is derived at render time, not stored. No content
-- hash / staleness — nothing is copied. ON DELETE CASCADE so a document's refs
-- vanish with it.
create table if not exists document_external_refs (
  id text primary key default (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  document_id text not null references markdown_documents(id) on delete cascade,
  url text not null,
  label text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (document_id, url)
);

create index if not exists idx_document_external_refs_document on document_external_refs (document_id);
