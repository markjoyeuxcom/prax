# Balanced Operations Console - Design Spec

**Date:** 2026-05-10  
**Status:** Draft for review  

## Overview

Redesign Moomora Console as a homelab-oriented operations console. The app should feel like a practical tool for running personal, work, and homelab tasks from a Kubernetes cluster, backed by Postgres through CloudNativePG.

The selected direction is **Balanced**: a dense but calm dashboard with left navigation, operational status, task metrics, a primary list/table task queue, and a right-side detail panel. Kanban remains available as a secondary view, but the default experience becomes a professional “Today” operations view.

## Goals

- Make the app look and feel like a professional self-hosted operations tool.
- Support server-side persistence through a backend API and CloudNativePG Postgres.
- Preserve the existing task board concepts: contexts/tabs, columns/statuses, priorities, due dates, manual ordering, import/export.
- Add room for richer task workflows: notes, checklist items, archive, activity history, and operational status.
- Keep the initial deployment simple: one app container, one writable app replica, Postgres managed by CloudNativePG.

## Non-Goals

- Multi-user collaboration in the first backend version.
- Realtime editing or websockets.
- Complex project management features such as sprints, estimates, dependencies, or Gantt charts.
- Replacing cluster-level auth tools. Authentication should be handled at ingress initially.

## UI Direction

### Layout

The app uses a two-region shell:

- **Left rail:** app brand, primary views, context filters, and cluster status.
- **Main area:** top bar, metric cards, task workspace, and optional task detail panel.

The default view is **Today**, using a task queue table with a selected-task detail panel. This view is optimized for scanning and repeated daily use.

### Left Rail

Primary views:

- Today
- Board
- Backlog
- Archive

Context filters:

- Personal
- Work
- Homelab

Cluster status card:

- API health
- Postgres sync state
- Last backup / next backup status

### Top Bar

Controls:

- Global task search
- Export
- Import
- New Task

The top bar should stay compact. Import/export can later move into a menu if the header becomes crowded.

### Metrics

The default metric row shows:

- Due today
- Overdue
- In progress
- Completed this week

These metrics are derived from task data and should respect the selected context when a context filter is active.

### Workspace Views

The workspace has a view switcher:

- **List:** default, dense table/queue.
- **Board:** Kanban view using the current status columns.
- **Calendar:** hidden in the first implementation. Add it only after a real calendar view exists.

List columns:

- Task
- Priority
- Status
- Due

The selected-task panel shows:

- Title and description
- Metadata
- Checklist
- Notes
- Activity history

## Data Model

Initial Postgres entities:

```sql
tasks (
  id uuid primary key,
  title text not null,
  description text not null default '',
  priority text not null check (priority in ('high', 'medium', 'low')),
  status text not null check (status in ('high-priority', 'in-progress', 'planned', 'completed', 'notes')),
  context text not null check (context in ('personal', 'work', 'homelab')),
  due_date date,
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

task_checklist_items (
  id uuid primary key,
  task_id uuid not null references tasks(id) on delete cascade,
  label text not null,
  completed boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

task_activity (
  id uuid primary key,
  task_id uuid not null references tasks(id) on delete cascade,
  event_type text not null,
  message text not null,
  created_at timestamptz not null default now()
);
```

Use `context` instead of the current frontend name `tab` in the backend API. The frontend may keep `tab` temporarily during migration, but the API contract should use `context`.

## Backend/API

Use a small Node backend. Express or Fastify are both acceptable; Fastify is preferred for clean schema validation and health endpoints.

Initial endpoints:

- `GET /healthz`: process health for liveness probe.
- `GET /readyz`: database connectivity for readiness probe.
- `GET /api/tasks`: list tasks, with optional `context`, `status`, `archived`, and search query filters.
- `POST /api/tasks`: create task.
- `PATCH /api/tasks/:id`: update task fields.
- `DELETE /api/tasks/:id`: archive task by setting `archived_at`, not hard delete.
- `POST /api/tasks/reorder`: persist ordering after drag/drop.
- `GET /api/export`: export all task data as JSON.
- `POST /api/import`: import task JSON, validating before write.

Hard delete can be added later as an admin-only maintenance action.

## Frontend Architecture

Refactor the current single `script.js` into small modules before wiring the API:

- `state.js`: active view, selected context, selected task, search.
- `taskApi.js`: frontend API client.
- `taskModel.js`: normalization and derived task state.
- `renderShell.js`: left rail, top bar, metrics.
- `renderList.js`: task queue table.
- `renderBoard.js`: Kanban view.
- `renderTaskDetail.js`: selected task panel.
- `modals.js`: add/edit/import flows.

The frontend should call a `taskApi` boundary rather than touching persistence directly. During transition, provide a local adapter and an API adapter so the UI can be developed incrementally.

## Kubernetes Deployment

Initial deployment:

- Single app container serving static assets and API.
- One writable replica.
- `Deployment`, `Service`, and `Ingress`.
- `Secret` for Postgres connection string or credentials.
- `ConfigMap` for non-secret app settings.
- Liveness probe: `/healthz`.
- Readiness probe: `/readyz`.

CloudNativePG provides the Postgres cluster, credentials, and backup mechanisms. The app should expose database readiness but should not manage database backups itself.

Ingress-level auth is preferred initially, using an existing homelab auth layer such as Authentik, Authelia, or Tailscale.

## Migration

Migration path from current localStorage app:

1. Keep JSON export from the current app.
2. Build backend import endpoint that accepts the current export shape.
3. Map existing fields:
   - `column` -> `status`
   - `tab` -> `context`
   - `order` -> `sort_order`
   - missing timestamps -> import time
4. Validate all imported values and reject invalid JSON before writing.

## Error Handling

- Show non-blocking toast notifications for save/import/export errors.
- Keep the user’s unsaved modal input if an API request fails.
- Surface backend readiness in the cluster status card.
- If the API is unavailable, show a clear offline/error state instead of an empty board.

## Testing

Recommended coverage:

- Backend unit tests for task validation, create/update/archive, import, and reorder.
- API integration tests against a test Postgres database.
- Frontend module tests for task normalization and view filtering.
- Browser smoke test for loading the app, creating a task, moving it, and reopening it after reload.
- Kubernetes manifest checks for required probes and environment variables.

## Implementation Order

1. Create the backend skeleton with health/readiness endpoints.
2. Add Postgres schema and repository layer.
3. Add task CRUD API.
4. Refactor frontend persistence behind `taskApi`.
5. Implement Balanced Operations Console shell.
6. Add list view and selected-task detail panel.
7. Reconnect Kanban as secondary Board view.
8. Add import/export against the backend.
9. Add Kubernetes manifests.
10. Add migration docs for localStorage export to Postgres import.

## Decisions

- Backend framework: Fastify is recommended, but Express is acceptable.
- Auth mechanism: use ingress-level auth and keep the app provider-neutral.
- Calendar view: hide it in the first implementation.
- Homelab context: ship it as a fixed context initially; make contexts configurable later if needed.
