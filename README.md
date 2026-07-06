# Prax

Prax (by Moomora) is a local-first app for tasks, runbooks, and Markdown notes, wearing a calm, native-feeling desktop design. It pairs a project-scoped task list and board with a full-text Markdown library — import, export, tags, and archive — all backed by a single embedded SQLite file. An optional local MCP server exposes the same data to Claude Code, turning your tasks and notes into working context for AI-assisted work.

Run it with plain Node (zero external dependencies — the database is an embedded file), with Docker Compose, or on Kubernetes; or try it instantly with the in-memory demo server.

## Install

**Desktop (recommended):** download the installer for your platform from the
GitHub Releases page — `.dmg` (macOS), `.msi`/`.exe` (Windows), `.deb`/
`.AppImage` (Linux). Zero external dependencies: the database is an embedded
file, created on first launch. Building from source:
[docs/desktop/BUILD.md](docs/desktop/BUILD.md).

**Web server:** run it with plain Node or Docker Compose — see
[Local Install](#local-install) below.

## What It Does

- Organises work into user-creatable **Projects** (active / on-hold / completed / archived) that group both tasks and documents, with an **All projects** overview and a cross-project **Today** view of everything due or slipping.
- Tracks tasks across Tasks, Board, Backlog, and Archive views, with create, edit, archive, restore, permanent delete, and drag/drop board reordering.
- Surfaces at-a-glance board signals: a priority dot, overdue / due-soon date flags, and a project chip on each card in the All-projects view.
- Links tasks to library runbooks and notes, so operational work points at the documents that support it.
- Provides a Markdown Library with runbooks, notes, `.md` import, tags, saved tag views, type/sort/group controls, and full-text search.
- Includes an Obsidian-style editor workspace with edit, preview, split, focus mode, live preview updates, CodeMirror editing, and Markdown helper buttons.
- Ships light ("Porcelain") and dark ("Deep Fern") themes with four accent colours and a reading-size control; fully keyboard-driven — **⌘K command palette**, **quick capture (N)**, list navigation, and undo toasts.
- Backs up and restores through Settings: JSON task import/export (append / skip duplicates / replace-project modes) and Markdown library export.
- Exposes the API to Claude Code through an optional local MCP server for interactive, subscription-backed task and document workflows.
- Runs locally with plain Node or Docker Compose, or deploys to Kubernetes — the embedded SQLite database needs no separate server.

## Screenshots

![Task list with due-date groups, priority dots, and signals](docs/images/prax-tasks.png)

![Kanban board with drag-and-drop columns and card signals](docs/images/prax-board.png)

![Markdown library with tags and trust chips](docs/images/prax-library.png)

![Settings in the dark Deep Fern theme](docs/images/prax-settings.png)

## Stack

- Node.js
- Fastify
- Embedded SQLite via `node:sqlite` (no native modules, no database server)
- Static frontend with plain JavaScript modules
- CodeMirror for Markdown editing
- Example Kubernetes manifests under `deploy/` (Kustomize base + overlays)

## Requirements

- Node.js 20 or newer
- npm

## Local Install

Clone the repo:

```bash
git clone git@github.com:awaybreaktoday/prax.git
cd prax
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

Use Docker Compose when you want the app containerised with a persistent data volume:

```bash
docker compose up --build
```

then open http://localhost:3100. Compose provides:

- `app`: the Prax server on host port `3100`
- `prax-data`: named volume holding `prax.db` (plus its WAL files)

The app applies database migrations automatically on startup, so a fresh volume is
initialised on first run. To reset local data:

```bash
docker compose down -v
```

## Run The Published Image

For release-style local testing, use the GitHub Container Registry image instead of building from source:

```bash
docker compose -f compose.yaml -f compose.image.yaml up
```

The image override uses:

```text
ghcr.io/awaybreaktoday/prax:v0.20.0
```

Use source-build Compose for development, and use the published image path when you want to test the same artifact Kubernetes will run.

## Run With Persistence

Prax stores everything in one SQLite file. Choose where it lives (defaults to
`./prax.db` in the working directory):

```bash
export PRAX_DB_FILE="$HOME/.local/share/prax/prax.db"
```

Migrations run automatically on startup; run them manually with:

```bash
PRAX_DB_FILE="$HOME/.local/share/prax/prax.db" npm run migrate
```

Start the server:

```bash
HOST=127.0.0.1 PORT=3100 PRAX_DB_FILE="$HOME/.local/share/prax/prax.db" npm start
```

Back up by copying the database file (plus `-wal`/`-shm` siblings) or using the
JSON/Markdown exports in Settings — see [docs/backup-restore.md](docs/backup-restore.md).

## Semantic Search (optional)

Semantic (embedding-based) library search is **off by default** and configured entirely via
environment variables (never the UI — the web UI exposes only a read-only status and an on/off
toggle). Vector-backed semantic search is temporarily unavailable on the embedded database — it returns with the `sqlite-vec` follow-up; keyword full-text search (FTS5) covers the library meanwhile.

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
- `npm start` starts the SQLite-backed server.
- `npm test` runs backend and frontend unit tests.
- `npm run check` syntax-checks key server and browser entry points.
- `npm run migrate` applies pending database migrations.
- `npm run build:codemirror` rebuilds the bundled CodeMirror editor asset.

An optional local MCP server lives in `mcp/` — it exposes the Prax API to Claude Code so
you can query and edit tasks and documents interactively on a Claude subscription. See
[mcp/README.md](mcp/README.md).

## Shared Memory CLI

The `prax` CLI lets any shell-capable AI tool or human pull a bounded, trust-aware context
pack from project memory, search and read documents, write new memory, and verify or supersede
it. `npm link` in the repo gives a global `prax` command. See [docs/cli.md](docs/cli.md)
for the full guide.

```bash
prax context "how do we restore postgres"
```

Documents written by agents (via the CLI or MCP) are **unverified** by default. A human runs
`prax verify <id>` to bless them. Retrieval is active-only and keeps unverified memory in a
clearly-labelled section so AI tools can see it while treating it with appropriate caution.

## Backup & Restore

See [docs/backup-restore.md](docs/backup-restore.md) for backup, restore, and upgrade procedures.

## Import And Export

Task backups use the current Prax format:

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

Legacy TaskBoard export envelopes are not supported. This project is treated as a greenfield Prax app.

## Data Formats

The export/import formats (`moomora.tasks` task backups and library `.md` front-matter) and the
MCP tool surface are documented in [docs/contract.md](docs/contract.md). Prax is
pre-1.0 and these shapes are still evolving; a regression-test suite under `tests/contract/`
locks the current shapes so changes are made deliberately rather than by accident. The HTTP API
is internal and may change between releases — for durable integration prefer the export formats
or the MCP server.

## Kubernetes Deployment

Deployment manifests use a Kustomize **base + overlays** layout under `deploy/`, designed for GitOps
with Argo CD:

```text
deploy/base/                          # env-agnostic manifests (no namespace)
deploy/overlays/{dev,staging,prod}/   # per-env image tag + hostname
```

These are **sanitized example manifests** — the hostnames (`*.example.com`), the Ollama endpoint,
and the gateway are placeholders to adapt to your own cluster (the maintainer's live config is kept
in a separate private GitOps repo). A GitOps tool such as Argo CD renders `deploy/overlays/<env>`
into a namespace like `prax-<env>`; no manifest hard-codes a namespace.

Each environment provisions a `PersistentVolumeClaim` (`prax-data`) that holds the embedded
SQLite database at `/data/prax.db` (`PRAX_DB_FILE`); the Deployment uses a `Recreate` strategy
and a single replica because SQLite is single-writer. The app is exposed via a Gateway API
`HTTPRoute` attached to the cluster's external gateway.

Render any environment locally (no cluster needed):

```bash
kubectl kustomize deploy/overlays/dev
```

See [docs/deployment.md](docs/deployment.md) for the full notes, including the cluster-side
prerequisites (a default StorageClass, Gateway `allowedRoutes`/TLS, DNS).

## Health Checks

- `GET /healthz` confirms the Node process is alive.
- `GET /readyz` confirms the embedded database answers queries.

## Project Direction

The detailed, living backlog lives in [docs/ROADMAP.md](docs/ROADMAP.md). At a glance:

- finish the shared-memory trust loop across all surfaces (verify/supersede in the UI + MCP)
- a retrieval eval harness to guard recall quality
- external references, repo-URL project detection, and an optional "Ask Project" RAG layer
- tighten the Markdown workspace into a stronger knowledge base

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
https://github.com/awaybreaktoday/prax
```
