# Templates and starter guides — implementation evidence

## Implemented

The shared registry now includes Template. Active saved templates offer Use template in
the editor and appear alongside four bundled starters in Library → New doc → Templates &
guides. Copies have an explicit destination, title and document type and start unverified.
The bundled onboarding starter creates a planned task with nine native unchecked items.

Generic repository setup, overview, onboarding and agent-memory guidance is canonical in
`public/starter-content/`. `/api/library/starters` exposes the complete read-only catalogue.
Startup performs no seeding or title-based update: existing user copies are independent.
The earlier organisation/instruction changes are included in the source tree and packaged
skills. Mandatory repository startup no longer depends on this machine's overview UUID.
The container recipe now copies CLI and skills as well as the existing public/server payload.

The chooser keeps its draft and stable operation identity in per-tab session storage.
Creation is single-flight. Document copies use durable receipts in the existing document
operation ledger, with a create-specific intent hash. Retries preserve intervening edits
and return 410 after permanent deletion instead of resurrecting the document. Tasks use
the existing atomic import/receipt contract for task plus checklist. Late catalogue reads
cannot reopen the chooser after navigation. Selector changes retain keyboard focus.

## Tested

- `npm test`: **2,188 passed**, zero failed/skipped.
- `npm run check`: passed; committed skill bundles match their source.
- `playwright test tests/e2e/templates.spec.js tests/e2e/review-repairs.spec.js`: **9 passed**.
  Includes custom master preservation, destination/type, response loss, reload retry,
  duplicate activation, stale catalogue response, keyboard containment and a 360px viewport.
  Axe reports no WCAG 2 A/AA or 2.1 AA violations in the chooser in light and dark themes.
- Production SQLite tests: starters available on an empty database; restart leaves a
  modified, human-verified copy unchanged; no automatic note insertion; task/checklist
  creation is atomic and replay-safe; document receipts preserve edits and permanent deletion.
- Taxonomy contract includes MCP; HTTP acceptance and Markdown export preserve Template.
  Raw Markdown import remains notes-only, matching the existing documented limitation.
- `npm run prepare:sidecar` and `npm run desktop:verify`: passed on Apple Silicon macOS.
- Started the staged server with an isolated empty database. Its four starter bodies and
  packaged instructions/skills match repository files. The staged Node runtime and CLI
  successfully created an unverified Template in that isolated database.
- `git diff --check`: passed. Existing release and organisation edits were preserved.

Browser launch from the vendor tool remained blocked by macOS Mach port permissions.
The successful browser run used Parley's person-approved host command path; final run
ID `1f1d2ba9-3dd0-40c3-9b1b-5eed6c42dd46` returned exit 0 with complete captured output.
Local logs and chooser screenshot: `/tmp/prax-templates-2026-09-20/`.

## Delivery boundary

These are source-tree and staged-payload checks, not a new published release. The version
remains 0.35.1 until release preparation. No GitLab push/tag, new native installer build,
Linux container build, or installed-app replacement was performed for this change.
The release pipeline should run its normal complete packaging/platform gates.
Personal notes, historical release evidence and project identifiers remain user data;
fresh installations receive the generic starters and product behaviour.
