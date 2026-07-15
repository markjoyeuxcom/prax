# Project-owned Library and Markdown Import Dialog Plan

**Design:** `docs/superpowers/specs/2026-07-13-project-owned-library-import-dialog-design.md`

1. Add pure modal rendering and durable import-dialog state.
2. Replace the navigation-derived file-picker shortcut with open/select/submit/close dialog actions.
3. Add caller-ID exact-once document creation for safe per-file retry.
4. Add project ownership chips to browse, semantic, archive, and editor surfaces.
5. Add the Library Project facet and Document info project reassignment.
6. Cover renderer, route, SQLite, and production-browser journeys.
7. Run the complete quality gates and update the exceptional-quality evidence.

## Completion evidence

- `npm test`: 158/158 unit, route, repository, SQLite, frontend, MCP, CLI, and contract files passed.
- `npm run check`: passed.
- `npm run test:e2e`: 46/46 production-server browser journeys passed.
- The Markdown journey selects Work entirely inside Library; retains file previews; loses one
  post-commit response; retries the same UUID; proves one row per file; filters by Work; shows the
  owner in the editor; and reassigns it to Personal through Document info.
- Dialog evidence also proves initial focus, keyboard containment, Escape dismissal, and focus return.
- `npm run verify:portable`: 200 tasks and 150 checklist items round-tripped with the pinned digest.
- `npm run verify:restore`: live-WAL `large` and historical `0009` destructive restores passed at
  `0014_add_task_import_operations.sql`, including integrity, semantic, migration, and production-boot checks.
