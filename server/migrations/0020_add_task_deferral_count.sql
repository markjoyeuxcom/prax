-- Slippage honesty (2026-07-18 plan): how many times a task's commitment was
-- consciously pushed — snoozed into the future or due-date moved later while
-- still open. Counted server-side in the PATCH path (one shared rule in
-- slippage.js); historic snoozes were never recorded as events, so every
-- existing task honestly starts at zero rather than inheriting a fabricated
-- backfill.
alter table tasks add column deferral_count integer not null default 0;
