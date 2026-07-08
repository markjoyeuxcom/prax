-- Runbook execution mode: a "run" is one execution of a runbook. Its steps are
-- snapshotted from the runbook's checkbox lines at start time, so checking them
-- off (with timestamps) records an incident chronicle WITHOUT editing the source
-- document — and later edits to the runbook don't rewrite past runs.
create table if not exists runbook_runs (
  id text primary key default (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  document_id text not null references markdown_documents(id) on delete cascade,
  title text not null default '',
  status text not null default 'running' check (status in ('running', 'completed', 'aborted')),
  started_by text not null default 'user',
  started_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at text
);

create table if not exists runbook_run_steps (
  id text primary key default (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  run_id text not null references runbook_runs(id) on delete cascade,
  position integer not null,
  text text not null,
  checked_at text,
  checked_by text
);

create index if not exists idx_runbook_runs_document on runbook_runs (document_id, started_at);
create index if not exists idx_runbook_run_steps_run on runbook_run_steps (run_id, position);
