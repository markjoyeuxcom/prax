# MCP Collection Pagination Implementation Plan

**Goal:** Replace every silent MCP collection cap with one explicit, versioned pagination
contract and make semantic results fully enumerable.

**Design:** [MCP Collection Pagination — Design](../specs/2026-07-13-mcp-pagination-design.md)

## Work

- [x] Add the shared MCP pagination schema/helper and contract tests.
- [x] Migrate every collection-producing MCP tool, including runbook runs.
- [x] Add exact pagination to semantic search while preserving the browser's default HTTP shape.
- [x] Update behavioural tests and external contract documentation.
- [x] Run focused tests, `npm test`, and `npm run check`.
- [x] Record QINV-10 evidence in the exceptional-quality standard. Durable-memory write was
  attempted; the local Prax service was unavailable, so the repository documents remain the
  authoritative record until the write can be retried.
