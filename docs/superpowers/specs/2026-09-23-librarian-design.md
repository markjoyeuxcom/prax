# Librarian: recall telemetry, consolidation proposals and knowledge gaps

User-approved scope: a consolidation pass over the Library that clusters near-duplicate notes
into **proposals** for human approval, records how agents actually use recall, lists the
questions memory could not answer, and sorts the review queue by what agents lean on. Tracked
in the Prax task "Librarian: consolidation pass with recall telemetry and knowledge gaps"
(`ca759366`). It extends knowledge-base health (`server/kbHealthReview.js`, `GET
/api/library/health`) and the review walk; nothing here changes the remember write path.

## Recall telemetry

Migration `0040_recall_telemetry_and_librarian.sql` adds three telemetry tables and the
proposal table below.

- `recall_queries`: `id`, `occurred_at`, `source` (`recall`, `search`, `context`, `mcp`,
  `assistant`), `mode` (`semantic`, `hybrid`, `keyword`, `recency`), `query` (credential spans
  redacted, then the first 500 characters; see the privacy stance), `query_key` (case-folded,
  punctuation-free, computed from the redacted text, for aggregation), `agent`
  (the `x-prax-agent` id when the request is agent-origin, else null), `project_id` (the scope
  asked for; null = all projects; `on delete set null`) and `hit_count`.
- `recall_query_hits`: `(query_id, document_id, rank)`, at most 50 per query. Both keys
  cascade: clearing a query or permanently deleting a document removes its rows.
- `recall_uses`: `id`, `occurred_at`, `document_id` (cascade), `agent`, `source`.

**What is recorded.** Only retrieval requests that name themselves with
`x-prax-query-source: recall|search|context|mcp|assistant` are recorded. The CLI
(`prax recall`, `prax search`, `prax context`), the skills (the same `cli/lib` code) and the MCP
server (`mcp`) send it, as does the in-app assistant (`assistant`); the web UI does not, so a person's Library searches are never recorded. The
routes are `GET /api/library/documents/semantic-search` (first page only, so a paged recall is
one query), the keyword listing `GET /api/library/documents?q=` (the recall/search fallback),
and both context packs when a query is given. Hit ids are what the server returned: a
semantic page, the keyword matches in listing order, or the pack's documents. A context pack
that fell back to recency records zero hits, because nothing matched the query.

**Never slowing or failing a recall.** The route builds its response first; recording is
scheduled with `setImmediate` after the handler returns, every step is inside `try`/`catch`, and
a failure is logged at warn level and dropped. A test injects a telemetry store that throws
synchronously and one whose promise rejects; recall still answers 200 with the same body.

**Used signals.** `prax used <id>` (`POST /api/library/telemetry/used` with `{ documentId }`)
records that an agent acted on a memory. A query counts as **answered** when one of its hits
has a used signal within 24 hours after the query. There is no MCP tool yet: the MCP toolset is
shared with the in-app assistant, where any non-read-only tool needs a human confirmation, so a
`mark_used` tool would interrupt every assistant answer. That stays an open question.

**Bounds.** Rows older than 90 days are deleted, and each table is capped at 20,000 rows
(oldest first). Pruning runs on every 50th insert and in the daily librarian sweep, so the
tables never exceed the cap by more than 50 rows between prunes.

**Privacy stance.** Telemetry is local only: it lives in the workspace's SQLite database and no
route, export or client sends it anywhere. It is never exported by default: the portable
Library export (`GET /api/library/export`, Markdown v3) contains documents only. It **is** in
the full workspace backup, because that backup is the whole database; restoring a backup
restores the telemetry it held. `prax telemetry clear` (`DELETE /api/library/telemetry`) deletes
every query, hit and used row; `prax telemetry status` shows the counts. Setting
`PRAX_RECALL_TELEMETRY=off` in the server's environment stops recording (clear, used and
reports keep working; used signals are refused with 409).

**Query redaction.** An agent may paste a token into a search, so a query is never stored
verbatim (Agy's review, 2026-09-23). `storedQueryText` in `server/recallTelemetry.js` runs
`redactSecrets` (`server/secretPatterns.js`) over the whole query, then applies the 500-character
cap, so a secret that straddles the cut is still recognised. Each credential span becomes
`[redacted]` and the rest of the query is kept, so gaps stay readable and groupable; `query_key`
is computed from the redacted text, so no secret reaches either column. Redacted shapes: the
harvester's credential set (private-key blocks from header to END line, or to the end when the
END line is missing; AWS `AKIA`/`ASIA` key ids; GitHub `ghp_`/`gho_`/`ghu_`/`ghs_`/`ghr_`/
`github_pat_`, GitLab `glpat-`, Slack `xox?-`, OpenAI and Anthropic `sk-` tokens) plus contextual
forms that only redaction uses because they can match harmless text: JWTs, `Bearer`/`Basic`
values, `password=`/`secret=`/`token=`/`api_key=`/`access_key=`-style assignments (the label is
kept) and the password in `scheme://user:password@host`. The module lives under `server/`
because the server must not import from `cli/`; the harvester and the skill bundles import it
from there. Redaction recognises known shapes only, so agents still must not put secrets in
recall queries, as they must not put them in memory.

## Near-duplicate clustering and proposals

`server/librarian.js` holds the pure parts; `server/librarianRoutes.js` the IO.

- **Candidates:** active, non-archived documents with a non-empty body, excluding templates,
  weekly reviews (`weekly-review` tag) and earlier proposals (`librarian-proposal` tag), capped
  at the 2,000 most recently updated (the report says when it truncated). Pairs are only formed
  inside one project.
- **With embeddings** (a configured, enabled embedder): cosine similarity between current
  vectors (same backend, model and revision as recall uses), threshold 0.92.
- **Without embeddings**, and for any pair where either document has no current vector:
  3-word shingles over the title and body, Jaccard threshold 0.5, candidate pairs found through
  an inverted index that ignores shingles present in more than 50 documents.
- Edges are joined by union-find into clusters of two or more documents (at most 8 listed per
  cluster). A cluster's key is a hash of its sorted document ids.

**Bounding the pair work.** Both finders are exact: they find the same pairs, with the same
similarities, as an unfiltered pass (a test holds them to the original code on a synthetic
library across several thresholds).

- *Shingles:* only pairs that share a shingle held by at most 50 documents are compared. Partners
  are gathered per document through the inverted index with an integer stamp array, so the work is
  the sum of C(df, 2) over those rare shingles (at most 25 partner visits per shingle occurrence),
  never all pairs, and each nominated pair gets one exact Jaccard. A pair whose shared shingles
  are all boilerplate (held by more than 50 documents) is not compared; with embeddings, cosine
  still covers it.
- *Embeddings:* cosine stays exact. Each vector is normalised once, and a pair's dot product is
  summed in blocks of 16 dimensions; after each block, Cauchy-Schwarz bounds what the remaining
  dimensions can add, and the pair is dropped once it can no longer reach the threshold. An
  unrelated pair is dropped after a small share of its dimensions, and a surviving pair is scored
  with the original `cosineSimilarity`. The pair loop is still quadratic within a project, which
  we accept at the declared limit: at most 2,000 candidates (about two million pairs). Lossy
  prefilters (top-k, LSH) were rejected because they could change which clusters are found.
- *Measured:* 2,000 documents in one project with 768-dimension vectors cluster in about 0.3 s on
  a laptop (the unfiltered cosine pass took about 2.4 s), and fewer than one pair in 50 needs a
  full cosine. `tests/backend/librarianScale.test.js` asserts those work counts and a generous
  8-second bound.

**Reusing the last clustering.** The report behind `prax doctor` clusters the library on every
call, so each run fingerprints what clustering reads: the settings, and for each candidate in
order its id, project, revision (the token over title and body) and the exact bytes of its
vector. The routes keep the clusters for the last four fingerprints in memory; an equal
fingerprint reuses them (`cached: true` in the run result) and any change recomputes. Proposal
status is always classified afresh, so a newly filed or dismissed proposal shows at once. The
cache lives in the app process only and is lost on restart. Documents and vectors are still read
on every call; that read is cheap next to clustering.

A proposal is one new document per cluster, created by `POST /api/library/librarian/run`:

- `kind: synthesized`, `updatedBy: agent`, `updatedByAgent: librarian`, `verified: false`,
  tag `librarian-proposal`, the cluster's project, and the canonical source's type. Because it is
  agent-written and unverified it appears in the review queue and the review walk with no extra
  wiring.
- The title is `Proposal: consolidate “<canonical title>” (+N)`. The body states that nothing
  has been merged or retired, then gives the draft canonical body (the canonical source, chosen
  verified first, then longest, then newest, followed by each other source's paragraphs that the
  canonical body lacks), the sources with id, type, trust and date, the proposed `supersedes`
  links, and why each pair was grouped (cosine or Jaccard value).
- The proposal records `derived-from` links to its sources (so an edited source marks it stale)
  and a `librarian_proposals` row: `document_id` (cascade), `cluster_key`, `project_id`,
  `source_ids`, `method` (`embedding`, `shingle` or `mixed` when a cluster has edges of both),
  `status` (`open`, `approved`, `dismissed`), `created_at`,
  `decided_at`.
- A run skips a cluster whose key already has a proposal (any status) and a cluster whose
  documents all sit in one open proposal, so re-running is idempotent and a dismissal sticks.

**Proposal-only invariant.** The librarian never supersedes, merges, edits or archives a source.
A proposal creates no `supersedes` link. Only
`POST /api/library/librarian/proposals/:id/approve` does, and it refuses an agent-origin request
(403, `reason: "human-approval-required"`) and an unverified proposal (409,
`reason: "verify-first"`): a person reads the draft in the review walk, verifies it, then
approves it in Library health. Approval links the proposal as `supersedes` each source that is
still active (a cycle or a vanished source is reported per source, not fatal) and marks the
proposal approved. `.../dismiss` marks it dismissed and archives the proposal document. Under the
no-auth model the origin header is a workflow guard, not access control (see `SECURITY.md`).

## Knowledge-gaps queue

`GET /api/library/librarian/gaps` groups recorded queries by `query_key` over the retention
window. A group is a gap when none of its occurrences was answered and either its latest
occurrence returned **no hits** (`reason: "no-hits"`) or it returned hits that were never used
(`reason: "unused"`). Unused gaps are reported only once the workspace has at least one used
signal and the latest occurrence is older than the 24-hour window; without used signals every
query would look unanswered. Each gap carries the latest query text, occurrences, last asked,
agents and sources, most asked first (at most 50).

## Recall frequency, the review order and prune candidates

- `GET /api/library/librarian/recall-counts` returns `{ counts: { <id>: { hits, uses,
  lastRecalledAt } }, since }` over the retention window.
- `GET /api/library/health?sort=recall` orders `needsReview` by hits, then uses, then the default
  order, and adds `recallHits` and `recallUses` to those rows. Without the parameter the response is unchanged:
  the triage TUI and the review walk keep the default order.
- The Library review queue gains an opt-in **Sort: Most recalled** step on its sort cycler; the
  walk follows the order shown. Library health's Needs review card has the same toggle.
- **Prune candidates:** active agent-written documents (not proposals) created at least 30 days
  ago with no hit in the window. They are flagged only once telemetry covers 30 days
  (`ready: false` with the coverage before that). Flagging changes nothing.

## Doctor, the Run librarian action and the schedule

- `GET /api/library/librarian/report` is read-only: health counts (needs review, stale, empty),
  index coverage, duplicate clusters (computed, not written; status `new` marks those with no
  proposal yet), open proposals, gaps, prune candidates and telemetry counts, plus `checks`
  with a level each.
- `prax doctor [--project <slug>] [--json]` prints that report. Exit 0 when no check warns, 2
  when one does (incomplete index, stale derivations, empty stubs, unproposed duplicate
  clusters), 1 when it could not run. Needs review, gaps, prune candidates and open proposals are
  informational.
- Library health gains a **Librarian** card: Run librarian (creates proposals), the open
  proposals with Review, Approve and Dismiss, the knowledge gaps, the prune candidates and a
  **Run daily** switch.
- The app already runs a periodic sweep (the Google Calendar reconcile), so the librarian follows
  that pattern: an unref'd hourly timer, stopped on close, prunes telemetry and, only when the
  `librarian_schedule_enabled` setting is on (off by default), runs the librarian pass at most
  once a day (`librarian_last_scheduled_run_at`), so a desktop session shorter than a day still
  gets its run.
- Contradiction detection stays where it is: the on-demand AI review. The remember path is
  untouched and the librarian never calls a chat model.

## Evidence

`tests/backend/secretPatterns.test.js` (token shapes, span redaction, the key computed from the
redacted text, redaction before the cap, nothing secret stored through the store or a route),
`tests/backend/recallTelemetry.test.js` (recording from each route, header opt-in, first-page
only, fire-and-forget failures, bounds, clear, disabled mode), `tests/backend/librarian.test.js`
(shingle and embedding clustering with the fake embedder, proposal shape, idempotent runs, the
proposal-only invariant, approval rules, the schedule, the clustering cache),
`tests/backend/librarianScale.test.js` (exactness against the unfiltered passes, 2,000 documents
within a time bound), `tests/cli/librarian.test.js` (`prax used`,
`prax telemetry`, doctor exit codes against a real server), the MCP source header in
`tests/mcp/praxClient.test.js`, `tests/frontend/librarian.test.js` (the card, the recall sort,
the controller) and `tests/e2e/librarian.spec.js` (Run librarian → review queue → verify →
approve).
`npm test`, `npm run check`, `npm run verify:restore`, `npm run verify:portable`.
