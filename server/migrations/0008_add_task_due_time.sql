-- Task time-of-day: an optional wall-clock time ('HH:MM', 24-hour, the user's
-- local time) paired with due_date, so reminders can fire at a specific time
-- rather than only on the date. Additive to the task shape and kept OUT of the
-- frozen moomora.tasks import field set (like deferred_until / recurrence /
-- labels). Nullable — most tasks stay date-only. Not indexed (reminder
-- selection is in JS, like the due-date logic).
alter table tasks add column due_time text;
