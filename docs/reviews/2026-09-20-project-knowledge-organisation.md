# Prax project knowledge organisation — 2026-09-20

The user approved filing by subject: project work and technical knowledge live in Prax;
reusable conventions and agent-memory usage live in memory. Both projects remain available
to shared recall. Temporary implementation state belongs to its task.

## Applied in Prax

Moved six active Prax-specific guides from memory into Prax, and moved the general agent-memory
usage/installation guide into memory. Standardised topic tags. Metadata moves preserved
IDs, content revisions, creation history, trust, code/external references and document links.
The installation guide was then refined separately to describe the agreed filing convention
and the updated installer. Two guides' citations were refreshed for changed documentation.
All 13 originals archived during the preceding cleanup remain unchanged.

Added **Prax project overview**, with repository/contract/quality/release references and wiki
links to the guides. Its project-card tag supports overview placement after human review;
it remains unverified and is directly addressable by ID for startup before that review.

The Prax Library now contains:

- Prax Today and task-list triage conventions — 34b43706-8137-4e74-8956-2025bd830537
- Prax Library, recall trust and review workflow — 96f6b390-c099-487b-96e8-1b556b735d08
- Prax UI design and navigation conventions — 290af37c-fa5a-463d-8cc1-aebc119e9d55
- Prax desktop: Tauri's drag-and-drop handler stays off on the main window — 818a161c-5396-43fd-addf-9c69115f6378
- Prax v0.35.1 release evidence and quality gates — dd9f1eb4-5a06-4441-8400-99e1f23da1b1
- Prax AI configuration and compatibility checks — 6b0670fb-f9ba-4c14-8be3-0a7935b9a8fb
- Prax CI runner behavior and follow-up work — fd79010b-2a45-40b7-bfe0-fb0a64d88b90
- Prax release process — fd74e50e-ee74-40d5-adb6-518449ab2d59
- Prax project overview — b000054a-501e-4252-92bf-1fb8c02ad434

Cross-project guide in memory: 2bdc5720-aa68-4fe2-9cc9-a86acc716a28.
Organisation task: 9f415f4e-3fc8-4f3c-bd2d-ff3a7b9f53bb; its notes record this work and its checklist records acceptance.

## Repository and installed instructions

AGENTS.md and its CLAUDE.md symlink now route startup through docs/working-on-prax.md, the
project overview, task-scoped context and cross-project recall. The working guide explains
filing, task handoffs, code entry points and validation. Updated both skill instructions,
CLI/memory documentation and README examples.

The installer now refreshes only its managed instruction block, preserves surrounding bytes,
file modes and symlinks, refuses malformed/ambiguous markers, and supports Antigravity's
global GEMINI.md path. Re-running can switch command form without uninstalling first.

Installed and read back the updated Prax skills and standing rules for Claude Code, Codex,
Copilot and Antigravity. Global files' unrelated content was preserved. Installed skill files
match the repository; the application-backed CLI shim was not rewritten. Direct installation
was blocked by this pane's filesystem permissions; approved Parley run
86e3e693-53f5-4f83-ac62-e3cd35144b68 completed with exit 0, followed by independent
file verification. The installed scripts were refreshed from the existing current bundles.

New sessions load current instruction files; no existing agent pane was restarted or tested
for model compliance. Copilot's instruction directory still needs to be enabled in its launch
environment; this Codex shell does not export COPILOT_CUSTOM_INSTRUCTIONS_DIRS. The installer
prints the configuration requirement. The user's primary Claude/Codex/Antigravity rule files
are in their documented global locations.

## Validation

- npm test: 2,179 passed, zero failed or skipped, including 11 installer tests.
- npm run check passed; generated skill bundles are current. No skill engine source changed.
- Both SKILL.md files passed Skill Creator validation; shell syntax check passed.
- All 39 active code citations match current files.
- Project context contains the nine expected Prax documents and excludes the global guide.
- Overview, release and memory-usage recalls each return the intended guide first.
- Retrieval reported 24/24 eligible documents indexed with none pending.
- No permanent deletion or human verification was performed.

Data/file snapshots, mutation journal and raw checks are in
/tmp/prax-project-organisation-2026-09-20 (temporary local audit files).

## Delivery state

App organisation and local agent installation are applied. Repository changes are local and
ready for review/publication; no release was requested for this task. The checkout is on main
with local HEAD 6f609ddba0ad7b171dd2ec34a3b90462748c1dcd; prior work already matches published
v0.35.1 content at 2237950a01c461582362376710636ebef0736e97. Review this task against its
pre-task file snapshot instead of treating all existing Git status changes as new work.
