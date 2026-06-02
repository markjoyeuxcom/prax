# Changelog

All notable changes to Moomora Console are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Moomora Console is pre-1.0:
the data formats are still evolving, and `docs/contract.md` is a format *reference* (with
regression tests under `tests/contract/`), not a stability contract.

At release time, the `[Unreleased]` section is renamed to the new version with its date, and a
fresh empty `[Unreleased]` section is started.

## [Unreleased]

## [0.11.0] - 2026-06-02

### Added

- Library `.md` export front-matter v2: outbound document links
  (`derived-from` / `supersedes`) with a hybrid `{ id, ref }` identifier per
  target, content hash, edit origin (`updated_by`), and `kind`. New
  `GET /api/library/documents/:id/export` route renders a single document as
  v2 markdown server-side (`text/markdown; charset=utf-8`, `Content-Disposition:
  attachment`). The browser single-doc download now navigates to this route
  instead of rendering client-side. Export-only — no import path, no YAML
  version field; v1 readers silently accept v2 since YAML ignores unknown
  keys. (#32)

### Changed

- Bumped `archiver` to 8.0.0 (ESM-only, named `ZipArchive` export). (#31)

## [0.10.0] - 2026-06-02

### Added

- Document `kind` (`"source"` / `"synthesized"`) distinguishing hand-authored documents
  from agent-synthesized derivations. Exposed on reads (`get_document`, search rows,
  stale/orphan rows), accepted as an optional input on `create_document` / `update_document`
  (HTTP + MCP), and supported as a `?kind=` filter on `GET /api/library/documents` and
  `search_documents`. Set explicitly by callers (no inference from `x-moomora-origin`);
  mutable via `update_document` so a polished synthesized doc can be promoted to source.
  Stale/orphan grooming rows carry `kind` so agents can refresh stale synthesized docs
  aggressively and leave stale source docs for human review. (#29)

## [0.9.0] - 2026-05-31

### Added

- Document graph: typed, directional document↔document links (`derived-from`, `supersedes`)
  with backlink retrieval, plus fetch-by-id routes (`GET /api/library/documents/:id`,
  `GET /api/tasks/:id`), exposed over the HTTP API and MCP (`link_documents`,
  `unlink_documents`, `list_document_links`). (#25)
- Document provenance and a stale/orphan groom loop: per-document content hash and
  path-stamped edit-origin (`updated_by`, from the `x-moomora-origin` header), a source-hash
  snapshot on `derived-from` links (refreshed on re-link), and read-only stale/orphan
  detection (`list_stale_documents`, `list_orphan_documents`, and
  `GET /api/library/maintenance/stale|orphans`). Documents now expose `contentHash` and
  `updatedBy`. (#26)

## [0.8.0] - 2026-05-31

### Added

- Database migration system: forward-only SQL migrations tracked in a `schema_migrations`
  table, applied through an advisory-locked runner on startup or via `npm run migrate`, plus
  backup/restore documentation (`docs/backup-restore.md`). (#20)
- Data-formats reference (`docs/contract.md`) documenting the `moomora.tasks` export/import
  format, the library `.md` front-matter, and the MCP tool surface, backed by a
  regression-test suite under `tests/contract/` that flags accidental shape changes. (#21, #22)

### Changed

- Refreshed the README screenshots to match the redesigned desktop UI.

### Removed

- Dead board-inspector code left over after the task-detail drawer migration. (#19)

## [0.7.7] - 2026-05-29

### Changed

- Broadened the project positioning beyond homelab use and updated the README to reflect the
  shipped MCP server and Markdown library.

### Fixed

- Decluttered the mobile top bar and repaired non-functional modal cancel buttons. (#18)

## [0.7.6] - 2026-05-28

### Changed

- Desktop layout and navigation redesign: grouped left-rail navigation, a metric strip, and a
  resizable task-detail drawer. (#17)

## [0.7.5] - 2026-05-28

### Added

- Read-only Library archive view for browsing archived documents separately from the active
  list. (#16)

### Changed

- The release workflow now auto-creates a GitHub Release on tag push.

## [0.7.4] - 2026-05-28

### Fixed

- Release-pipeline fix (container image publishing); no functional application changes.

## [0.7.3] - 2026-05-28

### Added

- Library export: single-document `.md` download and bulk ZIP export. (#15)

## [0.7.2] - 2026-05-22

### Fixed

- Mirrored the board-extras batch endpoint in the in-memory demo server. (#14)

## [0.7.1] - 2026-05-22

### Changed

- Board extras now load in a single batched request instead of one per card. (#13)

## [0.7.0] - 2026-05-22

### Changed

- Polished the board and sidebar workspace styling. (#12)

## [0.6.1] - 2026-05-22

### Fixed

- Scoped checklist item updates and deletes to their owning task. (#11)

## [0.6.0] - 2026-05-22

### Added

- Task detail enrichment: notes, checklist, and activity log. (#8)
- List-view swimlanes: project grouping on the Tasks view. (#10)

### Fixed

- Open a linked document regardless of the active Library filters. (#9)

## [0.5.1] - 2026-05-21

### Fixed

- The MCP server now advertises the package version instead of a stale hard-coded literal.

## [0.5.0] - 2026-05-21

### Added

- Board enhancements: project swimlanes and a density toggle. (#7)

## [0.4.1] - 2026-05-21

### Fixed

- Normalised task `dueDate` to `YYYY-MM-DD` when read from PostgreSQL.

### Changed

- Refreshed the README for the projects/board/palette features and recaptured screenshots.

## [0.4.0] - 2026-05-21

### Added

- User-creatable projects, a navigation redesign, and the Midnight palette. (#6)

## [0.3.0] - 2026-05-20

### Added

- Local MCP server exposing subscription-backed task and document access to Claude Code. (#5)

## [0.2.0] - 2026-05-20

### Added

- Browser-local appearance preferences: colour palettes, a font-scale control, and a settings
  panel.
- Operator-evolved UI redesign and task↔document linking. (#4)

### Changed

- Adopted a GitHub-like system font stack.

## [0.1.1] - 2026-05-19

### Added

- Multi-architecture release image publishing and Dependabot dependency updates.

### Changed

- Updated the local PostgreSQL image to version 18.

## [0.1.0] - 2026-05-19

### Added

- Initial release of Moomora Console: a Markdown library/document workspace with a CodeMirror
  editor, a Markdown toolbar, and live split preview; tag filtering with searchable saved tag
  views; an inline document info editor; a Docker Compose local install; and CI for tests and
  dependency security scanning.

[Unreleased]: https://github.com/awaybreaktoday/moomora-console/compare/v0.11.0...HEAD
[0.11.0]: https://github.com/awaybreaktoday/moomora-console/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/awaybreaktoday/moomora-console/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/awaybreaktoday/moomora-console/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/awaybreaktoday/moomora-console/compare/v0.7.7...v0.8.0
[0.7.7]: https://github.com/awaybreaktoday/moomora-console/compare/v0.7.6...v0.7.7
[0.7.6]: https://github.com/awaybreaktoday/moomora-console/compare/v0.7.5...v0.7.6
[0.7.5]: https://github.com/awaybreaktoday/moomora-console/compare/v0.7.4...v0.7.5
[0.7.4]: https://github.com/awaybreaktoday/moomora-console/compare/v0.7.3...v0.7.4
[0.7.3]: https://github.com/awaybreaktoday/moomora-console/compare/v0.7.2...v0.7.3
[0.7.2]: https://github.com/awaybreaktoday/moomora-console/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/awaybreaktoday/moomora-console/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/awaybreaktoday/moomora-console/compare/v0.6.1...v0.7.0
[0.6.1]: https://github.com/awaybreaktoday/moomora-console/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/awaybreaktoday/moomora-console/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/awaybreaktoday/moomora-console/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/awaybreaktoday/moomora-console/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/awaybreaktoday/moomora-console/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/awaybreaktoday/moomora-console/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/awaybreaktoday/moomora-console/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/awaybreaktoday/moomora-console/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/awaybreaktoday/moomora-console/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/awaybreaktoday/moomora-console/releases/tag/v0.1.0
