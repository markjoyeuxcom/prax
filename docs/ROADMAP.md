# Prax — Roadmap

A living backlog of planned and deferred work. This is **direction, not a commitment** — a
catalogue of candidate next steps kept honest. Substantial items go through the repo's
spec → plan → review workflow under [`docs/superpowers/`](superpowers/) before implementation.

**Current release:** `v0.39.2`.

## Recently shipped

- **v0.15.0 — Shared AI memory, slice 1.** Trust model (`verified` / `status` on documents +
  migration `0007`), `verify` / `supersede` / `context-pack` routes, conservative active-only
  retrieval with unverified memory quarantined, the thin `prax` CLI, and read-only trust
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
- **v0.17.0 — Memory skills converged onto the CLI.** `prax-recall` / `prax-remember` are
  now thin wrappers over shared `cli/lib/recall.js` + `cli/lib/remember.js` — one implementation
  behind both the skills and the `prax` CLI. Adds cross-project `prax recall` (distilled,
  `--recent`) and `prax remember --memory`; skills stay zero-install. See
  [`specs/2026-06-07-memory-skills-cli-convergence-design.md`](superpowers/specs/2026-06-07-memory-skills-cli-convergence-design.md).

---

## AI feature tiers

The generative-AI direction, shortlisted by value into three tiers on a shared **chat-completion
provider layer** + **trust guardrails** (citations-only, provenance shown, AI output lands
`agent-written` and needs human verify). All Tier-1 and most of Tier-2 shipped in the current
`[Unreleased]` cycle; see the CHANGELOG for details.

**Enabler (cross-cutting) — ✅ shipped:** local-first chat provider (OpenAI / Claude / Gemini /
Ollama / llama.cpp) + trust guardrails.

**Tier 1 — flagship — ✅ 3/3**
- [x] **Ask Prax** — grounded, trust-aware Q&A over the library (cited, verified-first).
- [x] **Auto post-mortem** from a runbook-run chronicle.
- [x] **Runbook generation** from an alert/incident description.

**Tier 2 — high value — ✅ 3/3**
- [x] **In-app agentic assistant** over the 34-tool MCP tree (reads free, writes confirmed).
- [x] **Knowledge-base health.** Deterministic buckets (needs-review / stale / empty) +
  the AI half: **auto wiki-linking** (deterministic title-mention suggestions) and **AI
  contradiction/gap detection** (a bounded, advisory "Scan with AI" pass with a verbatim-quote
  grounding gate). See
  [`specs/2026-07-09-kb-health-ai-design.md`](superpowers/specs/2026-07-09-kb-health-ai-design.md).
- [x] **Daily brief / on-call handoff** generator.

**Tier 3 — solid, less differentiated — ✅ 2/2 (completes the AI tier roadmap)**
- [x] **Editor writing actions** — draft / summarize / rewrite / notes→checklist. A **✦ AI**
  toolbar dropdown; results open in a preview overlay and only touch the doc on **Apply** (a
  normal user edit, so `verified` is preserved). Rewrite/checklist act on the selection when
  there is one (captured at menu-open, spliced back by exact offset so `$`-sequences and
  duplicate lines can't corrupt the apply). `POST /api/library/writing-action` +
  `server/writingActions.js`.
- [x] **Natural-language capture & NL→filter** — "p1 in homelab due this week." Capture:
  ⌘↵ smart add → removable-chips preview → ↵ confirms (plain ↵ stays deterministic; sigils
  override the model). Filter: ✦ Translate emits a **grammar string** into the existing
  input — transparent, editable, saveable — with provenance + restore and a semantic lint
  for silently-dead atoms. Two never-500 parse routes + pure `server/nlParse.js`; output
  coerced against whitelists and validated by the shared `parseTaskFilter`. See
  [`specs/2026-07-10-nl-capture-filter-design.md`](superpowers/specs/2026-07-10-nl-capture-filter-design.md).

---

The shared-memory direction (slice 1 → slice 2 → skills/CLI convergence) is now complete. Candidate
next steps, by value:

## High-value, low-cost

- [x] **Retrieval eval harness.** A fixed set of `query → expected-doc` pairs run through the real
  FTS keyword + context-pack pipeline (the Ask Prax fallback path) to catch recall regressions
  (e.g. the title-vs-body miss fixed in v0.14.1). Shipped: fixtures + cases in `tests/eval/`, a
  CI recall gate (`tests/backend/retrievalEval.test.js`), and a `npm run eval` report. Deterministic
  (no live embeddings); a semantic mode over a configured embedder is a future extension.

## Bigger product bets (shared-memory direction)

- [x] **External references.** Link a memory to a GitHub/GitLab/URL without copying the content.
  Shipped: `document_external_refs` (migration 0011; unique per document+URL, cascade on delete);
  `GET/POST/DELETE /api/library/documents/:id/external-refs` (idempotent upsert POST); MCP
  `list/add/remove_external_ref`; `prax remember --ref <url>`; an **External references** section
  in the editor sidebar with derived GitHub/GitLab/Link kind chips (only safe-scheme URLs become
  clickable), edited as `url | label` lines in Document info.
- [x] **Repo-URL project detection.** `prax` auto-detects the project from the git remote URL
  (projects gain a repo-URL field). Shipped: `repo_url` (migration 0009) + a **Repo** field in
  the project header; one shared normalizer (`server/repoUrl.js`) matches any spelling of the
  same remote; detection precedence `--project` > `PRAX_PROJECT` > `.prax/project.json` >
  git remote match > folder name; `prax init` registers the URL automatically.
- [ ] **RAG / "Ask Project".** An optional retrieval + generation layer, kept separate from the
  retrieval-only default. *(large)*
- [x] **Memory type taxonomy.** First-class `decision` / `known-issue` / `reference` /
  `post-mortem` types alongside `note`/`runbook`, defined once in a shared registry
  (`public/js/documentTypes.js`) that drives server validation, MCP schemas, the CLI, and the
  Library UI. The `document_type` CHECK was dropped in a table-rebuild migration (`0010`, with
  new `-- migrate:fk=off` runner support), so future types are registry-only edits. Auto
  post-mortems now carry the real type.

## Platform-adjacent (lower priority)

- [x] **Calendar view + ICS feed.** A Monday-start month grid of open dated tasks (sidebar
  **Calendar** entry; day detail strip reuses the standard task rows) plus `GET /api/calendar.ics`
  — an RFC 5545 feed (all-day + floating-time events, stable UIDs, no RRULE by design,
  `?project=` scoping) that Apple Calendar / Thunderbird can subscribe to. The desktop shell
  still hides the subscribe URL. The original reason (a per-launch port) no longer holds — the
  desktop persists its loopback port across launches — so showing it is now a pending product
  decision about whether local desktop subscriptions are supported.
- [ ] **CI image on merge.** Publish a `main`/SHA-tagged image so a dev environment can track a
  live build (today images are built on version tags; per-env image versions are pinned in Argo).
  *(medium)*
- [ ] **App-level auth.** None by design (trusted-network model); currently fronted by the
  gateway + Keycloak. Revisit only if a multi-tenant / `PRAX_TOKEN` model is wanted. *(large)*

---

*This roadmap is intentionally a backlog, not a schedule. Items move to a dated spec/plan under
`docs/superpowers/` when picked up.*
