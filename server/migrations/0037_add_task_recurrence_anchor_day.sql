-- The day-of-month a monthly series was set up on, so a Jan 31 series that is
-- clamped to Feb 28 returns to the 31st in March (server/recurrence.js). Set
-- when a monthly recurrence is set or a monthly task's due date is moved, and
-- carried to each generated occurrence. Existing monthly tasks stay null: a
-- clamped due date (the 28th) cannot tell us whether the series began on the
-- 28th or the 31st, so they keep their due date's day and take that as their
-- anchor at the next completion.
alter table tasks add column recurrence_anchor_day integer
  check (recurrence_anchor_day is null or recurrence_anchor_day between 1 and 31);
