-- Today plan & shutdown ritual (2026-07-18 plan): the working set is a DATE,
-- not a boolean — planned_for records which day a task was consciously pulled
-- into, which makes "planned yesterday but never shut down" detectable and
-- makes carry semantics trivial. carry_count records how many times an
-- unfinished planned item was consciously rolled to another day (the shutdown
-- ritual's honest score; server-computed in the PATCH path via planning.js).
alter table tasks add column planned_for text;
alter table tasks add column carry_count integer not null default 0;
