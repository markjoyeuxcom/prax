# Changelog

All notable changes to Prax (formerly Moomora Console) are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Prax is pre-1.0:
the data formats are still evolving, and `docs/contract.md` is a format *reference* (with
regression tests under `tests/contract/`), not a stability contract.

At release time, the `[Unreleased]` section is renamed to the new version with its date, and a
fresh empty `[Unreleased]` section is started.

## [Unreleased]

### Added

- **Smart list continuation.** Pressing Enter in a Markdown bullet, numbered,
  task, or quote line continues the marker on the next line (numbers
  auto-increment, task boxes start fresh and unchecked, indentation is
  preserved); Enter on an empty item exits the list.
- **Slash menu.** Type `/` at the start of a line for a filterable menu of the
  formatting actions (heading, lists, task, quote, code block, bold, italic,
  inline code, link) — giving every toolbar command a keyboard path. It reuses
  the existing format logic, so there's nothing new to keep in sync.
- **`[[wiki-links]]`.** Type `[[` to autocomplete a link to another document
  by title; the preview renders resolved links as clickable (they open the
  doc) and unresolved ones as a muted "missing" style.
- **The editor's "Referenced by N tasks" backlinks now actually populate.**
  The footer was wired but always fed an empty list; a new
  `GET /api/library/documents/:id/tasks` returns the non-archived tasks that
  link a document, and the editor loads them on open (Preview/Split modes).
- **Semantic search results show the real match score.** The ranker already
  computed a cosine similarity per hit and then discarded it; it's now
  surfaced as a percentage with a bar scaled relative to the top hit (raw
  cosine values cluster in a narrow band). Results carrying no score fall
  back to rank — no fabricated numbers, and the raw embedding never leaves
  the server.
- **⌘K finds documents by their body text**, not just title and tags — the
  cheap half of a doc quick-switcher.
- **Find & replace inside the editor** (⌘F) — a Prax-native panel that floats
  over the editor: live match highlighting with an "n of N" counter,
  next/previous, single Replace and Replace all, and match-case / whole-word /
  regexp toggles. It drives CodeMirror's search commands but keeps its inputs
  in the app's own DOM, so clicking into the Find/Replace fields behaves
  normally (CodeMirror's built-in panel stole focus back to the document);
  Enter finds the next match, ⇧Enter the previous, Esc closes and returns to
  the text. Replace/Replace-all act on document ranges, so they work whether
  or not the editor is focused.
- **An empty Library shows a welcome** (New doc / Import .md) instead of the
  "No documents match / Clear filters" dead end, which only makes sense once
  something exists to filter.
- **Settings is now split into tabbed sections** — Appearance, Intelligence,
  and Data & admin each get their own page, selectable by tabs, instead of
  one long scroll. The tabs reuse the app's existing `.tabs` pattern and
  mark the active section with `aria-current`, matching the sidebar/board/
  list active-state convention; the last-viewed section persists within a
  session.
- **Semantic search is back — configured from Settings, running on the
  embedded database.** Settings ▸ Intelligence now offers real provider
  selection across **Ollama (local or remote), OpenAI, Claude via Voyage AI
  (Anthropic's official embeddings partner — Anthropic has no first-party
  embeddings API), Gemini, and llama.cpp (its OpenAI-compatible server)** —
  each with its own base URL, embedding model, and write-only API key,
  remembered per provider so switching back restores what you entered.
  "Save & test connection" probes the backend honestly; configuration
  persists in the database (`PUT /api/settings/semantic-search` gains
  optional provider fields — additive, the key is never returned). Vector
  ranking runs in-process over embeddings stored as JSON — no native
  extensions — with the same relevance cutoff as the Postgres era. Re-index /
  Rebuild live in the same card.
- The Markdown editor gained a Settings toggle for **line numbers** (off by
  default, matching the design) and opens documents with the caret at the
  end.
- **Held keys repeat in the desktop app on macOS**: Prax opts its own
  defaults domain out of the press-and-hold accent picker, so holding a
  letter repeats it in the editor instead of opening the diacritics popover.
  Only Prax is affected — the picker keeps working everywhere else
  (`defaults delete com.moomora.prax ApplePressAndHoldEnabled` restores it).
- **The Outline toggle always answers the click.** The rail previously
  auto-hid on documents with fewer than two headings, leaving the button
  looking active while nothing appeared; it now always opens, showing a
  hint ("add `##` section headings…") until the document has enough
  structure to navigate. Outline entries also jump in **Edit** mode now —
  the click moves the CodeMirror cursor to the heading's source line and
  scrolls it to the top (previously jumps only worked in Split/Preview).
- **No more double scrollbar on long documents.** The editor claimed
  "at least" the content height instead of exactly the viewport height,
  so the page scrolled the whole editor while the pane scrolled the
  content. The editor is now pinned to the viewport; the pane is the
  only scroller.
- **Writing happens directly on the page.** The Markdown editing surface
  was an opaque box (the old terminal theme's background) sitting inside
  the white sheet; it is now transparent — the page *is* the surface,
  matching the design comp. The page itself is fixed (like a sheet of
  paper in a frame) and the text scrolls inside it, in every mode: Edit,
  Preview (prose and document links scroll together), Split (each pane
  fixed, content scrolling), and Focus. The page fills the window width;
  Focus mode keeps the narrow 740px reading column.

- **Archive, delete, and every other confirmation now work in the desktop
  app.** The desktop webview has no native JS dialogs (`confirm()` silently
  returns false, `alert()` shows nothing), which left Archive/Delete buttons
  dead and error messages invisible. Archiving a document now just happens,
  with an **Undo** toast (same pattern as tasks); permanent deletes (task,
  document, project) and the embeddings rebuild ask through an in-app
  confirm dialog (Enter confirms, Esc cancels); naming a saved Library view
  uses the same dialog with a text field; and all error/status messages are
  toasts. Clicking inside the quick-capture or command-palette dialog no
  longer closes it (only true outside-clicks dismiss).
- **"＋ New project" always answers.** With the name field empty the button
  (and the sidebar ＋) now opens a small "Name this project" dialog instead
  of silently doing nothing; Enter in the name field creates directly, and
  a toast confirms creation.

- **The Today view now aligns with the rest of the app.** It was the only
  top-level view not wrapped in the standard `.page` container, so its
  heading hung flush against the left edge while All projects, Library,
  Settings, and the project views were inset. Today now shares the same
  padding.

### Fixed

- **Nested lists render correctly in the Markdown preview.** Indented
  sub-bullets under an ordered item were flattened into the parent list and
  renumbered (e.g. a 5-item list with sub-bullets showed as 1–9); the preview
  now nests by indentation, and a contiguous ordered-then-unordered block
  renders as two lists instead of one.

### Changed

- The editor header now matches the design comp: tag and provenance chips sit
  beside the title, Outline is an outlined toggle, Edit/Split/Preview is a
  segmented control, and document actions (info, verify, supersede, archive)
  moved into a ••• menu — the permanent trust-strip row is gone. The page
  sheet fills the editor height, and word/character counts update live.
- **Prax is now a double-click desktop app** (Tauri 2 shell under `src-tauri/`).
  The bundled Node runtime runs the Fastify server as a sidecar on a free
  localhost port; the native window opens on a Prax splash and hands over once
  `/readyz` answers. User data lives in the OS app-data directory
  (`com.moomora.prax/` — `prax.db` plus `logs/server.log`), a second launch
  focuses the existing window instead of double-opening the database, and the
  sidecar is stopped when the app exits (the server also shuts down cleanly on
  SIGTERM/SIGINT everywhere). `npm run desktop:dev` / `desktop:build`;
  see docs/desktop/BUILD.md. The web-server workflow is unchanged — the
  desktop wrapper is additive.
- **PostgreSQL is replaced by an embedded SQLite database** (Node's built-in
  `node:sqlite` — no native modules, no database server, no Docker requirement).
  One file (`PRAX_DB_FILE`, default `./prax.db`; `DATABASE_URL` is still read as
  a plain file path) holds everything, in WAL mode with foreign keys on. The
  seven Postgres migrations are consolidated into one SQLite schema; migrations
  still run automatically at startup. Full-text library search now runs on FTS5
  (external-content table + sync triggers). The HTTP API, export/import formats,
  and MCP tool surface are byte-for-byte unchanged; constraint errors keep their
  pg SQLSTATE codes (23505/23503) via the adapter, so existing error handling
  behaves identically. A new real-engine integration suite drives the whole HTTP
  API against actual SQLite.
- Docker Compose no longer runs a database container — just the app plus a
  named volume. The Kubernetes manifests swap the CloudNativePG cluster for a
  PersistentVolumeClaim (`Recreate` strategy, single replica — SQLite is
  single-writer). Backup/restore is now file-based; see docs/backup-restore.md.

- **The Prax desktop design replaces the terminal-inspired UI.** The frontend is
  rebuilt to the Prax design system (light "Porcelain" / dark "Deep Fern" themes,
  Instrument Sans + Source Serif 4 bundled locally, oklch accent system with four
  user-selectable accents): floating-window shell with titlebar/sidebar/statusbar,
  a cross-project **Today** view, grouped task lists with multi-select and undo
  toasts, a four-column board with drop-position indicators, Backlog and Archive
  tabs, a floating task drawer (status/priority pills, due date, autosaving notes,
  checklist, linked docs, activity), an **⌘K command palette**, **quick capture
  (N)**, an **All projects** screen (replaces the project manager/archive dialogs),
  a card-grid Library with semantic mode, and a page-sheet editor with outline
  rail, focus mode, and clickable Markdown task items. Settings absorbs the old
  admin panel (backup/import/export, maintenance, semantic index) and adds theme/
  accent/window-chrome/reading-size preferences.
- **Backlog is now a real status**: the design's Backlog maps onto the API's
  spare `notes` status (previously a fifth "NOTES" board column). Tasks in the
  old NOTES column appear under Backlog; the old derived backlog (planned +
  no due date) now shows only under Planned. The HTTP API is unchanged.
- The task detail drawer is now the task editor (title, description, notes all
  autosave); the separate task edit form is gone. Documents open directly in the
  editor; new documents are created untitled and named in place.
- Browser-local keys for the retired swimlane groupings are no longer read;
  active-project, saved-views, and preference keys keep working (legacy palettes
  map onto the nearest theme).
- **Moomora Console is now Prax** (by Moomora). The product, package (`prax`), CLI
  (`prax`, with `moomora` kept as an alias), MCP server name, Docker/Kubernetes
  manifests, skills (`prax-recall` / `prax-remember`), and docs are renamed.
  Backwards compatibility is preserved everywhere it matters:
  - `MOOMORA_API_URL` / `MOOMORA_API_TOKEN` / `MOOMORA_PROJECT` env vars still work
    as fallbacks for the new `PRAX_*` names.
  - The `x-moomora-origin` request header is still accepted alongside `x-prax-origin`
    for agent provenance stamping.
  - The `.moomora/project.json` CLI marker is still detected (`.prax/` wins when both
    exist).
  - **Wire formats are unchanged**: the `moomora.tasks` export/import envelope, library
    `.md` front-matter, HTTP API shapes, and the MCP tool surface are untouched, so
    existing backups, imports, and integrations keep working. Browser-local preference
    keys are also unchanged. Entries below this one predate the rename and keep their
    original wording.

## [0.20.0] - 2026-06-11

### Changed

- **`search_documents` (MCP) is active-only by default**, matching the documented
  "retrieval is active-only" contract — agents no longer receive superseded/deprecated
  memory from full-text search unless they ask. A new optional `status` parameter
  (`active` / `superseded` / `deprecated` / `all`) lifts the filter for curation. The raw
  `GET /api/library/documents` route keeps returning all non-archived statuses (the web UI
  lists superseded documents with chips) — this exception is now documented in the contract.

### Fixed

- **Context-pack `limit` is now a pack-wide budget** (was per-section, so a pack could
  exceed the requested size). The budget is spent in section order — overview → relevant →
  runbooks → unverified — and the pack never contains more than `limit` documents.
- **Orphan-revert now ignores supersedes links from archived documents**: a superseded
  document whose only remaining superseder is archived reverts to `active` on unlink,
  in the demo server as well as Postgres.

## [0.19.2] - 2026-06-11

### Fixed

- **Selected board card joins the de-glow.** It drew a full amber outline plus an inset
  amber stripe on top of the tint — selection is now the amber left edge + tint, same as
  the task and library list rows.

## [0.19.1] - 2026-06-11

### Fixed

- **Task/library rows and the task drawer join the de-glow.** The task detail drawer's
  left border was a full-height accent line — now a normal hairline seam. The selected
  task row drops its full amber outline (selection is the amber edge + tint, like library
  rows). List rows (`task-row` / `document-row` / `task-card`) are square again — the 6px
  control radius was curving their colored edges and hover tints into capsules. Detail
  section tabs, mobile tabs, and the list/board toolbar toggles adopt the same muted-pill
  active treatment as the sidebar nav.

## [0.19.0] - 2026-06-11

### Changed

- **Library/shell mockup parity (design polish, phase 3).** Sidebar navigation swaps the
  bracket glyphs for small inline SVG icons with sentence-case section labels; topbar buttons
  adopt the `kbd`-chip grammar and the primary action becomes a filled accent button
  (`+ new doc`); the type/sort/group controls move into the collapsed filters drawer so the
  document list starts immediately under one slim row; the detail header drops the
  source-filename line; and the Console palette is aligned to the design-mockup values
  (`#7ee787` accent, neutral-green surfaces, `#232b23` hairlines). Other palettes unchanged.
- **Active states de-glowed.** The sidebar nav, settings nav, edit/preview/split mode tabs,
  and the mobile drawer no longer mark the active item with an inset accent stripe and
  full-accent text (which read as a glowing capsule once controls gained radii); active state
  is now a muted tinted pill, per the design mockups. The library resizer's hover/drag fill is
  softened from full accent to a mix.

## [0.18.0] - 2026-06-10

### Changed

- **Library design polish** (from the macOS-mockup review): controls, inputs, and chips gain a
  gentle 6px radius (panels stay square); the Console palette's surface tones are separated so
  the sidebar / list / detail panes read as distinct layers; the markdown preview is capped at a
  readable ~74ch measure; list-row meta now reads `type · project · updated by <who>` instead of
  the source-filename fallback; cluster status dots are round. The smart-views / tags / filters
  stack is collapsed behind a `filters ↕` toggle on desktop too (it was always-open), so the
  document list starts two rows down; detail action buttons render their bracket key as a `kbd`
  chip (`[v] verify` → `ⓥ verify`); row tags become quiet `#tag` text; the detail kicker is
  lowercase; preview mode reads as one continuous pane down to the Links section.

## [0.17.1] - 2026-06-10

### Fixed

- Library list rows no longer clip the trust chips (`SYNTH` / `STALE` / `VERIFIED` /
  `SUPERSEDED`) on long titles: the title now ellipsizes in its own span while chips stay
  pinned and visible. Also removes the sideways scroll the list panel developed with
  long-titled documents (grid items now allowed to shrink below content width).

## [0.17.0] - 2026-06-08

### Changed

- **Memory skills converged onto the CLI.** `moomora-recall` / `moomora-remember` are now thin
  wrappers over shared `cli/lib/recall.js` and `cli/lib/remember.js` — one implementation behind
  both the skills and the `moomora` CLI. New `moomora recall` (cross-project, distilled, with
  `--recent`) and `moomora remember --memory` (write to the global `memory` namespace). The skill
  invocation and output are unchanged, and skills remain zero-install (no global `moomora`).

## [0.16.0] - 2026-06-07

### Added

- **Trust actions on every surface (memory slice 2).** The Library detail panel gains
  `[v] verify` / `[v] unverify` and `[s] supersede…` buttons, so a human can change a document's
  trust state from the web UI (previously read-only chips). Supersede reuses the link-picker
  modal to choose a same-project replacement. Agents gain a `supersede_document` MCP tool
  (with a matching `supersedeDocument` client method); verifying stays a human-only action and is
  intentionally not exposed via MCP.

## [0.15.1] - 2026-06-05

### Added

- Kubernetes deployment manifests: a Kustomize `deploy/base` + `deploy/overlays/{dev,staging,prod}`
  layout for a GitOps Argo CD workloads ApplicationSet (one Application per environment; the
  destination namespace is injected by Argo). Each environment runs its own CloudNativePG
  `Cluster` on a stock PostgreSQL 18 operand with `pgvector` mounted as a Kubernetes ImageVolume
  extension, exposed via a Gateway API `HTTPRoute`, with semantic search configured through the
  ConfigMap.
- `AGENTS.md` — a tool-agnostic agent-memory convention (Codex, Cursor, aider, and any
  shell-capable agent) mirroring the Claude Code `CLAUDE.md` guidance, so Moomora memory is shared
  across tools.

### Changed

- Replaced the legacy flat `deploy/k8s/` manifests with the Kustomize base/overlays layout and
  reconciled `README.md` and `docs/deployment.md`.

## [0.15.0] - 2026-06-04

### Added

- Shared memory trust model: documents now carry `verified` / `status`
  (`active` / `superseded` / `deprecated`). Agent-written memory is unverified by default;
  humans verify or supersede it. Retrieval is active-only and quarantines unverified memory
  in a clearly-labelled section. Migration `0007` backfills existing rows conservatively
  (`updated_by = 'user'` → verified, `updated_by = 'agent'` → unverified) and marks
  documents that are already targets of a `supersedes` link as `superseded`.
- `GET /api/projects/:id/context-pack` — a bounded, trust-aware Markdown (or JSON) briefing
  assembled from project memory, with semantic ranking when embeddings are on and a recency
  fallback otherwise. Unverified documents appear in a `⚠ Unverified — pending human review`
  section.
- `POST /api/library/documents/:id/verify` (body `{verified: boolean, as?: string}`) and
  `POST /api/library/documents/:id/supersede` (body `{supersededBy: <id>}`).
- A thin `moomora` CLI (`cli/`) so any shell-capable agent or human can pull a context pack
  and read/write/verify project memory without opening a browser. See `docs/cli.md`.
- Read-only trust display (VERIFIED / SUPERSEDED) in the Library UI.

## [0.14.2] - 2026-06-04

### Added

- A **"rebuild all"** button in the Admin → Semantic Search section that force-reindexes every
  document (`POST /api/library/embeddings/reindex?force=true`), so the title+body migration (and any
  full rebuild after changing the embedding model) is one click instead of an API call. It confirms
  first, since it re-runs the embedding backend over the whole library; the existing **reindex**
  button stays staleness-based.

## [0.14.1] - 2026-06-04

### Changed

- Semantic search now embeds each document's **title + body** together (previously the body only),
  so a query that matches the title retrieves the document — titles are high-signal, especially for
  short notes. The on-write trigger re-embeds on a **title or body** change. `embedded_hash` is still
  the body `content_hash`, so the staleness logic, counts, and the export contract are unchanged.
  `POST /api/library/embeddings/reindex?force=true` re-embeds **all** active documents (run it once
  after upgrading, or after changing the embedding model). The `moomora-recall` skill gains a
  `--recent [n]` mode that lists the latest documents chronologically (a list intent, vs. semantic
  similarity).

### Added

- **Kubernetes pgvector deployment support.** A `deploy/postgres/Dockerfile` that adds pgvector to
  the official CloudNativePG PostgreSQL base image, and `deploy/k8s/postgres-cluster.example.yaml`,
  an example CloudNativePG `Cluster` that wires that image and pre-creates the `vector` extension at
  bootstrap (`postInitApplicationSQL`) — necessary because pgvector is not a "trusted" extension and
  the app's non-superuser migration role cannot `CREATE` it. `docs/deployment.md` gains a Postgres
  cluster (pgvector) section and a "Semantic search (optional)" section covering enabling embeddings
  via the ConfigMap + an API-key Secret.

## [0.14.0] - 2026-06-03

### Added

- **OpenAI-compatible embedding backend** (`EMBEDDING_BACKEND=openai`). One adapter covers real
  OpenAI, local llama.cpp, vLLM, LiteLLM, and any other OpenAI-compatible `/v1/embeddings` server
  via `OPENAI_BASE_URL` (default `https://api.openai.com/v1`) and an optional `OPENAI_API_KEY` (the
  `Authorization` header is omitted when the key is empty, so keyless local servers work). Keys are
  env-only and never exposed through the no-auth UI. (#47)
- **Configurable query-instruction prefix** (`EMBEDDING_QUERY_PREFIX`), prepended to **search-query**
  embeddings only — never to document embeddings — so instruct-tuned models (e.g. `qwen3-embedding`
  with `Instruct: …\nQuery:`, or `nomic` with `search_query: `) reach peak retrieval quality.
  Because documents always embed raw, changing the prefix needs no reindex. Default empty preserves
  prior behavior. (#47)
- **Agent-memory skills + convention** for using Moomora as long-term memory for an AI agent
  (e.g. Claude Code). Two repo-committed Claude Code skills — `moomora-recall` (retrieve relevant
  context by meaning, returning a distilled summary) and `moomora-remember` (persist durable
  findings to a dedicated `memory` project, de-duped by title, stamped with agent provenance) —
  plus `docs/agent-memory.md` and a `CLAUDE.md` block describing the retrieve → persist →
  supersede loop. The skills wrap the existing HTTP API (no server change) and are token-cheaper
  than the MCP tools for the retrieve/persist paths, which they complement rather than replace.

## [0.13.1] - 2026-06-03

### Changed

- Semantic search now applies a **gap-based relevance cutoff** instead of returning the whole
  library re-ranked. Only documents scoring within `EMBEDDING_SEARCH_TOP_DROP` (default 0.20) of
  the best match **and** at least `EMBEDDING_SEARCH_MIN_SIMILARITY` (default 0.45) cosine
  similarity are returned, so an unrelated query returns few or no results rather than every
  document. Both thresholds are env-tunable; the defaults are calibrated for the recommended
  `qwen3-embedding:0.6b` model. The filter is computed from a similarity scalar — the embedding
  vector is still never selected or returned. Applies to both the HTTP route and the
  `search_documents_semantic` MCP tool. (#44)

### Fixed

- The library **keyword/semantic switch** rendered as two oversized full-height boxes. The
  library browser was a fixed four-row CSS grid and the switch (added in v0.13.0) displaced the
  scrolling list from its `1fr` row; it is now a flex column with the document list as the sole
  growing child, so the switch renders as small inline pills. (#44)
- After an Enter-triggered semantic search, the top-ranked result now **opens in the detail
  pane** (mirroring a row click, including the mobile slide-in); previously the matching document
  appeared at the top of the list but the detail pane kept showing the previously-selected doc.
  A query with no relevant matches clears the selection and shows the empty state. (#44)
- A non-numeric `EMBEDDING_SEARCH_*` env value no longer silently disables all search results
  (it now falls back to the default instead of producing `NaN`). (#44)

## [0.13.0] - 2026-06-03

### Added

- pgvector-backed **semantic (embedding) search** over the Markdown library:
  paraphrased queries surface topically-relevant documents even when they share
  no words with the query. It is **retrieval-only** — embeddings rank existing
  documents, nothing is generated — staying true to the no-embedded-LLM
  -generation principle. Surfaced as `GET /api/library/documents/semantic-search`
  (cosine-ranked refs), `POST /api/library/embeddings/reindex`,
  `GET`/`PUT /api/settings/semantic-search`, a `search_documents_semantic` MCP
  tool (which falls back with a friendly message when disabled), an Admin
  "Semantic Search" status/toggle/reindex section, and a keyword/semantic switch
  in the library search. (#42)
- **Pluggable embedding backends** behind one interface, resolved from
  `EMBEDDING_BACKEND`. This release ships the **Ollama** adapter plus a
  deterministic **`fake`** test backend; OpenAI / Gemini / Voyage adapters are a
  v0.13.1 follow-up behind the same interface. (Anthropic has no embeddings API,
  so the "Claude" backend is Voyage, its officially recommended provider.) All
  backend config — URLs, model names, API keys — is **env-only** and never
  settable or readable through the no-auth web UI; the UI exposes only read-only
  status and the on/off toggle. (#42)
- **Two-level control:** the feature is config-gated (`EMBEDDING_BACKEND=none`,
  the default, leaves it entirely absent) and, when configured, a server-side
  runtime toggle (stored in a new `app_settings` table) turns it on and off live,
  consistently across the UI, MCP, and HTTP. Documents embed asynchronously on
  write (the write path never fails on an embedding error) with a manual reindex
  to backfill or repair after edits or a backend switch. (#42)

### Changed

- The Docker Compose PostgreSQL image is now **`pgvector/pgvector:pg18`** (was
  `postgres:18-alpine`) to provide the `vector` extension. It is volume-compatible
  with the previous PostgreSQL 18 image (identical data directory layout), so
  existing local volumes are preserved — no reset required. Migrations `0005`
  (embedding columns) and `0006` (`app_settings`) apply automatically on startup.
  **Deployment note:** the published image must run against a pgvector-capable
  PostgreSQL; the Kubernetes manifests will need a pgvector image (follow-up). (#42)

## [0.12.2] - 2026-06-03

### Added

- Playwright end-to-end browser test harness (`npm run test:e2e`) driving the
  in-memory demo server, covering the document-graph UI surface: Links-section
  visibility on first load and across every detail mode, SYNTH/STALE list
  chips, and the Admin Library Maintenance panel (stale/orphan tables, `[open]`
  click-through, project filter). It catches the layout/visibility and
  stale-DOM bug classes that the string-HTML unit suite cannot — the harness
  was mutation-tested against the v0.12.1 regressions to prove it is not
  tautological. Gated in CI via a new `e2e` job; the existing `npm test` unit
  suite is unchanged. (#40)

## [0.12.1] - 2026-06-03

### Fixed

- Library detail Links section now renders on first load and in every view
  mode (preview / edit / split / info-edit / focus). After v0.12.0 it was
  hidden until the user manually switched modes, because two compounding
  regressions left it both layout-clipped and stuck behind a stale-DOM bug
  in the post-fetch re-render. (#38)
  - `.library-detail` was a 2-row CSS grid; the renderer appended Links as
    a 3rd child which was placed in an implicit row but clipped by the
    aside's `overflow: hidden`. Fix: explicit `auto` third row in
    `grid-template-rows`.
  - `loadDocumentLinks` updated `state.documentLinks` correctly but its
    re-render call used a `[data-workspace]` selector that doesn't exist
    anywhere in the DOM, so the DOM stayed stale until another interaction
    triggered a re-render. Fix: call `renderWorkspace()`, the canonical
    library re-render entry point.

## [0.12.0] - 2026-06-03

### Added

- Document graph UI surface. The library list now shows inline `SYNTH` chips
  on synthesized documents and `STALE` pills on documents whose `derived-from`
  source has changed since the link was created. The detail panel gains a
  `SOURCE` / `SYNTHESIZED` kind badge, an "Updated by" metadata line, and a
  read-only Links section below the body (Derived from / Supersedes outbound,
  Backlinks inbound) with click-through to navigate the graph. Admin gains a
  new "Library Maintenance" section listing stale and orphan documents with
  a project filter, a refresh button, and `[open]` click-through that resets
  filters and realigns the active project as needed. Backend adds one
  additive contract field — `stale: boolean` on the document list response —
  computed via a `left join lateral` over the existing `derived-from` snapshot.
  No new HTTP endpoints, no new MCP tools, no migration. (#36)

## [0.11.1] - 2026-06-02

### Fixed

- Timestamps in HTTP responses and library `.md` exports now emit ISO 8601 strings.
  Previously the `pg` driver's `Date` objects rendered as
  `Date.prototype.toString()` form (e.g. `Tue Jun 02 2026 19:47:21 GMT+0000 (Coordinated
  Universal Time)`) in any string-interpolated touchpoint, contradicting the contract
  docs. Fixed at the data-layer boundary by wrapping every timestamp in the five
  normalizers (`normalizeDocumentRow`, `normalizeTaskRow`, `normalizeActivityRow`,
  `normalizeProjectRow`, `normalizeChecklistRow`) with a `toIso(value)` helper. (#34)

## [0.11.0] - 2026-06-02

### Added

- Library `.md` export front-matter v2: outbound document links
  (`derived-from` / `supersedes`) with a hybrid `{ id, ref }` identifier per
  target, content hash, edit origin (`updated_by`), and `kind`. New
  `GET /api/library/documents/:id/export` route renders a single document as
  v2 markdown server-side (`text/markdown; charset=utf-8`, `Content-Disposition:
  attachment`). The browser single-doc download now navigates to this route
  instead of rendering client-side. Export-only — no import path, no YAML
  version field; v1 readers silently accept v2 since YAML ignores unknown
  keys. (#32)

### Changed

- Bumped `archiver` to 8.0.0 (ESM-only, named `ZipArchive` export). (#31)

## [0.10.0] - 2026-06-02

### Added

- Document `kind` (`"source"` / `"synthesized"`) distinguishing hand-authored documents
  from agent-synthesized derivations. Exposed on reads (`get_document`, search rows,
  stale/orphan rows), accepted as an optional input on `create_document` / `update_document`
  (HTTP + MCP), and supported as a `?kind=` filter on `GET /api/library/documents` and
  `search_documents`. Set explicitly by callers (no inference from `x-moomora-origin`);
  mutable via `update_document` so a polished synthesized doc can be promoted to source.
  Stale/orphan grooming rows carry `kind` so agents can refresh stale synthesized docs
  aggressively and leave stale source docs for human review. (#29)

## [0.9.0] - 2026-05-31

### Added

- Document graph: typed, directional document↔document links (`derived-from`, `supersedes`)
  with backlink retrieval, plus fetch-by-id routes (`GET /api/library/documents/:id`,
  `GET /api/tasks/:id`), exposed over the HTTP API and MCP (`link_documents`,
  `unlink_documents`, `list_document_links`). (#25)
- Document provenance and a stale/orphan groom loop: per-document content hash and
  path-stamped edit-origin (`updated_by`, from the `x-moomora-origin` header), a source-hash
  snapshot on `derived-from` links (refreshed on re-link), and read-only stale/orphan
  detection (`list_stale_documents`, `list_orphan_documents`, and
  `GET /api/library/maintenance/stale|orphans`). Documents now expose `contentHash` and
  `updatedBy`. (#26)

## [0.8.0] - 2026-05-31

### Added

- Database migration system: forward-only SQL migrations tracked in a `schema_migrations`
  table, applied through an advisory-locked runner on startup or via `npm run migrate`, plus
  backup/restore documentation (`docs/backup-restore.md`). (#20)
- Data-formats reference (`docs/contract.md`) documenting the `moomora.tasks` export/import
  format, the library `.md` front-matter, and the MCP tool surface, backed by a
  regression-test suite under `tests/contract/` that flags accidental shape changes. (#21, #22)

### Changed

- Refreshed the README screenshots to match the redesigned desktop UI.

### Removed

- Dead board-inspector code left over after the task-detail drawer migration. (#19)

## [0.7.7] - 2026-05-29

### Changed

- Broadened the project positioning beyond homelab use and updated the README to reflect the
  shipped MCP server and Markdown library.

### Fixed

- Decluttered the mobile top bar and repaired non-functional modal cancel buttons. (#18)

## [0.7.6] - 2026-05-28

### Changed

- Desktop layout and navigation redesign: grouped left-rail navigation, a metric strip, and a
  resizable task-detail drawer. (#17)

## [0.7.5] - 2026-05-28

### Added

- Read-only Library archive view for browsing archived documents separately from the active
  list. (#16)

### Changed

- The release workflow now auto-creates a GitHub Release on tag push.

## [0.7.4] - 2026-05-28

### Fixed

- Release-pipeline fix (container image publishing); no functional application changes.

## [0.7.3] - 2026-05-28

### Added

- Library export: single-document `.md` download and bulk ZIP export. (#15)

## [0.7.2] - 2026-05-22

### Fixed

- Mirrored the board-extras batch endpoint in the in-memory demo server. (#14)

## [0.7.1] - 2026-05-22

### Changed

- Board extras now load in a single batched request instead of one per card. (#13)

## [0.7.0] - 2026-05-22

### Changed

- Polished the board and sidebar workspace styling. (#12)

## [0.6.1] - 2026-05-22

### Fixed

- Scoped checklist item updates and deletes to their owning task. (#11)

## [0.6.0] - 2026-05-22

### Added

- Task detail enrichment: notes, checklist, and activity log. (#8)
- List-view swimlanes: project grouping on the Tasks view. (#10)

### Fixed

- Open a linked document regardless of the active Library filters. (#9)

## [0.5.1] - 2026-05-21

### Fixed

- The MCP server now advertises the package version instead of a stale hard-coded literal.

## [0.5.0] - 2026-05-21

### Added

- Board enhancements: project swimlanes and a density toggle. (#7)

## [0.4.1] - 2026-05-21

### Fixed

- Normalised task `dueDate` to `YYYY-MM-DD` when read from PostgreSQL.

### Changed

- Refreshed the README for the projects/board/palette features and recaptured screenshots.

## [0.4.0] - 2026-05-21

### Added

- User-creatable projects, a navigation redesign, and the Midnight palette. (#6)

## [0.3.0] - 2026-05-20

### Added

- Local MCP server exposing subscription-backed task and document access to Claude Code. (#5)

## [0.2.0] - 2026-05-20

### Added

- Browser-local appearance preferences: colour palettes, a font-scale control, and a settings
  panel.
- Operator-evolved UI redesign and task↔document linking. (#4)

### Changed

- Adopted a GitHub-like system font stack.

## [0.1.1] - 2026-05-19

### Added

- Multi-architecture release image publishing and Dependabot dependency updates.

### Changed

- Updated the local PostgreSQL image to version 18.

## [0.1.0] - 2026-05-19

### Added

- Initial release of Moomora Console: a Markdown library/document workspace with a CodeMirror
  editor, a Markdown toolbar, and live split preview; tag filtering with searchable saved tag
  views; an inline document info editor; a Docker Compose local install; and CI for tests and
  dependency security scanning.

[Unreleased]: https://github.com/awaybreaktoday/moomora-console/compare/v0.20.0...HEAD
[0.20.0]: https://github.com/awaybreaktoday/moomora-console/compare/v0.19.2...v0.20.0
[0.19.2]: https://github.com/awaybreaktoday/moomora-console/compare/v0.19.1...v0.19.2
[0.19.1]: https://github.com/awaybreaktoday/moomora-console/compare/v0.19.0...v0.19.1
[0.19.0]: https://github.com/awaybreaktoday/moomora-console/compare/v0.18.0...v0.19.0
[0.18.0]: https://github.com/awaybreaktoday/moomora-console/compare/v0.17.1...v0.18.0
[0.17.1]: https://github.com/awaybreaktoday/moomora-console/compare/v0.17.0...v0.17.1
[0.17.0]: https://github.com/awaybreaktoday/moomora-console/compare/v0.16.0...v0.17.0
[0.16.0]: https://github.com/awaybreaktoday/moomora-console/compare/v0.15.1...v0.16.0
[0.15.1]: https://github.com/awaybreaktoday/moomora-console/compare/v0.15.0...v0.15.1
[0.15.0]: https://github.com/awaybreaktoday/moomora-console/compare/v0.14.2...v0.15.0
[0.14.2]: https://github.com/awaybreaktoday/moomora-console/compare/v0.14.1...v0.14.2
[0.14.1]: https://github.com/awaybreaktoday/moomora-console/compare/v0.14.0...v0.14.1
[0.14.0]: https://github.com/awaybreaktoday/moomora-console/compare/v0.13.1...v0.14.0
[0.13.1]: https://github.com/awaybreaktoday/moomora-console/compare/v0.13.0...v0.13.1
[0.13.0]: https://github.com/awaybreaktoday/moomora-console/compare/v0.12.2...v0.13.0
[0.12.2]: https://github.com/awaybreaktoday/moomora-console/compare/v0.12.1...v0.12.2
[0.12.1]: https://github.com/awaybreaktoday/moomora-console/compare/v0.12.0...v0.12.1
[0.12.0]: https://github.com/awaybreaktoday/moomora-console/compare/v0.11.1...v0.12.0
[0.11.1]: https://github.com/awaybreaktoday/moomora-console/compare/v0.11.0...v0.11.1
[0.11.0]: https://github.com/awaybreaktoday/moomora-console/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/awaybreaktoday/moomora-console/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/awaybreaktoday/moomora-console/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/awaybreaktoday/moomora-console/compare/v0.7.7...v0.8.0
[0.7.7]: https://github.com/awaybreaktoday/moomora-console/compare/v0.7.6...v0.7.7
[0.7.6]: https://github.com/awaybreaktoday/moomora-console/compare/v0.7.5...v0.7.6
[0.7.5]: https://github.com/awaybreaktoday/moomora-console/compare/v0.7.4...v0.7.5
[0.7.4]: https://github.com/awaybreaktoday/moomora-console/compare/v0.7.3...v0.7.4
[0.7.3]: https://github.com/awaybreaktoday/moomora-console/compare/v0.7.2...v0.7.3
[0.7.2]: https://github.com/awaybreaktoday/moomora-console/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/awaybreaktoday/moomora-console/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/awaybreaktoday/moomora-console/compare/v0.6.1...v0.7.0
[0.6.1]: https://github.com/awaybreaktoday/moomora-console/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/awaybreaktoday/moomora-console/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/awaybreaktoday/moomora-console/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/awaybreaktoday/moomora-console/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/awaybreaktoday/moomora-console/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/awaybreaktoday/moomora-console/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/awaybreaktoday/moomora-console/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/awaybreaktoday/moomora-console/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/awaybreaktoday/moomora-console/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/awaybreaktoday/moomora-console/releases/tag/v0.1.0
