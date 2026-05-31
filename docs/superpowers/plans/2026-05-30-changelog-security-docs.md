# CHANGELOG + SECURITY Docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `CHANGELOG.md` (Keep a Changelog format, reconstructed `v0.1.0`→`v0.7.7` history + `[Unreleased]`) and `SECURITY.md` (support policy, private-advisory reporting, explicit no-auth security model), and link both from the README.

**Architecture:** Two new top-level Markdown docs plus two small README edits. No code changes; the test/check surface is unaffected.

**Tech Stack:** Markdown only. Verified against the repo's existing `npm test` (592 passing) and `npm run check` to confirm nothing regressed.

---

## Notes for the implementer

- These are **static documentation files** with fully-specified content below — write them verbatim. The CHANGELOG history was reconstructed from `git log` per tag range; do not invent or re-summarize entries.
- Repo URL for links: `https://github.com/awaybreaktoday/moomora-console`.
- Do **not** bump `package.json` or tag anything — versioning/tagging is a separate release step. The `[Unreleased]` section stays "Unreleased" until a release is cut.
- After each file, run `npm test` and `npm run check` to confirm the doc-only change didn't disturb anything (expect **592 pass / 0 fail**, check exit 0).

---

## Task 1: CHANGELOG.md

**Files:**
- Create: `CHANGELOG.md`

- [ ] **Step 1: Create `CHANGELOG.md` with exactly this content**

```markdown
# Changelog

All notable changes to Moomora Console are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Moomora Console is pre-1.0:
the data formats are still evolving, and `docs/contract.md` is a format *reference* (with
regression tests under `tests/contract/`), not a stability contract.

At release time, the `[Unreleased]` section is renamed to the new version with its date, and a
fresh empty `[Unreleased]` section is started.

## [Unreleased]

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

[Unreleased]: https://github.com/awaybreaktoday/moomora-console/compare/v0.7.7...HEAD
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
```

- [ ] **Step 2: Verify the suite and check are undisturbed**

Run: `npm test && npm run check`
Expected: `592 pass / 0 fail`, check exits 0 (a doc-only addition changes neither).

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: add CHANGELOG with reconstructed release history"
```

---

## Task 2: SECURITY.md + README links

**Files:**
- Create: `SECURITY.md`
- Modify: `README.md`

- [ ] **Step 1: Create `SECURITY.md` with exactly this content**

```markdown
# Security Policy

## Supported Versions

Moomora Console is maintained by a single author. Only the latest release receives security
fixes; please upgrade to the newest version before reporting an issue.

| Version | Supported |
|---------|-----------|
| Latest release | ✅ |
| Older releases | ❌ |

## Reporting a Vulnerability

Please report security vulnerabilities **privately** through GitHub's
[private vulnerability reporting](https://github.com/awaybreaktoday/moomora-console/security/advisories/new)
("Report a vulnerability" under the repository's **Security** tab). Do **not** open a public
issue for a security problem.

Expect a best-effort response from a single maintainer. Reporters are credited in the resulting
advisory unless they ask to remain anonymous.

## Security Model & Scope

Understand the trust boundary before exposing Moomora Console to a network:

- **No built-in authentication or authorization, by design.** Moomora Console is built for
  single-user, trusted-network, or localhost operation. Anyone who can reach the HTTP port has
  full read/write access to every project, task, and document.
- **Network-exposed deployments must add their own auth.** Put authentication and TLS at the
  ingress / reverse-proxy layer. See [docs/deployment.md](docs/deployment.md), which covers
  ingress-layer authentication for Kubernetes.
- **No multi-tenant isolation.** The database holds a single logical workspace; there are no
  per-user boundaries.
- **Secrets come from the environment.** The database connection string (`DATABASE_URL`, or the
  CloudNativePG app secret in Kubernetes) is read from the environment and never committed to
  the repository.
- **Dependency scanning runs in CI.** Every push and pull request runs `npm audit
  --audit-level=high`, and pull requests additionally run GitHub's dependency-review action.
```

- [ ] **Step 2: Add links to `README.md`**

Find this block (the License + Repository sections near the end of `README.md`):

```markdown
## License

MIT. See [LICENSE](LICENSE).
```

Replace it with:

```markdown
## Security

See [SECURITY.md](SECURITY.md) for the security model (no built-in auth; trusted-network by
design) and how to report a vulnerability.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for the release history.

## License

MIT. See [LICENSE](LICENSE).
```

- [ ] **Step 3: Verify**

Run: `npm test && npm run check`
Expected: `592 pass / 0 fail`, check exits 0.

Also confirm the referenced files exist so the links resolve:
```bash
ls docs/deployment.md LICENSE CHANGELOG.md SECURITY.md
```
Expected: all four listed (CHANGELOG.md from Task 1, the others pre-existing).

- [ ] **Step 4: Commit**

```bash
git add SECURITY.md README.md
git commit -m "docs: add SECURITY policy and link CHANGELOG/SECURITY from README"
```

---

## Self-review notes (for the implementer)

- Task 1 must be done before Task 2's `ls` check (which expects `CHANGELOG.md` to exist).
- Do not modify `package.json`, any source file, or any test — this is docs-only.
- The CHANGELOG entries are reconstructed from real git history; if you believe an entry is
  wrong, flag it rather than rewriting from imagination.
