-- Where each agent's since-last-session memory delta last ended
-- (docs/design/budgeted-context-and-brief.md).
-- `agent` is the x-prax-agent id; `scope` is a project id, or '*' for the
-- all-projects feed, so a project-scoped delta never advances the wider one.
-- `last_recall_at` only moves forward (the route stores max(stored, new)).
-- Runtime metadata like the operation receipts: not part of portable export.
create table if not exists agent_recall_markers (
  agent text not null,
  scope text not null,
  last_recall_at text not null,
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  primary key (agent, scope)
);
