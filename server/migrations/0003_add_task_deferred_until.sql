-- Snooze / defer: a task with deferred_until in the future is hidden from Today
-- and active lists until that moment, then reappears. Nullable ISO timestamp;
-- null = not snoozed. Kept separate from due_date (when it's due) and
-- archived_at (removed from active).
alter table tasks add column deferred_until text;
