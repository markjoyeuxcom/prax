# Machine-interface integrity implementation plan

**Spec:** `docs/superpowers/specs/2026-07-13-machine-interface-integrity-design.md`

## 1. Lock the protocol contracts

- Extend MCP schema contracts with optional stable IDs and mutation annotations.
- Add failing backend contracts for owner-aware child collections, idempotent removals, checklist
  creation replay/conflict, and generated-document replay/conflict.
- Add failing client contracts for safe transport retry and agent-origin headers.
- Add failing CLI contracts for explicit search fallback and attended verification.

## 2. Make the HTTP surface reconcilable

- Add durable generated-document receipt columns and repository helpers.
- Add exact-once checklist creation using its existing item UUID.
- Make child DELETE routes desired-state idempotent while retaining missing-owner 404s.
- Make child GET routes distinguish missing owners from empty collections.
- Add exact-once IDs and intent checks to generated runbook/post-mortem routes.

## 3. Harden MCP writes

- Allocate stable IDs in create/start/generate handlers and expose them as optional inputs.
- Retry safe mutations once on transport failure and surface unknown-outcome retry instructions.
- Stamp all writes with agent origin.
- Add accurate `idempotentHint` and `destructiveHint` annotations.
- Correct by-ID error copy that incorrectly suggests archived records are hidden.

## 4. Harden CLI and shared skills

- Make `remember` create with a stable UUID and use safe transport retry for create/update.
- Restrict semantic fallback to the explicit unavailable status and emit a versioned search envelope.
- Require an attended, attributed, document-specific confirmation for `verify`.
- Update CLI, MCP, memory, and HTTP contract documentation.

## 5. Prove the journey

- Run focused backend, MCP, CLI, contract, and migration suites while iterating.
- Run `npm test` and `npm run check` on the final worktree.
- Review the diff for contract drift and persist the durable runbook/finding to Prax when available.
