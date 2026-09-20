# Templates and portable starter guidance

User-approved scope: add Template to the shared document taxonomy, let a person use a
saved template in a selected project, and ship the recent repository onboarding and
memory organisation guidance with fresh installations and upgrades.

## Behaviour

- Library → New doc → Templates & guides opens a preview with destination and title.
- Built-ins: repository setup runbook, project overview, repository onboarding task,
  and shared agent memory guide. The task creates native unchecked checklist items.
- A saved active Template has Use template. The copy receives a chosen document type;
  the original's content, trust, history and project are untouched. Copies start unverified.
- Built-ins are version-controlled product content, available without AI or embeddings.
  They are not seeded into user databases. Using one creates an independent copy.
- Generic guidance ships; personal project UUIDs, machine paths, release evidence and
  private notes do not become starter content. Repository instructions also need a
  portable fallback when a developer has no existing Prax library.

## Reliability

Preview before mutation; preserve the draft and stable request identity across failure
and reload. Disable repeat submission while pending. Use the existing idempotent document
create (with a durable creation receipt) and atomic task import contracts, including all task checklist items. Reconcile
lost document responses by ID. Receipts must not resurrect a permanently deleted result. Collection refresh failure cannot report a committed
creation as failed. Do not inherit verification or revive retired templates.

## Evidence

Fresh SQLite and restart/upgrade with modified user copies; API/CLI/MCP taxonomy;
Markdown export type preservation (raw import remains notes-only); browser document and task creation, custom template preservation,
destination choice, keyboard focus, narrow viewport, duplicate activation and lost-response
retry after reload. Run npm test, npm run check and affected browser journeys.
