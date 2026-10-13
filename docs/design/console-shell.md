# Console Shell Design

**Date:** 2026-10-12
**Status:** Implemented on `feat/console-ui`
**Builds on:** v0.40.0 and the [year-one shell](year-one-shell.md)
**Mockups:** the "Prax Console UI" design canvas (private; artboards for tasks + inspector,
board, Library, editor, review queue, Ask Prax, command bar, quick capture, tags at scale)

## Goal

The year-one shell fixed structure without changing the visual language. The functionality was
right but the layout still cost too much: three stacked navigation columns (an unlabelled icon
rail, the context panel, the main view) took about a quarter of the width; the same rituals
appeared in two places; task detail was a modal drawer you had to close to move on; and a
library with 100+ tags made the tag list a scroll. The Console shell rebuilds the layout and the
visual language, keeping every `data-action`, every view and every behaviour contract.

## Decisions

### Visual language

- **Type:** Schibsted Grotesk for the UI, JetBrains Mono for every piece of metadata (counts,
  dates, keys, section labels, the status line) and Newsreader for reading. All three are
  vendored as variable woff2 (Fontsource v5.3.0, OFL), so the desktop app stays offline.
- **Themes:** dark "Graphite" is the default; light "Paper" replaces Porcelain. One violet
  token, `--agent`, marks anything agent-written or AI everywhere (review counts, unverified
  chips, the Ask spark).
- **Accent:** lime is the default of ten swatches. Derived accent tokens (`--accent`,
  `--accent-soft`, `--accent-vivid`) are declared on `body`, where `applyPreferences` sets
  `--accent-choice`; on `:root` alone they froze against the default swatch. `--accent-vivid`
  lifts the swatch a fifth toward white so dark ink keeps AA on every choice.
- Hover and selection are neutral lifts. The accent is kept for focus, primary actions and the
  current place.

### Shell

- **One sidebar (≥ 940px).** The rail's destinations lead the panel as labelled *places*
  (Today, Inbox, Calendar, All projects, Library, Review queue, Filter) with the same
  data-actions; the context panel follows; Settings anchors the foot. Narrow windows keep the
  icon rail exactly as before. The review queue is a place (`nav-review`) with a violet count.
- **Titlebar:** brand and breadcrumb left, the command bar (the existing palette, ⌘K) in the
  centre, Ask (⌘I), New and an SVG theme toggle right.
- **Status line:** a mode block (TASKS, BOARD, LIBRARY, REVIEW, TAGS, EDIT...) and at most four
  keys that work in the current view. The year-one spec removed a *fixed* hint strip; these are
  contextual, so they stay true.

### Tasks

- **Docked inspector.** At ≥ 1360px in task contexts (project, Today, Filter, Calendar) the
  task drawer renders as a non-modal pane beside the list (`.drawer--docked`, no scrim, no
  `aria-modal`). The workspace stays live; ↑↓ moves the selection and the inspector follows,
  flushing the draft first exactly as switching tasks always did. Narrower windows and the
  editor keep the modal drawer. `inspectorDocked(state)` in `renderTaskDetail.js` is the one
  rule.
- **Rows:** flat and dense, due dates and signals as a right-hand mono column, group headers as
  a mono label with a hairline. The done box draws 16px inside a 24px target (WCAG 2.2).
- A project's own board no longer repeats the project's name on every card.

### Library

- **Authorship follows content.** `buildUpdateDocument` sets `updated_by` / `updated_by_agent`
  only when the patch carries a title or body; a retag, move or type change keeps the author,
  so the review queue (last-writer predicate) is immune to housekeeping.
- **Load states.** `documentsLoadState` is idle, loading, loaded or failed; the welcome screen
  needs a load that returned nothing, a failure keeps the rows and offers Retry.
- **One filter model.** Facets apply in semantic mode too (`semanticHidden` says how many
  matches they removed); the desk walks `reviewDeskIds` captured from the table; a saved view
  stores `filters` beside its tags (`savedLibraryViewPatch` reopens it); `resetLibraryFilters`
  clears every axis.
- **Address.** `libraryLocation.js` maps the Library state to `#library?…`; `afterRender` writes
  it with `replaceState` once boot has honoured the arrival hash, and `hashchange` reads it.
  `#doc/<id>` is read as a deep link but never written: a reload must not reopen an editor
  whose failed or conflicting draft vetoes navigation (that recovery starts from the Library).
- **Phones.** Under 600px the facet rows fold behind "Filters · n active"; under 520px the table
  is title + trust + action with wrapping titles; the search input takes its own line; the desk
  puts the document first. Cards carry UNVERIFIED, the author and a select box.

### Tags at scale

- **Normalised writes.** `cleanTags` in `server/libraryRoutes.js` lowercases, strips leading
  `#`, turns whitespace runs into one hyphen and collapses duplicates, so the app, CLI, MCP and
  agents write one spelling. Plurals and aliases are not folded at write time.
- **Narrowing panel.** With any filter active, the Library panel's Tags section lists only tags
  present in the current results, counted there, and says how many others match nothing.
- **Library ▸ Tags** (`libraryView: 'tags'`, `renderTagsManager.js`, `tagStats.js`): usage, last
  use, who added it, companion tags; filters for possible duplicates, used once and agent-only;
  conservative merge suggestions. A merge is confirmed, then re-tags each document through the
  ordinary human PATCH, so revision and verification rules apply as for a hand edit.

### Review desk

- **One at a time.** `nav-review` opens the desk (`renderReviewDesk.js`): the queue oldest
  first, the memory itself, and its provenance (agent, when, commits and code refs it cites,
  recall counts, links). The table with bulk verify stays one click away (`reviewLayout`).
- **Verify binds to the revision shown.** The desk fetches the saved document and passes its
  revision to `changeDocumentVerification`, the editor's QINV-04 rule; a changed document is
  refused and reloaded rather than verified unseen.
- **Decisions.** V verify, E edit then verify, M supersede (pick a replacement, or the
  overlapping verified document semantic search found), R reject (archives it, restorable),
  J skip. The mockup's "merge" is supersede: Prax has no body-merge operation, and supersede
  is the existing, reversible way to retire one document in favour of another.
- **Not shown:** the mockup's session id and "anchor matches HEAD" check. Documents do not
  record a session, and code refs are not compared with the working tree; the desk shows the
  commits the refs cite instead.

### Ask Prax page

- **A page, not a modal.** `navType: 'ask'` (`renderAskPage.js`): earlier questions (kept on
  this device, `prax.askHistory.v1`, 30 entries; the column shows the six most recent, two
  lines each, grouped by day, with Show all, forget, Clear history with Undo and a collapse
  toggle kept in `prax.askHistoryOpen.v1`), the thread, a composer with a project scope, and
  the sources rail. The command bar and ⌘I still open it; the assistant panel is a link.
- **Two contracts, one boundary.** Ask reads: grounded only in the library, cited, refusing
  without sources, writing nothing. The assistant acts: a tool-calling chat whose writes stop at
  confirmation cards. The boundary is shown, not implied: after an answer the Ask page's link
  reads "Act on this with the assistant" and prefills the assistant's composer with the question
  and the source titles; an assistant answer that ran no tool since the person's last turn is
  badged "From the model's own knowledge" with a link to Ask Prax (`assistantDisplayItems`
  marks it `ungrounded`).
- **Numbered citations.** The server validates `[Title]` citations against the sources it
  used; the page numbers those sources and swaps each title for its number, rendered after the
  untrusted markdown pass so chips cannot be injected. Each chip is a button (named "Source n:
  title (trust)") that focuses its rail card. Cited unverified sources raise a warning whose
  "Review it now" opens the review desk for an agent-written source and the editor for a
  human-written one (the desk queue holds only agent memory).
- **Keyword retrieval that answers questions.** Without embeddings the route uses the ranked
  any-word FTS search (`searchDocumentsKeyword`), not the Library's all-words listing filter;
  a keyword-only no-sources notice says so. Coverage notices (index, hidden harvested, excluded
  unverified, fallback) render on the page as the old overlay rendered them.
- **History re-reads its sources.** An entry keeps the scope and trust it was asked under;
  reopening it fetches each source again and labels trust changes, edits and deletions, dates
  the answer and offers Ask again. Each question stands alone (no conversation context is
  sent), and the composer says so.
- **Save answer as note** creates a note tagged `ask-prax` in the scoped project or the Inbox.
- **Suggested tasks** (`server/askTasks.js`, `POST /api/library/ask/tasks`): a second call
  after a written answer, so the answer is never held up. The server re-reads the answer's
  sources by id and keeps only suggestions that name one of them; at most three, titles
  cleaned, due limited to today or tomorrow. The page shows them unticked under a quiet Create
  button; Create N tasks posts each through the ordinary task API into the project the answer
  was asked under (recorded with the result) or the Inbox, with the question and source in its
  description. Each proposal carries its task id from the start, so a lost response is
  reconciled by a read instead of reported as a failure; created rows stay visible as created.
  A degraded model call is shown as a failure with Try again, never as "nothing calls for a
  task".
- **Trust and model chips.** Verified only filters retrieval before the answer context is
  built (`retrieval.trust`, `hiddenUnverified`). The model chip shows the configured backend
  and model and opens Settings ▸ Intelligence.
- **No sources, no answer.** With zero matching documents the route returns `no-sources`
  without calling the model.

### Editor

- **Selection bar.** The CodeMirror bundle reports selection changes with measured
  coordinates (`onSelectionChange`); main.js positions a `.selbar` under the selection with the
  writing actions that take a selection (Summarize, Rewrite for clarity, Notes → checklist) and
  Ask Prax…, which opens the Ask page with the selection as the question. The bar is
  imperative so a selection never forces a full render; mousedown is swallowed so the
  selection survives a click.
- **Write with AI.** The four writing actions moved to a head button. The menu states its
  scope (the selection captured when it opened, or the whole document) and the model, and
  without a model it stays clickable and links to Settings ▸ Intelligence. The preview is a
  modal dialog (`aria-modal`, the editor beneath inert, Cancel/Close always, Try again on
  failure). Apply is one change in the editor's history, so ⌘Z reverses it, and the toast
  carries an Undo; the copy says Apply saves like typing. The editor's undo stack is
  serialised with its selection and scroll across every host re-render
  (`historySnapshot` / `historyJson` in the CodeMirror wrapper), which is what makes that
  true. Opening the menu from the keyboard focuses its first action. The mockup's ⌘J is not used (it toggles the theme), and its actions
  (Tighten, Turn into steps, Add verify step, Explain) map to the existing Rewrite and Notes →
  checklist; Add verify step and Explain would be new server prompts.
- **Tables.** `applyMarkdownFormat('table')` inserts a 2×2 table or converts selected lines
  (tabs, " | " or commas); the wrapper binds ⌘⇧T, `/table`, Enter-at-row-end
  (`continueTableOnEnter`) and Tab/Shift+Tab cell navigation (`nextTableCell`), all pure
  helpers in markdownEditor.js. Outside a table Tab keeps its default.
- **Flat page.** The sheet is no longer a rounded card in a padded desk: it fills the pane
  under a hairline (`.sheet`), so the content is the edge and the scrollbar sits at the pane.
- **[[ picker.** Completions carry the document type and trust, verified documents rank first
  among equal matches, and trust colours the detail. The mockup's "create new note" row is not
  built: a link to a missing title renders as a missing link, and creating from the picker is
  left for a follow-up.

## Not done (deliberately)

- **Library reader pane.** The mockup's list | reader | context layout would change what a
  click on a document does, and the editor already has a Read mode. Left for a follow-up.
- **"Agents use existing tags only".** Shown in the mockup as a rule; it needs server-side
  enforcement and a review path for proposed tags, so it is not offered as a toggle yet.

## Testing

- Unit: `renderShell`, `renderTaskDetail` (docking), `renderBoard`, `tagStats`,
  `renderTagsManager`, `tagNormalization`, preferences and settings.
- Unit: `renderReviewDesk`, `renderAskPage` (citation numbering, untrusted rendering), state
  for the desk and ask history.
- e2e: `console-inspector.spec.js`, `console-tags.spec.js`, `console-review-desk.spec.js`,
  `console-ask.spec.js`, `console-editor.spec.js`; existing specs updated for the places, the
  queue title and the desk (review walks open the table first). The axe audit covers all ten accents in both themes.
