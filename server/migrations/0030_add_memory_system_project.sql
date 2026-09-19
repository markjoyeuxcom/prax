-- Reserved system "Memory" project: the shared long-term memory that every
-- agent CLI writes to (`prax remember … --memory`, the prax-remember skill).
-- Identified by slug 'memory' and guarded against rename / status change /
-- delete in projectsRoutes — it replaces Inbox as the only protected project,
-- so Inbox is an ordinary, deletable project from this migration on.
-- Fixed id so the row is stable and referenceable; `insert or ignore` keeps the
-- migration idempotent on the unique slug and adopts a `memory` project the CLI
-- already created on first remember (that row keeps its own id and contents).
insert or ignore into projects (id, name, slug, sort_order) values
  ('4d454d4f-5259-4000-8000-000000000001', 'Memory', 'memory',
   (select coalesce(max(sort_order), -1) + 1 from projects));
