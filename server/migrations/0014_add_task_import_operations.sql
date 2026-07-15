-- A portable import is a consequential batch write. Retain its caller identity
-- and original result independently of the imported task rows so a response
-- lost after commit can be replayed safely even after later task changes.
create table task_import_operations (
  id text primary key,
  project_id text not null,
  mode text not null check (mode in ('append', 'skip', 'replace')),
  payload_hash text not null,
  result_json text not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

create index task_import_operations_created on task_import_operations (created_at);
