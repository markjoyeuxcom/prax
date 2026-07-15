# Coherent knowledge lifecycle design

**Status:** Implemented and verified
**Date:** 2026-07-13
**Surface:** Library trust, provenance, supersession, archive, restore, and deletion
**Quality gate:** QINV-02, QINV-03, QINV-04, QINV-05, and QINV-11 in the
[Exceptional Prax Quality Standard](./2026-07-13-exceptional-prax-quality-standard.md)

## Problem

Prax exposes the right lifecycle concepts, but their implementation does not yet make one coherent
contract:

1. A `supersedes` edge and the target document's `status` are written separately. The dedicated
   supersede route, generic link route, archive, restore, unlink, and permanent-delete routes do
   not share one atomic mechanism. Generic HTTP/MCP linking can therefore leave an active target
   behind a live replacement edge, while a failure between route-level writes can report failure
   after only part of the lifecycle change committed.
2. The browser awaits a collection refresh inside mutation `try` blocks. A successful verify,
   supersede, archive, restore, or delete followed by a failed refresh is consequently described as
   a failed mutation. A lost response is not reconciled with canonical state.
3. Supersession has no human recovery affordance even though unlinking the replacement is supported
   by the API and MCP.
4. Browser evidence covers isolated happy paths rather than the defining verify → revise →
   supersede → retrieve → archive → restore lifecycle and its adverse outcomes.

## Journey contract

The activated journey is:

1. Open agent-written knowledge and see that it is unverified and attributable to an agent.
2. Verify it as a person and see the verifier reflected immediately.
3. Revise through the reviewed editor path without losing verification; prove an unreviewed agent
   revision revokes it.
4. Supersede the document with an active replacement and see the predecessor leave default
   retrieval while the directional replacement link remains inspectable.
5. Undo the supersession and recover the predecessor without disturbing any other live
   replacement.
6. Archive and restore the replacement, with the predecessor's derived status following the live
   replacement set exactly.
7. Permanently delete only after explicit confirmation, with no dangling lifecycle state.
8. If a response is lost or a refresh fails, report only what canonical readback proves and never
   invite an unsafe duplicate action.

## Design

### Database-enforced supersession

Migration `0012` installs SQLite triggers that make the relationship the source of truth:

- inserting a live `supersedes` link retires its active target in the same statement;
- deleting the link reactivates the target only when no other live replacement remains;
- archiving a replacement releases only targets with no other live replacement;
- restoring a replacement retires its linked active targets again;
- foreign-key cascade deletion flows through the same unlink rule.

The route layer no longer performs secondary status writes. This removes partial-commit windows
and makes the generic HTTP/MCP relation path obey the same invariant as the dedicated action.
The existing repository status helpers remain available for compatibility and repair tooling, but
normal lifecycle routes do not depend on them.

### Truthful browser outcomes

Each lifecycle write returns its canonical document and updates the local cache before any
collection refresh. Refresh failure is a partial-success state: the committed result stays visible
and the toast asks for a reload rather than claiming the mutation failed.

If the mutation request rejects, the browser reads the affected document back and compares the
observable intent (`verified`, `status`, `archivedAt`, or absence after permanent deletion). A
matching readback is treated as committed. A contradictory readback is a confirmed failure. If
readback is also unavailable, the outcome is explicitly unknown and the person is told to reload
before retrying. The affected document is locked against another lifecycle mutation for the rest
of that page session, so the remaining control surface cannot contradict that instruction.

### Reversibility and provenance

Verification remains directly reversible through Verify/Unverify and records `verifiedBy`.
Human-reviewed editor writes retain verification; agent-origin writes stamp `updatedBy: agent` and
clear verification. Supersession offers an Undo toast that removes the exact replacement edge.
Archive offers Restore through the same outcome handling. Permanent deletion remains the one
irreversible action and requires an explicit danger confirmation.

### Retrieval agreement

Default keyword, semantic, context-pack, and machine retrieval continue to select active,
non-archived knowledge. Curation paths may explicitly request superseded or archived records.
Lifecycle tests assert both record state and default retrieval rather than only checking a chip.

## Evidence

- Migration/SQLite integration evidence for generic-link activation, multi-replacement behavior,
  archive/restore, unlink, and cascade deletion.
- Pure frontend evidence for observable lifecycle intent matching.
- Production-browser evidence for the full human journey, exact Undo, lost-response readback, and
  refresh-failure truthfulness.
- MCP contract evidence that generic `supersedes` links use the same HTTP relation contract.
- Full unit, syntax, browser, retrieval-eval, portability, and restore gates.

## Out of scope

- A general document event ledger or version-history browser.
- Portable export of runtime trust state; the format contract deliberately excludes it.
- A new lifecycle state beyond active, superseded, and deprecated.
- Redesigning the whole editor or document graph UI.
