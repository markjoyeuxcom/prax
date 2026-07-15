# Document Draft Recovery Implementation Plan

**Goal:** Complete Priority-0 journey #2 with a durable, truthful, explicitly retryable document
draft lifecycle for title and body.

**Design:** [Document Draft Recovery](../specs/2026-07-13-document-draft-recovery-design.md)

## Work

- [x] Add the versioned local recovery-record contract and pure resolution tests.
- [x] Unify editor title/body dirty tracking, autosave, navigation flush, and stale-response handling.
- [x] Reconcile ambiguous write failures before exposing retry and conditionally clear recovery.
- [x] Render an accessible live save status plus explicit retry/recovered-draft actions.
- [x] Add the production-path failure, reload, double-retry, and exactly-once E2E journey.
- [x] Run all local quality gates and update the quality standard. Durable Prax memory remains an
  explicit follow-up because the configured local service was unavailable.
