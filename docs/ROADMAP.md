# Moomora Console — Roadmap

A living backlog of planned and deferred work. This is **direction, not a commitment** — a
catalogue of candidate next steps kept honest. Substantial items go through the repo's
spec → plan → review workflow under [`docs/superpowers/`](superpowers/) before implementation.

**Current release:** `v0.17.1`.

## Recently shipped

- **v0.15.0 — Shared AI memory, slice 1.** Trust model (`verified` / `status` on documents +
  migration `0007`), `verify` / `supersede` / `context-pack` routes, conservative active-only
  retrieval with unverified memory quarantined, the thin `moomora` CLI, and read-only trust
  display in the Library UI. See
  [`specs/2026-06-04-shared-ai-memory-slice1-design.md`](superpowers/specs/2026-06-04-shared-ai-memory-slice1-design.md).
- **v0.15.1 — Kubernetes deploy + cross-tool memory.** Kustomize `deploy/base` + overlays for
  a GitOps Argo CD workloads ApplicationSet, per-env CloudNativePG `Cluster` with `pgvector`
  mounted as an ImageVolume extension, Gateway API `HTTPRoute`, and `AGENTS.md` (a tool-agnostic
  agent-memory convention so Codex/Cursor/aider share the same memory as Claude Code). See
  [`specs/2026-06-04-k8s-deploy-workload-design.md`](superpowers/specs/2026-06-04-k8s-deploy-workload-design.md).
- **v0.16.0 — Shared AI memory, slice 2 (trust actions).** Verify / supersede from the Library
  UI (detail-panel `[v] verify` / `[s] supersede…` buttons reusing the link-picker to choose a
  replacement) and a `supersede_document` MCP tool, both thin clients over the slice-1 routes.
  Verification stays a human-only action (no MCP verify tool) by design. See
  [`specs/2026-06-06-memory-slice2-trust-actions-design.md`](superpowers/specs/2026-06-06-memory-slice2-trust-actions-design.md).
- **v0.17.0 — Memory skills converged onto the CLI.** `moomora-recall` / `moomora-remember` are
  now thin wrappers over shared `cli/lib/recall.js` + `cli/lib/remember.js` — one implementation
  behind both the skills and the `moomora` CLI. Adds cross-project `moomora recall` (distilled,
  `--recent`) and `moomora remember --memory`; skills stay zero-install. See
  [`specs/2026-06-07-memory-skills-cli-convergence-design.md`](superpowers/specs/2026-06-07-memory-skills-cli-convergence-design.md).

---

The shared-memory direction (slice 1 → slice 2 → skills/CLI convergence) is now complete. Candidate
next steps, by value:

## High-value, low-cost

- [ ] **Retrieval eval harness.** A fixed set of `query → expected-doc` pairs run in CI to catch
  recall regressions (e.g. the title-vs-body miss fixed in v0.14.1). For a product whose whole
  value is retrieval, this earns its keep. *(small–medium)*

## Minor follow-ups (from code review)

- [ ] **Context-pack `limit` is per-section, not a global cap** — make it a single doc/token
  budget so a pack can't exceed the requested limit.
- [ ] **`GET /api/library/documents` is not active-only server-side** — only the CLI filters to
  active; document the behaviour or add a server default so MCP/raw callers aren't surprised.
- [ ] **`buildRevertSupersededIfOrphan` doesn't exclude archived link sources** — tiny latent
  edge case in the supersede-revert query.

## Bigger product bets (shared-memory direction)

- [ ] **External references.** Link a memory to a GitHub/GitLab/URL without copying the content
  (`memory_external_refs`). *(medium–large)*
- [ ] **Repo-URL project detection.** `moomora` auto-detects the project from the git remote URL
  (projects gain a repo-URL field). *(medium)*
- [ ] **RAG / "Ask Project".** An optional retrieval + generation layer, kept separate from the
  retrieval-only default. *(large)*
- [ ] **Memory type taxonomy.** Richer `decision` / `runbook` / `known-issue` / … types
  (currently expressed via `document_type` + tags). *(small–medium)*

## Platform-adjacent (lower priority)

- [ ] **CI image on merge.** Publish a `main`/SHA-tagged image so a dev environment can track a
  live build (today images are built on version tags; per-env image versions are pinned in Argo).
  *(medium)*
- [ ] **App-level auth.** None by design (trusted-network model); currently fronted by the
  gateway + Keycloak. Revisit only if a multi-tenant / `MOOMORA_TOKEN` model is wanted. *(large)*

---

*This roadmap is intentionally a backlog, not a schedule. Items move to a dated spec/plan under
`docs/superpowers/` when picked up.*
