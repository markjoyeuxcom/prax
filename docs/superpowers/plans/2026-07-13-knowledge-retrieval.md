# Trustworthy knowledge retrieval implementation plan

**Spec:** [2026-07-13-knowledge-retrieval-design.md](../specs/2026-07-13-knowledge-retrieval-design.md)
**Status:** Complete

## 1. Exact, trust-bearing semantic references

- [x] Extend semantic candidate rows with the trust fields needed by result cards.
- [x] Extend route references without exposing embeddings.
- [x] Lock the shape and exact paged total in repository, route, and SQLite tests.

## 2. Browser pagination and result semantics

- [x] Request the paged semantic envelope from `libraryApi.js`.
- [x] Track exact page state, append loading, and append failure in application state.
- [x] Render exact totals, trust chips, honest similarity labels, and a keyboard-operable Load more
      control.
- [x] Reject stale initial and append responses with the semantic request token.

## 3. Ask Prax trust and recovery

- [x] Add request ownership so late answers cannot replace a newer query or reopened overlay.
- [x] Return and render explicit semantic-to-keyword fallback metadata.
- [x] Strengthen the prompt boundary for untrusted retrieved documents.
- [x] Validate generated citations against retrieved sources and degrade safely on failure.
- [x] Remove raw provider exception text from the client response.
- [x] Make sources accessible controls that open the canonical document.

## 4. Production-path evidence

- [x] Prove exact multi-page retrieval without duplicates and with visible trust state.
- [x] Prove a slow Ask Prax response cannot overwrite the newer answer.
- [x] Prove a cited source is keyboard-openable from the dialog.

## 5. Gates and adoption record

- [x] Run focused unit/route/browser tests.
- [x] Run `npm test`, `npm run check`, and the full Playwright suite.
- [x] Run `npm run verify:portable`, `npm run verify:restore`, and `git diff --check`.
- [x] Update the exceptional-quality evidence. Durable memory remains an explicit follow-up because
      the local Prax service was unavailable.

## Verification

- `npm test`: 155/155 test files.
- `npm run check`: passed.
- `npm run test:e2e`: 36/36 browser journeys.
- Focused retrieval browser suite: 2/2.
- `npm run eval`: 7/7 cases, 100% recall.
- `npm run verify:portable`: passed.
- `npm run verify:restore`: passed for current live-WAL and historical-schema drills.
- `git diff --check`: clean.
