# Task Detail Enrichment Design — Notes, Checklist, Activity

**Date:** 2026-05-21
**Status:** Approved (brainstorm)
**Builds on:** v0.5.1

## Goal

Make the three placeholder sections of the task detail panel real, following the working **Linked docs** pattern end-to-end (table → repository → routes → in-memory demo mirror → detail-panel section + `main.js` loader → MCP tool):

1. **Notes** — a single free-text field per task, inline-editable in the detail panel.
2. **Checklist** — ordered, toggleable checklist items per task (add / toggle / delete + a done count).
3. **Activity** — an auto-logged, read-only history of lifecycle + status events per task.

## Current state (context)

- `task_checklist_items` and `task_activity` tables exist in `server/schema.sql` but have **no** repository/route/UI/MCP wiring.
- "Notes" has **no** column or table.
- `renderTaskDetail.js` renders Checklist/Notes/Activity via static `renderDetailBlock(title, text)` placeholders.
- Reference implementation: Linked docs — `task_documents` table, `tasksRepository` link methods, `/api/tasks/:id/documents` routes, `scripts/demo-server.js` in-memory mirror, `renderLinkedDocs` in `renderTaskDetail.js`, `loadTaskDocuments` + handlers in `main.js`, and `link_task_document`/`list_task_documents` MCP tools.

## Non-goals (v1)

- No checklist reorder or inline rename (add / toggle / delete only). New items append at `sort_order = max + 1`.
- No timestamped/threaded notes — a single field.
- Activity logs only lifecycle + status (created, status changed, archived, restored). It does **not** log field edits, doc links, or checklist changes. Read-only — no manual activity entries.
- No archive/delete of activity rows (append-only; cascades on task delete via the existing FK).

---

## Feature 1: Notes (task field)

### Schema
Add to the `tasks` table in `server/schema.sql`:
```sql
notes text not null default ''
```

### Backend (`server/tasksRepository.js`)
- `normalizeTaskRow` returns `notes: row.notes`.
- Add `notes` to `ALLOWED_CREATE_FIELDS`, `IMPORT_FIELDS`, and `UPDATE_COLUMN_MAP` (`notes: 'notes'`), and to the `buildCreateTask` / `buildImportTasks` / `buildReplaceProjectTasks` column lists so the field round-trips.
- This changes the task object shape and the import field list, so the existing tests that assert a full task object or exact import value arrays in `tests/backend/tasksRepository.test.js` must be updated: `normalizeTaskRow` expectation (add `notes`), `buildImportTasks` and `buildReplaceProjectTasks` value-array expectations (add the `notes` value in field order), and any task-route test asserting the whole task. Updating these is part of Feature 1.

### Routes (`server/tasksRoutes.js`)
- Add `notes` to the task PATCH allow-list (`PATCH_FIELDS`). No new route — `PATCH /api/tasks/:id { notes }` already exists.

### Demo (`scripts/demo-server.js`)
- `createTask` seed object includes `notes: seed.notes || ''`. `updateTask` already `Object.assign`s patches, so notes flows through.

### UI (`public/js/renderTaskDetail.js` + `main.js`)
- Replace the Notes placeholder block with `renderNotes(task, options)`: a `<textarea data-task-notes>` pre-filled with `task.notes`, plus a `[s] save` button (`data-action="save-task-notes"`). Read-only views (archive) render the notes as static text, no editor.
- `main.js`: bind `save-task-notes` → read the textarea value → `updateTask(selectedId, { notes })` (existing task API helper) → reload the task into state → re-render.

### MCP (`mcp/tools/tasks.js`)
- Add an optional `notes: z.string()` to the `update_task` input schema and pass it through (it maps to the task PATCH). No new tool.

---

## Feature 2: Checklist (`task_checklist_items`)

Table already exists: `id, task_id (fk on delete cascade), label, completed bool, sort_order, created_at, updated_at`.

### Backend (`server/checklistRepository.js` — new)
Pure query builders + a `createChecklistRepository(db)` factory (mirrors `tasksRepository`):
- `buildListChecklist(taskId)` → `select * ... where task_id = $1 order by sort_order, created_at`.
- `buildAddChecklistItem(taskId, label)` → insert with `sort_order = (select coalesce(max(sort_order), -1) + 1 from task_checklist_items where task_id = $1)`.
- `buildSetChecklistItemCompleted(itemId, completed)` → `update ... set completed = $2, updated_at = now() where id = $1 returning *`.
- `buildDeleteChecklistItem(itemId)` → `delete ... where id = $1 returning *`.
- `normalizeChecklistRow(row)` → `{ id, taskId, label, completed, sortOrder, createdAt, updatedAt }`.

### Routes (`server/checklistRoutes.js` — new, registered in `server/index.js`)
- `GET  /api/tasks/:id/checklist` → list items for the task.
- `POST /api/tasks/:id/checklist` body `{ label }` → 400 if label missing/blank; returns the created item (201).
- `PATCH /api/tasks/:taskId/checklist/:itemId` body `{ completed }` → returns the updated item; 404 if not found.
- `DELETE /api/tasks/:taskId/checklist/:itemId` → 204/returns deleted; 404 if not found.
- Decorate the app with `checklistRepository` (parity with `tasksRepository`).

### Demo (`scripts/demo-server.js`)
- In-memory checklist array + a repository object exposing the same method names the routes call (`listChecklist`, `addChecklistItem`, `setChecklistItemCompleted`, `deleteChecklistItem`). Seed a couple of items on the demo's "Back up CNPG" task so the UI shows content.

### UI (`public/js/renderTaskDetail.js` + `main.js`)
- `renderChecklist(items, options)`: header "Checklist · N/M done"; each item a row with a toggle control (`data-action="toggle-checklist-item" data-item-id=...`), the label, and a `[x]` delete (`data-action="delete-checklist-item"`); plus an add row (`<input data-checklist-new>` + `[+] add` `data-action="add-checklist-item"`). Read-only views render items without controls.
- `state.taskChecklist` loaded by `loadTaskChecklist(taskId)` (parallels `loadTaskDocuments`); cleared/loaded on task select. `main.js` wires add/toggle/delete → checklist API helpers (new `checklistApi.js` client) → reload → re-render.

### MCP (`mcp/tools/checklist.js` — new, registered in `mcp/server.js`)
- `list_task_checklist` (read), `add_checklist_item`, `set_checklist_item` (toggle completed), `delete_checklist_item`. Client methods added to `mcp/moomoraClient.js`.

---

## Feature 3: Activity (`task_activity`, auto-logged, read-only)

Table already exists: `id, task_id (fk on delete cascade), event_type, message, created_at`.

### Backend (`server/tasksRepository.js`)
- `buildRecordActivity(taskId, eventType, message)` → insert; `recordActivity(...)` repo method.
- `buildListTaskActivity(taskId)` → `select * ... where task_id = $1 order by created_at desc, id desc`; `listTaskActivity(taskId)` returns normalized `{ id, taskId, eventType, message, createdAt }`.

### Logging points (route layer, where the event meaning is known)
- `POST /api/tasks` (create) → `recordActivity(id, 'created', 'Task created')`.
- `PATCH /api/tasks/:id` → if the patch changes `status` (compare against the task's current status before applying), `recordActivity(id, 'status', 'Status → <newStatus>')`.
- `POST /api/tasks/reorder` (board drag) → for each task whose status changed, `recordActivity(id, 'status', 'Status → <newStatus>')`.
- `archiveTask` route → `recordActivity(id, 'archived', 'Task archived')`.
- `restoreTask` route → `recordActivity(id, 'restored', 'Task restored')`.
- Logging is best-effort: a failure to write activity must not fail the underlying mutation (wrap in try/catch, swallow).

### Route (`server/tasksRoutes.js`)
- `GET /api/tasks/:id/activity` → newest-first list.

### Demo (`scripts/demo-server.js`)
- In-memory activity array; the demo's task create/update/archive/restore/reorder methods append the same events; `listTaskActivity` returns them newest-first. Seed one "Task created" event per seeded task.

### UI (`public/js/renderTaskDetail.js` + `main.js`)
- `renderActivity(events)`: read-only feed, newest first, each row = `message` + a short timestamp (date or `YYYY-MM-DD`); empty state keeps a muted "No activity yet." line. `state.taskActivity` loaded by `loadTaskActivity(taskId)`.

### MCP (`mcp/tools/activity.js` — new)
- `list_task_activity` (read-only). Client method in `mcp/moomoraClient.js`.

---

## Shared Wiring

- `main.js` task-select flow currently calls `loadTaskDocuments(taskId)`. Extend it to also load checklist + activity (a single `loadTaskDetailExtras(taskId)` that runs the three loads, or three calls). `renderTaskDetailHtml(task, options)` gains `checklistItems` and `activityEvents` options alongside `linkedDocuments`; `notes` rides on the `task` object.
- After any checklist mutation, reload checklist (and, since checklist changes don't log activity in v1, no activity reload needed). After a notes save or status change, reload the task and activity.

## Data Flow Summary

```text
select task → loadTaskDocuments + loadTaskChecklist + loadTaskActivity → renderTaskDetailHtml({ task(notes), linkedDocuments, checklistItems, activityEvents })

save-task-notes      → PATCH /api/tasks/:id { notes } → reload task
add/toggle/delete checklist → /api/tasks/:id/checklist[/:itemId] → reload checklist
status change (edit / board drag) → server records 'status' activity → reload activity on next view
```

## Build Order

1. **Notes**: schema + repo field + PATCH allow-list + demo + MCP update_task arg → detail-panel editor + wiring → tests.
2. **Checklist**: checklistRepository + routes + index decorate + demo mirror → API tests → checklistApi client + detail UI + main wiring → MCP tools → tests.
3. **Activity**: recordActivity/listTaskActivity + logging hooks on the task write paths + GET route + demo mirror → API tests → detail feed UI + loader → MCP read tool → tests.

## Testing

- **Backend:** checklist query builders + repo; activity record/list; notes in `normalizeTaskRow` and update/create maps (and update the existing full-object task tests to include `notes`); route tests for checklist CRUD and the activity GET, plus that a status-changing PATCH records one activity row.
- **Frontend:** `renderTaskDetail` — notes textarea pre-filled + save hook; checklist items + add/toggle/delete hooks + `N/M` count + read-only variant; activity feed empty and populated.
- **MCP:** shape/tool tests for the new checklist + activity tools and the `update_task` notes arg (mirroring existing `tasksTools`/`documentsTools` tests).

## Risks / Notes

- Adding `notes` to the task shape ripples through existing full-object task tests — updating them is part of Feature 1.
- Activity logging must be best-effort (never break a mutation); board-drag status changes are logged (chosen) — concise messages keep the feed readable.
- Demo server must mirror all three so the in-memory UI testing path stays representative (it's the primary manual smoke surface).
- New files stay focused: `checklistRepository.js`, `checklistRoutes.js`, `checklistApi.js`, `mcp/tools/checklist.js`, `mcp/tools/activity.js`; activity helpers fold into `tasksRepository.js` (small) rather than a new file.
