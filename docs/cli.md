# Prax CLI (`prax`)

The `prax` CLI is a thin client over the Prax HTTP API. It gives any shell-capable AI
tool (Claude Code, a shell script, a cron job) or a human the ability to pull a bounded,
trust-aware project memory briefing, search and read documents, write new memory, and
verify or supersede it — all without opening a browser.

## Install

Install from the repo with `npm link` to get a global `prax` command:

```bash
cd /path/to/prax
npm ci
npm link
```

Or run directly without installing:

```bash
node cli/prax.js <command> [args]
```

## Project detection

Most commands need to know which project to operate on. The CLI resolves the project in this
precedence order:

1. `--project <slug>` flag (highest priority)
2. `PRAX_PROJECT` environment variable
3. `.prax/project.json` file, searched from the current directory upwards to the root of the
   repository you are in. The file must contain `{"project": "<slug>"}`. Use `prax init` to
   create it.
4. A **git remote match**: the repository's `origin` URL (read from `.git/config`, no git binary
   needed) is matched against each project's registered **Repo** URL, so any checkout or
   worktree of a registered repo lands in the right project without its own marker file.
   URL spelling doesn't matter — `git@github.com:Org/Repo.git` and `https://github.com/org/repo`
   match each other.
5. A `.prax/project.json` **above** the repository root (a workspace folder holding several
   checkouts). It applies only when the repository's remote is not registered, so a folder's
   marker never pulls a registered repository into another project. Outside a repository the
   upward search has no boundary and rung 3 covers it.
6. The folder name (lowest priority, a convenience default): the repository root's name inside a
   repository — never a subfolder's, so running from `repo/docs` does not name a project
   "docs" — else the current directory's. `remember` and `task add` create a project that does
   not exist yet; when the name is only this guess they say so on stderr first.

Run `prax init` once in a project root to write the file so subsequent commands pick up the
project automatically:

```bash
prax init --project homelab
# Wrote .prax/project.json (project: homelab).
```

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PRAX_API_URL` | discovery | Base URL of the Prax server; disables discovery (see [Finding the app](#finding-the-app)) |
| `PRAX_PROJECT` | — | Default project slug (overrides folder-name detection) |
| `PRAX_API_TOKEN` (or `PRAX_TOKEN`) | — | Optional bearer token, forwarded as `Authorization: Bearer <token>`; `PRAX_API_TOKEN` wins when both are set. The server does not require it under the no-auth model |
| `PRAX_AGENT` | auto | Which agent CLI is writing (`claude`, `codex`, …), sent as `x-prax-agent` on agent writes. Detected from the Claude Code and Codex shell environments when unset; `--agent <id>` overrides |
| `PRAX_TRUSTED_VERIFIERS` | — | Comma-separated verifier names whose git-sourced verification `prax mirror import` may honour (after attended confirmation); `--trust-verifier` overrides |
| `PRAX_HARVEST_LOG` | — | `prax harvest --hook`: a file that receives one line per hook run, including failures the hook stays silent about |
| `PRAX_TIMEOUT_MS` | `30000` | How long one request may take before the CLI gives up (the `/readyz` discovery probe gets 2 s). A request that times out is never re-sent; a timed-out write is reported as an unknown outcome to reconcile. Raise it for a slow embedding model. |

The CLI, the skills and the MCP server share one transport; discovery, tokens, timeouts, error
wording and retries are described once, in
[Connecting to the app](agent-memory.md#connecting-to-the-app).

Every request also carries the caller's calendar day — `x-prax-local-date` (this machine's local
date) and `x-prax-time-zone` (its IANA zone), the same headers the web app sends — so
`prax task done` on a recurring task schedules the next occurrence from your today even when Prax
runs in a UTC container. Set `TZ` to change the zone the CLI reports.

## Global flags

`--flag value` and `--flag=value` are equivalent. Use the `=` form for a value that itself
begins with `--` (for example a checklist item `--check="--json output documented"`); with
the spaced form such a value would be read as the next flag, and a value-taking flag given no
value is refused rather than silently dropped. A lone `--` ends the flags: every later word is
an argument.

Every command declares its flags, and nothing typed is silently discarded: an unknown or
mistyped flag (`--tpye` suggests `--type`), a flag that belongs to another command, a boolean
flag given a value (`--json=yes`), and surplus words (an unquoted `remember` title) all exit
non-zero with the command's usage line. Boolean flags (`--json`, `--all`, `--all-projects`,
`--memory`) never take the next word, so `prax search --json postgres backup` searches for both
words. An invalid `--agent` is refused rather than turned into an anonymous write.

Every command accepts:

- `--project <slug>` — the project to operate on (see [Project detection](#project-detection))
- `--url <baseUrl>` — the Prax base URL; same meaning as `PRAX_API_URL` and takes precedence
- `--agent <id>` — the agent id stamped on writes (`claude`, `codex`, …); overrides `PRAX_AGENT`
- `--json` — machine-readable output where the command supports it

### Finding the app

Without `--url` or `PRAX_API_URL` the CLI discovers the app: the desktop app's saved loopback
port (the `webview-port` file under its app-data folder), then `http://127.0.0.1:3000`. The
first that answers a `/readyz` probe is pinned for the whole run and a write is never failed
over to the other candidate. `remember` prints the base URL it wrote to
(`… at http://127.0.0.1:<port>`). An explicit URL disables discovery entirely so a wrong address
fails loudly. The full rules — shared with the skills and the MCP server — are in
[Connecting to the app](agent-memory.md#connecting-to-the-app).

## Commands

### `init [--project <slug>]`

Writes `.prax/project.json` in the current directory so subsequent commands detect the
project automatically.

```bash
prax init --project homelab
```

If `--project` is omitted, `init` resolves the slug as `PRAX_PROJECT` > a **git remote match**
against a project already registered with this repository's URL (so a second checkout adopts
the existing project instead of creating a folder-named duplicate) > an existing
`.prax/project.json` found from the current directory upwards (re-written with the same slug) >
the folder name. Inside a git repository it also registers the remote URL on the project. The
file is safe to commit to the repo.

`init` also makes sure the project has its overview document, its master page (`<Name>
project overview`, a reference tagged `project-card`). A project created in the app or by the
CLI starts with one; for a project that has none, `init` creates it from the bundled starter
with the name, slug and repo URL filled in. It is unverified until a person completes and
verifies it. `prax overview` prints it.

### `context [query...] [--json] [--limit <n>] [--budget <tokens>] [--include-harvested]`

The headline command. Pulls a bounded, trust-aware Markdown briefing assembled from the
project's active documents. With a query the server ranks documents by semantic similarity
(when embeddings are on) and falls back to recency otherwise. Without a query the server
uses recency only.

```bash
prax context "how do we restore postgres"
prax context --limit 20
prax context --json
prax context "restore postgres" --budget 800
```

Flags:

- `--json` — emit the raw JSON context-pack object instead of Markdown
- `--limit <n>` — cap the total number of documents in the pack (server default: 12, max: 50)
- `--budget <tokens>` — bound the printed pack by an estimated token count instead of a
  document count, filled in the [budget fill order](#budgets-and-the-fill-order). The CLI asks
  for up to `--limit` candidates (50 when no limit is given), checks their code citations in
  this checkout and renders the pack itself; sections keep their order and unverified entries
  stay quarantined last. Without `--budget` the output is exactly the server's pack.
- `--include-harvested` — include [unreviewed harvested candidates](#unreviewed-harvested-candidates),
  which the pack leaves out by default (and counts).

The Markdown output groups documents into labelled sections — see [Output shape](#context-output-shape) below.
Both Markdown and JSON name the retrieval mode. Query fallback is explicit (for example,
`recency fallback (semantic-unavailable)`), so a machine never mistakes fallback context for a
semantic match.

### `search <query> [--all] [--include-harvested] [--json]`

Search the project library. Attempts semantic (embedding) search first and falls back to
keyword search only when the server explicitly reports that semantic search is not configured.
The fallback is always labelled; other semantic failures are returned as errors.

```bash
prax search "postgres backup"
prax search "postgres backup" --all
prax search "postgres backup" --json
```

Flags:

- `--all` — also include retired documents (`superseded` / `deprecated` status). Archived
  documents are never returned by search; there is no archive mode.
- `--json` — emit `{ schemaVersion, retrieval, items }`. `retrieval` names the mode
  (`semantic` / `keyword`), whether the result is `degraded`, and a `reason`
  (`semantic-not-configured` for the keyword fallback, `index-incomplete` when some documents have
  no current embedding), plus `index` (`{ total, embedded, pending }`) and `page` for semantic
  results. Semantic search is requested in pages of up to 50; when more results exist the
  envelope says so (`page.hasMore`) rather than silently stopping. `retrieval.hiddenHarvested`
  (present only when non-zero) counts the unreviewed harvested candidates the server left out.
- `--include-harvested` — include [unreviewed harvested candidates](#unreviewed-harvested-candidates).

Each result shows the document title, a trust tag (`[verified]`, `[unverified]`, or
`[superseded]`), the document id, and a short snippet. A degraded result is always labelled in
the human-readable output too.

### `recall [query...] [--project <slug>] [--limit <n>] [--budget <tokens>] [--recent [n] | --since-last-session | --since <iso>] [--include-harvested] [--json]`

Cross-project, active-only recall distilled to one block: the top hit's title, type, trust
label and id, its body trimmed to about 800 characters, then a short `Related:` list. This is
the same implementation the `prax-recall` skill bundles.

```bash
prax recall "how do we restore postgres"
prax recall "how do we restore postgres" --project homelab
prax recall --recent 5
```

- Searches **all** projects by default (agent memories and hand-authored notes alike);
  `--project <slug>` narrows it (`--project memory` for cross-project guidance).
  Project-specific knowledge belongs to its owning project, including agent-written notes.
- Retrieval is by meaning when an embedding backend is configured; on a server that reports
  semantic search as not configured it falls back to keyword search and says so.
- `--recent [n]` lists the newest **active** documents chronologically instead of searching —
  superseded and deprecated documents are excluded. There is no status or `--all` override on
  `recall`; use `search --all` or `get <id>` to look at retired documents.
- Hit lines carry a trust label (`verified` / `unverified`, plus the status when it is not
  `active`), so an unverified lead is visible without a second fetch.
- An incomplete semantic index is disclosed rather than hidden: a hit prints
  `(index incomplete: N of M documents pending — results may be missing)`, and an empty result
  prints `No relevant memory found for: "…" (index incomplete: N of M documents pending — this
  may not be a true miss)`. Only a plain `No relevant memory found` is an honest miss. A server
  that predates coverage reporting is labelled `index coverage unknown`, never assumed complete.
- `--limit <n>` must be a positive integer; `--recent` takes an optional count and no query
  (a query next to it is refused, not ignored).
- [Unreviewed harvested candidates](#unreviewed-harvested-candidates) are left out of the hit,
  `--recent` and delta lists, and the output says how many were hidden;
  `--include-harvested` shows them.
- On a server with semantic search not configured, recall falls back to keyword search, says so,
  and returns the same envelope as `prax search` in that state (`degraded: true`,
  `reason: "semantic-not-configured"`, and `page: { returned, total, hasMore }`). Keyword matches
  are ranked by how often the query's words occur (a title match weighs more) rather than listed
  in project order, and the top hit's citations are checked as on the semantic path.
- When the top hit pins code (`remember --cite`), its citations are checked against the current
  checkout only when it holds the cited repository: the hit's project's registered repo URL
  matches this checkout's `origin`, or (for a project without one, such as `memory`) the commit
  the citation was pinned at exists here. Otherwise the hit says `N citations not checked (…)` —
  outside a checkout, in another repository, at a commit this checkout does not have, with no
  recorded repository, or when the citations could not be read — rather than calling the code
  gone or changed. In a very large file only the lines near the citation
  are searched for a move, and a `changed` note says so.
  A citation is re-found in three steps:
  1. Its line hash at the recorded lines.
  2. The same line hash anywhere nearby, reported as `moved to p:a-b`.
  3. A whitespace-free content hash, so re-indenting or re-wrapping the cited code is not
     reported as a change. When the code also moved, the note says
     `moved to p:a-b (whitespace changed)`.

  When the content really changed, the note says where the enclosing function now is
  (`(loadConfig is now at line 40)`) or that it is gone. A citation pinned before these anchors
  existed is checked by its line hash alone. The first recall that finds its lines unchanged
  fills in the other two anchors with one small write, which is ignored if it fails.
- `--limit <n>` bounds the matches kept in the structured result (default 5). The server answers
  in pages of at most 50 and `recall` pages up to the bound; when matches remain beyond it the
  block starts with `(N of M matches shown — raise --limit for the rest)`. The rendered
  `Related:` list is deliberately short (five entries); `--json` carries every kept match.
- `--json` emits the structured result instead of the rendered block, including `index`,
  `degraded`, `reason` and `page`.
- `--budget <tokens>` switches to the fill-ordered, budgeted block (see
  [Budgets and the fill order](#budgets-and-the-fill-order)): up to `--limit` matches (20 when
  no limit is given), each read in full and with **every** match's citations checked, printed
  verified first, then cited-and-unchanged, then newest. The top of the block may therefore not
  be the highest-ranked match. `--json` adds `budget: { tokens, used, estimate, fill, entries:
  [{ id, tier, form }], omitted }`. `--budget` is refused with `--recent`.

#### The since-last-session delta

```bash
prax recall --since-last-session              # what changed since this agent's last delta
prax recall --since-last-session --project homelab --budget 600
prax recall --since 2026-09-20                # an explicit window; moves no marker
```

Instead of searching, list the memory that changed in a window: documents **created**,
**updated**, **verified**, **superseded**, **deprecated** or **archived** since then, each with
what changed, retired ones as a single line naming their replacement (`superseded by <id>`).

- `--since-last-session` starts where this agent's last `--since-last-session` delta ended. The
  server keeps one marker per agent (the `x-prax-agent` id, from `--agent`, `PRAX_AGENT` or a
  detected agent shell; without one the command is refused) and per scope (all projects, or the
  `--project` given). The first run has no marker: it prints `No earlier delta recorded …;
  baseline set at …` and records the baseline.
- The marker moves only after a `--since-last-session` block has been printed, to the last
  change it contained. Plain recalls, `--recent`, context packs, briefs and `--since` never
  move it, so every change reaches an agent's delta exactly once. When `--budget` leaves changes
  out, the marker stays put and the block says so. A marker that could not be recorded is
  reported on stderr; the next delta then repeats the window.
- `--since <iso>` takes an ISO-8601 date or date-time and reads without touching any marker.
- `--limit <n>` bounds one page (server default 50, max 200); a page lists the oldest changes
  first and says when more remain (the next delta continues from there).
- Unverifications and permanent deletions are not tracked by the delta, and the block says so.
- Several sessions of the same agent share one marker; use `--since` when that matters.
- The delta takes no query and cannot be combined with `--recent`; `--json` returns the route's
  envelope with each item's `tier`, the `budget` decisions and `advance` (whether the marker is
  advanced after output; stderr confirms it).

### `brief <task-id> [--budget <tokens>] [--include-harvested] [--json]`

Everything an agent needs to start a task, in one read-only call:

```bash
prax brief 2234a575-027e-4218-892a-b74d2b5c7f8c
prax brief 2234a575-027e-4218-892a-b74d2b5c7f8c --budget 500 --json
```

- The task header (status, priority, project, planned/due dates, labels, id) and description.
- The checklist, numbered as `prax task check` takes it, with an `n of m done` count.
- The **latest handoff**: the last paragraph of the task's notes (paragraphs are separated by a
  blank line), with a pointer to `prax task show` when there are more.
- **Linked documents** and **related documents** (the app's meaning-based suggestions), one line
  each with the trust chip, type, id, project and trust line. A document whose record could not
  be read prints `[trust unknown]`; only the first 20 linked documents are read. A degraded
  related list says why (`related documents unavailable: semantic-off`). A suggestion is left
  out of Related only when the Memory section actually prints it (in full or as one line); one
  the budget leaves out of Memory stays under Related, so no linked or related document is ever
  dropped from both.
- **Memory**: the top 3 recall matches for the task's title and description (across projects,
  excluding documents already linked), every match's citations checked, in the budget fill
  order, with the same index-coverage and keyword-fallback disclosures as `recall`. In keyword
  mode every word of the task text must match, so this section is often empty there.
- `--budget <tokens>` bounds the memory section only; the task's own text always prints.
- Memory and Related leave out [unreviewed harvested candidates](#unreviewed-harvested-candidates)
  and say how many; `--include-harvested` shows them. Linked documents are always listed.
- `--json` returns `{ schemaVersion, task, project, checklist, handoff: { paragraph,
  paragraphs }, linked, related: { items, underMemory, alsoUnderMemory, degraded, reason,
  hiddenHarvested }, memory }`. `related.underMemory` lists the suggestions that are also memory
  matches; `alsoUnderMemory` counts those the Memory section printed (the rest are in `items`).

### `overview [--project <slug>] [--json]`

Print the project's orientation card in one call. Active documents only, in this order: a
verified document tagged `project-card`; otherwise the newest `project-card`; otherwise one
titled exactly "<Project name> project overview". A caveat line above the card always states
whether it is verified and how it was found, so an agent treats an unverified card as a lead.
Every project created in the app or by the CLI starts with a starter card; with no card (a
project from before v0.41) it says to run `prax init` or use the template (exit 0). `--json` returns
`{ project, found, source, doc }`. `prax context` still leads with the card once it is verified.

```bash
prax overview                  # the checkout's project
prax overview --project homelab
```

- The recall is recorded in the workspace's local recall telemetry (query, agent, mode, the ids
  returned); a paged recall is one query. See [`used`](#used-id---json) and
  [Recall telemetry](#recall-telemetry). `search` and `context` are recorded the same way.

### `get <id> [--json]`

Fetch a single document by UUID.

```bash
prax get c58d3108-4f93-4a50-ac42-0c1d61e61b08
prax get c58d3108-4f93-4a50-ac42-0c1d61e61b08 --json
```

### `remember "<title>" --body <text> [--memory] [--type note|runbook|decision|known-issue|reference|post-mortem|template] [--tag a,b] [--ref <url>] [--cite <path[:start[-end]]>] [--id <uuid>]`

Write a document to project memory. If an **active** document with the same title already exists
in the project it is updated in place; otherwise a new document is created. The write is one
server-side transaction (`POST /api/library/documents/upsert-by-title`), so concurrent callers
cannot create a title twice, and a superseded or deprecated document is never revived — the new
memory becomes a fresh active document. Every write carries a caller-stable operation id, and the
server keeps a receipt for it: a retried or replayed write returns the current document unchanged
instead of reapplying its old body, so a delayed retry can never revert a newer memory. Agent-written
documents (created via this command or the MCP tools) land **UNVERIFIED** by default and record
which agent wrote them (`updatedByAgent`). The confirmation line always names the project and
the instance written to, and the document's actual trust — an update that leaves the title and
body unchanged keeps an earlier verification (`… in homelab — verified by Mark, at
http://127.0.0.1:<port>.`).

```bash
prax remember "Postgres restore runbook" \
  --body "Steps: 1. Stop app. 2. pg_restore …" \
  --project homelab \
  --type runbook \
  --tag postgres,homelab
```

Flags:

- `<title>` — one argument: quote a title that contains spaces. Extra words are refused (an
  unquoted `prax remember Postgres restore runbook` would otherwise have stored "Postgres").
- `--body <text>` — document body (Markdown); required and non-blank, because a same-title
  update replaces the stored body. For text that begins with `--`, write `--body="<text>"`.
  A value-taking flag given without a value (`--tag`, `--type`, `--ref`, `--cite`, `--id`) is
  refused rather than ignored.
- `--project <slug>` — choose the project that owns this knowledge; all projects are available
  to shared recall. Without it, ordinary remember resolves the current project.
- `--memory` — select **`memory`** for guidance useful across projects; the document is also
  tagged `memory`. Without an explicit project, an existing unique title in another project
  is refined there. The remember skill defaults new titles to memory, so pass its `--project`
  explicitly for project-specific findings.
- `--type` — document type: `note` (default), `runbook`, `decision`, `known-issue`, `reference`, or `post-mortem`. On a re-remember (same title), omit it to keep the stored type; pass it to retype.
- `--tag a,b` — a comma-separated tag list that **replaces** the tags of a same-title document in
  the project (with `--id` or a cross-project refine it is merged into them). Without `--tag`, an
  update keeps the stored tags. Repeating `--tag` does not accumulate: the last occurrence wins.
  `--tags` (the prax-remember skill's spelling) is accepted as the same flag; giving both is
  refused.
- `--ref <url>` — attach an external reference (a PR, dashboard, or issue URL) to the memory. Best-effort: a rejected URL warns on stderr but never fails the remember.
- `--cite <path[:start[-end]]>` — pin the code the memory is about, from inside the checkout.
  The path is repository-relative and the lines are 1-based and inclusive; no range means the
  whole file.
  - Three anchors are stored, never the source: a hash of the lines, a whitespace-free hash of
    them, and the name of the enclosing function, class or method.
  - The name comes from a heuristic for JS/TS, Python, Rust, Go, Swift and shell.
  - Re-citing the same range refreshes the pin. Best-effort, like `--ref`.

### `verify <id> --as <human-name>`

Mark a document as verified (human-blessed). Sets `verified: true`, stamps `verifiedAt` and
`verifiedBy`.

```bash
prax verify c58d3108-4f93-4a50-ac42-0c1d61e61b08 --as mark
```

Verification is a trust action that a person must attend. Before any request, the command
checks two things. It refuses when the shell belongs to an agent CLI: `PRAX_AGENT`, `--agent`,
or a marker set by Claude Code (`CLAUDECODE`), Codex (`CODEX_THREAD_ID`, `CODEX_SESSION_ID`),
Copilot CLI (`COPILOT_CLI`, `COPILOT_AGENT_SESSION_ID`) or Antigravity (`ANTIGRAVITY_AGENT`,
`ANTIGRAVITY_CONVERSATION_ID`). It also refuses non-interactive input. There is no override
flag; see [Verification](agent-memory.md#verification) for why. If the refusal is wrong, open a
terminal that no agent CLI started, or use the Library review queue.

The command requires an explicit human name. It prints the full current document for review
and asks for a confirmation phrase specific to that document before it changes trust. It does
not support `--json`. The write includes the reviewed revision and content hash; if the
document changes before confirmation, Prax returns a conflict instead of verifying content
nobody reviewed. To review many documents, use `triage`.

### `triage [--as <human-name>] [--project <slug>]`

An interactive pass over the review queue: agent-written documents that are unverified, not
superseded and not archived. The queue is walked in the same order as the Library's review
walk: grouped by type in registry order (runbooks, notes, decisions, known issues, templates,
references, post-mortems), newest first within each type. Each document shows its title,
type, project, trust, age, writing agent and creation date, then its id and tags. Its
citations are checked against the current checkout as `recall` checks them. The card ends
with a body excerpt (30 lines, 2,400 characters) and up to five similar documents. Then one
key decides:

| Key | Action |
| --- | --- |
| `v` | Verify the revision shown, as `--as` (asked once if absent). A truncated body is printed in full first, and a second `v` verifies it. |
| `e` | Edit the body in `$VISUAL`, `$EDITOR` or `vi`. The saved revision is shown again, so `v` can verify it. |
| `s` | Supersede: retire this document in favour of a replacement. Pick it by its number in the Similar list, by pasting an id, or with search words. Confirm with `y`. |
| `r` | Reject by archiving (confirm with `y`). Restore from Library → Archive. |
| `n` | Skip; the document stays in the queue. |
| `f` / `?` | Show the full body / the key help. |
| `q`, Ctrl-C, Ctrl-D | Quit and print a summary. |

```bash
prax triage --as mark
prax triage --as mark --project homelab
```

- Only a person can run it. The agent-environment and terminal checks that `verify` makes run
  before the first request. Triage also needs raw mode, and it refuses `--json`.
- `--project` narrows the queue to one project. It is never guessed from the checkout: like
  the UI queue, the queue covers every project by default.
- Triage writes as a person, never as an agent. An edit clears the agent attribution, exactly
  as a Library edit does. Every action uses an existing route: verify (bound to the revision
  shown), the receipt-backed document update (`operationId` plus `ifRevision`), supersede and
  archive. When a document changed after it was shown, triage reloads it instead of writing.
  An uncertain outcome is checked by re-reading the document, and triage never re-sends it.
  An edit whose outcome is unknown, or that met a conflict, keeps the draft file and prints
  its path.
- The queue is a snapshot taken at the start. A document verified, superseded, archived or
  deleted elsewhere is skipped and counted as already handled.
- Agents write the text, so it is untrusted: control characters, ANSI escapes and bidi
  overrides are shown as visible placeholders (`^[`, `<U+202E>`) so they cannot hide content.
- Triage is not part of the `prax-recall` / `prax-remember` skill bundles.

### `unverify <id>`

Remove the verified flag from a document, returning it to the unverified/pending state.

```bash
prax unverify c58d3108-4f93-4a50-ac42-0c1d61e61b08
```

### `supersede <oldId> --with <newId>`

Retire a document by marking it `superseded` and recording a `supersedes` link from the
replacement document to the old one. The old document remains readable but is excluded from
active retrieval.

```bash
prax supersede c58d3108-4f93-4a50-ac42-0c1d61e61b08 \
  --with  d72e4219-5a04-4b61-bd53-1e2e72f7c219
```

### `move <id> --to <project-slug> [--json]`

Refile one document or one task under another project: the command-line form of the Inbox's
"refile with its owner", for an agent that `remember`ed a note under the wrong project (a
re-`remember` refines a title where it already lives and never moves it). The id is tried as a
document first, then as a task. The target project must already exist (a typo never creates
one); only an active document moves, so a superseded or archived one keeps its place in
history; a record already under the target is reported rather than rewritten. The write is
stamped as an agent write like every other CLI update.

```bash
prax move c58d3108-4f93-4a50-ac42-0c1d61e61b08 --to homelab
# Moved document "Proxmox backup runbook" (c58d3108-…) from memory to homelab.
```

`--json` prints `{ kind, id, title, from, to, record }`, where `record` is the updated document
or task.

### `archive <id>`, `restore <id>`, `delete <id> --yes`

The lifecycle of one document or one task (design note "Prax design: agents archive, restore and delete" in the Prax Library); the id is
tried as a document first, then as a task. `archive` is reversible: the document leaves recall,
context packs and the mirror (the task leaves every open list) until `restore` brings it back.
`delete` is permanent and guarded three ways: the record must already be archived (two deliberate
steps, never one), a verified document is never deleted by an agent, archived or not, and `--yes`
must be given; without it the command names what would go and exits 1. There is no prompt. Every
request carries the agent origin and id, and the document's `updatedBy` / `updatedByAgent` say who
archived or restored it. Use `supersede` for memory that was replaced; use `archive` for memory
that should not have been written; stop at archive when unsure.

```bash
prax archive 7c1e… 
# Archived document "Wrong note about the proxy" (7c1e…). Restore it with `prax restore 7c1e…`.
prax delete 7c1e… --yes
# Permanently deleted document "Wrong note about the proxy" (7c1e…).
```

### `task <add|list|show|update|done|check|uncheck>`

Tasks from any shell, for handoff notes, acceptance checklists and agent work orders. The
project resolves exactly as it does for `remember`; every write is stamped as an agent write
with the detected agent id, so the task chronicle says who changed it: each activity event
carries `actor: "agent"` and `actorAgent` (for example `codex`). `add` records `Task created`;
title, description, notes and priority edits, status changes and checklist items checked,
unchecked, added or removed are recorded too (content is never copied into the chronicle). The
command binds to one instance before writing, like `remember`.

```bash
prax task add "Rotate the tunnel token" --priority high --due 2026-10-01 --label ops,homelab \
  --description "Token expires on the 3rd." --check "New token issued" --check "Old token revoked"
prax task list                       # open tasks in the current project (--all adds completed)
prax task list --status in-progress --all-projects
prax task show 2234a575-027e-4218-892a-b74d2b5c7f8c
prax task update 2234a575-… --status in-progress --append-notes "Branch feat/x, tests green, next: docs"
prax task check 2234a575-… 2         # tick the second checklist item (or name it by label)
prax task done 2234a575-…
```

- `add <title>` — flags: `--priority high|medium|low` (default medium), `--status` (default
  `planned`; values `high-priority`, `in-progress`, `planned`, `completed`, `notes`),
  `--due YYYY-MM-DD`, `--planned YYYY-MM-DD`, `--label a,b`, `--description`, `--notes`, and a
  repeatable `--check "<item>"` for acceptance items. The task and its checklist commit in one
  transaction through the exact-once import route with a fresh request id, so a lost response
  can be retried without creating a second task: the reply says `Already added` when the server
  replayed a recorded result. Append mode is deliberate: an explicit add is never skipped because
  an older task shares the title.
- `list` — open (not completed) tasks in the resolved project, one line each with status,
  priority, plan/due dates, labels and id. `--all` includes completed tasks, `--status <s>`
  filters to one status (`--status completed` lists the completed ones), `--query <text>` matches
  title or description, `--all-projects` lists every project with a `#project` suffix. `--json`
  returns the same selection as an array. Archived tasks are never listed.
- `show <id>` — the task, its numbered checklist and notes. `--json` adds a `checklist` array.
- `update <id>` — patches `--title`, `--status`, `--priority`, `--due`, `--planned` (an empty
  value clears a date), `--label`, `--description`, `--notes`, or `--append-notes <text>`, which
  reads the current notes and appends a paragraph. The update route carries no operation
  receipt, so the command sends **one** request and never retries on its own; an uncertain
  transport outcome is reported as unknown and you should inspect the task before retrying.
  `--append-notes` has a small read-then-write window; two agents appending at the same
  moment can lose one paragraph.
- `done <id>` — sets `completed`; a recurring task reports the next occurrence it spawned.
- `check <id> <n|label>` / `uncheck <id> <n|label>` — set one checklist item by its 1-based
  number or exact (case-insensitive) label. Setting a value is idempotent, so these and `done`
  retry only when no request provably reached the server.

### `mirror [--out <dir>] [--check] [--force]`, `mirror import [dir]`, `mirror --agents-block`

A one-way git mirror of the resolved project's Library, and a compiled block of its verified
decisions for the workspace instruction file. Prax stays the single source of truth: the mirror
never writes to it, and an import never writes over an existing document. Design:
the spec "Prax design: Library git mirror" in the Prax Library.

```bash
prax mirror                          # writes .prax/library/ at the repository root
prax mirror --check                  # exit 1 when the mirror is stale (CI)
prax mirror import .prax/library --project homelab --trust-verifier "Mark"
prax mirror --agents-block           # compile verified decisions into AGENTS.md
prax mirror --agents-block --remove  # take the block out again
```

- **`mirror`** writes each document as Markdown v3 (the Library export format, byte for byte)
  into `--out <dir>`, default `.prax/library/` at the repository root (the current directory
  outside a checkout). Active documents sit at the folder root, superseded and deprecated ones
  under `retired/`; `README.md` lists them and `index.json` is the manifest. The same Library
  state gives identical bytes, and an unchanged file is not rewritten. A title change renames
  the file, retiring moves it, and archiving or deleting removes it. Only files the manifest
  lists are ever deleted; other `.md` files are reported as unmanaged. A non-empty folder without
  a manifest is refused unless `--force`. Receipts, revisions, run history, embeddings, tasks and
  archived documents are not mirrored. Commit the folder with the change that motivated it; do
  not edit the files there.
- **`mirror import [dir]`** creates the folder's **active** documents in the resolved project
  (created when new) through the Markdown-import route, keyed by each document's own id, so a
  re-run creates nothing twice. A document that already exists keeps the library's copy (reported
  as present, or skipped when its content differs); one permanently deleted here is not
  recreated; retired files are skipped because links do not round-trip. Title, body, type, tags,
  kind, source file name, external references and code citations are imported; timestamps and
  author provenance are not (the import is an agent write).
- **Verification from git is a claim.** Every document lands unverified unless its file says
  `verified: true` with a `verified_by` name in your trusted list (`--trust-verifier a,b` or
  `PRAX_TRUSTED_VERIFIERS`; exact names, never read from the repository), its body still hashes
  to its `content_hash`, and you confirm in an attended terminal by typing `VERIFY <n>` after the
  list is shown. The verification is recorded as the claimed verifier. Anything else is reported
  under "Left unverified" with the reason.
- **`mirror --agents-block`** compiles the project's active, **verified** documents of type
  `decision`, plus verified documents of any type tagged `convention`, into a managed block
  between `<!-- prax-library:start -->` and `<!-- prax-library:end -->` in `--file <path>`
  (default: the repository's `AGENTS.md`, else `CLAUDE.md`, else a new `AGENTS.md`). `--type a,b`
  and `--tag a,b` replace the selection. Unverified documents are never compiled. The block is
  bounded by `--max-chars` (default 8000, minimum 1000); each body is capped at 1500 characters
  and anything cut or omitted says so and how to read it. A symlinked file is edited at its
  target, surrounding text is kept, an unchanged block is not rewritten, and malformed markers
  refuse the edit. `--print` writes the block to stdout instead; `--remove` deletes it.

### `check [--diff <range> | --files <a,b,…>] [--project <slug>] [--comment] [--strict] [--json]`

The cite-drift gate: find the memories whose cited code a change broke, so they are refreshed
or superseded in the same merge request instead of rotting. Read-only.

```bash
prax check --diff origin/main...HEAD         # a branch against where it forked
prax check --diff HEAD                       # uncommitted edits
prax check --files src/config.js,src/db.js   # whole files, against the working tree
git diff --name-only origin/main... | prax check
```

- **Input**, exactly one:
  - `--diff <range>`: `A...B` compares the merge base of A and B with B, `A..B` compares A with
    B, and `A` compares A with the working tree.
  - `--files`: a comma- or newline-separated list of repository-relative paths.
  - Paths piped on stdin.
- **Which memories**: live, active documents with a citation on a changed path, including the
  old path of a rename or deletion, from every project.
  - A citation is only checked when it belongs to this repository, by the same rule recall
    uses. Others are counted as `not checked`, never reported as drift.
  - `--project <slug>` narrows the lookup to one project and vouches for its citations.
- **With `--diff`**, a citation counts when the change touches its lines, located in the base
  version. For a whole-file citation, or a renamed or deleted file, touching the file is
  enough. Each touched citation gets one verdict:
  - `DRIFT`: it held before the change and does not after. The cited code changed, it is gone,
    or its file was renamed (the stored path is now wrong). **Fails.**
  - `STALE`: it was already broken before this change. Reported, never failing: one old rotten
    memory must not block every change to its file.
  - `HOLDS`: unchanged, moved, or changed only in whitespace.
- **With `--files` or stdin** there is no base, so each citation on a listed file is `DRIFT` or
  `HOLDS` against the working tree.
- **Exit codes**, following grep and diff:
  - `0`: no drift, or skipped because Prax was unreachable.
  - `1`: drift.
  - `2`: the check could not run, for example a usage error, an unknown revision, outside a
    checkout, or an API error.
- **Fail-open**: when Prax cannot be reached (refused, DNS or timeout) or predates this command,
  the check prints `prax check: skipped — Prax is not reachable at <url>; cited memories were
  not checked` on stderr and exits `0`.
  - Prax is local-first and usually runs on someone's machine, so a gate that failed whenever
    that machine slept would soon be switched off.
  - `--strict` makes it exit `2` instead, for a Prax that CI can always reach.
  - Other API errors always exit `2`.
  - `PRAX_TIMEOUT_MS` bounds how long an unreachable host can stall the job.
  - A change that touches no files never contacts Prax.
- **Output**: the text summary by default, `--json` for the structured report, or `--comment`
  for a merge-request comment body in Markdown.
  - The comment starts with `<!-- prax-check -->` so a bot can update its own comment.
  - It has a table of drifted memories (title, project, trust, citation, what happened,
    including where the enclosing function is now), then stale and still-holding sections, then
    how to fix them.

#### GitHub Actions example

Not part of Prax's own pipeline, whose runners cannot reach a developer's desktop app. For a
project whose runner can reach a Prax instance:

```yaml
prax-check:
  if: github.event_name == 'pull_request'
  runs-on: ubuntu-latest
  permissions:
    contents: read
    pull-requests: write            # to post the comment
  env:
    PRAX_API_URL: "https://prax.internal.example:3000"
    PRAX_TIMEOUT_MS: "5000"
    PRAX_REF: "main"                # better: the release tag that matches the instance
    # PRAX_API_TOKEN: ${{ secrets.PRAX_API_TOKEN }}   # when the instance requires one
  steps:
    - uses: actions/checkout@v7
      with:
        fetch-depth: 0              # the merge base must be in the clone
    - uses: actions/setup-node@v7
      with:
        node-version: 24
    # the CLI needs Node only: no npm install
    - run: git clone --quiet --depth 1 --branch "$PRAX_REF" https://github.com/<owner>/prax.git /tmp/prax
    - id: check
      shell: bash
      run: |
        set +e
        node /tmp/prax/cli/prax.js check --diff "${{ github.event.pull_request.base.sha }}..${{ github.event.pull_request.head.sha }}" --comment > prax-check.md
        echo "status=$?" >> "$GITHUB_OUTPUT"
        cat prax-check.md
    # Post the comment only when there is something to act on.
    - if: steps.check.outputs.status == '1'
      env:
        GH_TOKEN: ${{ github.token }}
      run: gh pr comment "${{ github.event.pull_request.number }}" --body-file prax-check.md
    - if: always()
      uses: actions/upload-artifact@v7
      with:
        name: prax-check
        path: prax-check.md
    - run: exit "${{ steps.check.outputs.status }}"
```

Exit `2` fails the job as well. To report a broken gate without blocking the merge, mark the
final step `continue-on-error: true` and read the status from the uploaded report instead.

### `harvest [--transcript <file>] [--session <id>] [--dry-run] [--budget-ms <n>] [--json]`

Harvests the memories an agent **proposed** in a session and files each one once, as an
unverified candidate in the **Inbox**, for a person to review. The design, and what each vendor's
hook contract is known to provide, are in
the spec "Prax design: session harvesting" in the Prax Library.

An agent proposes a memory in its own reply, with either:

- a line that starts with `Remember:` (after an optional bullet, optionally bold) and holds one
  self-contained finding. The title is its first sentence; or
- a fenced `prax-remember` block: `title:` (required), optional `type:`, `project:` (the
  suggested owner) and `tags:` lines, a blank line, then the body.

````markdown
Remember: Release tags are cut from main only. A tag on a feature branch breaks the updater feed.

```prax-remember
title: Harvest hooks run detached
type: decision
project: prax
tags: agent-memory

The hook hands its input to a detached worker, so the agent never waits on Prax.
```
````

Only the agent's own messages are read. User messages, tool calls and tool results are not
read, so text a fetched page plants cannot become a candidate. Markers inside other code fences
are examples and are ignored. A candidate that looks like it holds a credential is skipped. So
is one over 8,000 characters, and a run takes at most 20.

```bash
prax harvest --transcript ~/.claude/projects/<dir>/<session>.jsonl   # a saved session
prax harvest --transcript notes.md --session review-2026-09-23          # any text file
prax harvest --transcript session.jsonl --dry-run                       # list, send nothing
```

- **Input:** `--transcript <file>` reads a Claude Code, Codex (rollout) or Copilot CLI
  (`events.jsonl`) transcript, or plain text. Without it, stdin is read: a hook's JSON (the
  transcript it names plus `last_assistant_message`) or a transcript itself.
- **Each candidate** becomes a `note` (or the block's valid `type`) in `inbox`, tagged
  `harvested` plus the block's tags, `kind: synthesized`, stamped as an agent write, unverified.
  The body starts with the proposal. A *Harvest details* section follows, with the suggested
  project, the source session and transcript, and up to three similar active memories from
  recall.
- **Exactly once.** The document id and the operation id are derived from the session id and a
  hash of the candidate, and the create goes through the receipt-backed route. A later run of
  the same session reports `already` instead of writing, including after a person deleted the
  candidate. A candidate whose title matches an active document in any project is `skipped`, and
  the output names that document. It is never written over.
- **`--budget-ms <n>`** (default 20000) bounds the whole run. A run that exceeds it stops, reports
  what it did and exits 1. `--dry-run` prints the candidates and their derived ids and makes no
  request. `--session <id>` names the session when the input does not carry one.

`--hook claude|codex|copilot` is the entry point that `skills/install.sh --hooks` installs. It
reads the hook JSON from stdin and hands it to a detached background worker through a private
temporary file. It then returns at once, printing nothing and always exiting 0, even when Prax
is down or the input is malformed, so a hook never blocks or fails the agent. `--foreground`
runs the worker inline, for debugging. Set `PRAX_HARVEST_LOG` to get one line per run.

### `session-start --hook claude|codex|copilot [--budget <tokens>]`

The SessionStart hook that `skills/install.sh --hooks` installs
(design note "Prax design: session-start recall" in the Prax Library). It reads the vendor's hook JSON on stdin (bounded
in size and time), finds the project from the hook's `cwd` (marker file, then the registered
repo URL, then the folder name), and prints one block of additional context in the envelope the
vendor consumes: `prax context --budget <tokens>` for that project (default 1200), the agent's
`recall --since-last-session` (400 tokens; the marker advances only when the whole delta was
printed), and the two commands that close the loop (`prax used <id>`, `prax remember`). Claude
Code and Codex read `hookSpecificOutput.additionalContext`; Copilot CLI reads a top-level
`additionalContext`. The agent id is the vendor name unless `--agent` or `PRAX_AGENT` says
otherwise.

It fails open, always: Prax not running, no project, an older Prax without the delta, or the
deadline (`PRAX_SESSION_START_MS`, default 8000 ms) and it prints nothing and exits 0, so a
session never waits on memory. Each request has a 5 s timeout. It writes nothing but the delta
marker.

### `used <id> [--json]`

Report that you acted on a recalled memory, after recall or search returned it and you relied on
it. It records a used signal (`POST /api/library/telemetry/used`) with the agent id. The
librarian counts a question as answered when one of its hits gets a used signal within 24 hours;
questions that got no hits, or hits nobody used, become the knowledge-gaps queue in Library
health. Retried only when no request reached the server, so one use is never counted twice.

```bash
prax recall "how do we restore postgres"
# … follow the runbook it returned …
prax used c58d3108-4f93-4a50-ac42-0c1d61e61b08
```

### `doctor [--project <slug>] [--json]`

A CI-friendly summary of knowledge-base health from the read-only librarian report
(`GET /api/library/librarian/report`): index coverage, stale derivations, empty documents,
near-duplicate clusters without a proposal, open proposals, unverified documents, knowledge
gaps, never-recalled memories, active projects without an overview document and the
telemetry counts. It never writes anything; filing
proposals is the **Run librarian** action in Library health.

| Exit | Meaning |
|------|---------|
| `0` | Every check is `ok` or `info` |
| `2` | A `warn` check: incomplete embedding index, stale derivations, empty documents, duplicate clusters with no proposal, or a registered repo URL that no longer matches this checkout's origin |
| `1` | The report could not be fetched (Prax not reachable, HTTP error) |

The whole workspace is checked unless `--project` names one. `--json` prints the report with
its `checks` array (`{ id, level, count, message }`) and still sets the exit code.

One check is computed in the CLI, because only the CLI sees the checkout: `repo-url` warns
when the project detected for the current directory (or named by `--project`) is registered to
a repo URL that does not match this checkout's `origin`, which silently breaks remote-based
project detection and makes every `--cite` claim report "cited in another repository". The
message names both URLs and the fix (`prax init` after the move). It is `info` when the project
has no registered URL and the origin matches no project, and absent outside a repository.

### `telemetry <status|clear> [--json]`

`status` (the default) shows whether recall telemetry is on, how many queries and used signals
are stored, and the bounds. `clear` deletes every recorded query, hit and used signal in the
workspace (`DELETE /api/library/telemetry`).

### `backup [status | list [--limit <n>] | restore <commit> --yes] [--json]`

The [git backup](backup-restore.md#3-git-backup-to-github-or-gitlab) from a terminal. The
repository, branch and credentials are configured in Settings ▸ Data & admin ▸ Git backup; this
command runs what Settings configured, for scripts and cron. `prax backup` pushes a backup now and
reports the commit, or says nothing changed. `status` prints the repository, the last run, the
daily schedule and any staged restore. `list` prints the commits on the backup branch, newest
first. `restore <commit> --yes` stages that backup to replace the whole workspace the next time
Prax starts (the current database is kept in a rollback folder beside it); without `--yes` it
explains and exits 1. An operator action: no agent origin is recorded.

```bash
prax backup
# Backed up 21.3 MB as commit 4f2a9c1e0b77 on main at git@gitlab.com:you/prax-backup.git.
prax backup list --limit 5
prax backup restore 4f2a9c1e0b77 --yes
# Restore staged from commit 4f2a9c1e0b77 (backup of 2026-10-25 01:00 UTC, 21.3 MB). Quit and start Prax again to apply it; …
```

## Unreviewed harvested candidates

A [harvested](#harvest---transcript-file---session-id---dry-run---budget-ms-n---json) proposal
is an unverified Inbox document tagged `harvested`. It is not memory until a person reviews it,
so agent retrieval leaves it out by default: `recall` (including `--recent` and the
`--since-last-session` / `--since` delta), `search`, `context` (with or without `--budget`),
`brief` (memory and related sections), the prax-recall skill, the MCP search and context tools,
and Ask. Every result that hid one says so, for example
`(1 unreviewed harvested candidate hidden until a person triages it; --include-harvested to show)`.
`--include-harvested` on `recall`, `search`, `context` and `brief` (and on the recall skill)
shows them. A candidate a person verifies, or refiles without the `harvested` tag, is recalled
like any other memory; the delta reports it then (`verified` or `updated`). Plain listings
(`GET /api/library/documents` without `q`), triage and the web UI's Library, Inbox and search
are not filtered.

## Recall telemetry

Prax keeps a local record of the retrievals agent clients make so the librarian can list
unanswered questions, sort the review queue by what agents rely on and flag memories nobody
recalls. It is recorded only for requests that name their source (`prax recall`, `search`,
`context`, the skills and the MCP server do; the web UI does not), after the response is sent,
so it never slows or fails a recall. It stays in the workspace's database: it is never sent
anywhere and never included in the portable Library export, but a full workspace backup (the
whole database) carries it. Rows are kept 90 days, at most 20,000 queries and 20,000 used
signals. `prax telemetry clear` deletes it; `PRAX_RECALL_TELEMETRY=off` in the server's
environment stops recording. Before a query is stored, credential-shaped spans are replaced by
`[redacted]`: private-key blocks, AWS access key ids, GitHub, GitLab, Slack, OpenAI and
Anthropic tokens, JWTs, `Bearer`/`Basic` values, `password=`/`secret=`/`token=`/`api_key=`-style
assignments and passwords in URLs. The rest of the query is kept, and the grouping key is
computed from the redacted text. Redaction catches known shapes only, so still keep secrets out
of queries.

## Trust model

Documents carry two trust/workflow fields:

- **`verified`** (boolean) — whether a human has blessed this document. Agent writes (CLI
  `remember`, MCP `create_document` / `update_document`) land unverified by default. A human
  runs `triage` or the attended `verify <id> --as <name>` flow, or uses the Library UI, to
  bless them. Both commands refuse in an agent CLI's shell and without a terminal.
- **`status`** (`active` | `superseded` | `deprecated`) — lifecycle state. `supersede <oldId>
  --with <newId>` sets the old document's status to `superseded`. Deprecated is a manual
  state for documents that are stale but have no direct replacement.

Retrieval (`context`, `search`) is **active-only** by default. The `context` command
quarantines unverified documents in a clearly-labelled section so an AI tool can see them
but treat them with appropriate caution. Passing `--all` to `search` disables the active-only
filter.

**Important:** under the no-auth / trusted-network model, `verified` is a **workflow signal,
not access control**. Anyone on the network who can reach the Prax server can call `verify`
or `unverify`. It is useful for distinguishing agent-written memory that has been reviewed by a
human from memory that hasn't — not for preventing unauthorized writes. The agent-environment
guard on `verify` and `triage` stops an agent from verifying its own memory by reflex. It does
not stop a caller that goes around the CLI. See
the Prax Library document "Prax security policy and model" for the security model.

## `context` output shape

Below is an example of the Markdown emitted by `prax context "restore postgres"`. The
structure is: a top-level header naming the project, an optional query line, then one or more
`##` sections. Unverified documents always appear last under a clearly-labelled warning header;
with a small `--limit` they may be dropped entirely once the budget is spent on
higher-priority sections.

```markdown
# Context: Homelab (active)

_Query: restore postgres_

## Relevant memory

### CloudNativePG overview

This cluster runs PostgreSQL 18 on CloudNativePG …

## Active runbooks

### Postgres restore runbook
(runbook · c58d3108-4f93-4a50-ac42-0c1d61e61b08)

## ⚠ Unverified — pending human review

### Draft: K8s network policy — _unverified_

Early notes, not yet reviewed …
```

Sections that have no documents are omitted entirely. A "Project overview" section is
prepended when the project has any verified document tagged `project-card`.

## Budgets and the fill order

`recall --budget`, `context --budget`, the delta and `brief`'s memory section share one fill
order and one compaction (`cli/lib/budget.js`). The design is in
the spec "Prax design: budgeted context and brief" in the Prax Library.

**Estimate.** `tokens ≈ ceil(characters / 4)` over the exact text printed. It is a heuristic,
not a tokenizer: prose runs close to it, code and non-Latin text run above it. The budget line
reports it: `(budget: ~412 of 500 tokens, chars/4 · 4 of 7 shown · fill: verified →
cited-unchanged → recent)`.

**Fill order.** Three tiers, deterministic:

1. **verified** — active documents a person verified, in retrieval order;
2. **cited-and-unchanged** — unverified documents that pin code (`remember --cite`) whose every
   citation was checked in this checkout and still matches at its pinned lines, in retrieval
   order. A moved, changed, missing or unchecked citation does not qualify;
3. **recent** — everything else, newest first (an undated document sorts last).

**Compaction.** Entries print in full (a heading line with the trust chip and trust line, then
an excerpt: 800 characters for the first entry, 240 for the rest) while they fit. From the first
entry that does not, every later entry prints compact — one line, `- [chip] Title (type · id)
— first line of the body` — and the first compact line that does not fit ends the fill. No model
summarises anything, so every entry starts on a line with its trust chip (`[verified]`,
`[unverified]`, `[superseded]`, `[deprecated]`, `[archived]`).

**Never dropped.** The retrieval mode and fallback, index coverage (`index incomplete …`,
`index coverage unknown`), the bound note and the budget line always print, even when they alone
exceed the budget (the budget line then says so). What the budget left out is counted:
`_3 more left out by the budget (2 unverified) — raise --budget, or prax get <id>._`
