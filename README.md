# Moomora Console

Moomora Console is a local-first homelab operations console for tasks, runbooks, and Markdown workflows. It is built for a personal Kubernetes cluster, with a quiet operations UI, PostgreSQL persistence, and a growing document library that can become useful context for future AI and MCP integrations.

The project is early, but usable locally today through the in-memory demo server or a PostgreSQL-backed server.

## What It Does

- Organises work into user-creatable **Projects** (active / on-hold / completed / archived) that group both tasks and documents, with an "All projects" cross-project view, a project manager, and a separate archive dialog.
- Tracks tasks across Tasks, Board, Backlog, and Archive views, with create, edit, archive, restore, permanent delete, and drag/drop board reordering.
- Surfaces at-a-glance board signals: a priority dot, overdue / due-soon date flags, and a project chip on each card in the All-projects view.
- Links tasks to library runbooks and notes, so operational work points at the documents that support it.
- Provides a Markdown Library with runbooks, notes, `.md` import, tags, saved tag views, type/sort/group controls, and full-text search.
- Includes an Obsidian-style editor workspace with edit, preview, split, focus mode, live preview updates, CodeMirror editing, and Markdown helper buttons.
- Adapts across desktop, tablet, and mobile, with browser-local appearance preferences (Console, Graphite, Daylight, and Midnight palettes plus a font-scale control) and keyboard shortcuts.
- Offers an Admin panel for backup and JSON task import/export with append, skip duplicates, and replace-project modes.
- Exposes the API to Claude Code through an optional local MCP server for interactive, subscription-backed task and document workflows.
- Targets a homelab Kubernetes deployment backed by CloudNativePG/PostgreSQL.

## Screenshots

![Tasks queue across all projects](docs/images/moomora-tasks.png)

![Board with priority dots, due-date flags, and project chips](docs/images/moomora-board.png)

![Markdown library with tags and saved views](docs/images/moomora-library.png)

![Appearance preferences with the four colour palettes](docs/images/moomora-settings.png)

## Stack

- Node.js
- Fastify
- PostgreSQL via `pg`
- Static frontend with plain JavaScript modules
- CodeMirror for Markdown editing
- Kubernetes manifests under `deploy/k8s`

## Requirements

- Node.js 20 or newer
- npm
- PostgreSQL only if you want persistent local data

## Local Install

Clone the repo:

```bash
git clone git@github.com:markjoyeuxcom/moomora-console.git
cd moomora-console
```

Install dependencies:

```bash
npm ci
```

Run the demo server with in-memory seed data:

```bash
npm run demo
```

Open:

```text
http://127.0.0.1:3100/
```

Demo mode is for local UI testing. Data resets when the process restarts.

## Local Persistent Install

Use Docker Compose when you want the app and PostgreSQL together with a persistent local database:

```bash
docker compose up --build
```

Open:

```text
http://127.0.0.1:3100/
```

The compose stack starts:

- `app`: Moomora Console on host port `3100`
- `postgres`: PostgreSQL 18 on host port `54320`
- `postgres-data`: named volume for database persistence

The first database startup applies `server/schema.sql` automatically through Postgres init scripts. To reset local data:

```bash
docker compose down -v
```

PostgreSQL 18 uses the official image's version-aware data directory layout. If you previously ran this project with the older PostgreSQL 17 Compose volume, reset local development data with `docker compose down -v` before starting the PostgreSQL 18 stack, or migrate the database with a dump/restore flow.

## Run The Published Image

For release-style local testing, use the GitHub Container Registry image instead of building from source:

```bash
docker compose -f compose.yaml -f compose.image.yaml up
```

The image override uses:

```text
ghcr.io/markjoyeuxcom/moomora-console:v0.4.1
```

Use source-build Compose for development, and use the published image path when you want to test the same artifact Kubernetes will run.

## Run With PostgreSQL

Set `DATABASE_URL` in your shell:

```bash
export DATABASE_URL="postgresql://user:password@host:5432/database"
```

Apply the schema to a PostgreSQL database:

```bash
psql "$DATABASE_URL" -f server/schema.sql
```

Start the production-style server:

```bash
npm start
```

By default the app listens on `0.0.0.0:3000`. Override with:

```bash
HOST=127.0.0.1 PORT=3100 DATABASE_URL="postgresql://user:password@host:5432/database" npm start
```

## Scripts

```bash
npm run demo
npm start
npm test
npm run check
npm run build:codemirror
```

- `npm run demo` starts the in-memory local demo server.
- `npm start` starts the PostgreSQL-backed server.
- `npm test` runs backend and frontend unit tests.
- `npm run check` syntax-checks key server and browser entry points.
- `npm run build:codemirror` rebuilds the bundled CodeMirror editor asset.

An optional local MCP server lives in `mcp/` — it exposes the Moomora API to Claude Code so
you can query and edit tasks and documents interactively on a Claude subscription. See
[mcp/README.md](mcp/README.md).

## Import And Export

Task backups use the current Moomora format:

```json
{
  "format": "moomora.tasks",
  "version": 1,
  "project": "homelab",
  "tasks": []
}
```

Import modes:

- `skip`: default mode, skips duplicate tasks by title, project, status, and due date.
- `append`: imports everything as new tasks.
- `replace`: clears the selected project and imports the file after confirmation.

Legacy TaskBoard export envelopes are not supported. This project is treated as a greenfield Moomora Console app.

## Homelab Deployment

Kubernetes manifests live in:

```text
deploy/k8s
```

The manifests expect a CloudNativePG application secret named:

```text
moomora-console-db-app
```

The app reads the secret's `uri` key as `DATABASE_URL`.

See [docs/deployment.md](docs/deployment.md) for the current deployment notes.

## Health Checks

- `GET /healthz` confirms the Node process is alive.
- `GET /readyz` confirms database connectivity when running with PostgreSQL.

## Project Direction

Near-term direction:

- tighten the Markdown workspace into a stronger knowledge base
- improve tag-driven retrieval and saved views
- prepare document and task context for future AI/MCP workflows
- harden Kubernetes deployment, backup, and restore operations
- add authentication at the ingress layer for homelab use

## License

MIT. See [LICENSE](LICENSE).

## Repository

GitHub:

```text
https://github.com/markjoyeuxcom/moomora-console
```
