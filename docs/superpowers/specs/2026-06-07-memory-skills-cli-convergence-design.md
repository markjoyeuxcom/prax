# Converge the memory skills onto the CLI

**Status:** Approved (brainstorm complete)
**Date:** 2026-06-07
**Branch:** `memory-skills-cli-convergence`

## Context

Moomora's agent-memory loop has two parallel implementations of the same operations:

- The **CLI** (`cli/moomora.js` + `cli/lib/apiClient.js`) has `remember`, `search`, `verify`,
  `supersede`, `context`, `get` — `remember` writes to the **current project**, `search` is
  current-project + returns raw refs.
- The **skills** (`.claude/skills/moomora-{recall,remember}/*.mjs`) are standalone zero-install
  Node scripts that hit the API with their **own inline `fetch`** logic. `recall.mjs` searches
  **all projects** by default and **distills** the result (top hit + ~800-char body + a `Related:`
  list), with a `--recent` chronological mode; `remember.mjs` writes to a dedicated global
  **`memory`** project, auto-creating it, de-duping by title, tagging `memory`, kind `synthesized`.

This duplicates the HTTP layer, splits the `recall`/`remember` semantics across two codebases, and
leaves the CLI without the distillation / cross-project `recall` the skills have. This is the last
slice-2-adjacent item on the roadmap.

## Goal

One code path. Extract the recall/remember operations into shared `cli/lib/*` modules that **both**
the `moomora` CLI commands and the (still zero-install) skill `.mjs` wrappers import. Add a
cross-project `moomora recall`, and reconcile the current-project vs `memory`-project scoping for
`remember` behind an explicit flag. No server or schema change.

## Decisions (resolved during brainstorm)

| Topic | Decision |
|---|---|
| Architecture | **Operation modules + shared client** (approach #1). `apiClient.js` stays the pure HTTP layer; new `cli/lib/recall.js` and `cli/lib/remember.js` hold the operations; CLI commands and skill wrappers both import them. |
| Skill invocation | **Zero-install preserved.** Skills keep the `node .claude/skills/…/{recall,remember}.mjs` entrypoint; the `.mjs` files become thin wrappers importing `../../../cli/lib/*`. **No global `moomora` / PATH dependency for skills.** The installed CLI remains for human use. |
| `remember` scope | Default **current project**; `--memory` flag targets the global **`memory`** project. The caller resolves the target slug; the skill `remember.mjs` defaults the target to `'memory'`. |
| `recall` scope | Default **all projects, active-only** (cross-project); `--project <slug>` narrows. No `--all` flag (at the API `all=true` means *include retired*, a different axis — recall stays active-only). |
| `ensure-project-exists` | **Yes for both resolved scopes** — `remember` creates the target project on first use (current *and* memory). Today only the skill does this. |
| `kind: 'synthesized'` | **Caller-driven, not unconditional.** The skill/agent wrappers pass `kind: 'synthesized'`; the human CLI `remember` omits `kind` and keeps today's server default (`source`). |
| Origin | Unchanged — `remember` writes with `x-moomora-origin: agent` (lands `unverified`) for both callers, preserving "agents write unverified; humans verify". |
| `memory` tag | **Composed by the caller**, not by `remember()` — the human CLI adds it on `--memory`; the skill always adds it (as today). `remember()` itself is tag-agnostic. |

## Non-Goals (deferred)

- Any server route or schema change (the existing endpoints are sufficient).
- Changing the existing `search`, `context`, `get`, `verify`, `supersede` CLI commands.
- A global-install / PATH requirement for the skills.
- A `recall` flag to include retired (superseded/deprecated) docs — recall stays active-only.
- A CLI flag to force `kind` (humans get `source`; agents get `synthesized` via the wrapper).

## Architecture

Three layers; every entrypoint does the same thing — `createClient()` → shared operation →
format → stdout.

```
entrypoint (CLI command  OR  skill .mjs wrapper)
   │  createClient({ baseUrl, token })          // reads MOOMORA_API_URL / MOOMORA_TOKEN
   ▼
cli/lib/recall.js  /  cli/lib/remember.js        // the one implementation of each operation
   │
   ▼
cli/lib/apiClient.js                              // pure HTTP layer (one method = one endpoint)
```

### File structure

```
cli/lib/apiClient.js   MODIFY  map fetch-failure → friendly "not reachable"; attach err.status; add ensureProject()
cli/lib/recall.js      NEW     recall(client, opts) + formatRecall() + recent path
cli/lib/remember.js    NEW     remember(client, opts): ensure-project + dedup-by-title + write
cli/moomora.js         MODIFY  add `recall` command; refactor `remember` (uses lib + --memory); HELP text
.claude/skills/moomora-recall/recall.mjs        REWRITE  thin wrapper → createClient + recall + print
.claude/skills/moomora-remember/remember.mjs    REWRITE  thin wrapper → createClient + remember({project:'memory'}) + print
tests/cli/recall.test.js      NEW
tests/cli/remember.test.js    NEW
```

The skill `.mjs` files resolve `cli/lib/*` by a repo-relative path (`../../../cli/lib/…`) — both
live in the repo, so this is path-stable and needs no global install.

## Section 1 — `cli/lib/apiClient.js` (shared touch-ups)

The HTTP layer absorbs the error behaviour the skills hand-roll today, so every caller inherits it.

1. **Network-failure mapping.** Wrap the `fetch` call in `request()` in try/catch; on a thrown
   fetch error throw `new Error(\`Moomora not reachable at ${base} — is the app running? (${err.message})\`)`.
2. **Status on errors.** On `!res.ok`, attach the status before throwing so callers can branch
   (needed for the 409 = semantic-disabled fallback):
   ```javascript
   const err = new Error(message);
   err.status = res.status;
   throw err;
   ```
3. **`ensureProject(nameOrSlug)`** — find-or-create, mirroring the skill's `ensureProjectSlug`:
   ```javascript
   async ensureProject(target) {
     const projects = await request('GET', '/api/projects');
     const match = (Array.isArray(projects) ? projects : []).find(
       (p) => p.slug === target || (p.name && p.name.toLowerCase() === String(target).toLowerCase()),
     );
     if (match) return match.slug;
     const created = await request('POST', '/api/projects', { body: { name: target } });
     return created.slug;
   }
   ```
4. **`listDocuments(project)`** — the `--recent` primitive (all statuses, no `q` filter), mirroring
   the skill's recent path:
   ```javascript
   listDocuments(project) {
     const qs = project && project !== 'all' ? `?project=${encodeURIComponent(project)}` : '';
     return request('GET', `/api/library/documents${qs}`);
   }
   ```

Only `ensureProject` and `listDocuments` are added; `semanticSearch` / `keywordSearch` /
`findByTitle` / `createMemory` / `updateMemory` / `getDocument` are reused as-is.

## Section 2 — `cli/lib/recall.js`

### `recall(client, { query, project, limit = 5, recent = false })`

Returns a structured result (never prints). Encapsulates exactly today's `recall.mjs` behaviour:

- **`recent`** → `client.listDocuments(project)` (all statuses), sort by `updatedAt` desc, take
  `limit`. Return `{ kind: 'recent', project, items: [{ title, id, snippet }] }` (snippet = body
  whitespace-collapsed, ≤100 chars).
- **semantic path** (default): `client.semanticSearch(project || undefined, query, {})`.
  - `project` falsy ⇒ **no project param ⇒ all projects**; `includeRetired` stays false ⇒
    **active-only**.
  - empty array ⇒ `{ kind: 'empty', query }`.
  - else fetch the top hit's full body (`client.getDocument(refs[0].id)`) and return
    `{ kind: 'hit', note: null, top: { ...refs[0], body }, related: refs.slice(1, limit) }`.
- **409 fallback** (`err.status === 409`, semantic disabled): `client.keywordSearch(project || undefined, query, {})`
  (active-only, all projects). empty ⇒ `{ kind: 'empty', query, note: 'keyword' }`; else
  `{ kind: 'hit', note: 'semantic search disabled — keyword results', top: kept[0], related: kept.slice(1, limit) }`.
  *(The keyword fallback is active-only — a deliberate consistency fix; today's skill keyword
  fallback leaks retired docs.)*
- **Other errors** (503, not-reachable, …) propagate — the entrypoint prints them and exits 1.

### `formatRecall(result)` → string

Produces the **byte-identical** block the skill prints today:
- `kind: 'empty'` → `No relevant memory found for: "<query>"` (append
  ` (keyword; semantic search is disabled)` when `note === 'keyword'`).
- `kind: 'recent'` → `Most recent <n> document(s)[ in "<project>"]:` then `- <title> — <id>[ — <snip≤100>]` lines.
- `kind: 'hit'` →
  ```
  (<note>)            ← only when note is set
  ## <title>  (<type> · <id>)

  <body trimmed to ≤800 chars, … if cut>

  Related:            ← only when related is non-empty
  - <title> — <id>
  ```

Constants mirror the skill: `BODY_CHARS = 800`, `RELATED_MAX = 5`.

### CLI command

`moomora recall <query…> [--project <slug>] [--limit <n>] [--recent [n]] [--json]`
- Default scope all-projects (do **not** pass the current project unless `--project` given).
- `--json` → `out(result)` (raw structured object); else `out(formatRecall(result))`.
- `--recent` with optional inline count (`--recent 10`).

### Skill `recall.mjs` (rewrite)

Parse the same args it accepts today (`--project`, `--limit`, `--recent [n]`, positional query),
`const client = createClient()`, `const result = await recall(client, …)`, `console.log(formatRecall(result))`.
On a thrown error, print `err.message` to stderr and `process.exit(1)`; an `empty` result is a
normal exit 0 (honest miss). **Output is unchanged for agents.**

## Section 3 — `cli/lib/remember.js`

### `remember(client, { title, body, project, type = 'note', tags = [], kind })`

A generic, single-purpose operation: the **caller** resolves the target `project` slug and composes
`tags` (including `memory` when appropriate) and `kind`; `remember()` ensures the project, de-dups,
and writes. This keeps the namespace policy (which slug, which tags, which kind) in the thin callers
and out of the operation — so the skill's `--project` override is just "a different target slug."

- **Ensure target:** `const slug = await client.ensureProject(project)`.
- **Compose:** `documentType = type === 'runbook' ? 'runbook' : 'note'`; `allTags = Array.from(new Set(tags))`.
- **Dedup by exact title** within the target project: `client.findByTitle(slug, title)` → exact
  `d.title === title`:
  - exists → `client.updateMemory(dup.id, { title, body, tags: allTags })` → `{ doc, action: 'updated' }`.
  - else → `client.createMemory({ title, body, documentType, project: slug, tags: allTags, ...(kind ? { kind } : {}) })`
    → `{ doc, action: 'created' }`.
  - `kind` is forwarded **only when provided** — the human CLI omits it (server default `source`);
    the skill passes `kind: 'synthesized'`.
- `createMemory` / `updateMemory` already send `x-moomora-origin: agent` (unchanged).

### CLI command (refactor of the existing `remember`)

`moomora remember <title> [--body <text>] [--memory] [--type note|runbook] [--tag <t>]…`
- `const project = flags.memory ? 'memory' : resolveProjectName(flags).project`.
- `const tags = [...userTags, ...(flags.memory ? ['memory'] : [])]` (repeatable `--tag` collected
  into `userTags`).
- No `kind` passed (human write ⇒ server default `source`).
- `remember(client, { title, body, project, type, tags })`, then
  `out(flags.json ? doc : \`${action === 'updated' ? 'Updated' : 'Remembered'} "${doc.title}" (${doc.id}) — unverified.\`)`.

### Skill `remember.mjs` (rewrite)

Parse today's args (`<title> <body>` positionals, `--tags a,b`, `--type`, `--project`), then:
- `const project = flags.project || 'memory'` (memory default; `--project` overrides the target).
- `const tags = ['memory', ...userTags]` (the skill always memory-tags, as today).
- `remember(createClient(), { title, body, project, type, tags, kind: 'synthesized' })`.
- Print `Remembered "<title>" → <id> (<action>)`.

Preserves: memory project (auto-created), dedup, `memory` tag, `synthesized`, agent origin.
**Output equivalent to today.** (`--project` override keeps the skill's current behaviour — it just
changes the target slug.)

## Section 4 — Testing, docs & scope

### Tests (`tests/cli/`, Node's `node:test`, fake injected client)

- **`recall.test.js`:** semantic hit → `{kind:'hit'}` with top body fetched + related capped;
  empty → `{kind:'empty'}`; `err.status === 409` → keyword fallback with the disabled note;
  keyword empty → `{kind:'empty', note:'keyword'}`; `--recent` → sorted `{kind:'recent'}`;
  `formatRecall` golden strings for each kind (incl. the ≤800-char trim and `Related:` list).
- **`remember.test.js`:** `remember({ project: 'proj', … })` → `ensureProject('proj')` then create
  with **no `kind`** field in the body; dedup (existing exact title) → `updateMemory` with
  `action:'updated'`; `kind:'synthesized'` is forwarded into the create body **only when the caller
  passes it**; the passed `tags` are de-duplicated. (Caller-side tag/slug composition — `memory`
  tag on `--memory`, memory default for the skill — is exercised by the CLI/wrapper.)
- Existing `tests/cli/{detectProject,format}.test.js` stay green. All via `npm test`; `npm run check`
  must pass (add `cli/lib/recall.js` + `cli/lib/remember.js` to the `check` script's `node --check`
  list).

### Docs

- `.claude/skills/moomora-recall/SKILL.md` and `…/moomora-remember/SKILL.md` — note they now wrap
  the shared `cli/lib/*` modules; the `node …/{recall,remember}.mjs` invocation is unchanged.
- `cli/moomora.js` `HELP` — add the `recall` line and the `remember … [--memory]` flag.
- `docs/agent-memory.md` — mention the human-CLI equivalents (`moomora recall`,
  `moomora remember --memory`) now share the skills' code path.
- `CHANGELOG.md` `[Unreleased]`.
- `CLAUDE.md` / `AGENTS.md` need **no** change — the skill invocation is preserved.

## Success criteria

1. **One code path:** `moomora recall` / `moomora remember` and both skill `.mjs` wrappers call the
   shared `cli/lib/recall.js` / `cli/lib/remember.js`; no duplicated HTTP or recall/remember logic
   remains in the `.mjs` files.
2. `moomora recall <query>` returns cross-project, active-only, distilled output, and `--recent`
   lists recent docs; the skill `recall.mjs` output is unchanged.
3. `moomora remember <title>` writes to the current project (kind `source`); `moomora remember
   --memory` writes to the auto-created global `memory` project (`memory` tag); the skill
   `remember.mjs` writes `synthesized` to the `memory` project, output unchanged.
4. Skills remain zero-install (no global `moomora` needed); `npm test` + `npm run check` stay green.
