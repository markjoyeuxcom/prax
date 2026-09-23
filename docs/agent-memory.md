# Prax as agent memory

Prax can serve as a persistent, semantically-recalled **long-term memory** for AI agents —
Claude Code, Codex CLI, or any tool that can run a shell command. The library stores durable
knowledge; semantic search retrieves it by meaning; provenance and links keep it groomed. This
document describes the convention; the `prax-recall` and `prax-remember` skills in
[`skills/`](../skills/README.md) implement it.

## What belongs in memory

Memory is for **durable** knowledge that outlives a single session:

- **Facts / knowledge** — "the homelab Postgres runs CloudNativePG", a config value, an endpoint.
- **Decisions / conventions** — "we embed with `qwen3-embedding:0.6b`", "releases are squash-merged".
- **Procedures / runbooks** — reusable how-tos.

These map onto first-class document types — pass `--type` when remembering so recall can filter
by shape later: `note` (default), `runbook` (procedures), `decision` (a choice made and why),
`known-issue` (symptom + workaround), `reference` (lookup material), `post-mortem`. Re-remembering
an existing title may retype it (a note can graduate to a decision).

File knowledge by its subject. Project-specific architecture, decisions, runbooks and findings
belong in the owning project's Library, whether written by a person or an agent. Reserve the
**memory** project for preferences, conventions and procedures useful across projects.
Recall searches all projects by default, so project ownership does not restrict agent sharing.

Transient state (a half-finished edit, tests just run, the next action) belongs in the relevant
task's notes/checklist or linked handoff (`prax task update <id> --append-notes "…"`,
`prax task check <id> <n>`; see [the CLI guide](cli.md#task-addlistshowupdatedonecheckuncheck)). Update it before handing over, close the task when
acceptance checks pass, and retire temporary handoffs. Never persist secrets. For this
repository's concrete workflow, see [Working on Prax](working-on-prax.md).

## The loop

```
retrieve  →  work  →  persist  →  supersede  →  report use
```

1. **Retrieve-on-start** — read the repository's startup guide and project overview when
   available, then run the recall skill with "what I'm about to
   do". Retrieval is by meaning, so a paraphrase finds the right note even with different words;
   an honest "no relevant memory" means start fresh. For a "what did I note recently" intent (a
   list, not a similarity search) use `--recent`.
2. **Work** — using the recalled context as grounding (your documented procedures, not guesses).
3. **Persist-on-learn** — when something durable is learned or decided, run the remember skill
   with a title, body and `--project <slug>` for its owner (`--project prax` here). Use
   `--project memory` for knowledge useful across projects. Skill writes are stamped
   `updatedBy: agent`, `kind: synthesized`, and the agent id. When the memory is *about* something that lives
   elsewhere — a PR, a dashboard, an upstream issue — add `--ref <url>` to attach an external
   reference instead of copying the content in. When it is *about* specific code, add
   `--cite <path[:start[-end]]>` from inside the checkout: only a hash of those lines is stored,
   and a later recall from a checkout of the same repository says whether they changed, moved,
   or vanished. A recall anywhere else — outside a checkout, in another repository, or when the
   citations cannot be read — says `not checked` rather than implying the lines still match.
   A citation keeps three anchors: the line hash, a whitespace-free content hash (re-indenting
   or re-wrapping is not a change), and the enclosing function's name (so a changed citation
   says where that function is now). Run `prax check --diff origin/main...HEAD` before merging,
   or in the merge-request pipeline: it fails when the change breaks a memory's citation, so the
   memory is refreshed or superseded in the same change (see `docs/cli.md`).
   Recall is cross-project and says where each hit lives (`in homelab`). A remember run
   without `--project` follows that: a same-title document that exists only in another
   project is refined there, never copied into `memory`; several candidates are refused by
   name; `--id <uuid>` targets one document outright.
4. **Supersede** — re-remembering an existing title updates it in place (no duplicate). When one
   memory replaces another distinct one, run `prax supersede <oldId> --with <newId>` — it records
   the `supersedes` link and retires the old document from default retrieval. A retired title is
   never revived by a later remember: that becomes a new active document.
5. **Report use** — when a recalled memory actually informed the work, run `prax used <id>`.
   That is the signal the librarian uses to tell an answered question from one that only
   returned hits (see [The librarian](#the-librarian)).

## The librarian

The librarian keeps the Library consolidated without ever acting on its own
([design](superpowers/specs/2026-09-23-librarian-design.md)).

- **Recall telemetry.** Recall, search and context requests from agent clients (the CLI, the
  skills, the MCP server; they send `x-prax-query-source`) are recorded after the response:
  query text with credential-shaped spans replaced by `[redacted]` (tokens, keys, bearer values,
  `password=…`), agent id, mode and the ids returned. `prax used <id>` records a used signal. The
  web UI's searches are not recorded. Telemetry is local only: it never leaves the workspace's
  database and is not in the portable Library export, though a full workspace backup carries it.
  It is kept 90 days (20,000 rows per table at most), `prax telemetry clear` deletes it, and
  `PRAX_RECALL_TELEMETRY=off` on the server stops recording.
- **Knowledge gaps.** Questions that returned no hits, or hits nobody reported using within a
  day, are listed in Library health (most asked first). Answer one by remembering the missing
  knowledge.
- **Consolidation proposals.** **Run librarian** in Library health (or the daily schedule,
  off by default) clusters near-duplicate documents in each project: by embedding cosine when
  semantic search is on, by title and body shingles otherwise. Each new cluster becomes one
  unverified proposal document (`kind: synthesized`, written by `librarian`) with a draft
  canonical body, its sources and the `supersedes` links it proposes. It lands in the review
  queue. Nothing is merged or retired until a person verifies the proposal and approves it;
  agents cannot approve or dismiss proposals.
- **Recall frequency.** The review queue can sort by how often agents' recalls returned each
  document (**Sort: Most recalled**), as can Library health's Needs review list. Agent memories
  not recalled in 30 days of telemetry are flagged as prune candidates, never removed.
- **`prax doctor`** prints the same checks for CI, exiting 2 on a warning.
- Contradiction detection stays in the on-demand AI review; nothing here runs on the remember
  path.

## How a remember is written

`prax-remember` and `prax remember` call `POST /api/library/documents/upsert-by-title`, which
finds the **active** document with that exact title in the project and updates it, or creates one,
inside a single database transaction. That closes two holes the older read-then-write client
path had: two agents remembering the same title at the same moment could both create it, and a
superseded memory could be silently overwritten by a fresh one that active recall then never
surfaced. Older servers without the endpoint get the read-then-write path with the same
active-only rule. Every write carries a caller-stable operation `id`; inside the same transaction
the server checks its receipts for that id before it looks at the title, and records a receipt
after the write — for updates as well as creates. Replaying a
completed operation returns the current document unchanged (`200`, `replayed: true`), so a
delayed retry can never revert a newer memory; reusing the id with different content is `409`;
a replay whose document has since been permanently deleted is `410` rather than a silent
re-create.

Direct `--id` updates and unique-title refinements in another project use the
receipt-backed `POST /api/library/documents/:id/update` endpoint instead. They
carry an `operationId` and the content revision read by remember. A lost response
replays the committed operation without applying its body over a newer edit.
On servers without that endpoint, the fallback PATCH is attempted once; an
uncertain response is reported as an unknown outcome, requiring reconciliation.
See [the update retry contract](contract.md#document-update-retries).

The client binds to one Prax instance for the whole run and never fails a write over to another
(see [Connecting to the app](#connecting-to-the-app)); the confirmation line names the base URL
it wrote to.

## Session harvesting: proposals into the Inbox

Some findings might be durable, but the agent is not sure enough to run `remember` in the
middle of other work. For those, the agent writes a **proposal** in its own reply: a line that
starts with `Remember:`, or a fenced `prax-remember` block with a `title:` line, optional
`type:`, `project:` and `tags:` lines, a blank line and the body. A hook that
`skills/install.sh --hooks` installs runs `prax harvest --hook <vendor>` when the agent stops.
It files each new proposal once as an **unverified candidate in the Inbox**, tagged `harvested`,
`kind: synthesized` and stamped with the agent. The candidate body names the source session, a
suggested owning project, and similar active memories that recall found, so a person can accept
it, refile it with its owner, or archive it during Inbox triage.

- **Vendors.** Claude Code (`Stop`) and Codex (`Stop`, which Codex runs only after you
  trust it with `/hooks`) pass the transcript path and the final assistant message. Copilot CLI
  (`agentStop`) passes the transcript path. Antigravity has no hooks; run
  `prax harvest --transcript <file>` on an exported conversation instead. The spec records what
  was verified live and what is taken from vendor documentation:
  [session harvesting](superpowers/specs/2026-09-23-session-harvesting-design.md).
- **Deterministic.** Only the agent's own messages are read. User messages, tool calls and tool
  results never are, so a page an agent fetched cannot plant a candidate. No model summarises
  the session. Fenced examples, credential-shaped text and oversized bodies are skipped.
- **Exactly once.** The document id and the operation id are derived from the session and the
  candidate. A later turn of the same session, or a retry, creates nothing new. Neither does a
  candidate a person deleted, because the server's receipt outlives it. A title that already
  exists as an active document anywhere is skipped, never overwritten.
- **Never in the agent's way.** The hook hands its input to a detached worker and exits 0 at
  once, with no output, whether or not Prax is running. The worker works within a 20 s budget.
- **Not a memory yet.** Until a person verifies a candidate, or refiles it without the
  `harvested` tag, agent retrieval leaves it out: `prax recall` (also `--recent` and the
  `--since-last-session` delta), `search`, `context`, `brief`, the skills, the MCP search and
  context tools and Ask. Each says how many it hid (`1 unreviewed harvested candidate hidden
  until a person triages it; --include-harvested to show`), so a thin answer is never mistaken
  for a complete one. `--include-harvested` (MCP: `includeHarvested: true`; HTTP:
  `includeHarvested=true`) shows them. The web UI's Library, Inbox, Library search, similar
  documents and the task drawer's suggestions always show them; Ask in the app does not ground
  an answer on them and says so. Findings the agent is sure of still go through `remember`.

## Namespace & provenance

- **`memory` project** — the home for reusable cross-project knowledge. It is Prax's one reserved system
  project: seeded by migration, and the server refuses to rename, archive or delete it (the CLI
  still creates it on first remember for a database that predates the seed). Every other project,
  Inbox included, can be deleted from All projects — together with everything filed under it.
  Recall searches **all** projects by default, so it surfaces both agent memories and your
  hand-authored runbooks/notes; scope with `--project memory` only for cross-project guidance,
  or with another project slug for its knowledge. Agent-written project notes stay with that project.
- **`updatedBy: agent`** — every skill write is stamped via the `x-prax-origin` header, so
  machine-written memory is always distinguishable from human-authored docs.
- **`updatedByAgent`** — *which* agent wrote the current revision (`claude`, `codex`, `copilot`,
  `antigravity`, …), from the `x-prax-agent` header. The skills detect Claude Code, Codex,
  Copilot CLI and Antigravity from their shell environments; any other tool passes
  `--agent <id>` or sets `PRAX_AGENT`. A human edit clears it.
- **`kind: synthesized`** — marks memory as machine-generated, which the maintenance tooling treats
  as safe to refresh aggressively (vs. `source` docs left for human review).

## Verification

Everything an agent writes lands **unverified**, and only a person raises it to verified.
Recall, search and context packs show the difference, and the Library review queue lists
agent-written documents nobody has verified. There are three ways to clear the queue. All of
them bind the verification to the exact revision (title and body) the person was shown. If
the document changed since, the result is a conflict, never a blessing of content nobody saw.

- **Library → Review queue**: open a document, read it, press Verify and move to the next.
- **`prax triage`**: the same queue in a terminal, in the same order, with one key per decision:
  verify, edit, supersede, archive (reject) or skip. See [the CLI guide](cli.md#triage---as-human-name---project-slug).
- **`prax verify <id> --as <name>`**: a single document, confirmed by typing a phrase specific
  to that document.

**Agents cannot verify.** `prax verify` and `prax triage` refuse before any request in two
cases. The first is a shell that belongs to an agent CLI: `PRAX_AGENT`, `--agent`, or the
markers set by Claude Code, Codex, Copilot CLI and Antigravity (the list the provenance
headers use). The second is input or output that is not an interactive terminal. There is
**deliberately no override flag**:

- An agent reads the remedy in an error message and types it, so any documented bypass would
  be the first thing it tried.
- The terminal requirement is the real barrier, because agent shell tools have no TTY.
- Scripted verification never existed (`verify` has always required a terminal), so nothing is
  lost.

If you are a person in a shell that inherited an agent's variables, open a fresh terminal or
use the Library. The skills have no verify path, and the triage and verify modules are kept out
of the skill bundles. Agents keep `unverify` and `supersede`: lowering trust and retiring memory
are part of their loop and never raise trust.

Under the no-auth model this is a guard against self-verification by reflex, not access
control. Anything that can reach the API can still call it directly (see
[SECURITY.md](../SECURITY.md)).

## Why skills + CLI (and where the MCP server fits)

The skills and the `prax` CLI are the **canonical agent path** — they cover the whole memory loop
(recall, remember, get, search, context-pack, supersede) over one shared code path (`cli/lib/`),
and they exist for **token efficiency**: they load lazily (only a one-line description until
invoked, vs. always-on MCP tool schemas), and they do the search/fetch/filter in a script,
returning one distilled block instead of raw ref lists + full documents in context.

The skill scripts are **bundles** of `cli/lib` (built by `npm run skills:build`, committed under
`skills/*/scripts/`), so a skill is one file with no dependencies beyond Node 20+. That is what
lets the pack install on a machine without a checkout of this repository.

The MCP server (`mcp/server.js`) remains a supported product surface over the same API — it adds
the tasks/checklist suite and `derived-from` document linking, which the CLI does not cover. It is
**not enabled by default** for agent sessions in this repo; re-add it on demand
(`claude mcp add prax -- node mcp/server.js`) for a heavy task-curation session.

### Human CLI equivalents

- `prax recall "<query>"` — cross-project, active-only, distilled recall (`--recent [n]` for a
  chronological list of active documents only — retired memory never appears; `--project <slug>`
  to scope). Hits carry a trust label, and an incomplete semantic index is disclosed inline
  (`index incomplete: N of M documents pending`) so an empty result is never mistaken for an
  honest miss while vectors are still pending.
- `prax used <id>` — reports that a recalled memory informed the work (see
  [The librarian](#the-librarian)); `prax doctor` summarizes Library health with CI exit codes.
- `prax remember "<title>" --body "<text>" --project <slug>` — writes project knowledge to its
  owner (the current project is resolved when the flag is omitted). Use `--memory` for reusable
  cross-project knowledge. The skill defaults new titles to memory, so pass its `--project`
  explicitly. These destinations do not change cross-project recall or agent attribution.
- `prax brief <task-id>` — one briefing to start a task: header, numbered checklist, the latest
  handoff paragraph, linked and related documents with trust, and the top 3 memories for the
  task in the budget fill order.

### Budgeted recall and the since-last-session delta

An agent with a small context window can bound what it pulls instead of guessing a document
count: `prax recall "<query>" --budget <tokens>` and `prax context --budget <tokens>` (the
recall skill takes `--budget` too). Tokens are estimated as characters / 4. The block is filled
**verified first, then cited-and-unchanged, then newest**: an unverified note whose cited code
was checked in this checkout and still matches outranks one nobody can vouch for. Lower entries
are compacted to one line — title, type, trust chip, first line — rather than summarised, so no
entry ever loses its trust label, and whatever the budget leaves out is counted. Disclosures
(retrieval mode, index coverage) always print. Without `--budget` nothing changes. See
[Budgets and the fill order](cli.md#budgets-and-the-fill-order).

At the start of a session, ask what changed instead of re-reading everything:

```bash
prax recall --since-last-session          # or the skill: recall.mjs --since-last-session
```

This lists memory created, updated, verified, superseded, deprecated or archived since the end
of **this agent's** last delta (the server keeps one marker per `x-prax-agent` id and scope,
migration 0041). It needs an agent id (`--agent`, `PRAX_AGENT`, or a detected agent shell). The
marker moves only after a delta has been printed in full — plain recalls never move it, and a
budget that leaves changes out holds it — so no change is skipped. The first run sets the
baseline and says so; `--since <iso>` reads any window without touching the marker. The delta
does not see unverifications or permanent deletions. Several sessions of the same agent share
one marker; pass `--since` when they must not.

## Through git: the Library mirror and the compiled block

Recall needs a running Prax. Two outputs carry a project's knowledge into the repository for
teammates and agents without it; both are one-way projections, and SQLite stays the single
source of truth ([spec](superpowers/specs/2026-09-23-library-git-mirror-design.md)).

- **`prax mirror`** writes the project's Library as Markdown v3 into `.prax/library/` with stable
  names and byte-identical output when nothing changed, so knowledge changes are reviewed like
  code. Commit it; do not edit it there. Retired documents move to `retired/`; archived and
  deleted ones leave. `prax mirror import` brings a mirror into another library without ever
  writing over an existing document, and treats a file's verification as a **claim**: documents
  land unverified unless the named verifier is in the operator's trusted list
  (`--trust-verifier`, `PRAX_TRUSTED_VERIFIERS`), the body still matches the verified hash, and a
  person confirms in an attended terminal.
- **`prax mirror --agents-block`** compiles the project's **verified** decisions (and verified
  documents tagged `convention`) into a bounded, marked block of the repository's `AGENTS.md` /
  `CLAUDE.md`, so they are always-on for every session. Unverified memory is never compiled; it
  stays with recall, where its label travels with it. `skills/install.sh --library-block` does
  the same for the `memory` project in each tool's global instructions file. Refresh the block
  after verifying or retiring a decision; tag a standing runbook or reference `convention` to
  include it.

## Setup

### Installing the skills

The installer covers four agent CLIs: it copies the skills to `~/.agents/skills/` (where **Codex**
and **Copilot CLI** look) and links them into `~/.claude/skills/` (**Claude Code**) and
`~/.gemini/config/skills/` (**Antigravity**). Node 20+ must be on `PATH` on every route, because
the agents run the skill scripts with `node`.

- **In a checkout of this repo:** nothing to do. `.claude/skills/` and `.agents/skills/` link to
  `skills/`, so Claude Code and Codex see `prax-recall` and `prax-remember` with no install.
- **On a machine that installed the desktop app (dmg or package), with no checkout:** the bundle
  ships the pack next to the app's CLI and MCP server, so neither git nor repository access is
  needed, and the skills always match the installed app:

  ```bash
  sh "/Applications/Prax.app/Contents/Resources/resources/app/skills/install.sh" --instructions --cli
  ```

  Run from inside a pack (the bundle, or a checkout) the installer copies the skills from there
  instead of cloning. `--cli` also writes a `prax` shim into `~/.local/bin` that runs the bundle's
  `cli/prax.js` on the app's **own** bundled Node runtime — so the CLI itself needs no Node
  install — and `--mcp` prints the MCP registration command for each tool (registration stays
  opt-in). On Linux the same script sits beside the installed payload; only the leading path
  differs.
- **On any other machine:** `glab api "projects/markjoyeuxcom%2Fapps%2Fprax/repository/files/skills%2Finstall.sh/raw?ref=main" | sh`
  installs the pack without keeping a checkout. The repository is private, so the
  account must have been granted access; with `glab auth login` done the installer clones over
  HTTPS using `glab`'s credentials, otherwise it needs an SSH key registered with GitLab. Claude
  Code can alternatively install it as a plugin:
  `claude plugin marketplace add git@gitlab.com:markjoyeuxcom/apps/prax.git` then
  `claude plugin install prax@prax`.

On every route, `--instructions` adds or refreshes the standing "recall first / file by project"
rule in each tool's global instructions file, between markers. Paired with
`--cli` it writes that rule in `prax …` form; on its own it names the installed skill scripts by
absolute path, so the block never teaches a command the machine cannot run. The files:
`~/.claude/CLAUDE.md` (Claude Code), `~/.codex/AGENTS.md` (Codex), `~/.gemini/GEMINI.md`
(Antigravity) and
`~/.copilot/instructions/AGENTS.md` (Copilot CLI, which reads it only when your shell exports
`COPILOT_CUSTOM_INSTRUCTIONS_DIRS="$HOME/.copilot/instructions"` — the installer prints the
line). Project-specific startup guidance belongs in the workspace's instruction file.
Updating an existing block preserves surrounding text; malformed or ambiguous markers stop
the update instead of guessing. Re-running switches command form without uninstalling first.
`--hooks` adds the [session-harvesting](#session-harvesting-proposals-into-the-inbox) hook to
Claude Code (`~/.claude/settings.json`), Codex (`~/.codex/hooks.json`) and Copilot CLI
(`~/.copilot/hooks/prax-harvest.json`). It keeps every other setting and hook, and it teaches the
proposal markers in the standing block. `--uninstall` removes the skills, the links, the
instruction blocks, the shim and Prax's hook handlers; it edits a symlinked instruction file at its target (the link stays a link,
the mode is kept) and leaves a file with malformed markers unchanged, failing the run. See
[`skills/README.md`](../skills/README.md).

### Connecting to the app

The skills, the `prax` CLI and the MCP server reach Prax through one shared transport
(`server/praxTransport.js`), so they find the app, identify themselves, time out and retry in
exactly the same way. This section is the single description of that behaviour; the
[CLI reference](cli.md#environment-variables), the [MCP server README](../mcp/README.md#configuration)
and the [skills README](../skills/README.md) list only their own settings.

**Discovery.** The HTTP API is found in this order: `prax --url` → `PRAX_API_URL` → the desktop
app's saved loopback port (the `webview-port` file under its app-data folder:
`~/Library/Application Support/com.moomora.prax` on macOS, `~/.local/share/com.moomora.prax` on
Linux) → `http://127.0.0.1:3000`. An explicit URL disables the fallbacks, so a wrong address
fails loudly.

**Pinning, with no write failover.** The first candidate that answers a read-only `/readyz`
probe (2 s) is pinned for the life of the process, and every later request goes only there. A
write never fails over to another candidate: with the desktop app gone and a dev server on
`:3000`, landing the same write in a second workspace would be worse than an honest "not
reachable". Concurrent first requests share one probe; a discovery that finds nothing is tried
again by the next request. `prax remember` and the remember skill name the base URL they wrote to.

**Headers.** Every request carries the caller's calendar day (`x-prax-local-date` and
`x-prax-time-zone`, as the web app sends them), so completing a recurring task schedules the next
occurrence from the person's today even when Prax runs in a UTC container. Agent writes carry
`x-prax-origin: agent` and, when the agent is known, `x-prax-agent: <id>` — from `--agent`,
`PRAX_AGENT`, or the Claude Code / Codex / Copilot / Antigravity shell markers. A bearer token,
when set, is sent as `Authorization: Bearer <token>`: an explicit token first, then
`PRAX_API_TOKEN`, then `PRAX_TOKEN`, then the pre-rename `MOOMORA_API_TOKEN`. The server does
not require one under the no-auth model; it is for an authenticated ingress in front of it.

**Timeouts.** One deadline covers each request, response body included. The CLI and the skills
wait 30 s (recall, search and context embed the query, and a local embedding model can take
seconds to load cold); the MCP server's ordinary requests wait 5 s. `PRAX_TIMEOUT_MS` overrides
either. The MCP tools that wait on a chat model — `ask_prax`, `generate_runbook` and
`generate_post_mortem` — wait 180 s, or `PRAX_MCP_TIMEOUT_MS`. A setting that is not a positive
whole number of milliseconds is refused at startup rather than replaced by the default.

**Errors.** A failure is one of three kinds, worded the same by every client: Prax is **not
reachable** (`Prax not reachable at <url> — is the app running?`); it **did not answer in time**
(`Prax at <url> did not answer within 30 s — the request may still be processing; it was not
re-sent.`, naming the setting that raises the bound); or it answered with an **HTTP error**,
reported with its status and the server's message. A write that failed after it may have been
sent starts `Write outcome unknown; reconcile before retrying.`

**Retries.** A request is re-sent at most once, and only when a replay is provably safe. A
receipted operation — one that carries a caller-stable id or operation id (a remember, a
receipt-backed update, a task import with a request id, an MCP create with its `id`) — may be
retried after a lost response, because the server returns the first attempt's result instead of
repeating it. An unreceipted idempotent setter (checking a checklist item, `prax task done`,
verify, supersede, links) is retried only when the failure proves no request reached the server
(connection refused, or a DNS failure). Anything else, and every timeout, is reported rather than
re-sent: Prax may still be processing it.

The app must be running with an embedding backend configured (Settings ▸ Intelligence, or
`EMBEDDING_BACKEND`) for meaning-based recall; otherwise recall labels itself and falls back to
keyword search.

### Project detection

Project-scoped commands (`prax context`, `prax search`, `prax remember` without `--memory`)
resolve the project as: `--project` flag > `PRAX_PROJECT` env > `.prax/project.json` (walking up
from the cwd to the repository root) > **git remote match** > a `.prax/project.json` above the
repository root > the repository's folder name. The git rung reads the repository's `origin`
URL (pure fs — no git binary) and matches it against each project's registered **Repo** URL
(project header in the app, or set automatically by `prax init` inside a repo), so any checkout or
worktree of a registered repo lands in the right project without its own marker file. URL
spelling doesn't matter — `git@github.com:Org/Repo.git` and `https://github.com/org/repo` match
each other.
