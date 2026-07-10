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

- **Repo-URL project detection.** A project can now carry the URL of the repository it corresponds to (a **Repo** field in the project header, next to on-call and handoff), and the `prax` CLI auto-detects the project from the local git remote: detection precedence is `--project` > `PRAX_PROJECT` > `.prax/project.json` > **git remote match** > folder name. The git rung reads the repo's `origin` URL with pure fs (no git binary; worktree/submodule `.git`-file pointers followed to the shared config) and matches it against registered projects **regardless of spelling** — `git@github.com:Org/Repo.git`, `https://github.com/org/repo`, ssh-with-port, and PAT-in-URL forms all normalize to the same identity (one shared `server/repoUrl.js` canonicalizer on both sides). `prax init` inside a repo registers the URL on the project automatically (never overwriting a different registration), so every other checkout and worktree of that repo then lands in the right project with zero setup — and a folder rename can no longer send `prax remember` into a silently auto-created project. URLs are stored as entered; an unparseable URL is never rejected, it just never matches. New nullable `repo_url` column (migration `0009`), `repoUrl` on the project API payload, and `PATCH /api/projects/:id` support. *(Hardened by an adversarial review that executed its attacks against real git repos and caught real bugs, all fixed + regression-tested: the walk escaping the repo boundary — a fresh `git init` under a dotfiles-managed `$HOME` would have inherited the dotfiles project; the worktree resolution breaking for repos kept under a directory literally named `worktrees` and misattributing submodules-inside-worktrees; archived/completed projects capturing detection away from their active successors; percent-encoding asymmetry between URL spellings; and `prax init` auto-creating a duplicate project on a second checkout — it now adopts the registered project instead.)*

- **NL prompt regression eval (`npm run eval:nl`).** A pinned set of phrase→expected fixtures for the NL capture / NL→filter prompts, run through the real prompt + coercion pipeline against any env-configured chat backend (`CHAT_BACKEND=anthropic ANTHROPIC_API_KEY=… npm run eval:nl`, or ollama). The expectations were validated against a real model and encode the never-infer rules — an actual field the fixture didn't expect **fails** the case, so the exact over-inference regressions a prompt edit can silently reintroduce (guessed projects, invented priorities) are caught before they ship. Dates are pinned to a fixed "today" so cases reproduce forever; the comparators are unit-tested and reject typo'd fixture keys. Deliberately not part of `npm test` (spends real tokens); the mirror of `npm run eval` for retrieval. Also pins two prompt conventions surfaced by the real-model pass: a bare weekday counts today ("friday" said on a Friday = today; "next friday" = the following week), and a phrase that names something *as a project* emits `#slug` even when unlisted — the semantic lint then warns, which beats a silent title-text mismatch.

- **Natural-language capture & NL→filter (Tier-3 #8; completes Tier 3).** Type like you think, keep the deterministic paths sacred:
  - **Smart add** — in quick capture, <kbd>⌘/Ctrl</kbd>+<kbd>↵</kbd> sends the typed phrase ("rotate the certs next friday morning, high priority, homelab") to the AI, which parses it into structured fields shown as **removable chips** (project with its dot, priority, the **resolved absolute date** with weekday — past dates get a warning tone — time, ↻ recurrence, labels), with the cleaned imperative title back in the still-editable input. **Plain ↵ then creates; nothing exists until you confirm.** The classic `N → type → ↵` path is byte-identical (no model involved), the chord falls through to a plain add when no model is configured, and explicit sigils (`!high`, `#project`, `@label`, a literal date) always **override** the model — they're your intent, not its guess. Hallucinated projects/labels are dropped and shown as "ignored: …"; first <kbd>esc</kbd> discards the preview and restores what you typed, second closes.
  - **✦ Translate** — in the Filter view, describe the query in English ("high priority in homelab due this week"), hit <kbd>⌘↵</kbd> (or the ✦ Translate button), and the AI emits a **grammar expression** (`p1 & #homelab & due:week`) that lands in the same input — transparent, hand-editable, and saveable as a smart view unchanged. A provenance line shows what it came from with one-click **restore**; a server-side **semantic lint** warns about atoms that silently match nothing (`#typo`, `due:next-week`, `status:doing`) and barewords that probably meant a `#project`/`@label`. An invalid expression still lands (the existing error hint explains it) rather than being discarded.
  - Both run through two stateless, never-500 parse routes (`POST /api/tasks/nl-capture`, `/api/tasks/nl-filter`) + a pure `server/nlParse.js`: temperature 0, prompts grounded with today's date (weekday-correct, local), your project slugs, and known labels; the model's output is **coerced against a whitelist** (enums clamped, dates/times regex-validated, unknown projects dropped, labels kept only if known or verbatim in your text) and filter output is validated by the same `parseTaskFilter` the views use. Calls time out after 20s and are abortable. *(Drive-by fix: capturing from a project's Backlog tab no longer 400s — the design-vocab status is now translated at the API boundary.)*

- **Editor writing actions — draft, summarize, rewrite, notes → checklist (Tier-3 #7).** A **✦ AI** dropdown in the document toolbar with four writing helpers: **Draft from title** (write a first-draft body from the title — runbooks get checkbox steps + a rollback section), **Summarize** (a grounded TL;DR inserted at the top), **Rewrite for clarity** (tighten the prose while preserving every fact, command, and Markdown construct), and **Notes → checklist** (turn rough notes into ordered `- [ ]` steps). Rewrite and the checklist act on the **current selection** when there is one, otherwise the whole document. Every result opens in a **preview overlay** — nothing touches the document until you click **Apply**, and applying lands the text in the editable buffer as a **normal user edit** (so a `verified` document stays verified — you reviewed it). New `POST /api/library/writing-action` + a pure `server/writingActions.js`; the menu is gated on a configured chat model and, like every AI path, never 500s (it degrades with a reason). *(Hardened by two adversarial review passes that caught real bugs: applying a selection via `String.replace` let `$`-sequences in the model output — Postgres `$$` dollar-quoting, shell `$'…'` — corrupt the text and could target the wrong duplicate line (now an exact offset splice); a cancelled-mid-generation request could resurrect the overlay and whole-replace the doc (now a generation-token guard); and opening the menu re-rendered the editor and silently dropped the selection, making "replace selection" unreachable (the selection is now captured at menu-open).)*

- **AI review in Library health — contradiction + coverage-gap detection (Tier-2 #5, part 2; completes #5).** An on-demand **Scan with AI** button reads the library for two things a knowledge base rots from: **documents that contradict each other** and **coverage gaps** the open work implies. Contradictions are found by picking the most *similar* document pairs from the existing embeddings (never an O(n²) model scan) and judging each pair with the chat model — and a finding is only kept if the model quotes the conflicting sentence **verbatim from each doc** (a grounding gate that drops fabricated/paraphrased "conflicts", since a false contradiction hurts trust more than a missed one). Gaps come from one cheap pass over a trust-aware digest of titles + open-task themes. Everything is **advisory** (nothing is changed), **bounded** (≤13 model calls per scan regardless of library size), and **degrades cleanly** — no model, no embeddings, a mid-scan failure, or junk output each surface a clear reason instead of a crash or a false "all clear". New `POST /api/library/health/ai-review` + a pure `server/kbHealthReview.js`. *(The design was chosen via a judge-panel of four approaches; the implementation was then hardened against an adversarial review pass that caught string-unaware JSON parsing, false-green-on-crash rendering, and a few degradation gaps.)*

- **Auto wiki-link suggestions in Library health (Tier-2 #5, part 1).** A **Suggested links** section on the Health view surfaces places where one document mentions another's exact title in plain prose but hasn't `[[linked]]` it yet — the cure for the orphans the same view flags. Detection is deterministic (word-boundary, case-insensitive, first mention per pair), and deliberately skips mentions inside code spans/fences or existing links. One click **Link** rewrites that first mention to a `[[wiki-link]]` in the body (preserving its casing) — a normal user edit, so the document's `verified` state is untouched. New `GET /api/library/health/link-suggestions` + `POST /api/library/documents/:id/wiki-link`, backed by a pure `server/wikiLinkSuggest.js`.

- **Task time-of-day.** A task's due date can now carry an optional **time** (`HH:MM`, 24-hour, your local time) — a `<input type="time">` next to the due-date picker in the task drawer, disabled until a date is set and cleared alongside it. The time shows on task chips everywhere ("Today 12:00", "Jul 9 09:00 · overdue"), and **due reminders respect it**: a task due today with a time only nudges you once that time arrives (an overdue timed task still fires immediately). New nullable `due_time` column (migration `0008`), additive to the API task shape and kept out of the frozen import field set. The assistant can set it too — say "remind me at noon tomorrow" and it fills `dueDate` + `dueTime` (`12:00`). Tasks still store a *wall-clock* time, not a timezone-aware instant.

- **Rename a project.** The project header title now has a hover-revealed pencil that turns it into an inline editor — Enter (or clicking away) saves, Esc cancels. The **slug stays stable** on rename (it's the durable handle used by links and agents), and since project resolution now matches by name too, the new name resolves immediately everywhere. The reserved Inbox project stays protected. (The backend already accepted `name` on `PATCH /api/projects/:id`; this fills in the missing UI.)

- **In-app AI assistant — an agentic, tool-calling chat over your whole workspace (Tier-2 AI).** A right-docked **Assistant** panel (top-bar chat button or <kbd>⌘I</kbd>) that doesn't just answer — it *acts*, by calling the exact same tool tree the MCP server exposes to external agents (all **32 tools**: search/create/update tasks and documents, retrieve library context, run runbooks, generate post-mortems, and more), routed in-process through the app's real HTTP handlers so validation, project resolution, activity logging, and the trust model all behave identically.
  - **Reads run freely; writes pause for one-click confirmation.** The agent loop executes read tools immediately, but any tool that mutates data (create/update a task, author a document, run a runbook step) suspends the turn and surfaces a **confirmation card** — nothing changes until you approve. Approvals are per-turn, never blanket. Documents the assistant authors still land **agent-written and unverified**, so the assistant *extends* the trust model rather than bypassing it. After you approve a write, the app's task and library views **refresh immediately** (the server flags the turn as having mutated data) so the change shows without a manual reload.
  - **Tool-calling foundation.** The runtime chat-provider layer grew native function-calling for **Anthropic, OpenAI, and Gemini** (plus a scriptable fake backend for tests), with a neutral tool-call / tool-result message protocol shared across providers. Providers without tool-calling (Ollama / llama.cpp) degrade gracefully to a plain grounded conversation. Like every AI path, it never 500s: no model configured, an unsupported model, or a mid-loop error all degrade to a clear message.
  - **Transparent by default.** Each turn shows the tools it called (name, arguments, status, and a result preview) inline, so you can see exactly what the assistant did and why — no black box.
  - **Date-aware.** Each request injects today's date (the user's local date, recomputed per turn) into the system prompt, so "remind me tomorrow" / "due next Friday" / "in 3 days" resolve to a concrete `YYYY-MM-DD` due date instead of the model guessing.
- **Knowledge-base health, daily brief / on-call handoff, and a retrieval-recall harness (Tier-2 AI).** The connective tissue on top of the Tier-1 generation layer — surfacing what needs attention, summarizing the day, and guarding retrieval quality.
  - **Knowledge-base health** — a Library **Health** view (and `GET /api/library/health`) that buckets the documents needing attention: agent-written/unverified drafts to review (with a one-click verify), empty stubs, stale docs, and orphans (no inbound or outbound links). Trust tags show only where they mean something (the needs-review bucket), so the list reads as a to-do rather than noise.
  - **Daily brief / on-call handoff** — a **✦ Brief** button on Today opens a stand-up over every project: what's overdue, due today, and due soon (snoozed and completed tasks excluded), each project's on-call owner and handoff notes, and the docs changed in the last three days. **Draft with AI** (via `POST /api/brief/narrate`) narrates the structured brief into a few tight sentences using *only* its facts — no invented tasks or owners; **Copy** exports the Markdown. The brief itself is computed client-side, so it works with no model configured; the AI narration is additive.
  - **Retrieval-recall harness** — `npm run eval` (and a CI regression test) checks that a fixture set of `query → expected-doc` pairs still retrieves, guarding the keyword + context-pack path against silent recall regressions as the ranking evolves.
- **AI answers — Ask Prax, auto post-mortems, and runbook generation (Tier-1 AI).** A generation layer on top of the retrieval-only foundation, on a new runtime **chat provider** that mirrors the embedding one (OpenAI, Claude/Anthropic, Gemini, Ollama, llama.cpp; key redacted, no restart, configured in Settings ▸ Intelligence ▸ AI answers).
  - **Ask Prax** — a Library-header panel (and `POST /api/library/ask` + `ask_prax` MCP tool) that retrieves the trust-aware context and, when a chat model is set, writes a grounded answer that **cites its sources by title and flags unverified ones**, refusing rather than guessing when the library doesn't cover it. It answers from the **full bodies** of the top documents (not snippets), so runbook/how-to questions get the actual steps; degrades to showing the retrieved sources when no model is configured. Replaces the old "Brief me" panel (which it strictly supersedes).
  - **Auto post-mortem** — a "✦ Post-mortem" button on a finished runbook run (and `generate_post_mortem` MCP tool) turns the run's chronicle (steps, timestamps, actors, gaps) into a drafted post-mortem, with a deterministic template fallback when no model is set.
  - **Generate runbook** — a "New runbook" panel (and `generate_runbook` MCP tool) drafts a runnable runbook (checkbox steps, commands, rollback) from an alert/incident description.
  - Every AI-authored document lands **`agent-written` and unverified**, needing a human verify before it's trusted — so generation *extends* the trust model rather than undermining it. Retrieval was also cleaned up: empty/scratch docs are filtered out of the context pack, and snippets trimmed. The MCP surface grows to **32 tools**.
- **Plain editor engine (experimental).** Settings ▸ Appearance now offers a lightweight, dependency-free Markdown editor to A/B against CodeMirror — a transparent `<textarea>` (all the hard editing: cursor, selection, undo, IME, mobile, a11y — for free) layered over a synced, syntax-highlighted layer, with line numbers and the existing find/replace panel repurposed. Now at feature parity: `[[wiki-link]]` and `/slash` command autocomplete (same triggers and doc-title source as CodeMirror) plus painted find-match highlights with current-match tracking, so it's a drop-in candidate to replace CodeMirror's 275 KB dependency. Defaults off (CodeMirror stays the default) pending a decision to flip.
- **Preview font — serif, sans, or monospace.** A Settings ▸ Appearance ▸ Preview font toggle for the rendered preview pane: serif (Source Serif 4) reads like a document, sans matches the app chrome, monospace suits code-heavy runbooks. Headings stay the clean sans face in every mode. Driven by a `--prose-font` variable on `<body data-preview-font>`, so it applies live.
- **Editor font — proportional or monospace.** A new Settings ▸ Appearance ▸ Editor font toggle (applies to both engines). It also fixes a caret-drift bug in the plain editor: because a transparent `<textarea>` paints the caret from normal-weight, upright metrics, the highlight layer's bold headings and italic emphasis widened the glyphs in the proportional Instrument Sans and pushed the caret off the text (measured ~8 px by the end of an H1, compounding per span and shifting wrap points below). Proportional mode now shows emphasis by colour with a **metrics-safe faux-bold** (a `text-shadow` that thickens headings without changing glyph advances — verified 0 px drift); monospace mode keeps real bold/italic, which are width-neutral in a mono face. The editor line-height is also snapped to an **integer pixel** (`--pe-lh`, computed in `applyPreferences` as `round(15px × scale × 1.7)` so it tracks the reading scale and works on every engine): `1.7 × 15px = 25.5px` is a half-pixel that WebKit-based webviews (the desktop app) round differently for a `<textarea>`'s line box than for the highlight `<div>`s, drifting the caret a little more each line down — the shared integer makes both layers round identically. And because WebKit webviews (the macOS desktop app) can still position a `<textarea>`'s *native* caret off the styled text, the plain editor now **paints its own caret** positioned from the highlight layer's real geometry (the native caret is hidden with `caret-color: transparent`) — pixel-exact on every engine by construction, verified 0 px at every offset. Either way the caret is now pixel-exact. The custom caret is a single consistent height (the glyph line, measured from real text) so an empty/new line's caret matches a text line's, and the plain editor gains a **current-line highlight** (a subtle full-width band behind the caret's line, like CodeMirror).
- **Nine accent colours.** The Settings ▸ Appearance accent picker grows from 4 to 9 — a full spread from Fern green through Teal, **Sky (blue)**, Indigo, Plum, **Rose (red)**, Amber, Clay, to Moss — each tuned to read on both light and dark themes.
- **Labels, filters, smart views, and Upcoming** — a Todoist-inspired task milestone.
  - **Labels** on tasks: cross-cutting `@labels` (`@waiting`, `@pagerduty`, `@cert-rotation`), normalized to lowercase, edited as chips in the task drawer. New additive `labels` column (migration `0007`).
  - **A filter grammar + Filter view**: a live query box (`@label`, `#project`, `p1`, `overdue`, `due:today`, `status:in-progress`, `is:recurring`, boolean `&`/`|`/`-`/`( )`, bareword = title) that filters across all projects as you type. One shared pure predicate module evaluates it, so the **`search_tasks` MCP tool** accepts the *same* `filter` expression — humans and agents query identically. Save any expression as a **Smart view** in the sidebar.
  - **Upcoming view**: the next 7 days grouped by day (with an Overdue bookend), companion to Today.
  - **Capture tokens**: quick capture now also parses `#project` and `@label` out of the typed title (e.g. `rotate certs #homelab @cert !high fri`).

### Fixed

- **Create tasks by project name, and create recurring tasks, from the assistant / API / MCP.** Two `create_task` gaps that surfaced when the assistant tried to file a task: (1) project resolution matched only an exact **slug or id**, so passing a display name like "Terrafrom Labs" (with a space and capitals) failed with "project is invalid" — it now also matches the **name**, case-insensitively and tolerant of spaces vs. hyphens (`resolveProject` slugifies the input and compares slug/name), so humans and LLMs can use whatever they see. (2) The create path silently **dropped `recurrence`** (it was PATCH-only), so a "remind me daily" request couldn't actually recur; `create_task` now accepts and validates `recurrence` (`daily`/`weekly`/`monthly`/`every:Nd`/`every:Nw`), and the tool descriptions advertise both. (Note: tasks still carry a due *date* only, no time-of-day.)

- **Markdown preview mangled list items containing a shell pipe.** The renderer's table detector treated any line with a `|` as a potential table row *before* checking whether the line was actually a list/task/heading/blockquote — so a checkbox step like `- [ ] Identify the pod: \`kubectl get pods | grep x\`` was captured as a table row, failed the "next line is a `|---|` delimiter" test, and got dumped into a `<p>` as literal `- [ ]` text (splitting the surrounding list and, with a trailing colon/code span, absorbing the next item onto the same line). Common in generated runbooks, where nearly every step carries a `kubectl … | grep …`. The table branch now refuses to *start* a table on a line that begins another block construct (`#`, `>`, `-`/`*`/`+`, `N.`); the guard is deliberately applied only to the table **start**, so a genuine borderless table whose data cell begins with a marker (`- | negative`, `1. | Start`) still renders as a table. Verified with an adversarial pass over real tables (bordered, colon-aligned, borderless, marker-first-cell, pipe-in-code-cell) and every list/heading/blockquote-with-pipe shape.

- **Dark-mode Markdown editor was near-invisible.** The CodeMirror editor's body text rendered dark-on-dark because the `--text-body` alias (and a few siblings) were declared on `:root`, where `var(--ink)` was substituted once against the *light* palette and frozen — so they never followed the theme flip. The aliases now live on `body` (which carries the `[data-theme]` override), so each re-resolves per theme.

- **Runbook execution over MCP.** Agents can now drive a runbook run, not just read the runbook: five new MCP tools — `start_runbook_run`, `list_runbook_runs`, `get_runbook_run`, `set_run_step`, `set_run_status` — wrap the existing run routes, stamping the agent as the actor (`startedBy`/`checkedBy`). An agent responding to an incident can start a run, tick steps as it works, finish or abort, and pull the timestamped chronicle for a post-incident summary — all without touching the source document. The MCP surface grows 24 → 29 tools.
- **Due-date reminders.** Prax now nudges you when a task is due or overdue while it's open — a native desktop notification when you've granted permission (opt in from Settings ▸ Appearance), an in-app toast otherwise. Snoozed, completed, and archived tasks are skipped; each task is announced once per session, on load and on a 15-minute heartbeat so a task ticking over to due (e.g. across midnight) still surfaces. New opt-out `reminders` preference.
- **Recurring tasks.** A task can now repeat — daily, weekly, monthly, or a custom `every:Nd`/`every:Nw` cadence (set from a **Repeat** row in the task drawer). Completing a recurring task spawns its next instance server-side with the due date advanced by one interval, rolling forward past today so a late completion reschedules into the future rather than the past. The completed occurrence stays as a record, and the list refreshes so the next instance appears immediately. New nullable `recurrence` column (migration `0006`), additive to the API task shape and kept out of the frozen import field set.
- **Inline capture shorthand.** Quick capture parses a `!` priority sigil (`!high`/`!p1`/…) and a due date (`today`, `tomorrow`, a weekday, `next week`, or an explicit `YYYY-MM-DD`) out of the typed title, stripping the tokens — so "rotate certs !high fri" files itself. Possessives and mid-word lookalikes are left intact.
- **"Brief me" in the Library.** A ✦ button opens an ask-the-library overlay: type a question, get the trust-aware context pack (the same one `ask_library` serves agents) rendered as Markdown with a copy button — semantic when a provider is configured, keyword fallback otherwise.
- **Delete saved Library views.** Saved views in the sidebar gain a hover × to remove them (activating a delete path that previously had no control).
- **Runbook execution mode.** A runbook can now be *run*, not just read. A **▶ Run** button in the runbook editor snapshots its `- [ ] …` checkbox lines into a timestamped run and opens a focused checklist view: tick each step as you go (each tick stamps a time and who did it), watch a progress bar, then **Finish** or **Abort**. The run is a chronicle kept independently of the document — checking steps never rewrites the source, and later edits to the runbook don't alter past runs. **Copy chronicle** exports the run as Markdown (status, start/finish, per-step timestamps) for an incident record, and each runbook lists its **Past runs**. New `runbook_runs` / `runbook_run_steps` tables (migration `0005`), a step parser, a runs repository, and `POST/GET /api/library/documents/:id/runs` + `GET/PATCH /api/library/runs/:runId[/steps/:stepId]`.
- **"Agent-written" library facet.** The Trust facet row gains an **Agent-written** pill (synthesized derivations or documents last edited by an agent), so you can quickly see and verify what agents wrote — a lightweight curation hub built on the existing facet infrastructure.
- **On-call owner + handoff notes on projects.** A project header now carries two inline-editable ops fields — who is on call, and free-form handoff notes for the next shift — saved with a debounced PATCH (new nullable `on_call` / `handoff_notes` columns). The reserved Inbox project is excluded.
- **Ask the library a question — the `ask_library` MCP tool + `GET /api/library/context-pack`.** Retrieves the most relevant documents *with their content* for a query, without needing ids: semantic ranking when a provider is configured, keyword (FTS) fallback otherwise, optionally scoped to one project. Returns a bounded, trust-aware Markdown context pack (reusing the per-project context-pack machinery) so an agent can answer "what do we know about X?" in one call.
- **Snooze / defer tasks.** A task can be snoozed until tomorrow or next week (the drawer offers presets); it drops out of Today until then and reappears automatically, with a "N snoozed" note so nothing is forgotten. New nullable `deferred_until` on tasks (additive to the API task shape; not part of the import field set).
- **Inbox + context-aware quick capture.** New tasks no longer silently land in
  whichever project happened to be first. A reserved **Inbox** project (pinned in
  the sidebar, protected from rename/archive/delete) is the default home for
  tasks captured without a project context. Quick capture now derives its
  destination from the view you're in — a project view targets that project;
  Today targets Inbox *and* pre-sets a due-today so the task shows up where you
  made it; a Backlog tab pre-sets backlog status — and a footer picker lets you
  redirect to any project before adding. Triage an Inbox task later by moving it
  to a project.
- **Delete a document outright, alongside Archive.** The document menu now
  offers **Delete permanently…** next to Archive for active documents (not just
  archived ones), so a document can be removed in one step instead of
  archive-then-empty. It's guarded by the same in-app confirmation and hits the
  existing `DELETE /api/library/documents/:id/permanent`, which now removes a
  document in any state (archived or active) rather than only archived ones.
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
- **⌘B / ⌘I / ⌘E format in the editor.** The bold/italic/code shortcuts the
  toolbar advertises now fire inside CodeMirror (they only worked in the
  fallback textarea before), reusing the same format path as the toolbar and
  slash menu — and overriding the contentEditable's native Cmd-B so it can't
  insert stray `<b>` tags.
- **Filter the Library by type and trust.** A facet row adds Type
  (Runbooks / Notes) and Trust (Verified / Stale / Superseded) toggles with
  live counts. Facets are additive — AND across the axes (and with tags and
  search), OR within the Trust axis — and only show while browsing (not in
  archive or semantic mode); trust facets no document carries are hidden.
- **New-doc templates.** "＋ New doc" is now a small chooser: **Blank note**
  or **Runbook**, the latter seeding a `## Symptoms / Diagnosis / Resolution /
  Verification / Rollback` skeleton so the outline is ready to fill in.
- **Related documents in the editor.** A "Related documents" panel (Preview
  and Split modes) lists the docs most similar to the one you're reading,
  reusing its own stored embedding — no new embedding call. `GET
  /api/library/documents/:id/similar` ranks by cosine similarity, drops the
  document itself, and returns empty when semantic search is off or the doc
  has no embedding; each result is a clickable row with its match percentage.
- **The Markdown preview renders images, `~~strikethrough~~`, and underscore
  emphasis** (`_italic_` / `__bold__`). Underscore emphasis has word-boundary
  guards, so `snake_case` identifiers and paths like `/etc/foo_bar` are left
  alone; image `src` is restricted to http(s)/relative (no `javascript:`).
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

- **The Library no longer blinks on every keystroke while searching.** The
  main-content fade-in is a view-transition cue, but `renderApp` rebuilds the DOM
  on every state change, so it replayed on same-view re-renders too — a strobe
  while typing in keyword search (or toggling a filter). The fade now plays only
  when the view identity actually changes.
- **Confirm dialogs launched from a menu no longer need a double-click.** A
  confirm opened from an open menu (e.g. the doc menu's "Delete permanently…")
  left the menu open, so the "click outside a menu closes it" handler ate the
  first click on the confirm's buttons — you had to press Delete twice. Opening a
  confirm now closes any open menu first.
- **Re-index surfaces *why* embeddings failed.** A failed re-index reported a bare
  "N failed"; it now includes the first failure's message, and Ollama labels a
  504/408/524 as a timeout ("the model is slower than the gateway/proxy request
  timeout; raise the timeout or use a smaller embedding model") — the usual cause
  of a large model (e.g. `qwen3-embedding:8b`) behind an Envoy/nginx gateway
  failing every embed while the connection test still passes.
- **"Rebuild all" embeddings no longer looks like it did nothing.** The confirm
  dialog only closed *after* the whole rebuild finished, so against a remote or
  large model it sat on screen for the entire run and read as a dead button. It
  now dismisses immediately with a "Rebuilding every embedding…" toast, reports
  the result when done, and ignores repeat clicks while one run is in flight.
- **Typing in the Library search no longer loses focus after each letter.**
  Keyword search filters live, which re-renders and replaced the `<input>`
  element, so focus (and the caret) were lost after every keystroke — you could
  only enter one character at a time. The search input now re-focuses and
  restores the caret after the live re-render, like the palette input.
- **Semantic search no longer looks broken when nothing is embedded.** The most
  common "semantic search isn't working" was configuring a provider (e.g. Ollama)
  but never re-indexing: search only matches documents embedded with the *active*
  provider, so it silently returned an empty list. The empty state now
  distinguishes three cases — **nothing embedded yet** (shows "0 of N" with a
  **Re-index now** button — the fix for the switch-provider gap), a **backend
  error** (a toast + "unavailable" message pointing at Settings ▸ Intelligence,
  instead of swallowing the failure into empty results), and a **genuine
  no-match**. Re-index also now reports its outcome ("Re-indexed N documents", or
  "embedded X, Y failed — check the provider/model") so a provider that's
  reachable but missing its embedding model no longer fails invisibly.
- **Ollama's connection test now checks the model is actually pulled.** It only
  probed `/api/tags` (is Ollama up?), so it reported "connected" even when the
  configured embedding model wasn't pulled — every embed then 404'd with "model
  not found". The check now requires the configured model to be present in the
  tag list (resolving a bare name to `:latest`), so a missing model reads as
  disconnected at configure time instead of silently failing at search time.
- **Ollama tolerates a `/v1` on the base URL.** Ollama's native API lives at the
  root (`/api/…`); `/v1` is its OpenAI-compatible surface (that's the llama.cpp
  provider). A base URL like `https://host/v1` therefore 404'd at
  `/v1/api/embeddings`. The Ollama adapter now strips a trailing `/v1`, so a URL
  copied from an OpenAI-style config still works.
- **Database writes are isolated across the shared SQLite handle again.** The
  engine swap put every repository on one `node:sqlite` handle, and `connect()`'s
  session mutex only ordered sessions against each other — a direct `db.query()`
  (e.g. a fire-and-forget embedding write) could land inside another request's
  open `begin immediate` transaction and be committed or rolled back with it. A
  single FIFO gate now serializes all handle access: a checked-out session holds
  it for the whole `BEGIN…COMMIT`, so direct queries wait rather than interleave.
  (`db.exec` stays an ungated passthrough — the migration runner calls it on the
  raw handle inside its own session transaction.)
- **Reindexing re-embeds after a model change within a backend.** The
  "needs embedding" query compared only `embedding_backend`, so switching model
  (e.g. openai `text-embedding-3-small` → `-3-large`, a different dimension) left
  stale vectors that silently dropped out of search or mis-ranked until a *force*
  reindex. Each embedder now exposes its `model`, and the query also re-embeds
  rows whose `embedding_model` differs. The semantic-status "embedded" count is
  likewise model-aware, so it reads honestly (stale, not embedded) after a model
  change and nudges a reindex instead of claiming everything is current.
- **Constraint violations map to their pg SQLSTATE again.** The engine-swap
  error normaliser gated on `err.code === undefined`, but `node:sqlite` tags
  every error with `code: 'ERR_SQLITE_ERROR'`, so the remap to `23505`/`23503`
  never ran — a dependent added between the count check and delete surfaced as
  a 500 instead of the intended 409. It now keys off `errcode`/message.
- **`db.query()` rejects instead of throwing synchronously on failure**, so the
  `rollback().catch(…)` swallows in `replaceProjectTasks` and the migration
  runner actually catch (a failed rollback no longer masks the original error).
- **Markdown code spans and `[[wiki-links]]` no longer corrupt on `$`.** Token
  restoration used a string replacement argument, so `$&`/`` $` ``/`$'` in the
  escaped HTML (reachable from any code/title containing `$`) expanded as
  replacement patterns and leaked a NUL sentinel; it now uses a function
  replacer that inserts the HTML verbatim.
- **Saving only the AI model no longer 400s when the Base URL field is blank.**
  The save sent `baseUrl: ''` whenever the field existed; the server rejects an
  empty URL. It now sends the base URL only when non-empty, matching the API-key
  field.
- **`cosineSimilarity` rejects vectors with `null`/`NaN`/non-number entries**
  instead of letting `null * null === 0` produce a finite-but-wrong score that
  ranks and passes the relevance cutoff normally.
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
