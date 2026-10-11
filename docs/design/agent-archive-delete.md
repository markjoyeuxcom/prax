# Agents archive, restore and delete

**Date:** 2026-10-11 · **Status:** adopted, implemented with this note · **Builds on:** the trust
model in [agent memory](../agent-memory.md) and QINV-11 of the
[quality standard](quality-standard.md) (destructive actions are attributable). Tracked in the
Prax task "Agents can archive, restore and delete documents and tasks from the CLI" (d405a6cd).

## Problem

An agent that filed something wrong had two options: supersede it (which needs a replacement and
keeps the old document in history) or ask a person. Memory that should not have been written at
all, and tasks captured by mistake, stayed active until a person archived them in the app. Mark
asked on 2026-10-11 to give agents the ability to archive or delete.

## Design

Three CLI commands, one record each, the id tried as a document first and then as a task:

| Command | Effect | Guards |
|---|---|---|
| `prax archive <id>` | Reversible. The document leaves recall, context packs and the mirror; the task leaves every open list. | Refused when already archived. |
| `prax restore <id>` | Undoes an archive. | Refused when not archived. |
| `prax delete <id> --yes` | Permanent. | The record must be archived first (two deliberate steps, never one); a verified document is never deleted by an agent, archived or not (a person's verification is a person's to remove); `--yes` must be given so the intent is in the transcript. No prompt: agents have no terminal to answer in. |

The server routes already existed for the app (`DELETE /api/library/documents/:id` archives,
`PATCH …/restore`, `DELETE …/permanent`; the same shape under `/api/tasks/:id`). The CLI adds the
client methods and the guards. Each request carries the agent origin and id; the document archive
and restore routes now stamp `updatedBy` / `updatedByAgent` from them, as every other document
write does, so the since-last-session delta and the Library say who archived what. Task archive
and restore were already logged in the task's activity with the actor.

Supersede stays the retirement for memory that was *replaced*: it records the link and keeps the
old text reachable from the new one. Archive is for memory that should not exist. Delete is for
the archived leftovers nobody will miss, and an agent that is not sure stops at archive.

## Out of scope

The MCP server still exposes no archive, delete, reorder or import tool
([mcp/README.md](../../mcp/README.md)); the assistant's confirmed-write flow is the place that
would carry a person's confirmation, and nobody has asked for it there. Projects are not covered:
`prax` never archives or deletes a project.
