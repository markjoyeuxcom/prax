-- Attribute task history across UI/HTTP and MCP writes. Existing history was
-- produced before machine origin was recorded and is treated as user-origin.
alter table task_activity add column actor text not null default 'user';
