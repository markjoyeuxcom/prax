# Trustworthy knowledge retrieval design

**Status:** Implemented and verified
**Date:** 2026-07-13
**Surface:** Library semantic search and Ask Prax
**Quality gate:** QINV-08, QINV-09, and QINV-10 in the
[Exceptional Prax Quality Standard](./2026-07-13-exceptional-prax-quality-standard.md)

## Problem

Prax already supports keyword search, semantic search, and grounded answers, but the defining
retrieval journey still has correctness and trust gaps:

1. The browser uses the legacy semantic-search array response, which is capped at 20 results.
   It then describes the returned count as the number of matches, even when more matches exist.
2. Semantic cards omit synthesized, stale, and verified state even though those signals are
   central to deciding whether a result is safe to use.
3. Ask Prax requests are not versioned. A slow earlier answer can overwrite a newer query or
   reappear after the overlay has been closed and reopened.
4. Ask Prax silently falls back from failed semantic retrieval to keywords. The user cannot tell
   that the retrieval mode degraded.
5. Source pills are labels rather than navigable evidence, so the answer cannot be checked in one
   direct keyboard-accessible step.
6. Provider exception text is returned to the browser, and generated citations are not checked
   against the retrieved source set.

These are class-level failures, not presentation polish: incomplete results can look complete,
old asynchronous work can become current, and trust or degradation can be hidden at the point of
decision.

## Journey contract

The activated journey is:

1. Open Library and choose semantic search.
2. Submit a plain-language query by keyboard.
3. See an announced loading state followed by the exact relevant-result total.
4. Inspect rank/similarity, document type, and trust state before choosing a result.
5. Load additional pages without losing or duplicating earlier results.
6. Open a result and reach the canonical document.
7. Ask Prax a related question, receive either a citation-checked grounded answer or the retrieved
   context pack, see any retrieval fallback explicitly, and open a cited source directly.
8. If an earlier query resolves late, it has no visible effect.

## Design

### Exact semantic result envelope

The browser uses the existing versioned paged route shape:

```json
{
  "items": [],
  "page": {
    "offset": 0,
    "limit": 20,
    "returned": 20,
    "total": 43,
    "hasMore": true,
    "nextOffset": 20
  }
}
```

The initial search replaces prior results. **Load more** requests `nextOffset`, appends unique
document IDs, and retains the exact total. An append failure keeps the already visible page and
offers an inline retry. Query edits, mode changes, navigation, and a new submission invalidate all
older initial or append responses through the existing semantic request token.

Legacy array responses remain tolerated in the client for extensions and test doubles, but are
treated as one complete page; the production browser always asks for the envelope. The HTTP
legacy array remains shape-compatible and now returns every relevant result rather than silently
stopping at 20.

### Trust-bearing result references

Semantic repository candidates include `kind`, `updatedBy`, and a derived stale-source flag in
addition to verification and lifecycle status. The HTTP reference shape carries those fields but
never the embedding. Cards use the same trust chips as keyword cards:

- `SYNTH` for synthesized knowledge;
- `STALE` when a derived source changed;
- `VERIFIED` for human-verified content;
- lifecycle state when retired results are explicitly requested.

Similarity is labelled as cosine similarity, not as a calibrated probability or confidence.

### Ask Prax request ownership

Each Ask Prax submission receives a monotonically increasing client token. A response may commit
only while its token, query, and open overlay still match. Closing the overlay invalidates the
token. A newer submission supersedes the older one without disabling correction or resubmission.

The dialog uses modal semantics, named controls, an announced busy/result region, and prevents an
empty submission. Sources are buttons whose accessible name includes title, type, and trust. A
source activation closes the overlay and opens the canonical document.

### Explicit retrieval mode

The Ask Prax response adds:

```json
{
  "retrieval": {
    "mode": "semantic",
    "fallback": false,
    "reason": null
  }
}
```

When semantic retrieval fails, keyword fallback remains available but returns
`mode: "keyword"`, `fallback: true`, and `reason: "semantic-unavailable"`. A configured semantic
search with no relevant hits may fall back to keywords with reason `semantic-no-match`. When no
semantic provider is configured, keyword retrieval is the expected mode and is not presented as
an error.

### Grounding and disclosure safety

Retrieved document bodies are explicitly described to the model as untrusted data whose embedded
instructions must not be followed. The server validates that an answer over a non-empty source set
contains at least one exact source-title citation. A citation-validation failure degrades to the
retrieved context pack rather than displaying an apparently grounded answer.

Provider errors remain in server logs. The response exposes only the stable reason
`generation-failed`; raw provider messages are not sent to the browser.

## Evidence

- Pure renderer and citation-validation tests for totals, trust, modal semantics, fallback, and
  citation failure.
- Repository and route tests for trust-bearing references, exact pagination, retrieval metadata,
  and sanitized provider failure.
- Production-path browser evidence for multi-page semantic retrieval, source navigation, and stale
  Ask Prax response rejection.
- Full `npm test`, `npm run check`, `npm run test:e2e`, portability, and restore gates.

## Out of scope

- Replacing embeddings or changing relevance thresholds.
- Hybrid rank fusion or query-specific snippet extraction.
- URL routing for persisted search sessions.
- A general redesign of Library or the editor.
