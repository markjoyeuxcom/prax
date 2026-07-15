# Assistant Approved-Write Partial Success — Design

**Date:** 2026-07-13
**Status:** Implemented and verified
**Quality gate:** QINV-02, QINV-03, and QINV-08 in the
[Exceptional Prax Quality Standard](./2026-07-13-exceptional-prax-quality-standard.md)

## Problem

When a person approves an assistant write, the tool may commit successfully and the provider may
then fail while composing its follow-up. The server already returns canonical history containing
the successful tool result plus `didWrite: true`. The UI currently renders a generic failure ending
in “Please try again.” That message makes a committed change look uncommitted and invites a
duplicate action.

## Outcome contract

Assistant result application distinguishes three outcomes:

1. **Failure before a write:** show an error and allow an ordinary retry.
2. **Write completed, provider follow-up failed:** retain and render the canonical successful tool
   result, refresh tasks/projects/documents, show a non-error partial-success notice, state that the
   change completed, and explicitly say not to repeat the action.
3. **Write completed, cache refresh failed:** state that the change completed, direct the person to
   reload to see it, and explicitly say not to repeat the action. Never claim refresh succeeded.

The pending confirmation is cleared before the approval request begins and is not reconstructed
from history after a response, so double approval is unavailable. The composer remains usable for
a new question after the outcome settles; there is no action-level retry button.

## Deterministic production-path failure

The existing fake chat backend gains a test/dev-only `call_fail_after <tool> {json}` directive. It
proposes the same real assistant tool call as `call`, then throws when the committed tool result is
fed back for the follow-up. This drives the actual route, tool, repository, response envelope, UI
state, and cache refresh without intercepting or fabricating the server response.

The Playwright journey configures the fake provider through the production settings API, asks it to
create a uniquely named Inbox task with `call_fail_after`, approves once, and proves:

- the tool row is canonical and marked done;
- the notice says the approved change completed and must not be repeated;
- no confirmation or retry action remains;
- exactly one task committed in the database; and
- after closing the assistant and opening Inbox (a cached-state navigation), the task is visible,
  proving the UI refresh signal completed.

## Journey record

```text
Journey ID and title: P0-05 — Approved assistant write followed by provider failure
Surfaces: Assistant route/agent, fake chat test backend, assistant panel, task cache/UI
Invariant/category protected: QINV-02, QINV-03, QINV-08; correctness, recovery, truthful feedback
Fixture/profile and fixed clock: production Playwright SQLite app; unique task title; real local clock
Preconditions: Fake tool-capable provider configured; Inbox exists
Happy-path outcome: N/A—the protected adverse path commits once and reports partial success truthfully
Delay/failure/interruption variants: Provider fails after tool commit; cache refresh failure message
Accessibility clauses: Partial outcome uses role=status; hard failure uses role=alert; keyboard approval remains
Machine-contract clauses: status=error + didWrite=true + canonical tool result; pending approval cleared
Performance measurements (only after instrumented): Not instrumented; no budget claim
Automated evidence or reproducible drill: tests/e2e/assistant-partial-success.spec.js;
  tests/backend/assistantRoute.test.js; tests/frontend/assistantOutcome.test.js
Last verified revision/date: codex/resolve-review-findings working tree, 2026-07-13
Known gaps: Provider-specific transport failures remain covered by adapter tests rather than duplicated here
```
