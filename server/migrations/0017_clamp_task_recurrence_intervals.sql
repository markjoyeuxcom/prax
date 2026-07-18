-- Clamp stored every:N recurrence intervals to the validation cap (10000).
-- The cap was introduced at validation time only, so a task stored with a
-- then-legal larger interval silently ended its series on completion
-- (isValidRecurrence now rejects the token, nextDueDate returns null, no
-- successor spawns) while the UI announced the next occurrence was
-- scheduled. Clamping preserves the series; a 10000-day cadence is
-- indistinguishable from the original intent at any human timescale.
-- substr(recurrence, 7) starts after 'every:'; the final character is the
-- d/w unit, kept as-is. Non-numeric garbage CASTs to 0 and is untouched.
update tasks
set recurrence = 'every:10000' || substr(recurrence, length(recurrence))
where recurrence like 'every:%'
  and cast(substr(recurrence, 7, length(recurrence) - 7) as integer) > 10000;
