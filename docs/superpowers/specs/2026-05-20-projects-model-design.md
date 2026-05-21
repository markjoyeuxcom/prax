# Projects Model — Design Spec

**Date:** 2026-05-20
**Status:** Approved for implementation

## Goal

Replace Moomora's fixed three-value `context` (personal / work / homelab) with
**user-creatable Projects** that group both tasks and library documents, so the app can
become a daily-use central hub for projects and their Markdown files (created and queried
from the UI and from Claude Code / CLI tools via the MCP server).

This is the keystone slice of a larger product direction informed by OmniFocus. It
deliberately adopts only the "project as container" idea — not the full GTD apparatus.

## Context

Today `context` is a hardcoded enum living in the schema (`CHECK` constraints on `tasks`
and `markdown_documents`), the backend (`CONTEXTS` sets + validation in `tasksRoutes.js` /
`libraryRoutes.js`), the frontend (sidebar/drawer nav, task form, library form, admin
import/export, `state.js`), and the MCP server (`z.enum([...])` in tool schemas). Both
`tasks` and `markdown_documents` already carry `context`, so the cross-entity grouping a
"project" needs already exists structurally — it is simply locked to three values.

This is a greenfield project; **existing data may be discarded**. No backfill migration is
required — `schema.sql` is updated to the target shape and existing local databases are
reset.

## Scope

In scope: a `projects` resource with lifecycle, replacing `context` across tasks and docs;
a cross-project "All projects" navigation toggle plus per-project selection; a project
manager UI; and the minimal MCP change needed to keep the server working against the new
model.

Out of scope (deferred to later slices):

- Dedicated MCP project tools (`list_projects` / `create_project`, "create doc in project")
  — a follow-on MCP slice.
- OmniFocus extras: cross-cutting tags on tasks, defer/start dates, perspectives, review,
  sub-tasks, recurrence, inbox, flagged, forecast.

## Approach

Normalized model (chosen over keeping a `context` text column): a first-class `projects`
table referenced by foreign key from `tasks` and `markdown_documents`. Rename and status
live in one place, referential integrity is enforced, and a stable `slug` gives CLI/MCP a
human handle. More up-front work than a text column, but the only shape where rename,
status, and CLI handles stay clean for a daily hub.

## Data Model

New table:

```sql
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,                 -- stable handle for CLI/MCP, e.g. "homelab"
  status text not null default 'active'
    check (status in ('active', 'on-hold', 'completed', 'archived')),
  sort_order integer not null default 0,     -- nav ordering
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Changes to `tasks` and `markdown_documents`:

- Add `project_id uuid not null references projects(id)`.
- Drop the `context` column and its `CHECK (context in (...))` constraint.
- Replace the `(context, ...)` indexes with `project_id` equivalents
  (`idx_tasks_project_status`, `idx_markdown_documents_project_type`).

Migration:

- **Fresh installs:** `schema.sql` is updated to the target shape and seeds three starter
  projects — Personal / Work / Homelab (slugs `personal` / `work` / `homelab`, status
  `active`) — so a new database has sensible defaults that the user can rename or delete.
- **Existing local DBs:** reset (`docker compose down -v`, or drop/recreate the database)
  and re-apply `schema.sql`. No backfill script (greenfield; data loss accepted).

Slug rule: auto-derived from the name at creation (lowercased, non-alphanumerics →
hyphens, collapsed), uniqueness-checked with a numeric suffix on collision. The slug stays
stable when the display name is later renamed, so `--project homelab` keeps working.

Project deletion safety: a project is never hard-deleted while it owns tasks or documents.
`DELETE /api/projects/:id` archives (sets status `archived`); a separate permanent delete
succeeds only when the project is empty (mirrors the app's existing archive→permanent
pattern, avoids orphaning rows).

## API

New projects resource (`server/projectsRepository.js` + `server/projectsRoutes.js`):

- `GET /api/projects?status=` → list projects. Default returns `active`; `status=all`
  returns every status (for the manager); a specific status filters to it. Ordered by
  `sort_order` then `name`.
- `POST /api/projects` `{ name, status? }` → create. Slug auto-derived and uniqueness-
  checked. 201 on success; 400 on invalid/missing name or invalid status.
- `PATCH /api/projects/:id` `{ name?, status?, sortOrder? }` → rename / change status /
  reorder. 404 if missing; 400 on invalid fields. Slug is not changed by a rename.
- `DELETE /api/projects/:id` → archive (sets status `archived`). 404 if missing.
- `DELETE /api/projects/:id/permanent` → hard delete, allowed only when the project owns
  no tasks or documents; returns 409 Conflict otherwise. 404 if the project is missing.

Changes to existing routes/repositories:

- `tasks` and `markdown_documents` payloads take **`projectId`** instead of `context`.
  Validation replaces `CONTEXTS.has(context)` with: `projectId` is a valid UUID and
  references an existing project (and, for newly created items, a non-archived one).
- List filters: `?project=<id|slug>` replaces `?context=`. Omitting it (or `project=all`)
  returns across all projects — the cross-project aggregate the nav toggle drives.
- The `CONTEXTS` sets in `tasksRoutes.js` / `libraryRoutes.js` are removed.
- Write endpoints accept `project` as **slug-or-id** and resolve it to a `project_id`
  server-side (so MCP/CLI callers can pass a slug).

Import/export (currently keyed on `context`): the envelope's `context` field becomes
`project` (slug); import resolves the project by slug, creating it if absent. Export of
"all" spans projects. The export `format`/`version` is updated accordingly.

## Frontend

State & API client:

- `state.activeContext` → `state.activeProject` (`'all'` or a project id), persisted in
  localStorage; plus `state.projects` (the loaded active list).
- New `public/js/projectApi.js`: `fetchProjects(status)`, `createProject(name)`,
  `updateProject(id, patch)`, `archiveProject(id)`, `deleteProjectPermanent(id)`.
  Projects load on init and refresh after any change.

Navigation (`renderShell.js` + hamburger drawer): the hardcoded "Contexts" block becomes a
dynamic **Projects** nav:

- An **All projects** item (active when `activeProject === 'all'`) at the top.
- The list of **active** projects from `state.projects`, each selectable.
- A **`[+] new project`** affordance and a **manage** entry opening the project manager.
- The status-footer breadcrumb shows the project name (or "all projects").

Project manager (new render module, existing modal chrome): lists projects grouped by
status, with create (name → auto-slug), rename, status change (active / on-hold /
completed / archived), reorder, and permanent-delete (enabled only when the project is
empty). On-hold / completed / archived projects live here, keeping the main nav to active
ones.

Forms: the fixed `context` `<select>` in the task form (`renderTaskForm.js`) and library
form (`renderLibrary.js`) is replaced by a **project picker** populated from active
projects — defaulting to the currently-selected project, or the first active project when
in "All projects."

Views: Today / Board / Backlog / Library respect `activeProject` — aggregate across active
projects when "all," filtered when one is selected; metrics computed for the current
selection. The hardcoded `CONTEXTS` arrays in `renderShell.js`, `renderTaskForm.js`, and
`renderLibrary.js` are removed.

## MCP

Minimal change to keep the server working and consistent with the new model:

- Rename the `context` argument to **`project`** (`z.string()`, a slug or id) in
  `search_documents`, `search_tasks`, `create_document`, `update_document`, `create_task`,
  `update_task`; drop the `CONTEXT` enum constant.
- Tools pass `project` through to the API's `?project=` filter / payload, relying on
  server-side slug-or-id resolution; a missing project surfaces as a friendly tool error.
- Update the MCP README/tool descriptions accordingly.

Deferred to a follow-on MCP slice: dedicated `list_projects` / `create_project` tools and a
"create this doc in project X" convenience.

## Demo server

The in-memory demo repository gains a parallel `projects` store seeded with the same three
defaults, plus the same CRUD operations and project-scoped filtering, so `npm run demo`
mirrors the feature without Postgres.

## Testing

- **Backend:** `projectsRepository` CRUD builders; `projectsRoutes` (create + auto-slug /
  uniqueness, rename, status change, archive, permanent-delete-only-when-empty); task/doc
  validation resolving `projectId`; list filters by project and the "all" aggregate; slug
  derivation and collision handling.
- **Frontend:** projects nav (All + active list), project manager (create / rename /
  status / delete-when-empty), form project picker default behavior, `state.activeProject`
  persistence.
- **MCP:** tools accept a `project` string and map to the correct API params; existing
  tests updated.
- **Demo server:** in-memory projects store parity.

## Rollout

One slice on a new `feat/projects-model` branch, cut from the v0.3.0 `main`, implemented
back-to-front: (1) schema + projects repository/routes + tasks/docs validation changes +
demo store + backend tests, then (2) frontend API client + nav + project manager + forms +
view wiring + tests, then (3) the MCP `context`→`project` rename + tests. Stage-only;
commit per task; verify green before finishing.

## Migration note

This is a breaking schema change. Existing databases must be reset:
`docker compose down -v` (or drop/recreate the database), then re-apply
`psql "$DATABASE_URL" -f server/schema.sql`.
