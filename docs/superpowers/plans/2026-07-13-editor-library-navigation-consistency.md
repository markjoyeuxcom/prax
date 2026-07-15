# Editor and Library Navigation Consistency Implementation Plan

**Goal:** Make every editor exit save-before-navigate and make overlapping library collection loads
latest-request-wins.

**Design:** [Editor and Library Navigation Consistency](../specs/2026-07-13-editor-library-navigation-consistency-design.md)

## Work

- [x] Add a shared editor-exit preparation boundary to top-level navigation.
- [x] Route sidebar, back, filter/project, settings/health, and palette destinations through it.
- [x] Save the current draft before document archive.
- [x] Add latest-request-wins library collection and semantic-query loading.
- [x] Add production-browser delay, failure, stale-response, and keyboard evidence.
- [x] Update the quality record, run all gates, and attempt durable Prax memory.

Verification: `npm test` (150/150 files), `npm run test:e2e` (21/21 journeys),
`npm run check`, `npm run verify:portable`, and `npm run verify:restore` all passed on 2026-07-13.
The Prax-memory write was attempted, but the local service was unavailable at
`http://127.0.0.1:3000`; this version-controlled design remains authoritative.
