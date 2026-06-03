# Semantic Search UX Fixes — Design (v0.13.1)

**Goal:** Fix three issues found while testing v0.13.0 semantic search live against a real
Ollama (`qwen3-embedding:0.6b`): (1) only show *relevant* results, (2) auto-focus the top hit,
(3) the keyword/semantic switch buttons render huge.

**Scope:** A small, behavior-correcting follow-up to v0.13.0. NOT in scope: the
OpenAI/Gemini/Voyage adapters (deferred to a later version — native Ollama already works), and
the qwen3 query-instruct-prefix tuning (separate future enhancement).

---

## Issue 1 — Relevance cutoff (gap-based + floor)

Today `GET /api/library/documents/semantic-search` returns **all** active docs ranked by cosine
distance (`limit 20`), so every doc always shows, merely reordered. Users want only the relevant
ones.

### Decision: relative cutoff with an absolute floor

Calibrated against the live corpus with `qwen3-embedding:0.6b` (similarity = `1 - cosine_distance`):

| Query | Top hit | Tail |
|---|---|---|
| "let a virtual machine use the graphics card" | Proxmox **0.751** | next 0.377, then ≤0.38 |
| "my database crashed how do I get the data back" | PostgreSQL **0.688** | Restic 0.448, then ≤0.40 |
| "what is the meaning of life" (nonsense) | best only **0.283** | ≤0.28 |

A real match scores **0.65–0.75**; the irrelevant tail clusters at **0.17–0.40**; a nonsense
query's *best* hit reaches only **~0.28**.

**Rule:** keep document `i` iff `similarity[i] >= max(FLOOR, topSimilarity − DROP)`.
- **FLOOR = 0.45** (default) — kills nonsense queries (their top ~0.28 < 0.45 → zero results).
- **DROP = 0.20** (default) — trims the tail after a strong hit.

Validation on the calibration data:
- Graphics query → threshold `max(0.45, 0.551)=0.551` → keeps **only Proxmox**. ✓
- Database query → threshold `max(0.45, 0.488)=0.488` → keeps **only PostgreSQL** (Restic 0.448 just misses). ✓
- Nonsense query → threshold `0.45` > top `0.283` → **zero results**. ✓

Both thresholds are **env-tunable** because similarity scales differ per model:
`EMBEDDING_SEARCH_MIN_SIMILARITY` (floor) and `EMBEDDING_SEARCH_TOP_DROP` (drop). Defaults are
calibrated for the recommended qwen3 model and chosen **conservatively** (prefer one extra result
over hiding a real hit).

### Implementation

- `buildSearchDocumentsSemantic` adds `1 - (embedding <=> $1::vector) as similarity` to the
  SELECT (a scalar — NOT the vector; the embedding column still never appears). Ordering and the
  `limit` (safety cap) are unchanged.
- A new **pure** exported helper `applyRelevanceCutoff(rows, { minSimilarity, topDrop })` filters
  the fetched rows by the rule above. Pure → unit-testable with synthetic similarity arrays
  (using the real calibration numbers as fixtures). Empty input → `[]`.
- `searchDocumentsSemantic` runs the query, applies `applyRelevanceCutoff`, then maps the kept
  rows through `normalizeDocumentRow` (which already drops `similarity` via its allowlist — the
  **no-vector-leak invariant is preserved**, and `similarity` is not added to the ref).
- Thresholds flow config → route → repo opts: `config.js` reads the two env vars; `buildApp`
  decorates `app.embeddingSearch = { minSimilarity, topDrop }`; the semantic-search route passes
  them into `searchDocumentsSemantic(..., { projectId, limit, minSimilarity, topDrop })`. The repo
  method falls back to module defaults (0.45 / 0.20) when opts are absent (keeps it testable
  standalone).

The cutoff applies to **HTTP and MCP** automatically (both go through the same route → repo), and
the ref shape is unchanged (just fewer rows).

---

## Issue 2 — Auto-focus the top result

After an Enter-triggered semantic search, the matching doc appears at the top of the list but the
detail pane keeps showing the previously-selected doc. The search should open the #1 hit.

### Implementation (frontend, `main.js` Enter handler)

After `semanticSearch` returns `refs`:
- If `refs.length > 0`: set `semanticResults: refs` **and** select the top result —
  `selectedDocumentId = refs[0].id`, seed `documentDraftId`/`documentDraftBody` from the full doc
  in `state.documents` (refs lack `body`), clear `documentLinks`, then after render call
  `loadDocumentLinks(refs[0].id)` (mirrors the existing row-click selection path).
- If `refs.length === 0` (cutoff filtered everything): `semanticResults: []`,
  `selectedDocumentId: null` → the detail pane shows its existing empty state, and the list shows
  a "no relevant documents" empty state (handled by the existing empty-list renderer, which already
  renders for an empty document array).

The editor-pane resolution added in v0.13.0 (semantic mode resolves the selected doc from
`state.documents`) already handles the body; this change just makes the selection point at the top
hit instead of the stale one.

---

## Issue 3 — Switch buttons render huge

`.library-browser` is a CSS grid with `grid-template-rows: auto auto auto minmax(0, 1fr)` — exactly
four rows, the last being the scrollable `.document-list`. v0.13.0 inserted `.library-search-mode`
as a new child **before** `.document-list`, so the search-mode div fell into the `minmax(0,1fr)`
row (stretches to fill all remaining height) and the list was pushed into an implicit `auto` row.
The buttons then stretch to the tall search-mode row (`display:flex` default `align-items: stretch`).

### Decision: flex column, list is the sole grower

Replace the fragile positional grid with a flex column so any number of fixed-height sections can
precede the scrolling list:

```css
.library-browser {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-right: 0;
}
.library-search-mode { flex: 0 0 auto; align-items: center; }  /* content height; no stretch */
.document-list { flex: 1; min-height: 0; }                     /* grows + scrolls (keeps grid/overflow) */
```

This is robust whether or not the switch is present (it's conditionally rendered), and removes the
hard dependency on an exact child count. Verified visually on the running stack before hand-off.

---

## Testing & rollout

- **Unit:** `applyRelevanceCutoff` (gap + floor + empty), `config.js` (new env defaults +
  overrides), `buildSearchDocumentsSemantic` (similarity column present), route still returns the
  ref shape (no `similarity`/`embedding` leak).
- **Syntax/visual:** `npm run check`; redeploy to the running stack and confirm the three fixes in
  the browser (small pills; nonsense query → empty state; a real query → only relevant + top hit
  focused).
- **Docs:** note the cutoff + the two env vars in `docs/contract.md`.
- Ship as **v0.13.1** via the standard branch → PR → tag flow. The Postgres image and migrations
  are unchanged (no new migration).
