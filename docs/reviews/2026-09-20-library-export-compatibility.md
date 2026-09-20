# Entire-library export compatibility review — 2026-09-20

**Historical audit, before the export fixes.** The original behavior and evidence below are retained
for context. The probe now asserts v3 preservation; see
[resolution and release validation](2026-09-20-workspace-export-resolution.md) for the current result.

**Result: document content exports, but the operation does not preserve every current Prax
feature or provide a full restore.** Reviewed the current checkout, including the unreleased
Inbox workflow. The product export implementation was not changed by this review.

## Behavior checked

Settings → Data & admin → Export entire library and Library → Export open the same
scope/destination dialog. Scope `all` calls `GET /api/library/export?project=all`; Library
search, tags and project facets do not restrict it. The route emits a ZIP with one Markdown
file per nonarchived document, grouped by project slug. Duplicate filenames receive suffixes;
exported graph references use the final filenames. The desktop/browser destination handling
does not change archive contents.

| Feature | Export coverage |
| --- | --- |
| All seven document types, including Template, Reference and Post-mortem | Type and saved body included. |
| Memory and Inbox documents | Included like other project-owned documents. |
| Weekly reviews | Saved body and `weekly-review` tag included. The processing link stays a Prax-specific fragment; it cannot process items outside Prax. |
| Reference created from an Inbox task | Copied description/notes/checklist included; original archived task, task-document association and undo receipt omitted. |
| Document title, project slug, tags, timestamps, source/synthesized kind, content hash | Included. Body export adds a terminal newline when absent. |
| Human versus agent origin | `updated_by` included; specific agent (`updated_by_agent`) omitted. |
| Document UUID, verification/verifier/time, lifecycle status and staleness evidence | Omitted. Link target IDs alone do not provide each exported document's own UUID. |
| Document graph | `derived-from` and `supersedes` ID/ref pairs included; dependency snapshot hashes omitted. Targets outside the export may produce dangling refs. |
| Code-pinned citations and separate external references | Omitted; URLs already written into the Markdown body remain as text. |
| Archived documents, including generated copies retained by Undo | Excluded. |
| Tasks, schedules, activity, runbook executions, Inbox receipts | Excluded. The separate task JSON export covers documented task fields/checklists, not the complete workspace. |
| Project setup/metadata and empty projects, model/settings/index state | Excluded. A project slug on a document is not a project backup. |
| Bundled starters | Not database documents and therefore excluded. A saved document copy exports; an onboarding task belongs to task export. |
| Saved Library views, current filters/scroll, unfinished browser decisions/drafts | Browser state, excluded. Unsaved input is not in a database backup either. |
| Re-import | Plain intake creates a Note with the file text; it does not reconstruct front-matter metadata, original types, trust, ownership or graph links. |

## Confirmed defect: lifecycle disclosure

The dialog says **“Includes active documents only”** in `public/js/renderLibraryExport.js`.
`buildListActiveDocumentsForExport` in `server/libraryRepository.js` tests only
`archived_at is null`; it does not exclude `status=superseded|deprecated`.
`formatFrontMatter` in `server/libraryExport.js` omits `status`, so retired guidance exports
without its lifecycle label. A real ZIP generated in the probe contains both the superseded
and deprecated fixtures. This is a misleading export-scope/lifecycle representation and should
be corrected before proposing the next release under the current Gate A policy.

The missing operational tables and lack of Markdown restore are documented limitations, not
proof that the ZIP command failed. Additional metadata omissions matter for the newer memory
and provenance features and should be explicit in the UI/format contract. A full-fidelity
workspace recovery action should use the existing validated SQLite backup/restore path rather
than imply that Markdown import restores these features. SQLite covers committed database
state, including migration 0033 receipts; bundled resources and browser-only drafts are separate.

## Evidence

- `node docs/reviews/2026-09-20-library-export-audit.mjs [optional-output.zip]` runs only a
  disposable production SQLite app. The current probe produced 14 ZIP entries and asserted
  all seven types, Memory/Inbox content, reviews, task-to-reference contents, archive exclusion,
  omitted metadata, retired-document inclusion and plain-note re-import behavior.
- 66 existing export/backend/frontend checks passed: `libraryExport`,
  `libraryExport.linksAndProvenance`, `libraryExportRoute`, `librarySingleExportRoute`,
  `documentLinksRepository.export`, `libraryExportDestination`, `renderLibraryExport`.
- All 3 `tests/e2e/library-export.spec.js` browser checks passed in 3.6 seconds:
  scope/Save-picker write, cancellation and both Settings entry points. Reviewed Parley run
  `3aaf5599-8978-4c01-b6b2-b5999e6a3133`, captured exit status 0, no cancellation/truncation.
- Follow-up Prax task `d033a1c8-7fd8-455d-b44a-96d20f3d935b` records the confirmed
  lifecycle disclosure defect as planned work; this review did not mark it fixed.

The tests passing prove the existing export contract; they do not make it a full backup or
cover fields the format never promised. No personal library was exported, imported or modified
for the fixture, and no release/installation took place.
