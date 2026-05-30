# CHANGELOG + SECURITY Documentation — Design

**Date:** 2026-05-30
**Status:** Approved (design)
**Scope:** Add `CHANGELOG.md` and `SECURITY.md` as v1.0.0 release-hygiene docs. Documentation only — no code changes.

## Goal

Give Moomora Console two standard project documents required for a credible 1.0:

1. `CHANGELOG.md` — a reconstructed, human-readable history of every release plus the current unreleased work, in [Keep a Changelog](https://keepachangelog.com) format.
2. `SECURITY.md` — supported-versions policy, how to privately report a vulnerability, and an explicit statement of the project's security model (no built-in auth; trusted-network/single-user by design).

## 1. `CHANGELOG.md`

**Format:** Keep a Changelog 1.1.0 conventions + Semantic Versioning. Reverse-chronological.

**Header:** brief intro stating the project follows Keep a Changelog conventions and Semantic Versioning. (No "breaking change is defined by the contract" claim — the project is pre-1.0 and the data formats are still evolving; `docs/contract.md` is a format *reference*, not a stability contract.)

**Sections (top to bottom):**

- `## [Unreleased]` — the four changes on `main` since `v0.7.7`, grouped:
  - *Added* — database migration system with `schema_migrations` tracking, advisory-locked runner, `npm run migrate`, and backup/restore docs (`docs/backup-restore.md`) (#20). Data-formats reference (`docs/contract.md`) and a regression-test suite under `tests/contract/` covering the export/import formats and MCP surface (#21, #22) — described as the *net* outcome, not the freeze-then-relax churn.
  - *Changed* — refreshed README screenshots for the redesigned desktop UI.
  - *Removed* — dead board-inspector code left over after the task-detail drawer migration (#19).
- One `## [x.y.z] - YYYY-MM-DD` section per released tag, `v0.7.7` down to `v0.1.0`, dates taken from the tag creator dates. Each section has grouped bullets (Added / Changed / Fixed / Removed as applicable), reconstructed by summarizing `git log <prev>..<tag>`. `v0.1.0` is "Initial release" plus a short list of the headline capabilities present at first tag.

**Granularity:** concise — 1–4 bullets per release grouped by change type, not one bullet per commit. The reconstructed entries summarize intent (from PR/commit messages), not raw commit subjects.

**Compare links:** at the bottom, Keep a Changelog style, against the GitHub repo `https://github.com/awaybreaktoday/moomora-console`:
- `[Unreleased]: .../compare/v0.7.7...HEAD`
- `[0.7.7]: .../compare/v0.7.6...v0.7.7` … down to `[0.1.0]: .../releases/tag/v0.1.0`.

**Release process note:** a short line at the top documents that, at release time, the `[Unreleased]` section is renamed to the new version with the date, and a fresh empty `[Unreleased]` is added — so the changelog has a defined update ritual rather than drifting.

## 2. `SECURITY.md`

Three sections:

- **Supported Versions** — a small table; policy: **only the latest release** receives security fixes (pre-1.0, single maintainer). Example row: `| latest | ✅ |`, `| < latest | ❌ |`.
- **Reporting a Vulnerability** — report privately via GitHub's **"Report a vulnerability"** (private security advisories) on the repo's Security tab; do **not** open a public issue for security problems. Note best-effort response from a single maintainer, and that the reporter will be credited in the advisory/changelog unless they prefer otherwise.
- **Security Model & Scope** — the honest trust-boundary statement:
  - Moomora Console ships **no authentication or authorization by design**. It targets single-user / trusted-network / localhost operation. Anyone who can reach the HTTP port has full read/write access to all projects, tasks, and documents.
  - **Network-exposed deployments MUST** enforce authentication and TLS at the ingress / reverse-proxy layer (links to [`docs/deployment.md`](../docs/deployment.md), which already covers ingress auth).
  - No multi-tenant isolation; the database holds a single logical workspace.
  - Existing controls: dependency scanning in CI (`npm audit --audit-level=high` + GitHub dependency-review on PRs). Secrets (DB credentials) come from the environment / CloudNativePG secret, never committed.

## 3. Discoverability

- `README.md`: add a one-line link to `SECURITY.md` (GitHub also auto-surfaces it under the Security tab) and a one-line link to `CHANGELOG.md` near the License section. Minimal, no restructuring.

## Out of scope (YAGNI)

- No `security.txt`, no GPG key, no PGP-encrypted reporting.
- No automated changelog tooling (e.g. release-please, conventional-changelog) and no CI enforcement of changelog updates.
- No backfilling GitHub Releases bodies (the tags already auto-generate release notes via the existing release workflow).
- No version bump or tagging in this change — that's a separate release step.

## Accuracy requirement

The reconstructed changelog entries must be derived from the actual `git log` per tag range, not invented. The implementation plan will embed the full, finalized text of both files (no placeholders), with each release entry traceable to its commit range.
