-- Task labels: cross-cutting contexts (@waiting, @pagerduty, @cert-rotation) as
-- a JSON text array, mirroring markdown_documents.tags. Additive to the task
-- shape and kept OUT of the frozen moomora.tasks import field set (like
-- deferred_until / recurrence). Labels are normalized lowercase on write so
-- @-matching in the task filter grammar is predictable. Filtered in JS, never
-- SQL — so no index.
alter table tasks add column labels text not null default '[]';
