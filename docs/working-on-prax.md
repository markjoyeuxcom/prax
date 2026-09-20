# Working on Prax

The **Prax** project in the app owns work and knowledge about developing and maintaining
Prax. The **memory** project owns reusable guidance across projects. Both are available to
every agent through recall; filing follows the subject, while provenance records the author.

## Begin and hand over work

Find the project’s **Prax project overview** in its Library,
then retrieve the material for the actual task:

```sh
prax search "Prax project overview" --project prax
prax get <matching-document-id>
prax context "<task>" --project prax
prax recall "Prax <task>"
```

Document IDs belong to each library. Fresh installations can use this guide and create
an overview from Library → New doc → Templates & guides; existing libraries should refine
their established overview. Context packs contain bounded excerpts and label unverified entries;
read full documents before relying on their details. A `project-card` tag gives a verified
overview its own section; an agent-written overview remains unverified until human review.

Use one task per concrete outcome. Include acceptance checks and link supporting Library
documents. Task notes carry implementation state, branch/commit, validation performed and
the next action. Check current code and the working tree before resuming. Update the task
before handing over; finish it only when acceptance checks pass. Keep temporary handoffs
with the task and retire them after completion.

## File useful knowledge

| Information | Destination | Shape |
| --- | --- | --- |
| Prax architecture or subsystem orientation | Prax Library | Reference with source paths |
| Why a product or engineering approach was chosen | Prax Library | Decision |
| Repeatable release, recovery or operational procedure | Prax Library | Runbook |
| Confirmed unresolved defect | Prax task and supporting Library note when useful | Acceptance checks; known-issue |
| Completed review or release evidence worth retaining | Prax Library | Dated reference or post-mortem |
| Current implementation progress | The relevant Prax task | Notes, checklist, linked handoff |
| Preferences and agent-memory procedures used across repositories | Memory Library | Decision, reference or runbook |

Use a few topic tags: `architecture`, `ui`, `release`, `ci`, `ai`, `desktop`, `agent-memory`,
`quality`. Types describe the document; tags describe its subject. Avoid adding `memory`
merely because an agent wrote a project document. Refine the same title/ID and supersede old
guidance. Reference code or repository documentation instead of copying long implementation
details into multiple notes.

```sh
# Durable Prax finding
prax remember "<title>" --body "<finding and reason>" --project prax --type decision --tag architecture --cite path/to/file
# Convention useful across projects
prax remember "<title>" --body "<reusable guidance>" --memory --type reference --tag agent-memory
```

## Code entry points

Prax is a Node/Fastify application with embedded SQLite, a plain JavaScript frontend and a
Tauri desktop host. The desktop runs the same application payload on its bundled Node runtime.

| Area | Start here |
| --- | --- |
| Server startup and routes | `server/index.js`, `server/*Routes.js` |
| Persistence and migrations | `server/*Repository.js`, `server/migrations/` |
| Frontend state, events and rendering | `public/js/main.js`, `state.js`, `render*.js` |
| Memory commands and retrieval | `cli/prax.js`, `cli/lib/`, `server/libraryRoutes.js`, `server/contextPack.js` |
| Portable agent skills | `skills/src/`, `skills/prax-*/SKILL.md`, `skills/install.sh` |
| Desktop lifecycle and packaging | `src-tauri/src/`, `scripts/prepare-sidecar.mjs`, `.gitlab-ci.yml` |
| Regression evidence | `tests/backend/`, `tests/frontend/`, `tests/cli/`, `tests/contract/`, `tests/e2e/` |

Use [README](../README.md) for setup, [API/data contracts](contract.md) for boundaries,
[desktop build and recovery](desktop/BUILD.md) for packaging, and
[agent memory](agent-memory.md) for retrieval and persistence semantics. Design rationale
and implementation plans live under `docs/superpowers/`; dated plans describe their own
milestone and must be checked against current code. The [roadmap](ROADMAP.md) records direction.

## Validate changes

Run `npm test` and `npm run check`. After `skills/src/` or `cli/lib/` changes, run
`npm run skills:build` and include the rebuilt bundles. Exercise affected browser journeys
with `npm run test:e2e`; use the desktop and release checks when those surfaces change.
Follow the [product quality standard](superpowers/specs/2026-07-13-exceptional-prax-quality-standard.md):
Gate A applies to every change; Gate B applies to activated surfaces. Record actual test
results in the task, including any untested acceptance criteria.
