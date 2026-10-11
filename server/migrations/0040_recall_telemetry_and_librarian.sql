-- Librarian (docs/design/librarian.md).
--
-- Recall telemetry: a local-only record of the retrieval queries agent
-- clients make (they opt in with x-prax-query-source), the documents each
-- returned, and the documents an agent reports it used (`prax used <id>`).
-- Bounded by server/recallTelemetry.js (90 days, 20,000 rows per table) and
-- cleared by `prax telemetry clear`. It travels in the full workspace backup
-- (the whole database) and never in the portable Library export.
create table recall_queries (
  id integer primary key autoincrement,
  occurred_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  source text not null check (source in ('recall', 'search', 'context', 'mcp', 'assistant')),
  mode text not null check (mode in ('semantic', 'hybrid', 'keyword', 'recency')),
  query text not null,
  query_key text not null,
  agent text,
  project_id text references projects(id) on delete set null,
  hit_count integer not null default 0 check (hit_count >= 0)
);

create index idx_recall_queries_occurred on recall_queries (occurred_at);
create index idx_recall_queries_key on recall_queries (query_key);

create table recall_query_hits (
  query_id integer not null references recall_queries(id) on delete cascade,
  document_id text not null references markdown_documents(id) on delete cascade,
  rank integer not null,
  primary key (query_id, document_id)
);

create index idx_recall_query_hits_document on recall_query_hits (document_id);

create table recall_uses (
  id integer primary key autoincrement,
  occurred_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  document_id text not null references markdown_documents(id) on delete cascade,
  agent text,
  source text not null default 'cli'
);

create index idx_recall_uses_document on recall_uses (document_id, occurred_at);
create index idx_recall_uses_occurred on recall_uses (occurred_at);

-- Consolidation proposals. The proposal itself is an ordinary unverified,
-- agent-written document (so it lands in the review queue); this row names
-- the cluster it came from and its decision. Approval is the only path that
-- records `supersedes` links; the librarian never retires a source itself.
create table librarian_proposals (
  document_id text primary key references markdown_documents(id) on delete cascade,
  cluster_key text not null,
  project_id text not null,
  source_ids text not null,
  method text not null check (method in ('embedding', 'shingle', 'mixed')),
  status text not null default 'open' check (status in ('open', 'approved', 'dismissed')),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  decided_at text
);

create index idx_librarian_proposals_key on librarian_proposals (cluster_key);
create index idx_librarian_proposals_status on librarian_proposals (status);
