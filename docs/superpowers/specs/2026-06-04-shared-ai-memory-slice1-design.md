# Shared AI Memory — Slice 1 Design

**Status:** Approved (brainstorm complete)
**Date:** 2026-06-04
**Branch:** `shared-ai-memory-slice1`

## Context

Moomora Console already prototypes a shared-AI-memory loop: a `memory` project,
the `moomora-recall` / `moomora-remember` Claude Code skills, semantic search over
the library, provenance via `updated_by` (`user` / `agent`) and `kind`
(`source` / `synthesized`), and supersession via `document_links`. The broader
product direction ("Moomora as a shared local-first AI memory layer + a universal
`moomora` CLI") is captured in a separate planning doc.

This spec defines the **first shippable slice** of that direction, reshaped per
agreed pushbacks:

- **Evolve the existing document model, do not fork a new `memory_items` model.**
  ~90% reuse, ~10% new.
- **Ship the smallest loop that proves the thesis** — the thesis being *shared
  project memory usable by any shell-capable AI tool*, not just Claude Code.
- **Keep the trust / provenance model central** — agent-written memory is
  unverified until a human blesses it.
- **Conservative defaults on unverified retrieval** — never present unverified
  memory as authoritative fact.
- **Defer** RAG / "Ask Project", the 11-type taxonomy, external refs, repo-URL
  detection, and auth.

## Goal

A real `moomora` CLI that any shell-capable agent can use to pull a project
**context pack**, search and read project memory, write **unverified** memory,
and let a human **verify** / **supersede** it — all backed by the existing
`markdown_documents` model evolved with four trust fields.

## Non-Goals (deferred to later slices)

- RAG / "Ask Project" generation layer.
- External references (`memory_external_refs`) and repo-URL-based project detection.
- The 11-type memory taxonomy (type differentiation rides on `document_type` + tags).
- Authentication / `MOOMORA_TOKEN` enforcement (the CLI passes the header through
  for forward-compatibility, but the server does not require it).
- Verify / supersede **actions** in the web UI (read-only display only this slice).
- New MCP tools (the new fields surface through existing MCP read tools for free).
- Converging the existing `moomora-recall` / `moomora-remember` skills onto the CLI.

## Architecture overview

```
shell-capable agent / human
        │
   moomora CLI (thin HTTP client, cli/)
        │  init · context · search · get · remember · verify · supersede
        ▼
   Moomora HTTP API (existing + 3 new routes)
        │  context-pack · verify · supersede   (+ trust/status filtering on existing search)
        ▼
   markdown_documents  (evolved: verified, verified_at, verified_by, status)
   document_links      (reused: supersedes)
   semantic search     (reused)
```

The CLI duplicates **no** business logic — every command is an HTTP call. The
trust/selection logic lives in pure server modules so it is unit-testable without
HTTP.

---

## Section 1 — Data model evolution (`0007` migration)

`server/migrations/0007_add_memory_trust.sql`:

```sql
alter table markdown_documents
  add column if not exists verified     boolean not null default false,
  add column if not exists verified_at  timestamptz,
  add column if not exists verified_by  text,
  add column if not exists status       text not null default 'active';

alter table markdown_documents
  add constraint markdown_documents_status_check
  check (status in ('active','superseded','deprecated'));

-- Backfill existing rows conservatively:
update markdown_documents set verified = true  where updated_by = 'user';
update markdown_documents set verified = false where updated_by = 'agent';

-- Mark already-superseded docs (targets of a supersedes link) as superseded:
update markdown_documents d set status = 'superseded'
  where exists (select 1 from document_links l
                where l.target_document_id = d.id and l.relation = 'supersedes');
```

Notes:

- The constraint is added separately (not inline) so `add column if not exists`
  stays idempotent; the migration runner applies each statement once.
- **`normalizeDocumentRow` gains exactly four scalar fields** — `verified`,
  `verifiedAt` (ISO via `toIso`), `verifiedBy`, `status`. The allowlist pattern is
  preserved: the function remains an explicit allowlist with **no spread**, so the
  **no-vector-leak invariant holds** (embedding / vector columns are never
  returned).
- **No new `type` column.** `document_type` (`runbook` / `note`) plus tags carry
  type. The 11-type taxonomy stays deferred.
- The in-memory **demo server mirrors** the four fields so `npm run demo` and the
  contract tests stay faithful.

### Field semantics

| Field | Type | Meaning | Default |
|---|---|---|---|
| `verified` | boolean | A human has blessed this memory as trustworthy | `false` |
| `verified_at` | timestamptz | When it was verified | `null` |
| `verified_by` | text | Best-effort actor who verified (no-auth: a label) | `null` |
| `status` | text | `active` / `superseded` / `deprecated` | `active` |

---

## Section 2 — Trust & status workflow

Three state transitions, all built on existing primitives.

### 1. Create — trust defaults by origin

- Writes carrying `x-moomora-origin: agent` (the CLI `remember`, the
  `moomora-remember` skill, agent MCP calls) default `verified = false`.
- UI / human API / human MCP writes default `verified = true`.

This makes "agent memory is unverified until a human blesses it" automatic, with
no extra step for human-authored notes.

### 2. Verify — a human blessing

- **New route:** `POST /api/library/documents/:id/verify`
  - Body `{ verified: true, as?: string }` → sets `verified = true`,
    `verified_at = now()`, `verified_by = as ?? 'user'`.
  - Body `{ verified: false }` → revokes (`verified = false`, clears
    `verified_at` / `verified_by`).
- Actor is best-effort in the no-auth model: the CLI passes `--as <name>`
  (default `cli`); the UI passes `user`.
- **Honest limitation, documented:** with no auth, `verified` is a **workflow
  signal, not a security guarantee** — anyone on the trusted network can call it.

### 3. Supersede — reuse `document_links`

- **New route:** `POST /api/library/documents/:id/supersede`
  - Body `{ supersededBy: <newId> }` creates a `supersedes` link with
    `source = newId`, `target = :id` (matching the existing convention where
    `source supersedes target`), **and** flips `:id`'s `status = 'superseded'`.
  - Removing the last `supersedes` link targeting a doc reverts it to
    `status = 'active'`.

### Conservative retrieval (the crown-jewel default)

- **Context pack & default search** return only `status = 'active'` docs.
- Unverified active memory is **never silently mixed in as fact**: it is returned
  with its `verified: false` flag and, in the context pack, quarantined in a
  clearly-labelled `## ⚠ Unverified — pending human review` section, separate from
  verified memory.
- Default ordering prefers `verified = true`, then recency / similarity.
- `--all` opts into `superseded` / `deprecated` results.

---

## Section 3 — Context-pack endpoint

**Route:** `GET /api/projects/:idOrSlug/context-pack?query=<optional>&limit=<n>&format=md|json`

Almost entirely *assembly over existing data*. The only new logic is selection +
formatting, isolated in a pure module `server/contextPack.js`
(`buildContextPack(docs, { query, limit })`).

### Pack structure

1. **Header** — project name + status.
2. **Project overview** — verified, active docs tagged `project-card` (a
   convention tag), rendered in full. Omitted (no placeholder) if none exist.
3. **Relevant memory** —
   - if `query` is provided **and** embeddings are on: top-K **verified active**
     docs by semantic similarity (reuses the existing semantic search +
     relevance cutoff);
   - otherwise: most-recently-updated verified active docs.
   - Rendered as titled snippets.
4. **Active runbooks** — verified active `document_type = 'runbook'` for the
   project (title + id, not full body).
5. **`## ⚠ Unverified — pending human review`** — unverified active docs that
   matched, clearly quarantined, never mixed into sections 2–4.

### Behaviour

- **Bounded output:** `limit` (default 12 docs) + snippet truncation keep the
  pack inside a context window.
- **Graceful degradation:** embeddings off or no `query` → recency / tag
  fallback, never an error (mirrors the semantic-search 503-graceful pattern,
  but here we fall back rather than fail because keyword/recency always works).
- **Formats:** `format=md` (default) returns assembled Markdown;
  `format=json` returns
  `{ project, sections: [{ kind, title, items: [{ id, title, verified, snippet }] }] }`.

---

## Section 4 — `moomora` CLI

In-repo `cli/` with a `bin` entry (`"moomora": "cli/moomora.js"`), so
`npm link` / global install yields a real `moomora`; also runnable as
`node cli/moomora.js`. **Thin client** — every command is one HTTP call.

### Global options / config

- `--project <slug>` — override detection.
- `--json` — machine-readable output.
- `--url <base>` — default `MOOMORA_API_URL` → `http://127.0.0.1:3000`.
- `MOOMORA_TOKEN` — optional bearer header passthrough (forward-compat; the server
  does not require it this slice).

### Project detection resolution order

`--project` flag → `MOOMORA_PROJECT` env → `.moomora/project.json` (walk up from
cwd) → cwd folder-name match against existing project slugs → error with a
`moomora init` hint.

`.moomora/project.json` shape: `{ "project": "<slug-or-id>" }`.

The resolver is a **pure function** over `{ flag, env, fsLookup, cwd }` so it is
testable without network or filesystem side effects.

### Commands (slice 1)

| Command | Wraps | Notes |
|---|---|---|
| `moomora init` | — | writes `.moomora/project.json`; takes `--project`, else infers from cwd folder name; prompts only when attached to a TTY (non-interactive runs require `--project` or a folder-name match) |
| `moomora context [query…]` | **new** context-pack route | headline command; Markdown default, `--json` |
| `moomora search <query>` | existing keyword + semantic routes | trust flags shown; `--all` includes superseded |
| `moomora get <id\|title>` | existing get-document | full body + trust/status metadata |
| `moomora remember <title>` | existing create/update | **unverified** by default (`x-moomora-origin: agent`); `--body`/stdin, `--type`, `--tag`; dedup-by-title **within the resolved project** (PATCH if exists, else POST) |
| `moomora verify <id>` / `unverify <id>` | **new** verify route | `--as <name>` (default `cli`) |
| `moomora supersede <oldId> --with <newId>` | **new** supersede route | creates link + flips status |

### Backend delta (small)

Migration `0007` + four `normalizeDocumentRow` fields + **three new routes**
(context-pack, verify, supersede) + status/trust filtering wired into the
**existing** search / semantic routes. The `moomora-recall` / `moomora-remember`
skills keep working against the API untouched.

---

## Section 5 — Testing & verification

### Pure modules first (unit-testable without HTTP)

Mirrors the existing `libraryExport.js` / `applyRelevanceCutoff` pattern.

- `server/contextPack.js` — `buildContextPack(docs, { query, limit })` produces
  the sectioned structure (verified separated from unverified, superseded
  excluded, bounded by `limit`).
- CLI project-detection resolver — pure function over `{ flag, env, fsLookup, cwd }`.

### Backend unit tests (`npm test`)

- `normalizeDocumentRow` includes the four new fields **and still strips every
  embedding / vector column** — extend the existing no-leak lock test (load-bearing
  invariant).
- Migration `0007` backfill: `user` → verified, `agent` → unverified,
  supersede-target → superseded.
- Status auto-flip: creating a `supersedes` link flips target to `superseded`;
  removing the last one reverts to `active`.
- Trust-by-origin: agent-origin create → `verified = false`; human create →
  `verified = true`.
- `verify` / `unverify` routes set / clear `verified`, `verified_at`,
  `verified_by`.
- Retrieval: search + semantic exclude `superseded` / `deprecated` by default;
  ordering prefers `verified`.

### CLI tests

- Detection resolution order, arg parsing, JSON-vs-Markdown formatting (HTTP
  faked).
- One smoke test running `moomora context` against the demo server.

### Contract + demo

- Extend `tests/contract/` golden for the document shape (four new fields)
  deliberately; document in `docs/contract.md`.
- In-memory demo server mirrors the four fields + the three new routes so
  `npm run demo` and any E2E stay faithful.

### Web UI (read-only this slice)

- `verified` badge + `superseded` dimming in the existing list / detail panel,
  reusing the chip pattern (`SYNTH` / `STALE`). Keeps the UI from silently
  misrepresenting trust.
- **Verify / supersede actions are deferred** — CLI + API are the action surface
  this slice.

---

## Scope boundaries summary

| Area | Slice 1 | Deferred |
|---|---|---|
| Data model | `verified`, `verified_at`, `verified_by`, `status` on `markdown_documents` | `memory_type`, external refs |
| Retrieval | active-only + verified-preferred, unverified quarantined | RAG / "Ask Project" |
| CLI | init, context, search, get, remember, verify, supersede | watch, sync, richer detection |
| Detection | `.moomora/project.json` + folder-name fallback | repo-URL detection |
| Web UI | read-only trust display | verify / supersede actions |
| MCP | new fields via existing read tools (free) | new verify / supersede tools |
| Auth | header passthrough only | enforcement / `MOOMORA_TOKEN` |

## Success criteria

A shell-capable agent in a repo with `.moomora/project.json` can:

1. Run `moomora context "<task>"` and get a bounded Markdown briefing of verified
   project memory, with any unverified matches clearly quarantined.
2. Run `moomora search` / `moomora get` to retrieve memory with visible trust /
   status.
3. Run `moomora remember "<title>"` to write a memory that lands **unverified**.
4. A human runs `moomora verify <id>` (or `supersede`) and the memory's trust /
   status updates, immediately reflected in retrieval and the web UI's read-only
   display.

All while the **no-vector-leak invariant** and the **no-auth / env-only** model
remain intact.
