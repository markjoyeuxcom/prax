-- Areas (2026-07-20 areas-and-folders plan): a named grouping for projects —
-- "Work", "Home", "Labs" — rendered as collapsible sections in the panel.
-- Free text by design (no registry to manage); empty means unassigned.
alter table projects add column area text;
