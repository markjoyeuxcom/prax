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

## Not done (deliberately)

- **Library reader pane.** The mockup's list | reader | context layout would change what a
  click on a document does, and the editor already has a Read mode. Left for a follow-up.
- **"Agents use existing tags only".** Shown in the mockup as a rule; it needs server-side
  enforcement and a review path for proposed tags, so it is not offered as a toggle yet.

## Testing

- Unit: `renderShell`, `renderTaskDetail` (docking), `renderBoard`, `tagStats`,
  `renderTagsManager`, `tagNormalization`, preferences and settings.
- e2e: `console-inspector.spec.js`, `console-tags.spec.js`; existing specs updated for the
  places and the queue title. The axe audit covers all ten accents in both themes.
