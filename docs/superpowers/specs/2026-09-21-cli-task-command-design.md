# CLI task command

User-approved scope: give the `prax` CLI a task surface so an agent or script can create,
list, read, update, complete and tick tasks from any shell, following the same instance
binding, project resolution and provenance rules as `remember`. Tracked in the Prax task
"CLI: add a prax task command for creating and updating tasks".

## Behaviour

- `prax task add "<title>"` creates one task in the resolved project with optional
  `--priority`, `--status`, `--due`, `--planned`, `--label a,b`, `--description`, `--notes`
  and repeatable `--check "<item>"` acceptance items.
- `prax task list [--status s] [--all-projects] [--query text] [--json]` lists open tasks in the
  resolved project (or every project), one line each with status, priority, due date and id.
- `prax task show <id> [--json]` prints the task and its checklist with 1-based numbers;
  `--json` carries the raw task plus a `checklist` array.
- `prax task update <id>` patches `--title`, `--status`, `--priority`, `--due`, `--planned`,
  `--label`, `--description`, `--notes`, or appends a paragraph with `--append-notes`.
- `prax task done <id>` sets status `completed`.
- `prax task check <id> <n|label>` / `prax task uncheck <id> <n|label>` set one checklist item by
  1-based index or exact (case-insensitive) label.

## Reliability

- **add** goes through `POST /api/tasks/import` in `append` mode with a caller-generated
  `requestId`, so the task and its checklist commit in one transaction and a lost response
  can be retried without a duplicate: the server replays the recorded result. `append`, not
  `skip`: an explicit add must never be silently dropped because an older task shares the title.
- **update** is one `PATCH /api/tasks/:id` with no automatic retry. The route has no operation
  receipt, so an uncertain transport outcome is reported as unknown and the caller is told to
  inspect the task before retrying. `--append-notes` reads the current notes first and sends the
  concatenation; the window between read and write is disclosed in the docs.
- **done**, **check** and **uncheck** set a value rather than apply a delta, so a retry that
  proves no request reached the server (`connect-only`) is safe.
- Every write carries `x-prax-origin: agent` and the detected agent id, so the task chronicle
  attributes the change to the agent, as memory writes do.
- Writes bind to one instance via `/readyz` before sending, as `remember` does.

## Evidence

Unit tests over a fake client in `tests/cli/tasks.test.js` (payload shaping, request id
stability, checklist resolution, append-notes, unknown-outcome error wording) and header
checks in `tests/cli/apiClient.test.js`. Live check against the desktop instance. `npm test`,
`npm run check`, `npm run skills:build`.
