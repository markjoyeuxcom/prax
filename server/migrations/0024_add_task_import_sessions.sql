-- Staged chunked import sessions for large/arbitrary task import round-trips.
-- Each chunk is validated and stored in SQLite staging before being atomically
-- committed into the target project in a single transaction.

create table if not exists task_import_sessions (
  id text primary key,
  project_id text not null references projects(id),
  mode text not null check (mode in ('append', 'skip', 'replace')),
  status text not null default 'open' check (status in ('open', 'committed', 'cancelled')),
  chunk_count integer check (chunk_count is null or chunk_count >= 0),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

create index if not exists idx_task_import_sessions_created on task_import_sessions (created_at);

create table if not exists task_import_session_chunks (
  session_id text not null references task_import_sessions(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  chunk_hash text not null,
  tasks_json text,
  task_count integer not null check (task_count >= 0),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  primary key (session_id, chunk_index)
);

create index if not exists idx_task_import_chunks_session on task_import_session_chunks (session_id, chunk_index);
