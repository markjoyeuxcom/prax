# Working on Prax

The **Prax** project in the app owns work and knowledge about developing and maintaining
Prax; the **memory** project owns reusable guidance across projects. Both are available to
every agent through recall; filing follows the subject, while provenance records the author.
**Inbox** is the system home for captures whose owner is not yet clear. File known work
directly in its owning project and move unassigned Inbox items there during triage
(Inbox → To process, or Process Inbox for a guided pass).

## Begin and hand over work

Print the project's overview, then retrieve the material for the actual task:

```sh
node cli/prax.js overview
node cli/prax.js context "<task>"
node cli/prax.js recall "Prax <task>"
node cli/prax.js brief <task-id>      # one task: checklist, handoff, linked docs, top memories
```

`overview` prefers a verified document tagged `project-card`, then any `project-card`, then one
titled "Prax project overview", and always says which it found and whether it is verified.
Context packs contain bounded excerpts and label unverified entries; read full documents before
relying on their details. A fresh installation can create an overview from Library → New doc →
Templates & guides; an agent-written overview remains unverified until a person reviews it.

Use one task per concrete outcome. Include acceptance checks and link supporting Library
documents. Task notes carry implementation state, branch/commit, validation performed and
the next action. Check current code and the working tree before resuming. Update the task
before handing over; finish it only when acceptance checks pass. Keep temporary handoffs
with the task and retire them after completion.

### Which `prax` to run

- **In this checkout, `node cli/prax.js`.** It runs the code you are changing. `prax` on PATH
  is the shim the skills installer writes (`~/.local/bin/prax`); it runs the *installed* desktop
  bundle's CLI, so until the next release it lacks unreleased commands and fixes.
- **Elsewhere, `prax`.** Other repositories want the released CLI.
- **Sandboxed agents (Antigravity, Codex and similar).** `node` often resolves through mise
  shims, which read `~/.config/mise/config.toml` outside the workspace. When the sandbox cannot
  read it, `node cli/prax.js` fails or prompts. Either grant the sandbox read access to the mise
  config, or run the checkout CLI on the desktop bundle's own Node, which needs no shim:
  `/Applications/Prax.app/Contents/MacOS/prax-server cli/prax.js <args>`. Paths differ per
  machine, so there is deliberately no committed wrapper. This repository's `mise.toml` pins
  only Rust; Node comes from the global mise configuration.

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
| Frontend state, events and rendering | `public/js/main.js`, `state.js`, `*Controller.js` (features), `keyboardDispatcher.js`, `render*.js` |
| Memory commands and retrieval | `cli/prax.js`, `cli/lib/`, `server/libraryRoutes.js`, `server/contextPack.js` |
| Portable agent skills | `skills/src/`, `skills/prax-*/SKILL.md`, `skills/install.sh` |
| Desktop lifecycle and packaging | `src-tauri/src/`, `scripts/prepare-sidecar.mjs`, `.github/workflows/` |
| Regression evidence | `tests/backend/`, `tests/frontend/`, `tests/cli/`, `tests/contract/`, `tests/e2e/` |

[The docs index](README.md) lists every guide. Use the [README](../README.md) for setup,
[data formats](contract.md) for boundaries, [the desktop guide](desktop/BUILD.md) for packaging,
and [agent memory](agent-memory.md) for retrieval and persistence semantics. The design notes
under [`design/`](README.md#design-notes) explain the rationale of the current subsystems; each
names its date and must be checked against current code. Direction is summarised in the README.

## HTML escaping

The frontend builds HTML strings, and much of what it shows (documents, task text, model
output) is written by agents, so treat every value as untrusted. Escape it with
`public/js/html.js`:

- `escapeHtml(value)` for text and `escapeAttr(value)` for a quoted attribute value (the same
  escaping; `null` and `undefined` become `''`).
- `cssColor(value, fallback)` for a colour inside a `style` attribute. Escaping alone keeps a
  value inside its attribute, not inside its CSS declaration.
- `isSafeHttpUrl(url)` before a value becomes an `href`.

Markdown goes through `renderMarkdownHtml(md, { mode })` in `markdownPreview.js`. Use
`mode: 'document'` only for a person's own document in the editor preview (remote images load;
`editable: true` turns on task toggles). Everything else, including model output, uses
`mode: 'untrusted'`, which is also the default. The older `remoteImages`/`taskToggles` flags
still work and map onto these modes.

`tests/frontend/htmlEscaping.test.js` checks every `${…}` in a template literal that builds
HTML in every `public/js` module, `main.js` included. A template builds HTML when its text
contains a tag or an attribute (` name="`), or when it sits inside another HTML template's
interpolation. The value must be one of:

1. wrapped in an escaper (`escapeHtml`, `escapeAttr`, `cssColor`, or a local alias such as `esc`);
2. a literal, number, boolean, comparison, `.length`, an `UPPER_CASE` constant or a lookup in one;
3. a call to an HTML builder: a `render…` or `…Html` function, an allow-listed builder such as
   `chip` or `icon`, or a helper in the same file whose every return value passes;
4. built only from passing values: ternary branches, `||`, `??`, `&&`, `+`, template literals,
   and `list.map(item => …).join(…)`;
5. a local name whose every binding in the file passes: each initialiser and assignment, each
   pushed list item, and for a helper's parameter, the argument at every call; or
6. marked on its line with `// html-safe: <reason>`, or `/* html-safe: <reason> */` inside the
   interpolation when the line is template text.

The scanner (`tests/frontend/htmlInterpolationScanner.js`) is a small lexer, not a JavaScript
parser. It doesn't follow values through object fields or across modules, so data from a
model object (`model.count`) needs an escaper even when it's a number. When it reports a
value, escape it; use `html-safe` only when the value is HTML that another builder escaped.

## Validate changes

Run `npm test` and `npm run check`. After `skills/src/` or `cli/lib/` changes, run
`npm run skills:build` and include the rebuilt bundles. Exercise affected browser journeys
with `npm run test:e2e`; use the desktop and release checks when those surfaces change.
Follow the [product quality standard](design/quality-standard.md): Gate A applies to every
change; Gate B applies to activated surfaces ([quality.md](quality.md) records the evidence
state). Record actual test results in the task, including any untested acceptance criteria.
