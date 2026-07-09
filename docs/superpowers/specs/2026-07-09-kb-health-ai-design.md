# Knowledge-base health — the AI half (contradiction/gap detection + auto wiki-linking)

**Status:** Shipped (both increments; increment 2 hardened via an adversarial review pass)
**Date:** 2026-07-09
**Branch:** `main` (incremental, verified per increment)
**Tier:** 2 · item #5 (completes the partially-shipped Health feature)

## Context

The **deterministic** half of Tier-2 #5 shipped: `GET /api/library/health` + the Library **Health**
view bucket documents that need attention — needs-review (agent-written/unverified), empty stubs,
stale, and orphans (no inbound/outbound links). What's still missing is the **AI half** the tier
promised, and the part that actually protects the trust model against wiki-rot:

1. **Auto wiki-linking** — surface `[[link]]` opportunities so related docs actually connect
   (orphans are a symptom; linking is the cure).
2. **Contradiction / gap detection** — the chat model reading the library to flag docs that
   *disagree* and topics with *thin/no coverage*.

Everything here is **advisory**: suggestions a human accepts. Accepting a suggestion that mutates a
doc goes through the normal write path (agent-written → unverified). No new trust surface.

## Goal

Extend the Health view with two AI-adjacent capabilities, each degrading gracefully (the page never
breaks when no chat model / no embeddings are configured), reusing what exists (FTS, embeddings,
`documentLinksRepository`, the chat provider, the context-pack machinery).

## Decisions

- **Two increments, shipped independently.**
  - **Increment 1 — Auto wiki-linking (deterministic first).** For each active doc, find plain-text
    mentions of *another* active doc's exact title that are **not already** inside a `[[wiki-link]]`
    or a fenced code span. Case-insensitive, word-boundary, first mention per target. Surface as a
    "Suggested links" section in Health; one-click **Link** rewrites that first mention to
    `[[Title]]` in the body (a normal doc update). Pure function `suggestWikiLinks(doc, docs)` +
    `GET /api/library/health/link-suggestions`. Deterministic, no AI, no embeddings — highest
    precision, lowest risk. (Semantic-neighbour suggestions are a later add-on once this lands.)
  - **Increment 2 — Contradiction / gap detection (AI).** An on-demand "Scan with AI" action in
    Health. Contradictions: use embeddings to pick the top-K most *similar* doc pairs (cheap
    candidate generation), then ask the chat model to judge each pair "do these give conflicting
    guidance?" returning structured `{ contradicts:bool, issue }`. Gaps: feed a trust-aware digest
    of doc titles + the open-task themes to the model, ask for uncovered topics. Results render as
    an **AI review** panel — clearly labelled agent-generated, advisory only. `POST
    /api/library/health/ai-review`. Degrades: no chat model → the action is hidden/disabled with a
    Settings pointer; no embeddings → contradictions fall back to nothing (only gaps run).
- **Advisory, not autonomous.** No suggestion mutates data on its own. "Link" is one explicit click
  and produces a normal `updateDocument` (so an agent-touched doc re-derives `unverified` per the
  existing rule — a human still confirms the doc afterwards).
- **Bounded + degradable, like every AI path.** Token budgets on the digest; candidate pairs capped
  (top-K by similarity); the route never 500s on the AI path.
- **Pure where possible.** `suggestWikiLinks` and the digest/prompt builders are pure and unit-
  tested; the routes are thin.

## Out of scope (for now)

- Semantic-neighbour link suggestions (Increment 1 add-on).
- Auto-*applying* links or auto-authoring gap docs (stays a human click).
- Whole-library O(n²) contradiction scan (we use similarity to bound candidates).

## Verification

Per increment: unit tests for the pure functions, backend route tests (happy + degraded), full
suite green, and a browser pass in the Health view. Changelog + commit per increment.
