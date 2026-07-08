-- Recurring tasks: a nullable recurrence token ('daily' | 'weekly' | 'monthly'
-- | 'every:Nd' | 'every:Nw'; null = one-off). When a task carrying one is
-- completed, the API spawns the next instance with an advanced due date. The
-- column is additive to the task shape and deliberately kept out of the frozen
-- moomora.tasks import field set.
alter table tasks add column recurrence text;
