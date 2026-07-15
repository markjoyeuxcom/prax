-- migrate:fk=off
-- A run is an operational record, not a child copy of an editable document.
-- Snapshot enough source context to keep it intelligible after source deletion,
-- and retain the nullable source relation only for navigation/listing.

create table runbook_runs_new (
  id text primary key default (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  document_id text references markdown_documents(id) on delete set null,
  document_title text not null default '',
  project_id text references projects(id) on delete set null,
  title text not null default '',
  status text not null default 'running' check (status in ('running', 'completed', 'aborted')),
  started_by text not null default 'user',
  started_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at text,
  finished_by text
);

insert into runbook_runs_new (
  id, document_id, document_title, project_id, title, status,
  started_by, started_at, finished_at, finished_by
)
select
  run.id,
  run.document_id,
  coalesce(document.title, ''),
  document.project_id,
  run.title,
  run.status,
  run.started_by,
  run.started_at,
  run.finished_at,
  null
from runbook_runs run
left join markdown_documents document on document.id = run.document_id;

drop table runbook_runs;
alter table runbook_runs_new rename to runbook_runs;

create index idx_runbook_runs_document on runbook_runs (document_id, started_at);

-- Current step/run columns remain the fast materialized state. This ledger is
-- the append-only explanation of how that state was reached.
create table runbook_run_events (
  id text primary key default (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  run_id text not null references runbook_runs(id) on delete cascade,
  sequence integer not null check (sequence >= 0),
  event_type text not null check (event_type in ('started', 'step-checked', 'step-unchecked', 'aborted', 'resumed', 'completed')),
  step_id text references runbook_run_steps(id) on delete set null,
  step_text text,
  actor text not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (run_id, sequence)
);

create index idx_runbook_run_events_run on runbook_run_events (run_id, sequence);

-- Legacy state cannot reveal past unchecks/resumptions. Backfill only the
-- recoverable facts and mark unavailable finish provenance explicitly.
insert into runbook_run_events (run_id, sequence, event_type, actor, created_at)
select id, 0, 'started', started_by, started_at
from runbook_runs;

insert into runbook_run_events (
  run_id, sequence, event_type, step_id, step_text, actor, created_at
)
select
  step.run_id,
  row_number() over (partition by step.run_id order by step.position, step.id),
  'step-checked',
  step.id,
  step.text,
  coalesce(step.checked_by, 'unknown'),
  step.checked_at
from runbook_run_steps step
where step.checked_at is not null;

insert into runbook_run_events (run_id, sequence, event_type, actor, created_at)
select
  run.id,
  coalesce((select max(event.sequence) from runbook_run_events event where event.run_id = run.id), 0) + 1,
  case run.status when 'completed' then 'completed' else 'aborted' end,
  'unknown',
  run.finished_at
from runbook_runs run
where run.status in ('completed', 'aborted')
  and run.finished_at is not null;
