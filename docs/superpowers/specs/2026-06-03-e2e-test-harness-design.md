# End-to-end browser test harness design

**Status:** Approved
**Date:** 2026-06-03
**Target release:** v0.12.2 (patch — tooling + tests, no app behavior change)

## Goal

Add a Playwright-based browser test harness that catches the class of UI bug
that string-HTML unit tests cannot: layout/visibility problems and
"right-state-wrong-DOM" re-render bugs. The two v0.12.0 regressions fixed in
v0.12.1 (a CSS-grid clip + a `querySelector` that returned `null`, leaving the
DOM stale after a fetch) were both invisible to the existing `node --test`
string-HTML suite. A real headless browser asserting rendered visibility would
have caught both.

The first test set locks the v0.12 document-graph UI surface, with the
Links-section visibility regression as the centerpiece.

## Decisions locked in

- **Playwright (real headless Chromium).** Catches both bug classes — CSS
  layout/visibility AND stale-DOM. jsdom was rejected because it has no layout
  engine and would miss exactly the CSS half of what shipped.
- **Chromium only.** No Firefox/WebKit. Single engine keeps the install lean.
- **Demo-server target.** Tests drive the in-memory demo server (`npm run
  demo`), not a Postgres-backed instance. Self-contained; CI needs no database
  service.
- **Separate command.** New `npm run test:e2e`. The existing `npm test`
  remains the fast `node --test` unit suite (sub-second). The two never mix.
- **Serial execution (`workers: 1`).** The demo server holds shared in-memory
  state; parallel specs would race. Serial keeps fixtures deterministic.
- **Tests own their fixtures (Option A).** Each spec seeds the graph state it
  needs via the demo HTTP API. Demo seed data stays a clean slate and
  non-load-bearing.
- **`@playwright/test` is the project's first devDependency.** A deliberate
  departure from the so-far zero-devDep stance, justified by the bug class it
  guards.

## Non-goals

- **No broad smoke across all views.** Just the v0.12 graph surface (Links,
  chips, maintenance). Tasks/board/admin-import etc. are out of scope.
- **No visual snapshot / screenshot diffing.** Flaky and heavy to maintain;
  behavioral assertions only.
- **No multi-browser.** Chromium only.
- **No Postgres-backed e2e.** Demo server only.
- **No parallel workers.** Serial for deterministic shared state.
- **No change to the existing `node --test` suite or `scripts/run-tests.js`.**

## Architecture

### Dependency

`@playwright/test` added to `devDependencies` in `package.json`. First
devDependency in the project.

### Config — `playwright.config.js` (repo root)

```js
import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.MOOMORA_E2E_PORT || '3199';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.js',
  workers: 1,
  fullyParallel: false,
  reporter: process.env.CI ? [['html'], ['list']] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `node scripts/demo-server.js`,
    env: { HOST: '127.0.0.1', PORT },
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
```

- `webServer` auto-starts the demo server and waits for `/healthz` before
  tests run; tears it down after. CI needs no separate start step.
- `reuseExistingServer` locally lets a dev point at an already-running demo;
  CI always starts fresh.
- The demo server already honors `HOST` / `PORT` env vars (used by
  `scripts/demo-server.js`'s `loadConfig`).

### Test directory — `tests/e2e/`

- Specs named `*.spec.js`. Node's default test globber and
  `scripts/run-tests.js` only collect `*.test.js`, so `npm test` never picks
  these up.
- A `tests/e2e/helpers/seed.js` module exposes functions that hit the demo
  HTTP API to establish graph state.

### Command

`package.json` scripts gain:

```json
"test:e2e": "playwright test"
```

`npm test` is unchanged.

## Fixtures — Option A (tests seed via the API)

`tests/e2e/helpers/seed.js` codifies the manual smoke we've run all session
into reusable async functions. It uses the demo's HTTP API:

- `createDocument({ title, body, documentType, project, kind, tags })` →
  `POST /api/library/documents`.
- `linkDocuments(sourceId, targetId, relation)` →
  `POST /api/library/documents/:id/links`.
- `updateDocument(id, patch)` → `PATCH /api/library/documents/:id` (used to
  edit a source body and thereby make a derived doc stale).
- `resolveProjectId(slug)` → `GET /api/projects`, find by slug.

Each spec seeds with **unique titles** (a per-spec prefix plus a counter) so
that serial specs sharing the one demo-server instance don't collide on titles
or selectors. The helper returns created ids so specs can target exact rows.

The demo server resets its in-memory state only on restart; since `workers:
1` and one `webServer` instance back the whole run, specs must not assume an
empty library — they assert against the rows they themselves created, located
by unique title.

## Test specs

### `tests/e2e/links-section.spec.js` (regression centerpiece)

- Seed: a source doc + a synthesized doc with a `derived-from` link to it.
- Open the synthesized doc in the library.
- **Assert the Links section is visible on first load:**
  `await expect(page.locator('.document-links')).toBeVisible()`. This is the
  exact v0.12.0 regression. `toBeVisible()` checks real geometry (non-zero
  size, `display`/`visibility`/`opacity`), so it catches BOTH the CSS-clip and
  the stale-DOM failure modes.
- Assert it contains "Derived from" and the source title.
- Cycle through each detail mode — preview, edit, split, info, focus — and
  assert the Links section stays visible in each.
- Open the source doc; assert "Backlinks" lists the synthesized doc.
- Open an orphan doc; assert the Links section renders "No links." with no
  layout break.

### `tests/e2e/list-chips.spec.js`

- Seed: a synthesized doc + an edit on its source that makes it stale.
- Assert the list row for the synthesized doc shows a visible `SYNTH` chip and
  a `STALE` pill.
- Assert a plain source row shows neither chip.

### `tests/e2e/maintenance.spec.js`

- Seed: a stale `derived-from` link + an orphan doc.
- Open Admin → Library Maintenance.
- Assert the stale doc appears under "Stale documents" and the orphan under
  "Orphan documents".
- Click `[open]` on the stale row; assert the library workspace opens to the
  **correct** document (guards the cross-project / filtered-target navigation
  fix).
- Exercise the project filter `<select>` and the refresh button; assert the
  lists update.

All assertions use Playwright auto-waiting locators (`expect().toBeVisible()`,
`toHaveText()`, `toContainText()`). No manual sleeps.

## CI integration

New `e2e` job in `.github/workflows/ci.yml`, parallel to `test` / `security`
/ `dependency-review`:

```yaml
e2e:
  name: Browser tests
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v6
    - uses: actions/setup-node@v6
      with:
        node-version: 24
        cache: npm
    - run: npm ci
    - run: npx playwright install --with-deps chromium
    - run: npm run test:e2e
    - uses: actions/upload-artifact@v4
      if: failure()
      with:
        name: playwright-report
        path: playwright-report/
        retention-days: 7
```

- `playwright install --with-deps chromium` pulls only Chromium + its system
  libraries.
- The `webServer` config auto-starts the demo server inside the job.
- On failure, the HTML report (with traces) uploads as an artifact.
- This job gates PRs alongside the existing checks.

## `.gitignore`

Add Playwright artifact directories:

```
test-results/
playwright-report/
/blob-report/
/playwright/.cache/
```

## Validating the harness is not tautological

Before declaring the work done, temporarily revert the v0.12.1 fix locally:

1. Restore `.library-detail`'s `grid-template-rows` to the 2-row form
   (`auto minmax(0, 1fr)`).
2. Restore `loadDocumentLinks`'s re-render to the broken
   `app.querySelector('[data-workspace]')` lookup.

Run `npm run test:e2e` and confirm `links-section.spec.js` goes **red** —
proving the harness catches the exact shipped bug. Then restore the fix and
confirm **green**. Mutation-test the harness this way before merging.

## Testing strategy

- The harness IS the test. Its own correctness is verified by the
  mutation-test step above (revert fix → red → restore → green).
- `npm test` (the unit suite) must remain green and unchanged — confirm no
  `*.spec.js` leaks into the `node --test` run.
- `npm run check` must remain green (`playwright.config.js` is ESM and parses
  cleanly; it is NOT added to the `check` script since it requires the
  `@playwright/test` import to resolve, which is fine at test time but not a
  syntax-only `node --check`).

## Release

Patch — **v0.12.2**. Single PR. Tooling + tests only; no application behavior
change. Lands the harness cleanly on its own so the test infrastructure is
bisectable.

## Open questions

None.
