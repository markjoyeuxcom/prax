-- Reserved system "Inbox" project: the default home for tasks captured without
-- a project context (e.g. from Today or All projects). Pinned first via
-- sort_order = -1; identified by slug 'inbox' and guarded against rename /
-- archive / delete in projectsRoutes. Fixed id so the row is stable and
-- referenceable; `insert or ignore` keeps the migration idempotent on the
-- unique slug (safe to re-run, and a no-op if a user already has this slug).
insert or ignore into projects (id, name, slug, sort_order) values
  ('00000000-0000-4000-8000-000000000001', 'Inbox', 'inbox', -1);
