# Changelog

All notable changes to Prax (formerly Moomora Console) are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Prax is pre-1.0:
the data formats are still evolving, and `docs/contract.md` is a format *reference* (with
regression tests under `tests/contract/`), not a stability contract.

At release time, the `[Unreleased]` section is renamed to the new version with its date, and a
fresh empty `[Unreleased]` section is started.

## [Unreleased]

### Changed

- **Only user-facing guides stay in the tree until v0.99.0.** The contributor guide, the design
  note for each subsystem, the desktop build guide, the security policy and model, the product
  quality standard, the evidence scorecards, the quality fixture guide, the manual drill templates
  and the interface design notes moved into the Prax Library as documents of the Prax project
  (recall them by subject); the README lost its Run from source, Scripts, Project direction and
  Security sections, `docs/README.md` indexes the remaining guides, and `AGENTS.md` is a short
  pointer into Prax. Code comments and the surviving guides name the Library document instead of
  the file. The performance budget the gate script reads moved to `scripts/performance/`. Git
  history before 2026-10-25 keeps every file.

## [0.47.0] - 2026-10-25

### Added

- **Git backup and restore.** Settings ▸ Data & admin ▸ Git backup pushes the validated
  workspace snapshot (the same `prax.db` and manifest as the Full workspace backup, plus
  `RESTORE.md`, `tasks.json` and a readable Markdown copy of the Library) as one commit per
  backup to a private GitHub or GitLab repository, over SSH or with an HTTPS access token; a
  run whose database is unchanged makes no commit, and a daily schedule is optional. The
  token lives in an owner-only file beside the database, never inside the backup. Show
  backups lists the branch history and Restore… stages a commit: Prax checks it with the
  restore guards and applies it at the next start, keeping the current database in a rollback
  folder (the desktop app offers Restart Prax now; a failed apply keeps the previous database
  and says why). `prax backup`, `prax backup status | list | restore <commit> --yes` do the
  same from a terminal. The Docker image now installs `git` and an SSH client.

### Security

- Dependency updates for two high advisories in transitive packages (`body-parser`, `zod`)
  and two moderate ones (`fast-uri`, `ip-address`); lockfile only.

## [0.46.0] - 2026-10-16

### Changed

- **Ledger polish of the Console shell:** a CSS-only pass with no change to markup, actions
  or keys. The accent now marks only the current place (a 2 px bar in the sidebar margin),
  each page's one primary button and focus; the status-line mode is accent text instead of
  a filled block, and the titlebar New button is quiet so the page's own action stays the
  primary. The titlebar, sidebar, status line and docked inspector share the page surface
  with hairlines between them. Search and filter fields sit a step darker than the page.
  Trust reads as a provenance seal: a dashed violet ring for unverified, a solid accent ring
  with a tick for verified, struck for superseded, amber for synth, identical on Library
  cards and rows, the editor head, Today's night shift and the review desk. Library cards
  put the seals on their own line under the title instead of squeezing it. Buttons press
  back under the pointer and transitions use a fast ease-out; reduced motion still removes
  all movement. The decisions are recorded in `.interface-design/system.md`.

## [0.45.1] - 2026-10-13

### Fixed

- **v0.45.0 was tagged but never published:** its macOS desktop build failed on a
  timing-sensitive readiness test in the desktop shell (the runner's first progress report
  arrived after the test's 100 ms budget), with no change to the code under test. This release
  carries everything listed under 0.45.0 plus that test's wider scheduling margin.

## [0.45.0] - 2026-10-13

### Changed

- `npm run check` now includes an undefined-identifier lint (ESLint, `no-undef` only); it is
  the class of mistake that produced one of the review's findings and that `node --check`
  cannot see.

### Fixed

Everything in this section comes from the code-quality review of 0.44.0 (Codex, 2026-10-13,
three passes).

- **AI Undo no longer discards what you typed after Apply.** Undo on the toast or in the
  assistant restores the pre-Apply text only while the document still holds exactly the applied
  result; once you have typed since, it refuses and says to use ⌘Z, instead of silently
  replacing your later edits.
- **A failed Ask request now leaves the loading state** and restores the question to the input,
  instead of throwing inside its own error handler.
- **Housekeeping keeps content authorship.** Archive, restore, supersede and unlink, a tag
  change or a save with the same title and body no longer change who last wrote a document, so
  an unreviewed agent document stays in the review queue through all of them. Archive and
  supersession are attributed on their own fields (who did it, and which agent).
- **A truncated model answer is not presented as complete.** When the provider reports that
  the answer or the task proposals were cut off, Ask degrades with "answer truncated" rather
  than showing the partial text.
- **"Verified only" is applied before the candidate limit**, so a matching verified document is
  never crowded out by unverified neighbours. The "n unverified documents were left out" count
  says "at least" when the candidate list filled, says when it was unavailable, and can no
  longer cost an answer its sources; an unreviewed harvested candidate is reported as hidden by
  triage, not by trust. Ask history records the revision each source was grounded in and flags
  a source whose body changed since; an answer from before revisions were recorded says its
  sources cannot be checked rather than passing them off as unchanged.
- **Retrying a selection summary resends the selection**, not the whole document.
- **Replacement overview cards are deterministic.** When a project's card was moved or retired,
  the replacement's id is derived from the card occupying the slot, so two requests, in one
  process or two, converge on one card instead of each creating their own.
- **Table shortcuts:** Tab past the last cell adds the row after the table, never between the
  header and its separator; Enter at the end of the header row adds the first body row.
- **A restored semantic-search address runs its search;** a saved semantic view reopens as a
  semantic search; a tag with a comma survives the URL round trip (tags moved to a repeated
  `tag` parameter; a 0.44.0 address with comma lists keeps its meaning).
- **The truncated-answer notice no longer points at a setting that does not exist.**

## [0.44.0] - 2026-10-13

### Added

- **Tables in the editor.** A ▦ table toolbar button, ⌘⇧T and `/table` insert a table at the
  caret (or turn selected lines into rows, split on tabs, " | " or commas, the first line the
  header). Inside a table, Tab and Shift+Tab move between cells, Tab past the last cell adds a
  row, Enter at the end of a row adds a row, and Enter on an empty row leaves the table.

- **The Library has an address.** The filters, view, search, sort, grouping and layout are
  written to the URL hash (`#library?types=runbook&trust=agent&q=…`), so a reload comes back
  to the same view instead of the Inbox. `#doc/<id>` opens a document when typed or pasted;
  the editor itself writes no address, so a reload never lands inside a draft that vetoes
  navigation.

### Changed

- **The editor page is flat.** The document surface is no longer a rounded card floating in a
  margin; it fills the pane under a hairline, with the content as the edge.
- **Preview tables look like tables:** a rule under the header, hairlines between rows, cells
  that wrap instead of widening the page.
- **Ask Prax finds documents from a question in plain words without embeddings.** The keyword
  fallback is now the ranked, any-word search (BM25 with the relevance cutoff) instead of the
  Library's all-words listing filter, so "how do we fail over postgres" finds the Postgres
  failover runbook. A no-sources refusal that came from a keyword search says so and points at
  semantic search.
- **Ask page:** citation numbers are buttons that lead to their source card (named for
  assistive technology, keyboard reachable); the sources rail no longer fades its trust text;
  coverage notices (incomplete index, hidden harvested candidates, unverified left out by the
  toggle, keyword fallback) are shown as the old overlay showed them; a failed question keeps
  its text with a Try again; "Ask another question…" replaces the follow-up wording, since
  each question stands alone; the no-sources state no longer prints the empty context pack or
  a Copy button.
- **Ask history:** each entry records the scope and trust it was asked under; reopening one
  re-reads its sources from the library and says which were edited, unverified or removed
  since, dates the answer, and offers Ask again. The column is now a glance back, not an
  archive: the six most recent questions, two lines each, grouped by day, with Show all, a
  forget button per row, Clear history (with Undo) and a collapse toggle remembered per device.
- **Suggested tasks** arrive unticked, with a quiet Create button until something is chosen;
  the destination is the scope the answer was asked under; each proposal carries its own task
  id, so a lost response is reconciled instead of reported as a failure; a failed model call
  says so with Try again instead of "nothing calls for a task"; created proposals stay
  visible as created.
- **Write with AI:** applying a result is one change in the editor's own history, so ⌘Z
  restores the previous text, and the toast carries an Undo; the editor's undo stack now
  survives the app's re-renders; the preview is a true modal (focus moves into it, the editor
  behind it is inert, Cancel/Close always present, Try again on failure, a Settings link when
  no model is set); the menu and preview say that Apply saves like typing, and warn when the
  document is verified; opening the menu from the keyboard focuses its first action; the
  selection bar fits a narrow pane.
- **Narrow widths:** on phones the Ask page shows the answer first, then its sources, then a
  bounded list of earlier questions (the responsive rules used to be overridden); the ⌘K badge
  no longer collides with the Ask button.
- "Review it now" on a human-written unverified source opens that document in the editor,
  where Verify lives, instead of the review desk's first queue entry.
- **Ask and the assistant are visibly two contracts.** Once Ask has answered, its assistant
  link reads "Act on this with the assistant" and hands the question and the titles it was
  answered from into the assistant's composer. An assistant answer that read no Prax data is
  marked "From the model's own knowledge", with a link to Ask Prax for a cited one.

### Fixed

- **Desktop: the whole title bar drags the window again.** The Console title bar fills its
  width with the command bar and the action buttons, and Tauri starts a drag only on an element
  that itself carries the drag attribute, so only the brand area moved the window or zoomed on
  double-click. The wrappers, the wordmark and the breadcrumb text are drag regions now; the
  buttons stay buttons.

- **Tag housekeeping no longer evicts agent memory from review.** A patch that changes only
  tags, project or type leaves who wrote the document untouched (authorship follows content),
  so merging two tags on the Tags page keeps an agent's unreviewed note in the review queue and
  keeps a person's document theirs. The merge confirmation says so; the Tags page's columns now
  read "Last updated" and "Written by", which is what they measure, and a merge counts each
  document once.
- **Library on a phone.** The table's title column had no width (fixed columns ate the pane);
  under 520px a row is the title, wrapping, with trust and Review beside it. The facet rows fold
  behind "Filters · n active" with the active filters still removable above the fold, the
  search input takes its own line, Tags is in the ⋯ menu, and the review desk shows the
  document before the queue.
- **A pending or failed library load is not "Your library is empty".** The Library says
  "Loading…", a failure keeps the rows already loaded and offers Try again, and the welcome
  screen appears only after a load that really returned nothing.
- **One filter model.** Semantic search honours the active tags and facets and says how many
  matches they left out; "One at a time" walks exactly the rows the filtered table shows, in
  its order; Save view keeps every filter (types, trust, project, query, sort, grouping) and
  reopens them; a Tags-page link, the sidebar's Library and Clear filters reset every axis.
- **Cards say what the table says:** UNVERIFIED when nobody checked a document and who wrote
  it; an empty document reads "No content yet"; a select box sits beside each card, so bulk
  actions no longer require the table.
- **Bulk archive has Undo**, names what could not be archived and keeps it selected; the bulk
  bar says when a selected document is hidden by the filter.
- **Library truthfulness and reach:** the header count says "4 of 51 · filtered"; an unmatched
  Archive search says so instead of "No archived documents"; Group cycles Type, Project, Trust
  and None; facet pills, selection boxes and the ⋯ menu keep keyboard focus (Escape closes the
  menus); the STALE chip, archive rows, the semantic error line and the toast's Undo link meet
  contrast.

## [0.43.1] - 2026-10-13

### Fixed

- v0.43.0 was tagged but never published: its release run failed the browser suite on two
  specs that the seeded overview card had made ambiguous (a palette lookup matched both the
  project and its card; a toast assertion was too broad). The specs are fixed here; the app
  is unchanged from the 0.43.0 tag.

## [0.43.0] - 2026-10-13

### Added

- **Every project has an overview document.** Creating a project (in the app or with the CLI)
  files `<Name> project overview` in it: the bundled starter with the name and slug filled in
  (`prax init` adds the repository URL), tagged `project-card`, unverified until a person
  completes and verifies it.
  `POST /api/projects/:id/overview` and `prax init` add the card to a project that has none,
  and `prax doctor` lists active projects still without one. `prax overview` prints the card,
  and the project page has an **Overview** button that opens it (creating it when missing).

## [0.42.0] - 2026-10-13

### Added

- **Suggested tasks on Ask answers.** After a written answer, Prax proposes up to three
  follow-up tasks, each tied to one of the answer's sources (`POST /api/library/ask/tasks`;
  suggestions that cite nothing are dropped). They arrive ticked; untick any, then Create N
  tasks files them in the scoped project or the Inbox. Nothing is created until you choose.
- **Ask composer chips:** the project scope with its colour, a Verified only / Verified +
  unverified toggle (`trust: "verified"` on `/api/library/ask` leaves unverified memory out of
  the answer and its sources), and the answering model, which links to Settings.
- When one unverified source is cited, "Review it now" opens the review desk on it.

### Fixed

- Ask no longer calls the model when nothing in the library matches: it says so (reason
  `no-sources`) instead of answering from the model's own knowledge, or chatting back.

- The Ask page composer empties once a question is asked (the thread keeps the question) and
  takes new lines with Shift+Enter; typing a follow-up no longer cancels the answer in
  progress.
- The Library header no longer repeats Ask Prax; the titlebar's Ask and the palette open the
  same page.

## [0.41.0] - 2026-10-12

### Added

- **Library ▸ Tags**: every tag with its usage, last use and who added it; filters for possible
  duplicates, used once and agent-only; suggested merges that re-tag documents as a human edit.
- With a filter active, the Library panel lists only the tags present in the results.
- **Review desk.** The review queue is a place in the sidebar and opens one document at a
  time: the queue, the memory, and its provenance (agent, cited commits and code, recall
  counts, links). V verify, E edit, M supersede, R reject (archive), J skip; Verify binds to the
  revision on screen. The table and bulk verify are one click away.
- **Ask Prax page.** Questions get a full page: numbered citations matched to a sources rail,
  a warning when a cited source is unverified, a project scope, earlier questions on this
  device, and Save answer as note.
- **Write with AI in the editor head.** The writing actions (Draft from title, Summarize,
  Rewrite for clarity, Notes → checklist) moved from the end of the formatting toolbar to a
  "Write with AI" button. The menu says whether it will work on the selection or the whole
  document and what each action does; without a model it links to Settings ▸ Intelligence
  instead of being greyed out.
- **Editor selection bar.** Selecting text offers Summarize, Rewrite for clarity, Notes →
  checklist and Ask Prax… beside the selection.
- `[[` link completion shows each document's type and trust and ranks verified documents
  first.

### Changed

- **The Console interface.** A new layout and visual language
  ([design note](docs/design/console-shell.md)). Wide windows have one labelled sidebar
  (places, then the current context, Settings at the foot) instead of an icon rail beside a
  panel; the titlebar centres a ⌘K command bar; a status line names the mode and the keys that
  work in it. Dark "Graphite" is the default theme and light "Paper" replaces Porcelain; lime is
  the default accent; Schibsted Grotesk, JetBrains Mono and Newsreader replace Instrument Sans
  and Source Serif 4. Agent-written content is violet everywhere.
- **Docked task inspector.** At 1360px and wider, in project, Today, Filter and Calendar views,
  the task drawer docks beside the list as a non-modal pane; ↑↓ moves the selection and the
  inspector follows. Narrower windows keep the modal drawer.
- Task rows are flat and denser, with due dates as a right-hand mono column. A project's own
  board no longer repeats its name on every card.
- **Tags are normalised on every write** (lowercase, no leading `#`, spaces become hyphens,
  duplicates collapse) by the document API, so the app, CLI, MCP and agents agree on spelling.

### Fixed

- A chosen accent no longer sits on the default accent's wash: the derived accent tokens now
  re-resolve on `body`.

## [0.40.0] - 2026-10-11

### Added

- **Agents can archive, restore and delete from the CLI.** `prax archive <id>` takes one
  document out of recall, context packs and the mirror (or one task out of every open list)
  reversibly; `prax restore <id>` undoes it; `prax delete <id> --yes` is permanent and guarded:
  the record must already be archived, a verified document is never deleted by an agent, and
  `--yes` must be given. The id is tried as a document first, then as a task. The document
  archive and restore routes now stamp who did it (`updatedBy` / `updatedByAgent`), as every
  other document write does. Design note: `docs/design/agent-archive-delete.md`. The MCP server
  still exposes no archive or delete tool.
- **Session-start recall hook.** `skills/install.sh --hooks` now installs a second hook beside
  harvesting: `prax session-start --hook <vendor>` on Claude Code and Codex `SessionStart` and
  Copilot CLI `sessionStart`. It opens every session with a budgeted context pack for the
  project the session's directory belongs to, what changed in memory since that agent's last
  session (advancing the delta marker), and the two commands that close the loop. It fails open
  on everything (Prax down, no project, a deadline) and prints nothing. Design note:
  `docs/design/session-start-recall.md`.
- **`prax used` is taught.** The standing instruction block (CLI form), the recall skill and
  every `prax recall` hit block now say when to run `prax used <id>`, so the librarian can tell
  answered questions from knowledge gaps; before this nothing named the command and no used
  signal was ever recorded.
- **`prax doctor` reports repo-URL drift.** A `repo-url` check warns when the project detected
  for the current directory is registered to a repo URL that no longer matches the checkout's
  origin (the GitLab-to-GitHub move case), which silently breaks remote-based detection and
  `--cite` checks; `info` when nothing is registered yet.
- **`prax move <id> --to <project-slug>`.** Refiles one document or one task under another
  project from the command line, the way the Inbox lets a person refile a candidate with its
  owner. The id is tried as a document, then as a task; the target project must exist, only an
  active document moves, and a record already under the target is reported, not rewritten.
  `--json` prints the outcome with the updated record. The server routes already accepted a
  `project` slug; the CLI never exposed it, and a re-`remember` deliberately refines a title in
  place rather than moving it.

### Changed

- **The README explains the whole install.** Download and checksum verification, the
  per-platform steps (the unsigned-app approval on macOS, `apt install` for the `.deb`, FUSE for
  the AppImage), first launch and where the database lives, the one-line CLI and skills install
  from the bundle on macOS and Linux, update and uninstall. The v0.39.2 packages built on GitLab
  were verified against their `SHA256SUMS` and published as the GitHub release for the existing
  tag, so the download link works again (v0.21 to v0.39.1 remain on GitLab only).
- **Documentation consolidated.** `docs/` now holds one guide per subject plus an index
  (`docs/README.md`): the quality scorecards and the manual activation drills are one document
  (`docs/quality.md`), the roadmap folded into the README, the skills installation guide lives
  only in `skills/README.md`, and the design notes still describing current subsystems moved
  from `docs/superpowers/specs/` to `docs/design/` under plain names. The README is half its
  former length and links to the guides instead of restating them.
- **Dependency floors raised to the current minor and patch releases** (the Dependabot
  groups opened after the move back to GitHub, applied on `main` directly): `@fastify/static`
  10.1.6, `zod` 4.6.5, `@codemirror/*` (commands 6.11.1, language 6.13.1, state 6.7.6, view
  6.43.14), `@playwright/test` 1.64.0, `@tauri-apps/cli` 2.12.2; the desktop crate's
  `Cargo.lock` takes the cargo minor-and-patch group (brotli, cssparser, dom_query, html5ever
  and the rest); the workflows use `actions/cache` v6. Node stays on the 24 LTS line: the
  deploy image's Node 25 bump was declined and Dependabot now ignores major `node` bumps for
  the Docker image.
- **Repository and pipelines back on GitHub.** The project lives at
  `https://github.com/markjoyeuxcom/prax` again (the move to GitLab on 2026-09-07 was about
  GitHub-hosted macOS minutes). `.github/workflows/` replaces the GitLab pipeline: `ci.yml` runs
  the checks, unit + contract suite, dependency audit and browser suite on every pull request
  and push to `main`; `desktop.yml` builds both desktop packages by hand; `release.yml` turns a
  `vX.Y.Z` tag into one GitHub release with every package, `SHA256SUMS` and the changelog
  section as its body, a candidate marked as a prerelease. Every job runs on a GitHub-hosted
  runner with a pinned image (`ubuntu-24.04` in the `node:24-bookworm` container; `macos-15`
  for the macOS package, spent only on manual desktop builds and release tags) with the same
  pinned, checksummed Node and pinned Rust as before; no container image is published. The
  self-hosted runner setup that was in place for a day on 2026-10-10 is in git history.
  `tests/contract/desktopReleaseWorkflow.test.js` pins the workflows instead of the pipeline.
  The skills installer, plugin manifest, README, `SECURITY.md` (private vulnerability
  reporting), deploy manifests (the GitHub container registry image name, for self-built images), the
  changelog links and `scripts/prepare-release.mjs` name GitHub again, and the `gh` CLI
  replaces `glab` for fetching the installer. Dependabot is back (weekly npm and actions
  groups). The GitLab project is archived read-only with a pointer to GitHub.

- **Shorter standing instruction block.** `skills/install.sh --instructions` now writes a block
  of about 40 lines (was 54) into each agent CLI's global instructions file: the `remember` flag
  catalogue defers to `prax remember --help`, the recall-interpretation and proposal paragraphs
  are condensed, and the project-specific "Track the work" paragraph is gone (it belongs in a
  project's own `AGENTS.md`). The `Remember:` proposal marker is still taught when a harvest
  hook is installed. Re-run the installer with `--instructions` to refresh existing blocks.
- **`AGENTS.md` trimmed to Prax-specific guidance.** The repository guide no longer repeats the
  memory convention that the global block and `docs/agent-memory.md` already state.

### Removed

- **Historical planning and review material.** The implementation plans, the specs for shipped
  work that the guides now describe, the September 2026 review transcripts and their logs, the
  2026-07 desktop design prompts and prototype, and `docs/ROADMAP.md` were removed from the tree;
  git history keeps them. Comments that cited them now point at the guide or say nothing.

### Security

- **Dependency updates for new advisories.** `proxy-addr` 2.0.8 (critical: IP spoofing via an
  IPv4-mapped IPv6 trust subnet, GHSA-jqcg-44mw-7w3h, via `fastify`) and
  `@modelcontextprotocol/sdk` 1.32.1 (high). `npm audit --audit-level=high` is clean again.

## [0.39.2] - 2026-10-03

### Security

- **Dependency updates for new advisories.** `brace-expansion` 5.0.12 (high: three
  denial-of-service advisories, via `@fastify/static`), `fastify` 5.12.5, `fast-uri` 3.1.8 and
  `ip-address` 10.7.3 (moderate). All are patch updates within the existing version ranges; they
  were published after v0.39.0 and stopped the v0.39.1 release at the `npm audit` gate.

### Fixed

- **`prax task add --check` works again** (first published here; see 0.39.1). Since v0.39.0 every
  `task add` with a checklist was refused because `check` was declared both as `task add`'s
  repeatable checklist flag and as `mirror --check`'s boolean in one global flag grammar. Flag
  kinds are now chosen per command, and the CLI refuses to start if any command's grammar
  declares a flag with two kinds.

## [0.39.1] - 2026-10-03

Not published: its tag pipeline stopped at the `npm audit` gate (see 0.39.2). Its fix ships in
0.39.2.

### Fixed

- **`prax task add --check` works again.** Since v0.39.0 every `task add` with a checklist was
  refused (`--check needs a value`, or `--check takes no value` for `--check=<item>`), because
  `check` was declared both as `task add`'s repeatable checklist flag and as `mirror --check`'s
  boolean in one global flag grammar. Flag kinds are now chosen per command, and the CLI refuses
  to start if any command's grammar declares a flag with two kinds.

## [0.39.0] - 2026-09-23

### Added

- **`prax triage`** walks the review queue in a terminal, in the Library review walk's order:
  verify (`v`), edit in `$EDITOR` (`e`), supersede (`s`), archive (`r`), skip (`n`). Each
  document shows its trust, citations with drift, similar memories and a body excerpt; a
  truncated body must be read in full before `v` accepts it. All writes use the existing
  receipted routes.
- **Agents cannot verify memory.** `prax triage` and `prax verify` refuse to run under an agent
  CLI (PRAX_AGENT, `--agent` or a known vendor environment) or without a terminal, before any
  request, with no bypass flag.
- **`prax overview`** prints the project card in one call: a verified `project-card` first, then
  any `project-card`, then the "<Project> project overview" title, always stating its trust.
- **`prax brief <task-id>`** assembles one task's briefing: header, numbered checklist, latest
  handoff paragraph, linked and related documents with trust, and the top three related memories
  with citation drift and index coverage.
- **Budgeted context.** `prax context --budget <tokens>` and `prax recall --budget <tokens>` fill
  verified memory first, then memory whose citations still match this checkout, then the most
  recent, compacting to one labelled line per entry (a chars/4 estimate) and counting what was
  left out. Without `--budget`, output is unchanged.
- **Since-last-session delta.** `prax recall --since-last-session` (or `--since <iso>`) lists the
  memory created, updated, verified, superseded, deprecated or archived since this agent last read
  the delta. Markers are stored per agent (migration 0041) and only move after a complete read.
- **Session harvesting.** An agent proposes a memory with a `Remember:` line or a
  `prax-remember` block; a Stop hook (Claude Code, Codex, Copilot CLI; `install.sh --hooks`) files
  each proposal once as an unverified Inbox candidate with similar memories listed. Extraction
  reads only the agent's own messages, uses no model, and the hook never blocks an agent's exit.
  `prax harvest --transcript <file>` covers CLIs without hooks. Until a person verifies or
  re-files it, an unverified candidate tagged `harvested` is left out of agent-facing recall,
  search, context packs, Ask, brief and the delta, with the number hidden stated in every result
  (`--include-harvested` / `includeHarvested=true` to show); the web app still shows them.
- **`prax check`**, a citation-drift gate for CI: memories whose cited lines a change touches are
  reported as drift (exit 1), stale or holding; `--comment` writes a merge-request comment. It
  skips with a warning when Prax is unreachable (`--strict` fails instead). Citations gain
  whitespace-insensitive and enclosing-symbol anchors (migration 0039) so moved or reformatted
  code is still found.
- **Library git mirror.** `prax mirror` writes a project's Library into `.prax/library/` as
  deterministic Markdown v3; `prax mirror import` treats git-sourced verification as a claim
  (trusted verifier, unchanged content and an attended `VERIFY` confirmation); `prax mirror
  --agents-block` and `install.sh --library-block` compile verified decisions and `convention`
  documents into a bounded, separately marked block in agent instruction files.
- **Librarian.** Recall, search and context requests from the CLI, skills, MCP and assistant are
  recorded locally (migration 0040; 90 days, capped; never in portable exports; `prax telemetry
  clear`, `PRAX_RECALL_TELEMETRY=off`), with credential-shaped text in queries redacted before it is
  stored; person-driven Library searches are not. `prax used <id>`
  marks a memory as used. A librarian pass clusters near-duplicate memories into unverified
  proposal documents (never superseding anything until a person approves), lists knowledge gaps,
  sorts the review queue by recall frequency on request, and `prax doctor` summarises Library
  health for CI.

### Changed

- **Internal structure (no visible behaviour change).** The web app's 7,600-line `main.js` is now
  4,000 lines: thirteen feature controllers (plan mode, assistant, settings, document lifecycle,
  review walk, runs, Library transfer, knowledge tools, writing, document info, capture, template
  studio, task drawer) and one keyboard dispatcher with a documented priority order replace the
  in-file code and four separate key listeners. Every state field is declared in `state.js`.
- **HTML escaping is enforced.** One `html.js` module escapes text, attributes and CSS colours,
  and a test fails on any unescaped interpolation in any frontend module; it caught and fixed an
  unescaped project colour and about a hundred values that relied on convention. The Markdown
  renderer uses a per-render token table (NUL can no longer forge its placeholders) and explicit
  `document` / `untrusted` modes, and every call names its mode.
- **One client core.** The CLI and MCP server share one HTTP transport (discovery, headers,
  timeouts, error kinds and retry rules) and accept `PRAX_API_TOKEN` or `PRAX_TOKEN`; the
  skills parse arguments with the CLI's engine. MCP timeout and "unreachable" messages now match
  the CLI's, and MCP honours `PRAX_TIMEOUT_MS`.
- **One operation ledger.** Every retry receipt (document upsert and update, Inbox actions, task
  imports, assistant writes, record creation, generation) goes through one module over the
  existing tables; HTTP behaviour and stored hashes are unchanged.
- **Schema and restore guards.** Startup checks the full set of search, lifecycle and
  supersession triggers; a database with migrations this build does not know refuses to start
  (`PRAX_SCHEMA_TOO_NEW`); restore refuses a backup from a newer Prax or schema, and backup
  manifests record their final migration.
- **`desktop:verify` checks what ships.** It inspects the built payload and bundles after
  `tauri build` (files, version, production dependencies, sidecar Node) and runs in both desktop
  CI jobs; staging now clears Tauri's copied resources so a deleted file is never shipped.

### Fixed

- **`prax remember` could erase a document.** A missing `--body`, or one whose text began with
  `--`, was sent as an empty body over a same-title document while the command reported success.
  `remember` now requires a non-blank `--body` and refuses any value flag given without a value
  (write `--body="--text"` for text that starts with `--`). Re-remembering without `--tag` now
  keeps the stored tags on every path; `upsert-by-title` keeps them when `tags` is omitted.
- **Weekly review regeneration overwrote your edits.** Regenerating now refuses a review that a
  person or an identified agent edited since it was compiled (`reason: "edited-review"`), re-reads
  the review after the narrative is generated so a verification or edit made meanwhile counts,
  and writes with a revision check. Narration now reports why it degraded
  (`no-chat-model`, `generation-failed` or `empty-narration`).
- **Typing was lost when a toast expired or background data arrived.** Toast expiry now
  updates only the toast, and a render in the same view puts back the focused field, its caret
  and any text that lived only in the page: a new document's title, checklist items, dialog
  names, project renames, Settings fields and the editor's caret and scroll. Links and related
  notes that arrive in plain Edit mode no longer remount the editor. A background render during
  an inline project rename neither saves nor discards the half-typed name.
- **The desktop app vanished instead of showing recovery after a server crash.** A crash with
  the window open rebuilt the window under a label that was still registered, so no window
  remained. The open window now navigates to the recovery screen, which closes the app when
  closed, and window failures are written to `server.log`.
- **⌘Q, Dock Quit and logout killed the local server.** The macOS app menu's Quit now runs the
  same graceful shutdown as the tray, and every other quit path waits (bounded) for the server
  to close the database, so the WAL is checkpointed. The desktop smoke test now covers menu
  Quit, `terminate:` and a crash with the window open.
- **A fresh Compose volume could not hold the database.** The image creates `/data` for the
  non-root user and defaults `PRAX_DB_FILE` to `/data/prax.db`.
- **Copilot CLI answers work again.** Copilot ignores stdin when `--prompt` is set, so after the
  prompt moved off the command line it answered that it saw no request. The prompt now goes only
  through stdin (verified live against Copilot CLI 1.0.85).
- **Monthly repeats remember their day.** A series set up on the 31st now goes Feb 28 → Mar 31 →
  Apr 30 when completed on time (migration 0037 stores the anchor day; it round-trips through
  task export and import). Existing monthly tasks pick up their anchor from their next due date.
- **The CLI, skills and MCP send your local date and timezone,** so `prax task done` and MCP
  completions of recurring tasks roll forward from your day on a UTC server.
- **Project detection is stricter.** A `.prax` marker above the repository no longer beats a
  registered git remote, a subfolder name is never used as a project, guessing from the folder
  name warns first, and `remember` always names the project and its real trust status. CLI
  requests time out after 30 s (`PRAX_TIMEOUT_MS`).
- **Backups work above 2 GiB** (streamed hashing); document listings no longer read embeddings;
  task search ignores case for non-ASCII letters; unknown document `status` filters and invalid
  semantic-search settings are refused with `400`.
- **Stored data is trimmed and repaired.** Migration 0038 breaks supersession cycles created
  before 0031, and assistant and task-import receipts no longer keep copies of deleted content;
  idle task-import sessions expire after 7 days; assistant history is cut at a user turn and
  clipped text is marked.
- **Desktop startup and logging.** A saved port in use now says which port and what to do; long
  migrations report progress and get a 10-minute budget; `server.log` rotates at 5 MiB and no
  longer records every request; Library and workspace exports reach the Save dialog as raw bytes
  instead of a JSON number array.
- **Document links open in your browser** (the system browser on desktop, a new tab on the web);
  wiki links are keyboard-reachable; every dialog keeps focus inside it and makes the page behind
  inert; toasts are announced through one persistent live region; Escape and Enter are ignored
  while an input method is composing.
- **Today's side cards show true counts** and say how many more there are; smart views with
  non-Latin or similar names no longer overwrite each other; a failed chat-provider save keeps
  the typed CLI path.
- **Release and deployment hardening.** CI pins Node 24.21.0 (checksummed on Linux too) and Rust
  1.98.1, builds with `--locked`, and checksums packages where they are built; the Kubernetes base
  adds `seccompProfile: RuntimeDefault`, disables the service-account token and ships a
  NetworkPolicy; the startup probe allows 10 minutes. Docs now match shipped behaviour, including
  that no container image is published for current versions.
- **Truncated AI output is no longer presented as complete.** Every provider now reports when
  a reply hit its length limit. A cut-off writing action or runbook is refused, a cut-off
  post-mortem falls back to the chronicle template, a cut-off assistant answer says so, and a
  truncated tool call is never proposed. HTTP chat providers now time out (180 s; 300 s for
  Ollama).
- **OpenAI reasoning models work after a tool call.** Responses requests now ask for encrypted
  reasoning, and reasoning items that cannot be replayed are dropped.
- **Ask Prax cites what the model actually saw.** Citations are checked against, and Sources show,
  the documents placed in the answer context, bounded by `limit`.
- **The local embedder's relevance floor applies everywhere.** Context packs, Ask, similar and
  related documents use the active embedder's floor, as semantic search already did.
- **Accepting a wiki-link suggestion** re-embeds the document, refuses to overwrite a concurrent
  edit (`409`) and returns `404` for an archived document.
- **Document downloads with non-Latin names work**, using an ASCII `filename` plus RFC 5987
  `filename*`; the ZIP export also no longer holds two names that differ only by case.
- **Retried creates are exact once.** Tasks, checklist items and documents created with a caller
  id keep a receipt (migration 0034): an identical retry after an edit returns the record, and one
  after a permanent delete returns `410` instead of recreating it. MCP `create_document` now
  sends an operation id.
- **Google Calendar reconnects reuse the Prax calendar**, the OAuth callback and Settings agree,
  stale push errors clear, settings writes are serialised, and Sync now runs through the pusher.
- **Monthly recurrence keeps its day.** A late completion lands on the anchored day (Jan 31 → Apr
  30, not Apr 28). A series already stored on a clamped day cannot recover its original day.
- **Dates follow your timezone.** The web app sends its local date and timezone, so recurrence,
  planning and the assistant's "today" match yours on a UTC server, and run, activity, brief,
  Library, Inbox and editor timestamps display in local time.
- **The CLI refuses input it cannot use.** Unknown flags, surplus words, flags from other
  commands and invalid `--limit` / `--recent` values exit with usage; boolean flags never
  swallow the next word; `--tags` is an alias of `--tag`.
- **`prax recall` is honest about citations and keyword fallback.** Citations are only checked
  in a checkout of the same repository (otherwise the hit says why they were not checked); the
  keyword fallback reports `degraded`, pagination and relevance order, and checks citations;
  the moved-code scan is bounded.
- **The MCP server finds the desktop app** through the same discovery as the CLI, waits up to
  180 s for generation and Ask tools (`PRAX_MCP_TIMEOUT_MS`), says "may still be processing"
  rather than "unreachable" on a timeout, and a replay waits for a generation already running.
- **`install.sh --uninstall` no longer deletes instructions or breaks symlinks.**
- **Task changes say who made them.** Agent-created tasks, renames, description, notes, priority
  and checklist changes are logged with the agent id (migration 0036); `prax task list` shows open
  tasks by default. Activity recorded in the same millisecond keeps its order.
- **Frontend writes report what happened.** Promote and working-note failures are reported
  accurately; bulk, triage and plan-add report partial results; a task reload that started before
  a newer write no longer overwrites it; repeated Enter or double clicks no longer create twice.
- **Plan and shutdown keys act on the focused decision**, and a double activation no longer skips
  an item.
- **Preview checkboxes toggle** (click, Space or Enter) in an editable document, and link and image
  URLs containing `_` or `__` are no longer corrupted by emphasis. The title autosave keeps a
  trailing space while you type.
- **CLI flag values that begin with `--`.** `--flag=value` is now accepted everywhere, and
  `prax task add` refuses a bare `--check` instead of silently dropping the checklist item
  whose text started with `--`.

### Security

- **AI answers no longer load remote images.** Assistant answers, Ask Prax, AI narratives and
  writing previews render a remote Markdown image as an inert "not loaded" label instead of an
  `<img>`. A browser fetches an image as soon as it renders, so a prompt-injected answer could
  otherwise have carried Library or task text out in the image URL with no click. Only the
  editor preview of a document still loads its remote images.
- **The container keeps its DNS-rebinding defence.** The image listens on `0.0.0.0`, which used to
  switch the `Host` header check off even though Compose publishes the port on `127.0.0.1` only,
  so any web page whose name rebound to loopback could use the API. The new `PRAX_ALLOWED_HOSTS`
  setting turns the check on for any bind (loopback names and IP literals are always accepted;
  `*` turns it off). The image sets it to `localhost`; the Kubernetes base sets `"*"` to keep its
  previous behaviour. **Behaviour change:** a Docker or Compose install reached through a proxy
  hostname must add that name to `PRAX_ALLOWED_HOSTS`.

- **Other sites can no longer change your data.** Browsers send requests from any page to
  Prax's loopback port. State-changing requests are now refused (`403`) when `Sec-Fetch-Site`
  says they came from another site, or when a present `Origin` is not Prax's own origin.
  Command-line, MCP and other non-browser clients are unaffected.
- **The assistant shows exactly what it will change before you approve.** Each proposed write
  shows the target's title and every changed field, with a full body diff, and each write is
  approved or declined on its own. Tool input is validated against the tool's schema, and an
  agent's supersede records who did it.
- **Claude and Copilot CLI answers run without tools and without your CLI settings.** The
  Claude CLI now runs with all tools disabled and user settings ignored, and neither CLI receives
  Library text on its command line any more (it goes through stdin). A CLI that exits before
  reading a large prompt no longer crashes the server.
- **A document title can no longer fake a trust label.** Titles are single-line: line breaks and
  control characters collapse to a space on every write, migration 0035 repairs stored titles,
  and context packs, Ask context and the assistant snapshot render titles on one line.
- **Every account on the machine is trusted.** SECURITY.md now states this deliberate
  single-user decision: the loopback API has no credential, so other local accounts can use it.

## [0.38.0] - 2026-09-21

### Added

- **`prax task` commands.** Create, list, show, update, complete and tick tasks from any
  shell: `prax task add` with priority, dates, labels, notes and repeatable `--check`
  acceptance items; `list`, `show`, `update` (including `--append-notes` for handoff notes),
  `done`, `check` and `uncheck`. Creation commits the task and its checklist in one
  transaction through the exact-once import route with a fresh request id, so a lost
  response never produces a duplicate. Updates send one request and report an uncertain
  transport outcome as unknown rather than retrying over a newer edit. Every write carries
  agent provenance, and the project resolves as it does for `remember`.

## [0.37.1] - 2026-09-20

### Added

- **Full workspace backup from the export dialog.** Download a validated SQLite snapshot ZIP
  with a checksum manifest, starter guides and restore instructions. It preserves all saved
  projects, tasks, archives, templates, trust, links, citations, run history, settings and Inbox
  undo records. A bundled restore command verifies the checksum and refuses existing targets.
- **Optional Archive inclusion in Markdown exports.** Select it for a project or the entire
  Library. Export scope and the distinction between Markdown intake and full recovery are explicit.
- **Process Inbox.** File tasks and notes into their owning projects, plan a task's work
  date, complete it, keep it as a linked reference, archive it, or skip it. Decisions have
  retry receipts and guarded undo; unfinished decisions survive reloads in the same tab.
- **Inbox capture and review views.** Pending tasks and notes are counted separately from
  saved weekly reviews, with age indicators and a direct processing link in new reviews.
- **Reviewed AI filing suggestions.** The configured answer model can suggest an owning
  project, document type and possible duplicates. Coverage is disclosed; using a suggestion
  fills the form for review and never moves, merges, deletes or verifies an item itself.

### Fixed

- **Backup and restore commands work through symlinked paths.** They resolve their entry point
  correctly and perform the operation instead of exiting silently. Regression checks invoke both
  commands through aliases and verify the restored data.
- **Library exports retain current document metadata.** Markdown v3 includes each document's
  ID, lifecycle and verification state, specific agent, original filename, code/external references,
  linked task IDs and dependency hashes. Retired guidance keeps its status label. Full backups
  disclose saved credentials and the exclusion of unsaved drafts and browser-only state.
- **Library Back preserves the previous view.** The editor's Back button and breadcrumb
  restore tags, projects, type and trust filters, search, grouping, sorting, layout, loaded
  results and scroll position. Linked documents retain the original return view, and failed
  saves keep both the draft and its origin. Changed semantic results are refreshed.
- **Inbox is a default protected system project alongside Memory.** Upgrades restore a
  missing Inbox or reactivate the existing one without changing its contents, keeping
  capture and weekly review available. Both system projects show their purpose and hide
  forbidden rename, lifecycle and metadata controls. Tasks and notes can still be moved
  into their owning projects normally.

## [0.37.0] - 2026-09-20

Withheld before publication after the packaged restore rehearsal found a silent no-op through
a symlinked command path. The tag is retained; use v0.37.1, which includes these features and the fix.

## [0.36.1] - 2026-09-20

### Added

- **Reusable templates.** Save a Library document as Template and use it to create an
  independent, unverified copy in a chosen project. Choose the copy's title and type;
  the original content, verification and history remain intact.
- **Templates & guides for every installation.** The Library's New doc menu now includes
  repository setup, project overview, repository onboarding task and shared agent-memory
  starters. They work without AI and ship with desktop and container packages. Onboarding
  creates a planned task with nine native unchecked acceptance items.
- **Recoverable template creation.** Drafts and creation identities survive a tab reload.
  Repeated clicks and lost-response retries cannot create duplicate copies. Durable document
  receipts preserve later edits and permanent deletion; task and checklist creation is atomic.

### Changed

- **Shared agent guidance follows project ownership.** Project knowledge belongs in its
  owning Library, reusable conventions in Memory, and unfinished work in task notes/checklists.
  Repository setup covers new repositories, existing repositories and additional checkouts.
- **The instruction installer updates existing installations.** Managed blocks refresh in
  place while preserving custom text and symlinks, and malformed blocks are refused.
  Antigravity global instructions are included alongside Claude, Codex and Copilot.
- **Fresh installations receive generic starters, while upgrades preserve personal notes.**
  Built-in guides are packaged files rather than database seeds. Repository startup guidance
  no longer depends on this machine's overview ID. Container builds now include CLI and skills.

### Fixed

- **The bundled macOS installation command matches the actual app layout.** The shared
  agent-memory guide now includes the nested `Resources/resources/app` directory, with a
  regression check against the desktop resource configuration.

Version 0.36.0 was withheld during package verification. This release includes its template
and onboarding features with the corrected installation guide.

## [0.36.0] - 2026-09-20

### Added

- **Reusable templates.** Save a Library document as Template and use it to create an
  independent, unverified copy in a chosen project. Choose the copy's title and type;
  the original content, verification and history remain intact.
- **Templates & guides for every installation.** The Library's New doc menu now includes
  repository setup, project overview, repository onboarding task and shared agent-memory
  starters. They work without AI and ship with desktop and container packages. Onboarding
  creates a planned task with nine native unchecked acceptance items.
- **Recoverable template creation.** Drafts and creation identities survive a tab reload.
  Repeated clicks and lost-response retries cannot create duplicate copies. Durable document
  receipts preserve later edits and permanent deletion; task and checklist creation is atomic.

### Changed

- **Shared agent guidance follows project ownership.** Project knowledge belongs in its
  owning Library, reusable conventions in Memory, and unfinished work in task notes/checklists.
  Repository setup covers new repositories, existing repositories and additional checkouts.
- **The instruction installer updates existing installations.** Managed blocks refresh in
  place while preserving custom text and symlinks, and malformed blocks are refused.
  Antigravity global instructions are included alongside Claude, Codex and Copilot.
- **Fresh installations receive generic starters, while upgrades preserve personal notes.**
  Built-in guides are packaged files rather than database seeds. Repository startup guidance
  no longer depends on this machine's overview ID. Container builds now include CLI and skills.

## [0.35.1] - 2026-09-20

### Fixed

- **Memory retries preserve newer work.** Document updates now commit a durable operation
  receipt alongside the change, so a lost response and retry cannot overwrite an intervening
  edit. CLI, skills and MCP use the receipt endpoint, and remember carries the revision it
  read. Older servers receive one update attempt with an explicit unknown outcome if its
  response is lost. Other writes without receipts retry only failures known to precede connection.
- **Late verification responses preserve the active draft.** A conflict can refresh only
  the unchanged editor that requested verification, preserving subsequent typing and navigation.
- **Remember updates the correct project.** Cross-project title matches retain their owner,
  including on older servers; ambiguous owners are reported instead of creating duplicate memory.
- **Supersession links cannot form new cycles.** An atomic database guard rejects circular
  replacement chains through both link APIs, including concurrent requests and archived edges.
- **Review actions stay with their queue position.** Delayed verification and document loads
  respect Skip, Back and newer review sessions. Completed verification still updates its own
  queue count without advancing or replacing a different document.
- **External changes refresh after leaving the editor.** Today and other collection views
  refresh on focus even when a previous editor document remains in navigation state.
- **Verification changes refresh across clients.** Collection fingerprints include document
  revision and trust fields, so verification and unverification appear without a content edit.
- **Project deletion clears its calendar events.** Deleting a project with tasks queues a bulk
  Google Calendar reconciliation after the database commit.
- **Gemini tool conversations retain their signatures.** Original response parts and call IDs
  survive tool continuations, saved approvals and recovery, with bounded validation on replay.
- **Review guidance matches recall behavior.** Library, editor and Today explain that unverified
  memory can still be recalled and verification records human review.

## [0.35.0] - 2026-09-20

### Changed

- **The Library search bar is complete as drawn.** A `/` key cap sits in the bar and pressing
  `/` on the Library focuses it (anywhere else `/` still opens the palette). Keyword | Semantic
  is always there: without an embedding backend the Semantic half is dimmed and leads to the
  Intelligence card in Settings instead of vanishing.

### Fixed

- **The checkout binds to the `prax` project again.** `.prax/project.json` still carried the
  pre-rebrand slug, so project-scoped CLI commands run from the repo (`prax context`, `prax search`,
  `prax remember` without `--memory`) resolved to a project that no longer exists.
- **Board cards can be dropped into another lane in the desktop app.** The desktop window
  handed every drop to Tauri's file drag-and-drop handler before the page's own `drop` event
  fired, so a dragged card sprang back to its lane. Nothing in Prax takes file drops, so that
  handler is off and the board's drag and drop is the page's again. A browser test now drags a
  card between lanes and checks the task's status followed.

## [0.34.0] - 2026-09-19

### Changed

- **Panel section labels read as structure.** TYPE, PROJECT, TRUST, TAGS and every other panel
  section label are one shade stronger and sit under more air, so the groups separate by
  whitespace instead of blending into the rows beneath them.
- **Content group labels sit a half-step above the panel's.** Runbooks, Notes, Overdue, Today
  and every other group label are slightly larger and heavier, in the same ink as the panel
  section labels, with more room above each group, so the content outranks the sidebar.
- **The Library search matches the design.** One full-width bar with the search icon and the
  Keyword | Semantic segment inside it; Sort, Group and the cards / table switch move to a
  toolbar row beneath, where the active-filter chips sit on the left. The header now says how
  many documents there are and how many are verified.
- **New is one menu button.** The titlebar's New task button and its separate chevron are
  replaced by a single **New ▾** that opens New task (quick capture, still `N` from anywhere),
  New document and New project, task first so Enter gets the common case.

## [0.33.0] - 2026-09-19

### Added

- **The review queue walks.** Review (on a row) or Review next opens the document with a strip
  under the editor header: where you are in the queue, **Verify and next** (the same
  read-then-verify action as the document menu, then straight on to the next unverified
  document), **Skip**, and **Back to queue**. The last document offers Verify and finish and
  lands back on the queue with a count. The walk is a snapshot of the queue as shown, so a
  search or facet narrows what you review; a document verified elsewhere meanwhile is skipped.
  One click per memory instead of three.

- **⌘K opens on where you just were.** With an empty query the palette leads with a Recent
  group: the last projects visited and documents opened, most recent first, before the
  commands. Recently opened documents are remembered per device like recent projects.
- **Row density is in Settings.** The comfortable / compact preference sits in Appearance beside
  the other type and layout choices, as well as on every list's toolbar.
- **All projects groups by area.** Within each state, projects sit under their area — the same
  partition as the browser panel — with unassigned ones under Other; a workspace without areas
  looks exactly as before.
- **The board's Completed column is this week's, and creation is not activity.** The column is
  now **Done this week**, the same seven-day rule as the list; older finished cards leave it
  and a footer says how many and points at the list's Done earlier. Cards no longer show
  "Task created" as their latest activity: the extras endpoint now carries the event type
  (`latestActivityKind`), and a creation-only history renders no activity line.

### Changed

- **Small shell pieces from the year-one canvas.** The titlebar's New is a split button —
  capture stays the primary half, the chevron offers New document and New project (which lands
  on All projects with the name field focused). In narrow windows the rail shows the current,
  pinned and recent projects as lettered tiles, five at most, instead of one identical dot per
  project. Lists gain a comfortable / compact row density (a preference, applied on `<body>`).
  A project's Overdue header carries Reschedule all to Monday for that project. The Library's
  Semantic toggle becomes a Keyword | Semantic segment and gains Group: Type / None. ⌘K's
  selected task offers Today beside Done. Ninth and final item of the year-one shell spec.
- **Today, year one: overdue is a set to decide on, and the day has a second column.** Overdue
  work moves out of a plain group into a **triage band**: the count, how many have slipped at
  least twice, and three decisions for the whole set — reschedule everything to next Monday,
  send everything to the backlog (both undoable), or review one by one in Plan mode. The band
  previews the five oldest and unfolds on request; the selected row grows a Today / Monday /
  Backlog strip. Planned gets an **Edit plan** tail, Due today an **Add all to plan** tail, and
  the header a **Weekly review** button that says when one is due. A right-hand column shows
  the week's load by day, what agents wrote since yesterday with a link into the review queue,
  and any project carrying on-call or handoff notes; the Today panel groups the rituals
  (weekly review, brief, library health). Everything derives from already-loaded state.
  Eighth item of the year-one shell spec.
- **Library table mode and a review queue for agent memory.** The Library gains a **table**
  layout beside cards (a per-device switch next to Sort): one row per document with type,
  project, trust, tags, who wrote it and when, a select box per row, and a sticky bulk bar
  whose one action is Archive. The **Review queue** is a first-class destination — the panel's
  first row, an amber badge on the rail's Library button, a ⋯ menu item, and Library › Review
  queue in the breadcrumb — listing agent-written documents nobody has verified (superseded and
  archived ones excluded) with a banner that counts them per agent. Facets and search apply
  inside the queue. Each row's **Review** (and the banner's **Review next**) opens the document
  in preview with Verify at hand; leaving the editor returns to the queue. Verification itself
  stays a read-then-verify action in the editor, by design — nothing verifies blind. Seventh
  and last item of the year-one shell spec.
- **⌘K has scopes, deeper results, and an inline Done.** The palette gains a scope bar — All,
  Commands, Projects, Views, Tasks, Docs — with honest match counts; ⇥ / ⇧⇥ walk it and the
  input keeps focus. All keeps the mixed list with five per group and a "+N more in Tasks" row
  that jumps into that scope; a single scope lists up to forty and says how many more there
  are. A scope with an empty query browses the whole group (every project, every view), which
  All never did. The selected task row carries a Done button, also reachable with ⌘↵. Sixth
  item of the year-one shell spec.
- **On hold folds away, and the statusbar stops teaching.** On-hold projects leave the area
  sections of the browser panel for one trailing **On hold** section that starts folded (it
  opens on click and stays open per device, while you type a filter, or when the current
  project is in it); pinned on-hold projects still float to Pinned. The statusbar's permanent
  strip of shortcut hints is replaced by one line of facts — projects, open tasks, documents —
  and a **⌘/ shortcuts** button; the full keymap now lives in a Keyboard shortcuts overlay
  (`⌘/`, Esc to close) that lists what `keyboardShortcuts.js` actually binds, including the
  desktop capture chord. Fifth item of the year-one shell spec.
- **The titlebar crumb is a breadcrumb, and the panel remembers where you were.** "prax —
  Homelab" is now a path: Area › Project › View, Library › document (› Run), Library › Archive,
  Filter › view, Settings › section. Every earlier segment is a button that goes back there
  (the same actions the rail and panel use); the current place is plain text. Calendar and
  Filter, which used to show an empty crumb, are named. In the browser panel a **Recent**
  section lists the last three projects you visited (per device, like pins) once you have six
  or more projects, above Pinned and the areas; it steps aside while you type a filter. Fourth
  item of the year-one shell spec.
- **Library facets live in the panel on wide windows; the header is three controls.** The
  Library's context panel now carries every filter axis with live counts — Type, Project,
  Trust and Tags (most-used first, folded past ten, with a "Find a tag…" box once the list
  outgrows that) — dispatching the same `toggle-lib-*` actions as before. The main view keeps
  one search box and shows only the *active* filters, as removable chips with Clear filters and
  Save view, so nothing is filtering invisibly. Windows narrower than 940 px (no panel) keep the
  facet and tag rows. The header shrinks from eight buttons to **Ask Prax**, **＋ New doc** and
  a **⋯** overflow holding New runbook from an incident, Health, Weekly review, Import
  Markdown…, Export… and Archive/Active. Third and last item of the year-one shell spec.
- **List groups fold, and done work splits at a week.** Every group header in a project's
  List tab is now a collapse toggle (remembered per device, like panel areas), so Upcoming and
  No date can stay out of the way of the rows that need action today. The Completed group is
  replaced by **Done this week** and **Done earlier** (split at seven days on `completedAt`,
  else `updatedAt`, the same fallback the weekly review uses), both folded by default and each
  with an **Archive all** on its header that goes through the undoable bulk-archive path. Folded
  rows leave the keyboard order and the "Showing N of M" count. Second item of the year-one
  shell spec.
- **Project names no longer truncate behind the ops fields.** On-call, handoff, repo and area
  used to share the header row with the title and rendered even when empty, so a project called
  "Homelab" showed as "Homel…" at ordinary window widths. The header now keeps an **Ops**
  disclosure (collapsible, remembered per device like panel areas, with a count of set fields)
  and the fields sit on their own row beneath it; a field without a value is a small `＋ Field`
  button instead of an empty input. Inline editing and the debounced save are unchanged. First
  item of the year-one shell spec
  (`docs/design/year-one-shell.md`).
- **Any project can be deleted, and `memory` is the only protected one.** Permanent delete used
  to refuse every project that still held a task or a document (`409`), which in practice meant
  no real project could ever be removed, while the Inbox project was reserved outright. Delete
  from All projects now removes the project together with everything filed under it — tasks
  (with their checklist and activity), documents (with their links, refs and run chronicles) and
  staged imports — in one transaction, and the confirmation says so; the toast reports how many
  tasks and documents went with it. The reserved project is now the shared agent-memory home:
  migration 0030 seeds a `memory` project (adopting one the CLI already created), the server
  refuses to rename, change the status of, archive or delete it, and its All projects card shows a
  System chip instead of actions. Inbox is an ordinary project: still the default capture target
  while it exists, but the person may rename or delete it like any other.

### Fixed

- **Dark-mode and accessibility pass on the year-one surfaces.** A new Playwright axe audit
  covers Today's triage band and cards, the Library table and review queue, ⌘K with scopes,
  the shortcuts overlay and the New menu, in both themes. It found and this fixes: the overdue
  chip, Overdue group label and rail badge were below 4.5:1 in both themes (a new `--hi-text`
  token moves alarm red toward the theme pole before it becomes small text, as the accent
  already did); the UNVERIFIED chip referenced an undefined token and sat on a translucent
  wash, so it now has a solid card ground; the Library table's rows had no cell roles; the
  Today card links were under the 24 px target size; every menu panel's items now carry
  `role="menuitem"`. The audit for an open popover skips the target-size rule for the
  controls the popover legitimately covers.
- **Recent knows the project you launched into.** The project restored on boot is pushed into
  the panel's Recent list at once instead of after the next visit.
- **Every Library action behind the ⋯ menu has a ⌘K command.** Ask Prax, Review queue,
  Library health, Weekly review, Import Markdown…, Export library… and Keyboard shortcuts are
  palette commands, so nothing moved into the overflow lost its keyboard route. The weekly
  review runs through one shared function with a single in-flight guard, whichever entry
  point starts it.
- **Library health has a breadcrumb.** The health view read as an empty crumb; it is now
  Library › Health with Library a link back.
- **The Today plan Playwright spec no longer walks other specs' seeds.** Plan mode only offers
  Done at the end of its queue, and in a full run the shared server's queue outgrew the spec's
  40-card walk, so it timed out three runs in four. It now stops once its own two tasks are
  planned and leaves with Escape.
- **The task-context Playwright spec asserts its own premise.** It resets the semantic-search
  setting before it starts rather than inheriting whatever a failed earlier spec left behind.

## [0.32.1] - 2026-09-19

### Changed

- **Documented the desktop-bundle install route for the memory skills.** `docs/agent-memory.md`
  listed only the checkout and the `glab` clone, so a machine that installed Prax from the dmg
  looked like it needed repository access — it does not: the bundle ships the pack next to the
  app's CLI and MCP server. The install section now covers all three routes, names where the
  skills land per agent CLI, and states the Node 20+ requirement. `AGENTS.md` leads with the
  `prax` command (with the `node cli/prax.js …` fallback for a checkout without it), and the
  README no longer describes the skills as Claude Code and Codex only.

- **The standing memory instructions teach the command the machine can run.** `skills/install.sh
  --instructions` now writes the short `prax recall …` / `prax remember … --memory` form when
  `--cli` has put the shim on `PATH`, naming the shim's absolute path as the fallback, and keeps
  the installed skill scripts' absolute paths otherwise. `--cli` is applied before
  `--instructions` so the shim decides the form, and the closing check line follows the same
  rule. Switching an existing block to the other form still takes `--uninstall` first, because
  the start marker guards against a second write.

### Fixed

- **The macOS package can no longer ship a Node runtime that only starts on the build machine.**
  `scripts/prepare-sidecar.mjs` stages the sidecar by copying `process.execPath` verbatim, so the
  Node that builds the package is the Node inside it. A Homebrew `node@24` links against
  `@rpath/libnode.<abi>.dylib` and seventeen Cellar dylibs, and a dmg built with one shipped a
  `prax-server` that aborted with `dyld: Library not loaded` on every Mac but the builder's —
  invisible to `cargo build`, `tauri build` and the bundlers, because the failure is in the
  spawned child. Staging now inspects the runtime with `otool` and refuses anything that depends
  on more than `/usr/lib` and `/System`, naming each offending library, and the macOS job pins a
  checksummed official nodejs.org build so the shipped runtime is chosen rather than inherited.

- **The macOS build runs again after the runner moved to Tart.** The `macos` runner now uses
  gitlab-runner's custom executor with `gitlab-tart-executor`, which clones a throwaway VM per
  job, so `desktop-macos-arm64` must name its `image:` — without one every run died in the
  prepare stage with `CUSTOM_ENV_CI_JOB_ID is missing and no --default-image was set`, which is
  the executor's mislabelled wording for a missing job image. The job pins its VM image by
  digest and installs its own Rust, and names every toolchain path explicitly because the job's
  shell is not a login shell and the image's profile never runs.

- **`prax remember --memory` stamps the provenance it always claimed.** A memory written through
  the CLI's `--memory` namespace now carries `kind: synthesized`, as the `prax-remember` skill
  already did, so it gets the *SYNTH* chip in the library and is visible to the maintenance
  tooling instead of looking like a hand-written note. `prax help` says so, and its auto-detected
  agent list now names `copilot` and `antigravity` alongside `claude` and `codex`.

## [0.32.0] - 2026-09-16

### Changed

- **Library filter bar folds the tag long tail.** The tag row shows the ten most-used tags and
  a `+N more` pill (`Show fewer` once expanded) instead of every tag in the library; an active
  tag is always visible so it can be cleared. The row carries a *Tags* label like the Type /
  Trust / Project facets, so the filter bar reads as one block. On a 59-tag library this brings
  the first document group up by roughly five rows.

## [0.31.1] - 2026-09-16

### Removed

- **CI no longer builds or publishes a container image.** The `container` and
  `container-preview` jobs and the `container` stage are gone; a release tag now runs the
  quality gate and the two desktop builds, then publishes. No Docker is needed on the runner
  (no privileged executor, no socket mount), and release notes carry a *Container* section only
  when `release-notes.mjs --image` is passed explicitly. `deploy/Dockerfile`, the compose files
  and the Kubernetes manifests remain for self-built images; the last published image is
  `v0.30.0`.

## [0.31.0] - 2026-09-16

### Added

- **dmg-only machines need no repository.** The desktop bundle now stages the agent-skills pack
  next to the CLI and MCP server (`…/resources/app/skills`, required by the release verifier),
  and `skills/install.sh` run from inside a pack — the bundle or a checkout — installs from
  there without git or repository access. `--cli` writes a `prax` shim onto the app's own Node
  runtime; `--mcp` prints the four tools' `mcp add` commands against the bundle's server.
- **`skills/install.sh --instructions`** writes the standing "recall first / remember durable
  findings" rule into each tool's global instructions file — `~/.claude/CLAUDE.md`,
  `~/.codex/AGENTS.md`, `~/.copilot/instructions/AGENTS.md` — once, between
  `<!-- prax-memory:start/end -->` markers, naming the installed script paths; it prints the
  `COPILOT_CUSTOM_INSTRUCTIONS_DIRS` export Copilot needs and the workspace-file note for
  Antigravity, and `--uninstall` removes exactly those blocks. Unknown options are now an
  error instead of being ignored.
- The memory skills and `prax` CLI detect **GitHub Copilot CLI** (`COPILOT_CLI`,
  `COPILOT_AGENT_SESSION_ID`) and **Antigravity** (`ANTIGRAVITY_AGENT`,
  `ANTIGRAVITY_CONVERSATION_ID`) from their shell markers and stamp `updatedByAgent`
  accordingly, as they already did for Claude Code and Codex. `skills/install.sh` also links
  the skills into `~/.gemini/config/skills/` (`PRAX_GEMINI_SKILLS_DIR`) for Antigravity.

### Changed

- **CI runs entirely on self-hosted runners.** `homelab` is now the pipeline's default
  runner tag — checks, browser tests, the container build and the release job join the Linux
  desktop build there — so no job consumes shared-runner minutes. The macOS build keeps its
  `macos` tag. The container jobs build through the runner host's Docker socket
  (`/var/run/docker.sock`, mounted by the runner) instead of a `docker:dind` service, so the
  executor needs no privileged flag; the buildx builder is named per job and removed afterwards.
  The image is built for **linux/amd64 only** for now — arm64 (and its qemu registration on
  the runner host) is dropped, matching the desktop targets.

### Fixed

- **Remember no longer splits a memory across projects.** Recall searches every project but
  upsert-by-title is project-scoped, so refining a recalled `homelab` document with
  `prax-remember` (defaulting to `memory`) created a second copy. Recall now prints the
  project on every hit (`in homelab`), and a remember run without `--project` updates a
  same-title document in the one other project it lives in — tags merged, never copied into
  `memory`; a title present in several other projects is refused by name. `--id <uuid>`
  targets one document outright. `prax remember --memory` follows the same rule.

## [0.30.0] - 2026-09-14

### Added

- **Code-pinned memory.** `prax remember --cite <path[:start[-end]]>` (and the `prax-remember`
  skill) pins a memory to the code it describes: `document_code_refs` stores the path, range,
  commit and a sha256 of the cited lines — never the source. Recall run inside a checkout
  re-hashes the file and labels the top hit `changed`, `moved to path:a-b`, or `is gone`;
  outside a checkout it claims nothing either way. Served at
  `GET`/`POST`/`DELETE /api/library/documents/:id/code-refs`.
- **Hybrid retrieval (`?mode=hybrid`).** Semantic search can fuse the cosine ranking with
  FTS5 BM25 by Reciprocal Rank Fusion and nudge by trust, so a document whose vector is
  pending is still findable and an exact token (an error code, a version) matches. Each hit
  carries `match: { semanticRank, keywordRank, rrf, trust, score }`. The CLI and the
  `prax-recall` skill opt in; the web UI keeps the cosine default.
- **Trust and age in every recall hit.** The trust line now reads like
  `unverified · 2d old · via codex · keyword-only` (verification and by whom, lifecycle, age,
  writer, and a keyword-only marker), and related hits carry a snippet. Semantic-search refs
  gained `updatedAt` and `updatedByAgent`.
- **On-device embeddings (`local`).** An in-process backend (`@huggingface/transformers`,
  `Xenova/all-MiniLM-L6-v2`) with no daemon, key, or per-query cost. The runtime is an
  optional install, so the backend reports itself unavailable with the install command rather
  than failing at embed time; the desktop app, whose signed bundle cannot take the install,
  does not offer it.
- **Per-backend relevance floors.** A backend may declare the cosine floor its vectors need
  (`local` declares 0.35); `EMBEDDING_SEARCH_MIN_SIMILARITY` remains the operator override and
  wins only when it actually parsed as a number.
- `GET /api/settings/semantic-search` reports `unavailableReason` next to `connected`.

### Fixed

- **Whole-file citations no longer duplicate.** SQLite treats NULLs as distinct in a UNIQUE
  constraint, so the `document_code_refs` key never fired for a citation without a line range
  and every re-cite (or retried POST) inserted another row. Migration 0029 collapses existing
  duplicates to the newest pin and adds a NULL-safe unique index the upsert targets.
- **Trust weighting was not mild.** RRF compresses ranks into a 1.8× band, so the previous
  ×1.25 / halving-per-year weights let a verified hit at rank 16 take first place and sank a
  year-old top hit to last. Weights are now bounded (×1.05 boost, decay floored at ×0.9) and the
  magnitude is pinned by tests.
- A code citation with an `endLine` but no `startLine` is refused (`400`) instead of being
  stored as a whole-file pin under its own key.

### Security

- **DNS-rebinding defence.** A loopback bind now answers `403` to any request whose `Host`
  header is not a loopback name; `PRAX_ALLOW_UNAUTHENTICATED_NETWORK=true` lifts it for a
  loopback bind behind a local reverse proxy.
- The Claude and Copilot CLI backends run in a fresh private scratch directory (`mkdtemp`,
  mode `0700`) per provider instance instead of a fixed path under the shared temp directory,
  which on a multi-user host would have let another local user plant CLI hooks.
- The release pipeline pins `release-cli` to a version and verifies its SHA-256, and the
  registry login reads the token from stdin instead of the command line.

## [0.21.0] - 2026-09-06

### Added

- **GitHub Copilot CLI answer model.** Settings ▸ Intelligence can now use the local
  `copilot` login for keyless answers, with `auto` model selection by default and an optional
  binary path for desktop launches. Calls run non-interactively in an empty directory with a
  deny-over-allow tool fence, MCP servers and custom instructions disabled, serialized
  execution, and honest connection/error reporting.

- **`npm run release:prepare -- <version>`** cuts this changelog (renames `[Unreleased]`, merges
  duplicated subsection headings, rewires the compare links) and writes the version into every
  site that carries one — package, lockfile, Cargo, plugin manifest, published-image references,
  deploy overlays and docs — as listed in `scripts/release-sites.mjs`. `npm run release:notes --
  --tag vX.Y.Z` prints the release body.

- **Portable memory skill pack.** `prax-recall` and `prax-remember` now live in `skills/` as
  single-file bundles of `cli/lib` (Node 20+, no packages, no checkout), following the Agent
  Skills layout both Claude Code and Codex read. `.claude/skills/` and `.agents/skills/` are
  symlinks into it; `skills/install.sh` installs the pack on any machine without keeping the
  repository, and the repo doubles as a Claude Code plugin marketplace (`claude plugin
  marketplace add git@gitlab.com:markjoyeuxcom/apps/prax.git`). `npm run skills:build` rebuilds
  the bundles and `npm run check` fails when a committed bundle is stale.
- **Atomic remember.** `POST /api/library/documents/upsert-by-title` creates or updates by exact
  title within a project in one transaction; the CLI and skills use it (with a fallback for
  older servers).
- **Which agent wrote it.** Documents carry `updatedByAgent` (`claude`, `codex`, …) from the
  `x-prax-agent` header on agent writes (migration 0026). The CLI and skills detect Claude Code
  and Codex automatically; `PRAX_AGENT` / `--agent` override.
- **App discovery.** Without `PRAX_API_URL` the CLI and skills find the desktop app through its
  saved `webview-port` file before falling back to port 3000.

- **Claude CLI chat backend — your subscription powers Prax, no API key stored.** Settings
  ▸ Intelligence ▸ Answer model gains a **Claude CLI** provider that drives the Claude Code
  CLI headlessly (`claude -p`, JSON envelope) through the existing `claude` login — Pro/Max
  subscription auth, with **zero credentials in Prax** (`keyRequired: false`; there is no
  key field because there is no key). Every spawn is safety-fenced so an advisory call can
  never become an agent run: the CLI's built-in tools are denied wholesale, a no-tools
  instruction rides the system prompt, the working directory is an empty scratch dir, the
  MCP config is explicitly empty, and `--max-turns` caps the loop as a ceiling
  (`server/chat/claudeCli.js`). Spawns are serialized (one CLI
  process at a time, 120s timeout), the prompt travels over stdin, and the system prompt
  rides `--append-system-prompt` beneath the CLI's own guardrails. CLI outcomes surface
  **verbatim** through the never-500 advisory regime — a login prompt or rate-limit message
  arrives as the CLI said it, never dressed up as success. The desktop PATH gotcha
  (GUI-launched sidecars can't see `claude`) is handled by resolution order — explicit
  **Binary path** setting (a wrong explicit path errors, it is never silently replaced) →
  PATH → the usual install homes — and the card states the honest limitation up front: the
  in-app assistant's tool calling still needs an API backend (`supportsTools: false`
  degrades through the existing gate). Powers Ask Prax, NL capture/filter, writing
  actions, and review narration. Codex CLI can ride the same chassis later.

- **Task context surface — the Library feeds the task you're doing.** The task drawer
  gains a **Related knowledge** row: semantic suggestions from your notes and runbooks,
  shaped from the task's title + description in one pinned query-builder
  (`server/relatedDocuments.js` — markdown stripped, bounded, embedded transiently at
  request time; tasks are never written into the Library's index). Strictly advisory: the
  row fills **after** the drawer renders, already-linked and archived docs are excluded,
  and with embeddings off it degrades to one quiet labelled line pointing at Settings ▸
  Intelligence — never an error, never a delay. Each suggestion offers open, **＋ Link**
  (becomes a real task↔doc link), or a session-scoped dismiss. **＋ Working note** spawns
  a note titled after the task, seeded with a Context/Findings skeleton, pre-linked, and
  opened in the editor — one click from "starting work" to "taking notes that will be
  findable next time." The reverse surface (a document's "Referenced by N tasks"
  backlinks) already existed and completes the loop.

- **One-click weekly review — the week, compiled into a Library document.** Library ▸
  **Weekly review** compiles an honest week-in-review from live data: **Shipped**
  (completed this week, by project), **Stalled** (in progress, zero chronicle events all
  week), **Most slipped** (top deferred/rescheduled/carried offenders — the slippage and
  carry data feeding straight back), **Inbox aging**, **Silent projects**, **Next week**
  (due + planned, day by day), and the documents touched (wiki-linked, so reviews join
  the graph). An **empty week compiles truthfully** ("Nothing shipped this week.") — never
  padded, never omitted — and the doc footer states its own definitions (UTC Monday–Sunday
  weeks). Reviews are **idempotent by ISO week** (`Weekly review — 2026-W29`): regenerating
  updates the same document in place, never duplicates; a review you **verified** is
  refused rather than silently overwritten (regenerating would revoke your blessing).
  Written as a synthesized, agent-provenance doc in the system Inbox with a
  `weekly-review` tag — searchable, semantically embeddable, and recallable by agents
  ("what was I struggling with in June"). Optional AI narration appends a labelled
  `## Narrative` (degrades honestly without a chat model), and an opt-in Sunday-evening
  nudge reminds you while the week's review doesn't exist yet.

- **Today plan & shutdown ritual — Today stops showing what's due and starts asking what
  you'll do.** Tasks gain a **plan date** (`plannedFor`, migration `0021`): **Plan today**
  walks stale plans → overdue → due today → inbox → this week with keyboard-first
  add/skip (optional time input timeboxes the task — the date+time flow straight to
  Google Calendar via the live push; capturing mid-pass joins the plan automatically), and
  Today then leads with a **Planned** section, the honest score ("planned 5 — 2 done" —
  computed, no streaks), and due buckets that never double-show planned items. **Shut
  down** walks every unfinished planned item with exactly three verdicts: **Carry to
  tomorrow** (bumps a server-computed `carry_count` + a `carried` chronicle event — the
  old → new day recorded), **Reschedule** (a due-date change, honestly counted by the
  slippage rules), or **Drop from plan** (deliberately unrecorded — dropping a plan is not
  a confession). Skipped shutdowns surface next morning as a **stale-plan banner** whose
  Review walks those items first; moving a stale plan forward counts as a carry, because
  the day still moved. `planned:today|none|any|date` joins the filter grammar (smart
  views + agents), "carried n×" joins the slippage chips, both fields round-trip
  export/import, clients cannot forge the counter, and an opt-in evening nudge (Settings)
  reminds once per day after 5pm. Planning is fully optional: an unplanned Today behaves
  exactly as before.

- **Slippage honesty — your own procrastination, made visible the way the app's failures
  are.** Tasks now carry a **deferral count**: snoozing an open task into the future or
  moving its due date later bumps a server-side counter (one pinned rule in
  `server/slippage.js` — completing, scheduling an undated task, pulling a date earlier,
  and unsnoozing never count) and records an honest `deferred`/`rescheduled` chronicle
  event with the old → new detail. Open tasks past the thresholds wear calm chips
  ("deferred 4×", "60d old") in lists and board cards; the drawer states the exact count;
  thresholds and an off-switch live in Settings. A built-in **Stale** smart view (open,
  not snoozed, untouched 30+ days, backlog excluded — it's a parking lot by intent) joins
  the sidebar via new `stale:<days>` and `deferrals:<n>` filter-grammar atoms, available
  to saved views and agents alike. An optional **board WIP limit** renders the In-progress
  overrun (`5/3`) without ever blocking a drag — signals, never enforcement. Counts
  round-trip through export/import, clients cannot forge them, and counting starts
  honestly at zero (historic snoozes were never recorded; the app does not invent a
  backfill). Migration `0020`.

- **System-wide capture — tray icon + global hotkey capture bar (desktop).** Press
  **⌘⇧Space** (Ctrl+Shift+Space on Windows/Linux) anywhere on the desktop and a small
  always-on-top capture bar appears — type, Enter, done; the task lands in the Inbox (or a
  `#project`) without switching to Prax. The bar is served by the local server
  (`capture.html`) and reuses the exact in-app capture semantics: shorthand tokens
  (`#project @label !high tomorrow`), a live destination hint, and **exact-once creation**
  (client-generated id; an ambiguous failure keeps your text and Enter replays the same
  create — never a duplicate; unknown `#project` tokens fall back to Inbox with the token
  kept in the title). Typed text survives restarts via a draft store deliberately separate
  from the in-app capture's crash-recovery slot. The new tray icon offers Capture task /
  Open Prax / Quit; the main window now closes to the tray, macOS dock-reopen and second
  launches resurface it, and if another app owns the shortcut the tray tooltip says so —
  the tray path keeps working (degraded, never broken). First item of the
  2026-07-18 workflow & self-organisation roadmap.

- **Google Calendar push sync (Phase 2) — live incremental push + reconcile sweep.** Task
  changes now reach Google **within seconds, automatically** — no Sync now click. Every task
  mutation route (create, edit, complete, archive, restore, permanent delete, recurring
  successors, board drags that flip status) notifies a **debounced, coalescing pusher** that
  decides per task: still an open dated task → upsert its event; anything else → delete exactly
  its derived event. The push is **fully detached from the mutation** — a Google failure or a
  disconnected integration can never fail, slow, or block a task operation (mutations while not
  connected produce zero Google traffic). Bursts (imports, project replaces, >25 queued changes)
  collapse into **one full reconcile** instead of hammering per-event calls, and a background
  **15-minute sweep** re-runs the reconcile so anything a failed push missed heals itself. The
  Integrations card gains an honest **live-push status line**: last-push heartbeat, or the exact
  push error with the truthful caveat that the sweep will retry it (`lastPushAt`/`lastPushError`
  in the status API — the MCP server and in-app assistant inherit live push for free since they
  mutate through the same routes). Because pure re-sorts never touch eligibility, drag-reorders
  push nothing unless a status actually changed.

- **Google Calendar push sync (Phase 1) — connect, dedicated calendar, Sync now.** Prax pushes
  open dated tasks into a dedicated **"Prax" calendar** it creates in your Google account: a
  **one-way projection** (tasks stay the source of truth) using the granular
  `calendar.app.created` scope, so Prax can only ever touch calendars it created itself. You
  bring your own Desktop-type OAuth client (setup guide: [docs/google-calendar.md](docs/google-calendar.md));
  the client id/secret live in `app_settings` beside the AI keys and are **never echoed** by the
  API. Connect runs the installed-app OAuth flow — PKCE + loopback redirect to whatever port
  Prax is on — with single-use, expiring state. Events use **stable IDs derived from task ids**
  (idempotent upserts; a stale task deletes exactly its own event), all-day vs timed mapping
  mirrors the ICS feed via a shared `isCalendarEligible` rule (open dated tasks; completed,
  backlog, archived, and snoozed excluded), and recurring tasks carry no RRULE. **Sync now**
  reports honestly — pushed/removed counts, per-task failures shown as degraded, never clean
  success; every Google failure degrades (200 + reason) and never breaks task operations.
  Disconnect revokes the token at Google and deliberately leaves the calendar. New Settings ▸
  **Integrations** tab with connect/sync/disconnect and truthful status. Phase 2 (above) adds
  the per-mutation incremental push + reconcile sweep.

- **Exceptional-quality baseline — the product-wide quality program.** *(Entry added
  retroactively for the `400452f` commit, which shipped without one.)* Adopts
  [Exceptional Prax — Product Quality Standard](docs/design/quality-standard.md)
  (product promise, two-speed Gate A/B ratchet, invariants, critical journeys, scorecards) and
  lands its infrastructure in one pass: fixes for a prior external review's findings; **MCP
  pagination** (paged envelopes with `total`/`hasMore`/`nextOffset` replace the silent 20-item
  cap across every list tool); **exact-once task import** with durable request identity
  (migration `0014`) and creation receipts (`0015`); **supersession lifecycle enforcement** in
  SQL triggers (`0012`); a **durable runbook chronicle** that survives document deletion
  (`0013`); **SQLite backup/restore machinery** with an operator CLI and restore drills; task,
  document, and capture **draft recovery** (localStorage) with a task mutation queue; secure
  deployment defaults (loopback bind + explicit network acknowledgement, CSP and security
  headers, `/readyz`); a large **Tauri desktop lifecycle rework** (readiness protocol, splash,
  export dialogs); the mature-workspace **quality fixture** + performance measurement/gates; and
  14 e2e journey specs that encode the standard's invariants as executable tests.

- **Calendar view + ICS feed — see dated tasks on a month grid, and subscribe from a real calendar app.** A new **Calendar** entry in the sidebar (and narrow-window rail) renders open dated tasks on a Monday-start month grid: compact chips show the priority dot, time-of-day, and title; **today** gets an accent ring; ‹ / **Today** / › page between months; clicking a day opens a detail strip below the grid that reuses the standard task rows (so the drawer, done-toggle, and project chips behave exactly like every list view), and clicking a chip opens the task drawer directly. <kbd>Esc</kbd> dismisses the day strip like every other transient surface. The inclusion rule is identical to Upcoming: open tasks only — completed, backlog, archived, and snoozed tasks stay hidden. Grid arithmetic runs on a **UTC clock**, so the month layout is host-timezone-independent (even Samoa's skipped 2011-12-30 renders exactly once — regression-tested under `TZ=Pacific/Apia`).
  Alongside it, `GET /api/calendar.ics` serves the same open dated tasks as a standards-compliant **iCalendar feed** (pure `server/icsFeed.js`: RFC 5545 escaping, 75-octet multibyte-safe line folding, stable `<taskId>@prax` UIDs so a resubscribed feed updates in place): tasks without a time are all-day events, timed tasks use **floating local times** (matching the app's wall-clock semantics), priorities map to ICS priorities, and the project becomes the event category. `?project=<slug>` scopes the feed and names the calendar after the project. Recurring tasks deliberately carry **no RRULE** — Prax spawns the next instance server-side on completion, so an RRULE would double-count. The Calendar view shows the feed URL with a copy button when the origin is durable (server/Docker); the desktop shell hides it, because its port changes per launch. *(Hardened by an adversarial review that executed its attacks — 9 candidates, 0 refuted: the feed resurfacing snoozed tasks the app hides everywhere else; a year-9999 due date emitting a grammar-invalid expanded-year DTEND that could break the whole subscribed feed (now omitted — the spec default is exactly one day); the desktop shell advertising a launch-scoped subscribe URL that dies on relaunch; day cells advertising `role="button"` keyboard operability that no code path honored — worse, Enter on a focused cell reopened an unrelated task's drawer; Escape being unable to dismiss the day strip; and the timezone-dependent grid arithmetic above.)*

- **External references — link a memory to a PR, dashboard, or upstream issue without copying the content.** A document can now carry pointers to the outside URLs it's about: a new `document_external_refs` table (migration `0011`; unique per document+URL, cascade on delete), three REST routes (`GET`/`POST`/`DELETE /api/library/documents/:id/external-refs` — the POST is an **idempotent upsert**, returning `201` on create and `200` when the URL was already attached, refreshing the label either way), three MCP tools (`list_external_refs` / `add_external_ref` / `remove_external_ref`, tool count 32 → 35), and `prax remember --ref <url>` to attach one from the CLI in the same breath as the memory itself. In the editor, refs render as an **External references** section in the preview sidebar — each row shows a derived kind chip (**GitHub** / **GitLab** / **Link**, computed at render time from the host by a shared DOM-free module, never stored) and opens in a new tab — and are edited as plain `url | label` lines in the Document info form, reconciled against the stored set on save. URLs are stored as entered (no format validation — an odd URL just renders as a Link chip), and refs are runtime metadata, deliberately **not** part of the portable `.md` export (like the trust fields).
  *(Hardened by an adversarial review — 5 finder angles, every candidate independently re-executed against the real code — that confirmed and fixed real bugs before ship: the `url | label` line format split on the first bare `|`, so a stored URL that legitimately contains a pipe — a Grafana template-variable query string — was silently deleted and recreated truncated by **any** Document-info save, even one that never touched the refs field (the separator is now whitespace-then-pipe, which can't occur inside a URL, and round-trips are regression-tested); a `javascript:`/`data:` URL rendered as a live anchor in the sidebar — an XSS vector `escapeHtml` can't catch — and now renders as inert text unless the scheme is http/https/mailto; a stored newline in a label or URL split one textarea line into two on the next save and resurfaced as a phantom ref (control whitespace is now sanitized server-side); saving the form before the stored refs had loaded silently merged instead of replacing (the form now snapshots the refs it was seeded from and reconciles against that snapshot — and a background refs load can no longer re-render an open form and wipe what you'd typed, a guard also applied to the four sibling sidebar loaders); and per-ref save failures were swallowed silently (now counted and surfaced as a toast).)*

- **Memory type taxonomy — first-class decision / known-issue / reference / post-mortem types.** Documents grow beyond runbook-or-note: the type set is now `note`, `runbook`, `decision` (a choice made and why), `known-issue` (symptom + workaround), `reference` (lookup material), and `post-mortem` — defined **once** in a shared registry (`public/js/documentTypes.js`) that drives the server validation, the MCP tool schemas (and therefore the in-app assistant), the `prax` CLI, the skill conventions, and the whole Library UI (type facets are now OR-within-axis with zero-count pills hidden, card-grid sections come from the registry, each type gets its own chip tint, and the New-doc menu gains Decision / Known issue / Reference templates). `prax remember --type` **validates instead of silently coercing** to note, and re-remembering an existing title can retype it. Auto post-mortems graduate from a tagged note to the real `post-mortem` type (existing tagged ones are retyped in the migration; the tag stays for continuity).
  Under the hood this is the repo's first **table-rebuild migration** (`0010`): SQLite can't alter a CHECK constraint, so `markdown_documents` is rebuilt **without** one — the registry is the enforcement point now (like task statuses), meaning future types never need a rebuild. The migration runner gained a `-- migrate:fk=off` marker implementing SQLite's documented rebuild protocol: foreign keys off outside the transaction (a `DROP TABLE` with them on would cascade-delete `document_links`/`runs` rows), `foreign_key_check` before commit, pragma restored after. rowid is copied explicitly so the FTS5 index stays keyed correctly, and the FTS triggers + indexes are recreated and rebuilt — all covered by a dedicated migration test that carries a populated pre-0010 database across intact.

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
- **Labels, filters, smart views, and the week ahead** — a Todoist-inspired task milestone.
  - **Labels** on tasks: cross-cutting `@labels` (`@waiting`, `@pagerduty`, `@cert-rotation`), normalized to lowercase, edited as chips in the task drawer. New additive `labels` column (migration `0007`).
  - **A filter grammar + Filter view**: a live query box (`@label`, `#project`, `p1`, `overdue`, `due:today`, `status:in-progress`, `is:recurring`, boolean `&`/`|`/`-`/`( )`, bareword = title) that filters across all projects as you type. One shared pure predicate module evaluates it, so the **`search_tasks` MCP tool** accepts the *same* `filter` expression — humans and agents query identically. Save any expression as a **Smart view** in the sidebar.
  - **The week ahead on Today**: below Overdue and Today, a collapsible **Next 7 days** section groups dated tasks by day (Tomorrow, then weekday and date). It replaces the 3-day "Due soon" bucket and the separate Upcoming view that briefly existed during this cycle, so there is one place that answers "what is due"; the sidebar's Today cockpit counts it too.
  - **Capture tokens**: quick capture now also parses `#project` and `@label` out of the typed title (e.g. `rotate certs #homelab @cert !high fri`).

### Changed

- **The repository moved to GitLab** (`https://gitlab.com/markjoyeuxcom/apps/prax`) on
  2026-09-07 after the GitHub Actions minutes ran out. CI is now `.gitlab-ci.yml`: every merge
  request and push to `main` runs the Node checks, the unit and contract suite, the dependency
  audit and the browser suite; the two desktop builds run on the project's own runners (Linux x64
  on the runner tagged `homelab`, macOS Apple Silicon on the runner tagged `macos`), manual there
  and automatic on release tags; a release tag builds the multi-arch container into
  `registry.gitlab.com/markjoyeuxcom/apps/prax` and creates a GitLab release with both desktop
  packages, `SHA256SUMS` and the changelog section. A missing package fails the release.
  GitLab's hosted macOS and Linux ARM64 runners are not assignable on the Free plan (the jobs
  fail with `no_matching_runner`), which is why the builds live on the project's own runners and
  Linux ARM64 is no longer a target; an offline runner holds a tag pipeline rather than letting it
  release without a package (`docs/desktop/BUILD.md`). The skills installer and its docs use `glab` (or SSH, or a token)
  instead of `gh`; the Claude Code plugin marketplace is added by git URL; Dependabot is gone.
  The GitHub repository is kept read-only.

- **Context-aware panel — the second column follows the rail.** The panel stops being a
  fixed projects browser and becomes the secondary navigation for wherever you are:
  **Today** shows a plan cockpit (the honest score, Plan today / Shut down right there,
  overdue / due / snoozed counts, a planned-earlier review shortcut, and the working set
  as clickable rows); **Calendar** gets a Monday-start mini month with load dots, a today
  mark, month arrows, and the selected day's tasks underneath; **Library** (and the
  editor) get a document browser — types with live counts as one-click filters, Library
  saved views in their natural home, and the five most recently touched docs;
  **Settings** turns its tab strip into panel rows plus a small live-status block
  (calendar sync age, capture chord). Project contexts keep the exact Projects/Views
  browser (pins, areas, filter — untouched), **Filter now auto-selects the Views tab**,
  and narrow windows keep the in-page Settings strip since they have no panel. Every
  context panel re-arranges already-loaded state over existing actions — the cockpit's
  rows are the same `open-task`, the mini-month days the same `calendar-select-day`, the
  type filters the same facets — so panel and main view can never disagree.

- **Customizable capture shortcut + desktop tray polish.** Settings ▸ Appearance (desktop
  app only) gains a **Capture shortcut** row: type a chord (`CmdOrCtrl`, `Alt`, `Shift`,
  `Super` + a key), Apply, and it re-registers **live — no restart**. The chord persists
  in the app database (travels with backups); the shell fetches it at startup and remains
  the honest arbiter: a chord another app owns reports "Saved, but not active" with the
  exact reason, and the tray tooltip says so too. Leave it **empty to disable** — the tray
  Capture item always works. Polish: the macOS tray icon renders as a **template icon**
  (correct in light and dark menubars) and the capture bar now summons on whatever
  Space/desktop is active. The desktop checklist gains a per-OS manual-check section for
  the whole tray/capture/shortcut surface. Completes the system-wide capture plan.

- **Areas and folders — scale becomes structure (layout option C).** Projects gain an
  **area** (migration `0022`): free text, edited inline in the All-projects ops row beside
  on-call/handoff/repo, and the panel's Projects tab groups by it — areas as alphabetical
  **collapsible sections** with counts, unassigned projects under "Other", and zero
  change when no areas exist (the flat list stays the flat list). Smart views file into
  **folders** with no schema at all: save a view as `Folder/Name` (the dialog's
  placeholder says so) and it lands in that collapsible folder — stored labels containing
  slashes from before the convention are never reinterpreted. Collapse state is per-device
  (localStorage, like pins), a typed panel filter **auto-expands everything** (hiding a
  match inside a collapsed section would make the filter a liar), pinned items stay above
  all grouping, and ⌘K project results now read "Project · Work" so the area
  disambiguates from anywhere. Areas ride every existing surface for free — project
  payloads, MCP `list_projects`, the weekly review. This completes the sidebar-at-scale
  arc: rail → panel → ⌘K → pins → areas.

- **Pinned favorites — star what you use daily.** Every row in the panel grows a
  hover-revealed **☆ star**: pinned projects and views float into a leading **Pinned**
  section on their tab (kept in list order, honest about staleness — a pin for a deleted
  project simply never renders), and pinned items also **rank first in ⌘K results**. Pins
  are per-device view state in localStorage, exactly like smart views — never server data.
  Projects and smart views pin by id; Library saved views pin by label (their only stable
  identity). The last piece of the sidebar-at-scale work: rail for destinations, panel to
  browse, ⌘K to teleport, pins for the daily five.

- **⌘K jumps to projects and views.** The command palette gains **Projects** and **Views**
  result groups while you type: any active or on-hold project (Inbox included), any smart
  view (built-in Stale too), and any Library saved view is now two keystrokes away —
  `⌘K`, a few letters, Enter. Navigation targets rank above content search (a short query
  usually means "take me there"), on-hold projects say so in the result line, and library
  views jump by their stored identity so a filtered result can never open the wrong one.
  The companion to the rail + panel shell below: at 60 projects and 80 views, nobody
  scrolls.

- **Rail + panel shell — the sidebar becomes a browser.** The single wide sidebar is
  replaced by a two-level shell built for scale (chosen from three mocked layouts): a slim
  **icon rail** owns every top-level destination (Today, Calendar, Inbox, All
  projects, Library, Filter, Settings pinned at the bottom — now with mini count badges on
  Today and Inbox), and a **browser panel** beside it owns the growing lists: a
  **Projects / Views tab pair with live counts** and a **type-to-filter box** that narrows
  as you type and reports "No matches" honestly. The Views tab gathers task smart views
  (built-in Stale included) and Library saved views in one place. Every classic affordance
  survived the move unchanged — project dots and open counts, hover-× deletes, active
  states, manage-projects ＋, and the full `data-action` vocabulary (which is why the
  entire e2e suite still means what it meant). Narrow windows (<940px) keep the familiar
  rail-only mode with project dots. Found by the WCAG gate during the build: the ＋ button
  originally sat inside `role="tablist"` (axe `aria-required-children`, critical) — moved
  beside it. Follow-ups that layer on this shell without rework: ⌘K jump targets for
  projects/views, pinned favorites, and area grouping.

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

### Removed

- **Document-orphan detection.** Standalone documents are valid—especially memories retrieved
  through search rather than explicit graph edges—so the noisy orphan heuristic has been removed
  from Library Health, Settings maintenance, the REST API, and the MCP tool surface. Typed document
  links, stale-derivation detection, and wiki-link suggestions remain.
- Linux ARM64 installers. The pipeline builds macOS Apple Silicon and Linux x64 only; GitLab's
  hosted ARM64 runners are not available on the project's plan and there is no self-hosted one.
- The experimental Plain editor and editor-engine selector. CodeMirror is now the
  sole editor engine; saved Plain preferences automatically use CodeMirror while
  retaining font, line-number, and reading-scale choices.

### Fixed

- **OpenAI Answer model 400 errors.** The OpenAI backend now uses the Responses API for current
  model and tool-calling compatibility, retains Chat Completions for llama.cpp, replays reasoning
  output statelessly with provider storage disabled, and surfaces the provider's bounded error
  detail instead of reporting only the HTTP status.
- **Gemini assistant tool calling works again.** Prax sent the general JSON Schema keyword
  `exclusiveMinimum` in the `ask_library` and `ask_prax` declarations, but the Gemini
  `FunctionDeclaration.parameters` surface rejects it with HTTP 400. The Gemini adapter now
  keeps only supported schema fields and translates strict integer bounds to inclusive bounds
  (`> 0` becomes `minimum: 1`). A regression serializes the complete live assistant toolset so
  future schema changes cannot silently break every Gemini assistant turn.
- **The main window now shows work written outside it.** A task captured from the menu-bar
  capture bar (its own webview), or anything written by the memory skills, the CLI or MCP, never
  appeared in an open main window: it loaded its collections once and only refetched after its own
  writes, and the desktop shell has no reload gesture, so a capture was invisible until relaunch.
  The window now refetches tasks (and the Library, unless a document is open in the editor) when it
  regains focus, becomes visible, or navigates, and the capture bar announces each save over a
  same-origin channel for an immediate refresh. A refresh re-renders only when something changed
  and folds server state into an open task drawer's untouched fields as before. A snapshot that
  was in flight while this window saved something is discarded and refetched, so an older read can
  never overwrite a newer accepted save (QINV-09); the newest task request always wins, so a
  capture made during the initial load is not lost; nothing re-renders while a document is open in
  the editor; and a re-render restores keyboard focus and the caret to the field being edited,
  including the quick-capture overlay. Browser regressions in `tests/e2e/external-refresh.spec.js`;
  scheduler, write-epoch and focus unit tests in `tests/frontend/externalRefresh.test.js`.
- **The packaged-runtime smoke runs alongside an installed Prax.** A smoke launch
  (`--desktop-smoke <dir>`) no longer registers the single-instance plugin, whose socket is keyed
  on the app identifier rather than the app-data directory; on a machine where Prax was already
  running (the self-hosted macOS runner) the smoke only surfaced that app's window and failed
  without creating its isolated database. Normal launches keep the plugin.
- **The capture bar no longer floats in a white slab.** Its page paints only the rounded bar and
  leaves the rest transparent, but the window itself was opaque, so the unused part of the
  640×128 surface showed as a white block around the bar. The capture window is now transparent
  (`macOSPrivateApi` enabled for the webview background on macOS) and draws no window shadow:
  macOS rendered that shadow for the whole rounded frame, which on a transparent window still
  showed as a pale rounded slab with an outline behind the bar (rc.2); the bar's own CSS shadow
  is the only one drawn.
- **A retried remember can no longer overwrite newer memory.** `upsert-by-title` matched the
  title before it looked at the caller's operation id, so a delayed retry of an old remember
  reverted a body written in between, and reusing an id with different content was accepted
  instead of refused. The server now keeps a receipt per operation id (migration 0027): a replay
  returns the current document unchanged (`200`, `replayed: true`) for updates as well as creates,
  a different intent under the same id is `409`, and a replay whose document was permanently
  deleted since is `410` rather than a silent re-create. Regression coverage in
  `tests/backend/libraryUpsertByTitle.test.js` (interleaved A/B/A, changed intent, delete).
- **The CLI and skills bind to one Prax instance.** Discovery could fail a write over from the
  desktop app's port to `127.0.0.1:3000` and print the same success line, so a remember could
  land in a second workspace unnoticed. Each process now runs exactly one discovery (a `/readyz`
  probe of the desktop port, then `127.0.0.1:3000`), shared by every request that arrives before
  it finishes, and nothing re-pins the instance afterwards; every read and write goes only there,
  a retry is a retry of the same instance, and the confirmation names the base URL it wrote to.
- **Recall discloses an incomplete semantic index.** `prax recall`, `prax search` and the
  `prax-recall` skill used the unpaged route, which cannot report pending vectors, so a miss on
  an incomplete index read as an honest "no relevant memory". They now request the paged route
  and print `index incomplete: N of M documents have no current embedding`; `prax search --json`
  carries `retrieval.degraded`, `retrieval.reason`, `retrieval.index` and `retrieval.page`, and a
  bounded page is disclosed. Recall pages the server's 50-result pages up to `--limit` instead of
  silently stopping at the first, says when matches remain beyond the bound, and labels an older
  server that reports no coverage as unknown rather than complete.
- **`recall --recent` is active-only.** Superseded and deprecated documents no longer appear as
  if current; recall hits and related lines now carry a trust label (`verified` / `unverified`,
  plus any non-active status).
- `prax init` honours `PRAX_PROJECT` as the documented precedence promised.
- `skills/install.sh` clones over HTTPS with the GitLab CLI's credentials when `glab` is logged
  in (falling back to SSH), applying them to the sparse checkout that fetches the skills blobs as
  well as to the clone; it checks for Node 20+, accepts `PRAX_CLAUDE_SKILLS_DIR`, and explains a
  failed clone or fetch in terms of repository access. A no-checkout uninstall and SSH-only and
  token-based fetch paths are documented. The installer now has its own regression tests,
  including the CLI-credential transport.
- The release workflow published the container to the previous repository owner's registry
  namespace; it now targets the repository's own registry, runs the browser suite and dependency
  audit as part of the release quality gate, assembles the release body from this changelog, and
  states that the installers are unsigned and not notarized. The desktop release verifier accepts
  `vX.Y.Z-rc.N` prerelease tags and refuses a tag when any version site has drifted. `npm audit`
  is the active dependency gate. Desktop jobs build before `cargo test --lib` so the two
  compilations of the tray icon no longer race on tauri's compile-time image cache. (These
  repairs were made to the GitHub workflows, which the GitLab pipeline under *Changed* has since
  replaced with the same gates.)

- The macOS menu-bar icon now uses a transparent Prax mark instead of tinting the
  filled application icon into a solid square.

- Remembering a title that had been superseded silently overwrote the retired document, which
  active recall never surfaces; the memory was effectively lost. Only active documents match now.
- Two agents remembering the same title concurrently created duplicates (client-side
  read-then-write); the server-side upsert serialises them.
- The `prax-remember` skill silently ignored `--ref` (and any unknown option); unknown options
  are now errors and `--ref` attaches the reference.
- `CLAUDE.md` told agents to run `prax-recall` as a command that did not exist; it is now a
  symlink to `AGENTS.md`, the single agent guide.

- **The e2e gate is binary again — the two known full-suite flakes are diagnosed and
  closed.** Both were test-choreography races that only fired under full-suite conditions,
  never in isolation, which had quietly turned "green" into a judgment call. (1) The task
  drawer re-renders up to three times right after opening (context load, related-knowledge
  loading, then its result); a one-shot `fill()` racing those renders can write into a
  just-detached input and vanish — real typing is safe (every keystroke lands in state and
  the focused-field capture restores values), but the drawer-typing journeys now wait for
  the drawer to settle before typing. (2) The drawer-draft journeys assumed the close-save
  is always the first PATCH, but the 1s autosave debounce can fire first under load and
  can split a draft into per-field patches — interceptions now match any draft-field PATCH,
  failure injections are flag-gated ("every save fails until Save failed is observed")
  instead of ordinal-gated, and the pins assert the real invariants: no payload replay,
  fields union to the exact draft, nothing commits while saves fail. (3) Once the shared
  suite server accumulates 100+ tasks, the list's "Showing 100 of N" banner is a second
  `role="status"` element — capture-notice assertions are now scoped to the Quick-capture
  dialog. (4) Mutation reconciles re-render too: after a project reassignment whose
  response is lost, the readback → apply → render rebuild races a fill into the label
  input the same way — the journey now waits for the reconcile render's observable
  effect (the row leaving the old project's list) before typing. Verified by repeat-each
  churn plus repeated full-suite runs.

- **The assistant on no-tool-calling backends is grounded in a live snapshot instead of
  fabricating.** The old degrade path (any backend without tool calling: Claude CLI, Ollama,
  llama.cpp) handed the model the assistant persona and **no data** — asked "what's overdue",
  it confidently invented an empty workspace ("you don't have any tasks") beside a list of two
  overdue tasks, and doubled down when challenged. The no-tools turn now injects a **bounded,
  honest workspace snapshot** (`server/assistant/snapshot.js`) — true totals, per-project open
  counts, Overdue / Due today / Planned today / In progress / Inbox sections with real counts
  in every header and elisions spelled out ("…and 8 more") — fetched through the same
  in-process client the agent tools use. The snapshot also carries a **Library index**
  (trust counts plus the unverified docs pending human review, each with type, project,
  and provenance — titles and metadata only, never document bodies), so "which docs need
  review" answers from truth too instead of "I can't see the Library". Read-only rules ride along: answer data questions
  only from the snapshot, say "I can't check that in this mode" for anything beyond it, and
  never claim to have made changes (actions still need an API backend). If the snapshot
  itself fails to load, the rules flip to an explicit no-visibility stance — "never guess,
  never say the workspace is empty" — rather than letting the vacuum refill. The panel header
  now says what the mode is (**read-only · answers from a live snapshot**) instead of the
  confusing "35 tools · no tool-calling".

- **Quality-baseline remediation, closing wave — the fix pass reviewed against itself.** The
  plan's final ground rule: an adversarial re-review of the whole Waves 1–4 diff (24 candidates,
  1 refuted, 11 distinct confirmed defects — several inside the fixes themselves), all corrected:
  - **Restores report the truth**: SQLite's `RETURNING` does not see AFTER-trigger writes, so a
    restore whose status the 0018 trigger recomputed returned a stale lifecycle state to every
    API consumer; `restoreDocument` re-reads the row.
  - **The chronicle re-sequencing survives timestamp ties** (0019 amended): the tie-break is now
    `rowid` — the old `sequence` tie-break mutated mid-statement and two same-second events
    could collide on the uniqueness constraint.
  - **The drawer's DOM capture respects state**: renderApp used to re-read all three drawer
    fields from the live DOM, silently re-installing stale values as "typing" after every
    state-side fold — which made the out-of-band-edit protection undo itself and made **Discard
    draft autosave the discarded text back**. Only the focused field is captured now.
  - **Per-field saves get per-field reconciliation**: the lost-response readback compared whole
    snapshots, misreporting a committed notes-only save as a conflict whenever an agent had
    edited an untouched field.
  - **The capture owner guard is coherent**: restores adopt ownership (a reloaded tab can edit
    and discard its own draft again), stores refuse to overwrite a foreign tab's pending crash
    draft, and closing an EMPTY capture no longer force-destroys another tab's recovery.
  - **The capture client honours the archived-replay rejection** — its readback matcher now
    excludes archived rows like the server's, instead of converting the honest 409 back into
    "Added to project".
  - **An agent retitle revokes verification**: title is part of what the human blessed —
    retrieval, citations, and wiki-links all key on it; identical titles and pure metadata still
    keep the badge.
  - **Legacy checklists restore**: the import bound is decoupled from the new creation cap (a
    pre-cap database can legally hold more than 200 items per task; its export must restore) —
    and the replay of the checklist item that *filled* a task returns its truthful idempotent
    200 instead of a cap 400 claiming a committed write was refused.
  - Verify's content-hash guard accepts either hex case; the raw-hot-copy marker-mismatch error
    now explains the WAL-resident-marker cause instead of implying the backup is bad.

- **Quality-baseline remediation, Waves 3+4 — lifecycle coherence, agent-surface honesty, and
  operational safety.** The remaining eleven confirmed findings from the 2026-07-18 adversarial
  review, closing out the remediation plan:
  - **Supersession survives archive/restore cycles** (migration `0018`): restoring a document now
    recomputes its own status from its live inbound `supersedes` edges — the archived-target gap
    let a restored doc sit live and `active` with a live edge — and a repair pass fixes rows the
    0012 reconcile could not see. `deprecated` remains untouchable by the lifecycle.
  - **The incident ledger's order matches its timestamps** (migration `0019`): the 0013 backfill
    sequenced legacy step-checked events by runbook *position*; re-sequenced by `created_at`
    under the uniqueness constraint (two-phase), a no-op for live-written rows.
  - **Run reads are one snapshot**: `getRun` wraps its three reads in a transaction, so a
    concurrent step-check can no longer produce a status/steps/events mix that never existed.
  - **"Durable" runs are findable after their runbook is deleted**: new
    `GET /api/library/maintenance/detached-runs` lists runs whose document is gone, with their
    snapshot titles — preserved-but-unreachable was preservation in name only.
  - **Ask Prax citation matching is case-insensitive**, as its contract comment always claimed —
    a grounded answer citing `[postgres failover runbook]` is no longer discarded as uncited.
  - **Opening quick capture in one tab no longer destroys another tab's unfinished draft**: the
    shared recovery entry carries an owner token; only the writing tab (or an explicit discard /
    confirmed creation) clears it.
  - **Clearing the drawer title no longer starts a once-per-second toast/focus-steal loop**: the
    title-required signal is the in-place status, and the autosave timer stands down while the
    title is empty (manual save/close still surfaces the requirement).
  - **MCP pagination is honest end-to-end**: the bare-array fallback (pre-envelope servers) now
    applies limit/offset instead of returning everything, and an empty page can never emit a
    non-advancing cursor (`nextOffset === offset` looped agents forever).
  - **`docker run -p` works again**: the image bakes `HOST=0.0.0.0` + the explicit
    acknowledgement (a container binding loopback black-holes its published port with healthy
    logs; exposure stays the operator's decision at the network boundary, and bare-metal keeps
    the secure loopback default). The server now logs its bind loudly, warning when reachable
    beyond the machine. Contract pin inverted deliberately.
  - **Backup/migrate CLIs work under `HOST=0.0.0.0`**: the bind refusal moved from `loadConfig()`
    to the listen path — tools that never open a socket no longer die on a network error during
    the documented incident-recovery runbook.
  - **Backups no longer block their successors**: validation opens via an `immutable=1` URI (no
    `-wal`/`-shm` sidecars created; defensive cleanup for URI-less builds), so a validated backup
    path stays writable for the next rotation.
  - **A crashed desktop shell no longer orphans the server**: stdin EOF (parent died without
    saying `shutdown`) now triggers the same graceful shutdown. And the CSP allows `https:`
    images, matching the markdown preview's documented contract — remote screenshots render again.

- **Quality-baseline remediation, Wave 2 — misleading success and duplicate mutations.** Seven
  more confirmed findings from the 2026-07-18 adversarial review, each with its reproduction
  landed as a regression test:
  - **The assistant's `didWrite` now reflects the outcome, not the approval.** An approved write
    whose handler threw still set `didWrite: true`, so a follow-up model failure told the user
    "The approved change completed … Do not repeat the action" about a write that never happened
    — the inverse of the misleading-success bug the flag exists to prevent. Derived from the
    per-call `isError` outcomes now.
  - **Legacy recurring series survive the interval cap.** The `every:N` cap (10000) was applied
    retroactively at validation time only, silently ending pre-upgrade series on completion while
    the UI toasted "next occurrence scheduled". Migration `0017` clamps stored over-cap intervals
    (preserving the series), and the completion toast now derives from the PATCH response's new
    additive `nextOccurrenceTaskId` — when no successor was actually spawned, the toast says so.
  - **Reopening a completed occurrence no longer discards an explicit recurrence in the same
    PATCH** — the one-off detachment applies only when the caller did not speak to recurrence.
  - **An idempotent create replay never "succeeds" against an archived row.** Capture announced
    "Added to project" for a task no view shows; the replay now requires a live row and an
    archived match returns a truthful, distinct 409.
  - **Capture distinguishes permanent rejections from transient failures.** `createTask` surfaces
    the response status + server message; a deterministic 4xx shows "The server rejected this
    capture … edit it and try again" (and drops the retry identity) instead of the false
    "retry unchanged is safe".
  - **Typing in the capture no longer destroys the exact-once retry identity** — type a character
    and delete it again and the retry still reuses the same request id; submit mints a new
    identity only when the intent actually diverges.
  - **A timed-out MCP request is never automatically re-sent.** The client retried timeout aborts
    as if the server were unreachable — but a timed-out generation may still be processing, so
    the re-send ran it twice (duplicate post-mortems/runbooks). Only connection-level failures
    (request provably never started) retry; timed-out callers keep their stable identity for a
    deliberate retry.
  - **No more no-exit draft traps.** A document or task archived/deleted externally while its
    draft was dirty vetoed every navigation with a retry that could never succeed — and the task
    drawer rendered *nothing* while its invisible draft blocked the app. Both surfaces gain an
    explicit confirmed **Discard draft** affordance; a vanished task now renders a "Task
    unavailable" panel offering **Keep draft & close** (device copy retained) or discard.

- **Quality-baseline remediation, Wave 1 — data loss and trust integrity.** Seven confirmed
  defects from the 2026-07-18 adversarial review of the quality-baseline commit, each fixed with
  its executed reproduction landed as a permanent regression test
  (plan: the 2026-07-18 quality-baseline remediation):
  - **Restoring a raw file-copy backup no longer discards WAL-resident transactions.** The
    restore validated the backup *through* its `-wal` sidecar but copied only the main db file —
    committed data vanished while the restore reported checksummed success. Restore now copies
    db + `-wal` + `-shm` into staging, checkpoints, re-validates, and leaves no sidecar orphans.
  - **Explicitly verifying a user-created document now actually records the reviewer.** The
    re-verification guard compared `verified_by = $2` against a NULL column — NULL under SQL
    three-valued logic — so the UPDATE matched zero rows and the route's replay fallback masked
    the no-op as a 200. Null-safe `IS` comparison; the review is stamped.
  - **An agent retag or byte-identical body no longer destroys human verification.** Agent-origin
    updates revoked verification unconditionally; revocation is now conditional on the stored
    `content_hash` actually changing (QINV-04's own rule), so metadata-only agent edits keep the
    badge and agent content changes still lose it. Both trust fixes carry *executed* regression
    tests against a real migrated database — the prior tests regex-matched the SQL text, which is
    exactly how the NULL-guard bug shipped green.
  - **The task-drawer autosave can no longer overwrite out-of-band edits.** Saves now PATCH only
    the fields whose draft diverges from the seeded baseline (new `taskDraftBaseline`), and a
    task refresh folds newer server values into untouched fields — an assistant/MCP edit to the
    description survives a user's notes-only autosave, live in the open drawer.
  - **Renaming a document via Document info is no longer silently reverted** by the next body
    autosave (the draft title now follows the rename).
  - **Project navigation (palette, board chord, project cards) can no longer silently discard a
    dirty drawer draft** — `goProject` gets the same flush-and-veto guard as every other
    drawer-closing path.
  - **The app can always restore its own export.** Skip-mode import no longer dedupes incoming
    tasks against *each other* on the lossy title/status/dueDate key (distinct tasks sharing the
    key all import), and the batch-wide cumulative 500-checklist-item cap became a per-task
    bound (200) shared with the creation route; the task cap rose to 5000. Contract pins
    re-pinned deliberately.

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

[Unreleased]: https://github.com/markjoyeuxcom/prax/compare/v0.47.0...HEAD
[0.47.0]: https://github.com/markjoyeuxcom/prax/compare/v0.46.0...v0.47.0
[0.46.0]: https://github.com/markjoyeuxcom/prax/compare/v0.45.1...v0.46.0
[0.45.1]: https://github.com/markjoyeuxcom/prax/compare/v0.45.0...v0.45.1
[0.45.0]: https://github.com/markjoyeuxcom/prax/compare/v0.44.0...v0.45.0
[0.44.0]: https://github.com/markjoyeuxcom/prax/compare/v0.43.1...v0.44.0
[0.43.1]: https://github.com/markjoyeuxcom/prax/compare/v0.43.0...v0.43.1
[0.43.0]: https://github.com/markjoyeuxcom/prax/compare/v0.42.0...v0.43.0
[0.42.0]: https://github.com/markjoyeuxcom/prax/compare/v0.41.0...v0.42.0
[0.41.0]: https://github.com/markjoyeuxcom/prax/compare/v0.40.0...v0.41.0
[0.40.0]: https://github.com/markjoyeuxcom/prax/compare/v0.39.2...v0.40.0
[0.39.2]: https://github.com/markjoyeuxcom/prax/compare/v0.39.1...v0.39.2
[0.39.1]: https://github.com/markjoyeuxcom/prax/compare/v0.39.0...v0.39.1
[0.39.0]: https://github.com/markjoyeuxcom/prax/compare/v0.38.0...v0.39.0
[0.38.0]: https://github.com/markjoyeuxcom/prax/compare/v0.37.1...v0.38.0
[0.37.1]: https://github.com/markjoyeuxcom/prax/compare/v0.37.0...v0.37.1
[0.37.0]: https://github.com/markjoyeuxcom/prax/compare/v0.36.1...v0.37.0
[0.36.1]: https://github.com/markjoyeuxcom/prax/compare/v0.36.0...v0.36.1
[0.36.0]: https://github.com/markjoyeuxcom/prax/compare/v0.35.1...v0.36.0
[0.35.1]: https://github.com/markjoyeuxcom/prax/compare/v0.35.0...v0.35.1
[0.35.0]: https://github.com/markjoyeuxcom/prax/compare/v0.34.0...v0.35.0
[0.34.0]: https://github.com/markjoyeuxcom/prax/compare/v0.33.0...v0.34.0
[0.33.0]: https://github.com/markjoyeuxcom/prax/compare/v0.32.1...v0.33.0
[0.32.1]: https://github.com/markjoyeuxcom/prax/compare/v0.32.0...v0.32.1
[0.32.0]: https://github.com/markjoyeuxcom/prax/compare/v0.31.1...v0.32.0
[0.31.1]: https://github.com/markjoyeuxcom/prax/compare/v0.31.0...v0.31.1
[0.31.0]: https://github.com/markjoyeuxcom/prax/compare/v0.30.0...v0.31.0
[0.30.0]: https://github.com/markjoyeuxcom/prax/compare/v0.21.0...v0.30.0
[0.21.0]: https://github.com/markjoyeuxcom/prax/compare/v0.20.0...v0.21.0
[0.20.0]: https://github.com/markjoyeuxcom/prax/compare/v0.19.2...v0.20.0
[0.19.2]: https://github.com/markjoyeuxcom/prax/compare/v0.19.1...v0.19.2
[0.19.1]: https://github.com/markjoyeuxcom/prax/compare/v0.19.0...v0.19.1
[0.19.0]: https://github.com/markjoyeuxcom/prax/compare/v0.18.0...v0.19.0
[0.18.0]: https://github.com/markjoyeuxcom/prax/compare/v0.17.1...v0.18.0
[0.17.1]: https://github.com/markjoyeuxcom/prax/compare/v0.17.0...v0.17.1
[0.17.0]: https://github.com/markjoyeuxcom/prax/compare/v0.16.0...v0.17.0
[0.16.0]: https://github.com/markjoyeuxcom/prax/compare/v0.15.1...v0.16.0
[0.15.1]: https://github.com/markjoyeuxcom/prax/compare/v0.15.0...v0.15.1
[0.15.0]: https://github.com/markjoyeuxcom/prax/compare/v0.14.2...v0.15.0
[0.14.2]: https://github.com/markjoyeuxcom/prax/compare/v0.14.1...v0.14.2
[0.14.1]: https://github.com/markjoyeuxcom/prax/compare/v0.14.0...v0.14.1
[0.14.0]: https://github.com/markjoyeuxcom/prax/compare/v0.13.1...v0.14.0
[0.13.1]: https://github.com/markjoyeuxcom/prax/compare/v0.13.0...v0.13.1
[0.13.0]: https://github.com/markjoyeuxcom/prax/compare/v0.12.2...v0.13.0
[0.12.2]: https://github.com/markjoyeuxcom/prax/compare/v0.12.1...v0.12.2
[0.12.1]: https://github.com/markjoyeuxcom/prax/compare/v0.12.0...v0.12.1
[0.12.0]: https://github.com/markjoyeuxcom/prax/compare/v0.11.1...v0.12.0
[0.11.1]: https://github.com/markjoyeuxcom/prax/compare/v0.11.0...v0.11.1
[0.11.0]: https://github.com/markjoyeuxcom/prax/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/markjoyeuxcom/prax/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/markjoyeuxcom/prax/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/markjoyeuxcom/prax/compare/v0.7.7...v0.8.0
[0.7.7]: https://github.com/markjoyeuxcom/prax/compare/v0.7.6...v0.7.7
[0.7.6]: https://github.com/markjoyeuxcom/prax/compare/v0.7.5...v0.7.6
[0.7.5]: https://github.com/markjoyeuxcom/prax/compare/v0.7.4...v0.7.5
[0.7.4]: https://github.com/markjoyeuxcom/prax/compare/v0.7.3...v0.7.4
[0.7.3]: https://github.com/markjoyeuxcom/prax/compare/v0.7.2...v0.7.3
[0.7.2]: https://github.com/markjoyeuxcom/prax/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/markjoyeuxcom/prax/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/markjoyeuxcom/prax/compare/v0.6.1...v0.7.0
[0.6.1]: https://github.com/markjoyeuxcom/prax/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/markjoyeuxcom/prax/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/markjoyeuxcom/prax/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/markjoyeuxcom/prax/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/markjoyeuxcom/prax/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/markjoyeuxcom/prax/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/markjoyeuxcom/prax/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/markjoyeuxcom/prax/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/markjoyeuxcom/prax/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/markjoyeuxcom/prax/releases/tag/v0.1.0
