# Task Context Surface Implementation Plan

**Goal:** Kill the re-finding-context tax: opening a task surfaces the Library knowledge
that helps you do it (semantic suggestions), one click links a doc or spawns a pre-linked
working note, and documents show their open tasks in return.

**Roadmap:** [Workflow & Self-Organisation Roadmap](2026-07-18-workflow-selforganisation-roadmap.md) · item 3
**Status:** Shipped

## Current state

- Semantic search exists: `GET /api/library/documents/semantic-search`
  ([libraryRoutes.js](../../../server/libraryRoutes.js)), embeddings maintained
  fire-and-forget per doc write, gated by the `semantic_search_enabled` setting and the
  configured `EMBEDDING_BACKEND`; degrades honestly when off.
- Task↔document links exist full-stack: `GET/POST /api/tasks/:id/documents`,
  `DELETE /api/tasks/:id/documents/:documentId`, rendered in the task drawer's links row.
  The **reverse** direction (docs listing their linked open tasks) has no surface.
- Documents have taxonomy types and templates
  ([documentTypes.js](../../../public/js/documentTypes.js),
  [documentTemplates.js](../../../public/js/documentTemplates.js)); the drawer is rendered
  by the pure state→HTML pipeline with a delegated-action model.

## Design decisions

1. **Advisory regime, strictly.** Suggestions load *after* the drawer renders (async fill
   into a placeholder row), never delay it, and every failure state renders as a quiet
   labelled line ("semantic search off" / "suggestions unavailable"), not an error. The
   drawer is a core task surface; this feature may not add a millisecond to it.
2. **One suggestion endpoint, task-shaped.** `GET /api/tasks/:id/related-documents`:
   builds the query server-side from title + description (bounded length), calls the same
   embedding search, **excludes already-linked docs and archived docs**, returns the top 5
   with scores. Server-side shaping keeps MCP/assistant able to reuse it later and keeps
   the query construction testable in one place.
3. **Two actions per suggestion:** **Link** (existing `POST /api/tasks/:id/documents` — the
   suggestion row becomes a real link and leaves the suggestion list) and **dismiss for
   this task** (per-task suppression list stored with the task's client state — not a
   server concern in slice 1; a dismissed doc simply stops being suggested this session).
4. **Working note is a template spawn.** "Start working note" creates a doc titled
   `Working note — <task title>`, typed via taxonomy (existing note-like type; add a
   `working-note` type only if the taxonomy review says so), body seeded from a template
   with a wiki-link back to the project and the task title, immediately linked via the
   existing task-doc link, and opened in the editor. Everything used already exists;
   this is composition, not new machinery.
5. **Reverse surface reuses the links row idiom.** New
   `GET /api/documents/:id/tasks` (open linked tasks, via the same join table) rendered as
   a compact row in the document meta/links area: title, status dot, click-through to the
   task. Completed/archived tasks are excluded by default (the doc surface is about *live*
   work; the graph view remains the historical picture).
6. **Ranking stays honest:** scores come straight from the embedding search; no heuristic
   re-ranking in slice 1. If suggestions are weak, the fix is the embedding input (title +
   description shaping), which is one pure function with tests.

## Work

### Increment 1 — related-knowledge row (read-only + link)

- [x] `GET /api/tasks/:id/related-documents`: query shaping (pure `relatedDocuments.js`),
      semantic call, linked/archived exclusion, top-5 cap, degraded JSON — never 500.
- [x] Drawer: async fill after render (state keys + delegated actions per the render
      pattern); Link action wires to the existing link endpoint and moves the doc to the
      links row; session-scoped dismiss.
- [x] Respect the drawer's focused-field capture rules — the async fill must not clobber
      an in-progress edit (renderApp already captures only the focused field; the fill
      goes through normal setState).

### Increment 2 — working note

- [x] Template + spawn action: create doc (taxonomy-typed, template body, project
      wiki-link), link to task, navigate to editor; failure leaves the task drawer state
      untouched with the reason inline.
- [x] The spawned note immediately appears in the task's links row (it is just a link).

### Increment 3 — document side

- [x] Already existed: the editor's "Referenced by N tasks" backlinks row
      (`buildListTasksForDocument`) covers the reverse surface — discovered during the
      mapping pass; no new endpoint needed. (It lists non-archived tasks, including
      completed — a slightly wider net than the sketch's open-only.)
- [x] CHANGELOG entry.

## Verification (as shipped)

- Unit: `tests/backend/relatedDocuments.test.js` — query-shaping pins (markdown stripping,
  bounds, honest nulls), quiet degrade paths (no embedder / invalid / missing task), and a
  REAL ranking journey with seeded embeddings: near doc suggested, linked doc excluded,
  orthogonal doc below the relevance cutoff.
- E2e: `tests/e2e/task-context-surface.spec.js` — embeddings-off drawer shows the labelled
  line (itself a covered state), working-note spawn creates + links + opens with the
  backlink visible, server-truth link asserted.
- Gates: 1742 unit, 86 e2e; no schema change.

## Original verification sketch

- Unit: query shaping (long descriptions truncated, markdown stripped), exclusion rules
  (linked + archived), degraded paths, working-note template assembly, reverse-lookup
  payload.
- E2e: seed a doc semantically near a task (deterministic embedding backend fixture, as the
  semantic-search e2e already does) → open drawer → suggestion appears → Link → moves to
  links row; spawn working note → editor opens with the seeded body and the task shows the
  link; doc view lists the open task and click-through navigates.
- Gates: `npm test`, `npx playwright test`; no schema change (the link table exists), so no
  migration pins or drills.

## Risks / notes

- With embeddings disabled the entire feature quietly reduces to the existing manual links
  row plus the working-note button — it must remain useful in that mode, which is why the
  spawn action does not depend on suggestions.
- Suggestion quality is bounded by embedding input quality; keep the shaping function the
  single tuning point rather than sprinkling heuristics across surfaces.
- Do not embed task content into the doc index — the suggestion query embeds transiently
  at request time (same as a manual semantic search); tasks stay out of the Library index.
