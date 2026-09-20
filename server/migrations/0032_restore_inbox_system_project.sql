-- Inbox is again a protected dependency of capture and weekly review.
-- Adopt an existing slug without replacing its ID, contents or relationships.
-- If it was deleted, allocate a NEW ID: never reuse a retired ID or repurpose
-- a different project that happens to hold migration 0002's original ID.
insert into projects (name, slug, sort_order)
select 'Inbox', 'inbox', -1
where not exists (select 1 from projects where slug = 'inbox');

update projects
set name = 'Inbox', status = 'active', sort_order = -1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
where slug = 'inbox'
  and (name <> 'Inbox' or status <> 'active' or sort_order <> -1);
