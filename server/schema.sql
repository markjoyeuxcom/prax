create extension if not exists pgcrypto;

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  priority text not null check (priority in ('high', 'medium', 'low')),
  status text not null check (status in ('high-priority', 'in-progress', 'planned', 'completed', 'notes')),
  context text not null check (context in ('personal', 'work', 'homelab')),
  due_date date,
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  label text not null,
  completed boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists task_activity (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  event_type text not null,
  message text not null,
  created_at timestamptz not null default now()
);

create table if not exists markdown_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null default '',
  document_type text not null check (document_type in ('runbook', 'note')),
  context text not null check (context in ('personal', 'work', 'homelab')),
  tags text[] not null default '{}',
  source_filename text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tasks_context_status on tasks (context, status);
create index if not exists idx_tasks_archived_at on tasks (archived_at);
create index if not exists idx_tasks_due_date on tasks (due_date);
create index if not exists idx_markdown_documents_context_type on markdown_documents (context, document_type);
create index if not exists idx_markdown_documents_archived_at on markdown_documents (archived_at);
create index if not exists idx_markdown_documents_fts
  on markdown_documents
  using gin (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, '')));

create table if not exists task_documents (
  task_id uuid not null references tasks(id) on delete cascade,
  document_id uuid not null references markdown_documents(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, document_id)
);

create index if not exists idx_task_documents_document on task_documents (document_id);
