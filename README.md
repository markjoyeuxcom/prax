# Moomora Console

Moomora Console is a local-first homelab operations console for tasks, runbooks, and Markdown workflows. It is built for a personal Kubernetes cluster, with a quiet operations UI, PostgreSQL persistence, and a growing document library that can become useful context for future AI and MCP integrations.

The project is early, but usable locally today through the in-memory demo server or a PostgreSQL-backed server.

## What It Does

- Tracks personal, work, and homelab tasks across Today, Board, Backlog, and Archive views.
- Supports task workflow actions including create, edit, archive, restore, permanent delete, and board reordering.
- Provides a Markdown Library for runbooks, notes, imported `.md` files, tags, saved tag views, and document metadata.
- Includes an Obsidian-style editor workspace with edit, preview, split, focus mode, live preview updates, CodeMirror editing, and Markdown helper buttons.
- Offers an Admin panel for backup, export, and import workflows with append, skip duplicates, and replace-context modes.
- Targets a homelab Kubernetes deployment backed by CloudNativePG/PostgreSQL.

## Screenshots

![Today task queue](docs/images/moomora-today.jpg)

![Markdown library](docs/images/moomora-library.jpg)

![Split Markdown editor](docs/images/moomora-editor-split.jpg)

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

## Import And Export

Task backups use the current Moomora format:

```json
{
  "format": "moomora.tasks",
  "version": 1,
  "context": "homelab",
  "tasks": []
}
```

Import modes:

- `skip`: default mode, skips duplicate tasks by title, context, status, and due date.
- `append`: imports everything as new tasks.
- `replace`: clears the selected context and imports the file after confirmation.

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
