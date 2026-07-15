# MCP Collection Pagination — Design

**Date:** 2026-07-13
**Status:** Approved for implementation
**Quality gate:** QINV-10 in the [Exceptional Prax Quality Standard](./2026-07-13-exceptional-prax-quality-standard.md)

## Problem

Prax's MCP list and search tools silently discard every result after the first 20. The caller
cannot tell that data was omitted and has no way to request the next result. This is especially
dangerous for maintenance tools: an agent can mistake a partial stale/orphan list for a complete
inventory.

## Contract

Every MCP tool whose primary result is a collection accepts the same optional inputs:

- `limit`: integer from 1 through 50; defaults to 20.
- `offset`: non-negative integer; defaults to 0.

Every such tool returns this versioned envelope:

```json
{
  "schemaVersion": 1,
  "items": [],
  "page": {
    "offset": 0,
    "limit": 20,
    "returned": 0,
    "total": 0,
    "hasMore": false,
    "nextOffset": null
  }
}
```

`total` is the exact number of matching records, not an estimate. When `hasMore` is true,
passing `nextOffset` as the next call's `offset` enumerates the next page without overlap.
Callers should ignore unknown fields for forward compatibility.

The affected tools are `search_tasks`, `search_documents`, `list_task_documents`,
`list_task_checklist`, `list_task_activity`, `list_document_links`, `list_external_refs`,
`list_stale_documents`, `list_orphan_documents`, `search_documents_semantic`, and
`list_runbook_runs`.

Mutation responses that happen to include an array are not collection endpoints and retain their
existing shapes.

## Semantic search

The current semantic-search HTTP route computes only a fixed top 20 array. It will gain an
opt-in `page=true` mode with `limit` and `offset`; this mode returns the same `items` + `page`
metadata (without changing the default array response used by the browser). The repository ranks
and relevance-filters the full candidate set before slicing, so `total` is exact and later pages
remain reachable. The MCP client always uses paged mode.

## Compatibility

This is a deliberate pre-1.0 MCP contract break: collection outputs change from a bare array to a
versioned envelope, and the contract documentation/tests change in the same patch. Tool names and
all existing inputs remain intact; `limit` and `offset` are additive. The co-shipped browser keeps
the existing semantic-search HTTP array response unless it explicitly opts into paged mode.

## Verification

- Unit-test pagination boundaries, empty/non-array inputs, maximum page size, and exact metadata.
- Contract-test the optional inputs and envelope key sets.
- Behaviour-test each affected MCP handler.
- Backend-test semantic-search paging and preservation of the default HTTP response.
- Run `npm test` and `npm run check`.
