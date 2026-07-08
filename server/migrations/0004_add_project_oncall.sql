-- Ops metadata on a project: who's on call, and free-form handoff notes for
-- shift/rotation handovers. Both nullable free text.
alter table projects add column on_call text;
alter table projects add column handoff_notes text;
