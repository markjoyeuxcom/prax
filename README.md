# Moomora Console

Moomora Console is a self-hosted console for tasks, runbooks, and Markdown notes, wrapped in a quiet, terminal-inspired UI. It pairs a project-scoped task queue and board with a full-text Markdown library — import, export, tags, and archive — all backed by PostgreSQL. An optional local MCP server exposes the same data to Claude Code, turning your tasks and notes into working context for AI-assisted work.

Run it locally with Docker Compose or deploy it to Kubernetes (with CloudNativePG for PostgreSQL), or try it instantly with the in-memory demo server.

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
- Runs locally via Docker Compose or deploys to Kubernetes, backed by CloudNativePG/PostgreSQL.

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
git clone git@github.com:awaybreaktoday/moomora-console.git
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

The app applies database migrations automatically on startup, so a fresh Postgres volume is initialised on first run. To reset local data:

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
ghcr.io/awaybreaktoday/moomora-console:v0.14.2
```

Use source-build Compose for development, and use the published image path when you want to test the same artifact Kubernetes will run.

## Run With PostgreSQL

Set `DATABASE_URL` in your shell:

```bash
export DATABASE_URL="postgresql://user:password@host:5432/database"
```

The app applies migrations automatically on startup. To apply them explicitly (e.g. before first boot or from CI):

```bash
DATABASE_URL="postgresql://user:password@host:5432/database" npm run migrate
```

Start the production-style server:

```bash
npm start
```

By default the app listens on `0.0.0.0:3000`. Override with:

```bash
HOST=127.0.0.1 PORT=3100 DATABASE_URL="postgresql://user:password@host:5432/database" npm start
```

## Semantic Search (optional)

Semantic (embedding-based) library search is **off by default** and configured entirely via
environment variables (never the UI — the web UI exposes only a read-only status and an on/off
toggle). It requires PostgreSQL with the `pgvector` extension.

| Variable | Default | Purpose |
|----------|---------|---------|
| `EMBEDDING_BACKEND` | `none` | `none` (off), `ollama`, `openai`, or `fake` (deterministic test backend) |
| `EMBEDDING_MODEL` | — | model name for the chosen backend (e.g. `qwen3-embedding:0.6b`, `text-embedding-3-small`) |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama base URL (when `EMBEDDING_BACKEND=ollama`) |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible base URL incl. `/v1` — real OpenAI, llama.cpp, vLLM, LiteLLM, … |
| `OPENAI_API_KEY` | — | bearer key for `openai`; omit for keyless local servers |
| `EMBEDDING_QUERY_PREFIX` | — | prepended to **search-query** embeddings only (instruct-tuned models); e.g. `nomic`'s `search_query: ` |
| `EMBEDDING_SEARCH_MIN_SIMILARITY` | `0.45` | relevance-cutoff floor (cosine similarity) |
| `EMBEDDING_SEARCH_TOP_DROP` | `0.20` | keep results within this of the best match |

Example (OpenAI-compatible server, e.g. a local llama.cpp started with `--embeddings`):

```bash
EMBEDDING_BACKEND=openai OPENAI_BASE_URL=http://127.0.0.1:8001/v1 EMBEDDING_MODEL=nomic-embed-text npm start
```

## Scripts

```bash
npm run demo
npm start
npm test
npm run check
npm run migrate
npm run build:codemirror
```

- `npm run demo` starts the in-memory local demo server.
- `npm start` starts the PostgreSQL-backed server.
- `npm test` runs backend and frontend unit tests.
- `npm run check` syntax-checks key server and browser entry points.
- `npm run migrate` applies pending database migrations.
- `npm run build:codemirror` rebuilds the bundled CodeMirror editor asset.

An optional local MCP server lives in `mcp/` — it exposes the Moomora API to Claude Code so
you can query and edit tasks and documents interactively on a Claude subscription. See
[mcp/README.md](mcp/README.md).

## Shared Memory CLI

The `moomora` CLI lets any shell-capable AI tool or human pull a bounded, trust-aware context
pack from project memory, search and read documents, write new memory, and verify or supersede
it. `npm link` in the repo gives a global `moomora` command. See [docs/cli.md](docs/cli.md)
for the full guide.

```bash
moomora context "how do we restore postgres"
```

Documents written by agents (via the CLI or MCP) are **unverified** by default. A human runs
`moomora verify <id>` to bless them. Retrieval is active-only and keeps unverified memory in a
clearly-labelled section so AI tools can see it while treating it with appropriate caution.

## Backup & Restore

See [docs/backup-restore.md](docs/backup-restore.md) for backup, restore, and upgrade procedures.

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

## Data Formats

The export/import formats (`moomora.tasks` task backups and library `.md` front-matter) and the
MCP tool surface are documented in [docs/contract.md](docs/contract.md). Moomora Console is
pre-1.0 and these shapes are still evolving; a regression-test suite under `tests/contract/`
locks the current shapes so changes are made deliberately rather than by accident. The HTTP API
is internal and may change between releases — for durable integration prefer the export formats
or the MCP server.

## Kubernetes Deployment

Kubernetes manifests live in:

```text
deploy/k8s
```

The manifests expect a CloudNativePG application secret named:

```text
moomora-console-db-app
```

The app reads the secret's `uri` key as `DATABASE_URL`.

Optional **semantic search** needs a `pgvector`-capable Postgres cluster — build the image from
`deploy/postgres/Dockerfile` and provision `deploy/k8s/postgres-cluster.example.yaml` (which
pre-creates the `vector` extension). See [docs/deployment.md](docs/deployment.md) for the full
deployment notes, including enabling embeddings via env/secret.

## Health Checks

- `GET /healthz` confirms the Node process is alive.
- `GET /readyz` confirms database connectivity when running with PostgreSQL.

## Project Direction

Near-term direction:

- tighten the Markdown workspace into a stronger knowledge base
- improve tag-driven retrieval and saved views
- prepare document and task context for future AI/MCP workflows
- harden Kubernetes deployment, backup, and restore operations
- add authentication at the ingress layer for network-exposed deployments

## Security

See [SECURITY.md](SECURITY.md) for the security model (no built-in auth; trusted-network by
design) and how to report a vulnerability.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for the release history.

## License

MIT. See [LICENSE](LICENSE).

## Repository

GitHub:

```text
https://github.com/awaybreaktoday/moomora-console
```
