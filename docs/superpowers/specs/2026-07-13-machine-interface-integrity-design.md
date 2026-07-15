# Machine-interface integrity design

**Date:** 2026-07-13
**Journey:** 14 — MCP, CLI, and agent skills
**Quality invariants:** QINV-02, QINV-03, QINV-04, QINV-08, QINV-10, QINV-11

## Outcome

An agent or shell client can enumerate, read, mutate, retry, and reconcile Prax data without
silently mistaking a missing owner for an empty collection, duplicating a consequential create,
hiding a degraded search, or claiming that a write failed after it actually committed.

## Findings

The collection-envelope work already makes MCP result bounds explicit, but the mutation and
owner semantics still have gaps:

1. MCP task/document/checklist/run creation does not consistently allocate a caller-stable UUID.
   A response lost after commit can therefore produce a duplicate on retry.
2. Generated runbooks and post-mortems are especially unsafe to retry: they may rerun a model and
   create another document. A UUID alone is insufficient because a changed prompt must not replay
   an unrelated result.
3. Relationship removals and checklist deletion return 404 on replay. After a lost response the
   caller sees a failure even though the requested absence is already true.
4. Child collections such as task activity, checklist items, document links, and external refs can
   return an empty array when the owning task/document does not exist.
5. The MCP HTTP client does not retry even operations whose server contract is idempotent, and task
   and relationship writes do not consistently stamp agent origin.
6. `prax search` catches every semantic-search failure and silently falls back to keyword results.
   JSON output is a bare array with no retrieval mode or degradation signal.
7. `prax verify` is described as a human trust action but is callable non-interactively with a
   generic `verifiedBy = "cli"`, allowing an automated workflow to bless its own output accidentally.
8. Context-pack Markdown and the `ask_prax` tool discard known retrieval/degradation metadata,
   making keyword/recency fallback look like ordinary semantic evidence.

## Contract

### Stable mutation identity

- `create_task`, `create_document`, `add_checklist_item`, `start_runbook_run`,
  `generate_post_mortem`, and `generate_runbook` accept an optional caller-stable UUID.
- MCP allocates a UUID when the caller omits one and sends it to the HTTP API. The same ID plus the
  same intent is an exact replay; reusing it for different intent returns 409.
- If the transport remains unavailable after the safe retry, the tool error includes the allocated
  ID and tells the caller to retry the same intent with that ID. It never asserts failure when the
  commit outcome is unknown.
- The MCP and CLI HTTP clients retry transport failure once only for operations declared safe to
  replay. They do not retry arbitrary reads or unsafe legacy writes implicitly.

Checklist creation uses the existing checklist-item primary key as retry identity. Generated
documents persist two internal receipt fields on the result document: operation kind and a SHA-256
hash of canonical caller intent. A retry checks that receipt before invoking the model. Concurrent
same-intent calls may both generate, but only one document is committed and both return that same
result. Changed intent with the same result UUID is a conflict.

### Desired-state removals

Unlink/remove/delete endpoints are idempotent when their owner still exists. Removing an already
absent relationship/item returns the current collection (or 204 for checklist items). A missing
owner remains 404. This makes a retry truthful without turning a bad owner ID into success.

### Owner-aware collections

Every child collection first proves that its owner exists. A valid empty owner returns an empty
collection; a nonexistent owner returns 404. Archived owners remain readable, matching by-ID read
semantics, while create/link routes keep their existing active-owner rules.

### Explicit degraded search

`prax search` falls back only when semantic search explicitly returns 409 (not configured). Human
output prints a degradation notice. JSON output becomes:

```json
{
  "schemaVersion": 1,
  "retrieval": { "mode": "semantic|keyword", "degraded": false, "reason": null },
  "items": []
}
```

Unexpected semantic failures propagate. Keyword fallback uses
`reason: "semantic-not-configured"` and `degraded: true`.

Context-pack JSON includes the same retrieval object. Markdown renders it directly under the query,
including keyword/recency fallback and reason. `ask_prax` retains its prose-first output but prepends
or appends an explicit degradation/retrieval note whenever generation or retrieval falls back.

### Human verification boundary

`prax verify` requires all of the following:

- an interactive input and output terminal;
- an explicit nonblank `--as <human-name>` value;
- review of the full current document printed before mutation;
- typing a document-specific confirmation phrase.

The reviewed document's `contentHash` is sent as an atomic write precondition. If the body changes
between review and verification, the server returns 409 and leaves it unverified. The Library UI
uses the same guard.

`--json` is rejected for this interactive operation. `unverify` remains scriptable because it lowers
trust rather than granting it. This is a workflow boundary, not an authentication boundary; the
trusted-network security model is unchanged.

### MCP annotations and provenance

All mutation tools declare `idempotentHint` only after their retry contract is safe. Tools that
remove, overwrite, retire, abort, or complete state also declare `destructiveHint`. Every MCP write
sends `x-prax-origin: agent`, even where the current record does not yet expose actor metadata.

## Compatibility

- Existing HTTP clients may omit stable IDs and retain their prior single-shot behavior.
- MCP inputs gain optional fields; tool names and required fields do not change.
- Full-record success shapes remain full records. Link/removal confirmation shapes remain stable.
- The intentional breaking change is `prax search --json`, which moves from a bare array to a
  versioned envelope so machines cannot miss degradation.
- Verification remains available in the Library UI and in an attended terminal.

## Acceptance evidence

- Contract tests pin every new optional MCP identity field and mutation annotation.
- Backend tests prove exact replay/conflict for checklist and generated-document creation.
- Backend tests prove absent-owner versus empty-owner behavior and idempotent removal replay.
- Client/tool tests simulate a lost first response and prove one retry returns one canonical result.
- CLI tests prove explicit search degradation and the verification gate.
- `npm test` and `npm run check` pass on the complete worktree.
