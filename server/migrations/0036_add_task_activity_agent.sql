-- Say WHICH agent changed a task, not only that an agent did. Mirrors
-- markdown_documents.updated_by_agent (0026): the `x-prax-agent` id sent by
-- the prax CLI and MCP clients alongside an agent origin, null for a person or
-- an agent that did not identify itself. Existing history stays null.
alter table task_activity add column actor_agent text;
