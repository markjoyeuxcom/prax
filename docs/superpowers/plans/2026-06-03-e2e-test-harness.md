# End-to-end browser test harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Playwright browser-test harness driving the in-memory demo server, with a first test set that locks the v0.12 document-graph UI surface — catching the layout/visibility and stale-DOM bug classes that string-HTML unit tests miss.

**Architecture:** `@playwright/test` (first devDependency, Chromium only). `playwright.config.js` auto-starts the demo server via its `webServer` block on a test port. Specs live in `tests/e2e/*.spec.js` (invisible to `node --test`'s `*.test.js` globber). Tests seed their own graph fixtures via the demo HTTP API using `page.request`. Serial execution (`workers: 1`) keeps shared in-memory demo state deterministic. New `npm run test:e2e` command; `npm test` stays the fast unit suite.

**Tech Stack:** Playwright (`@playwright/test`), Node 24, the existing Fastify demo server.

**Spec:** [`docs/superpowers/specs/2026-06-03-e2e-test-harness-design.md`](../specs/2026-06-03-e2e-test-harness-design.md)

**Target release:** v0.12.2 (patch).

---

## Key selectors (confirmed from the codebase)

| Purpose | Selector |
|---|---|
| Navigate to library view | `[data-view="library"]` |
| Library list row | `.document-row` (carries `data-library-document-id`) |
| Detail Links section | `.document-links` |
| SYNTH chip | `.chip-synth` |
| STALE pill | `.chip-stale` |
| Edit mode button | `[data-library-mode="edit"]` |
| Preview mode button | `[data-library-mode="preview"]` |
| Split mode button | `[data-library-mode="split"]` |
| Info-edit button | `[data-action="edit-document-info"]` |
| Focus button | `[data-action="toggle-document-focus"]` |
| Open admin | `[data-action="open-admin"]` |
| Maintenance project filter | `[data-maintenance-project-filter]` |
| Refresh maintenance | `[data-action="refresh-maintenance"]` |
| Maintenance [open] button | `[data-action="open-library-doc"][data-library-document-id="<id>"]` |

App defaults: `activeView: 'list'`, `activeProject: 'all'`. A fresh Playwright
browser context has no localStorage, so the project filter is `all` and seeded
docs across any project appear in the library list.

---

## File map

**Create:**
- `playwright.config.js` — Playwright config (webServer, chromium project, serial).
- `tests/e2e/helpers/seed.js` — API-seeding helpers using a Playwright request context.
- `tests/e2e/smoke.spec.js` — trivial "app shell loads, no console errors" canary.
- `tests/e2e/links-section.spec.js` — the Links-visibility regression specs.
- `tests/e2e/list-chips.spec.js` — SYNTH / STALE chip specs.
- `tests/e2e/maintenance.spec.js` — Admin maintenance specs.

**Modify:**
- `package.json` — add `@playwright/test` devDependency + `test:e2e` script.
- `.gitignore` — Playwright artifact directories.
- `.github/workflows/ci.yml` — new `e2e` job.

**Unchanged:** `scripts/run-tests.js`, `npm test`, all existing `*.test.js`.

---

## Task 1 — Scaffold the harness + smoke canary

**Files:**
- Modify: `package.json`
- Create: `playwright.config.js`
- Modify: `.gitignore`
- Create: `tests/e2e/smoke.spec.js`

- [ ] **Step 1: Add the devDependency and the script**

Run: `npm install --save-dev @playwright/test`

This adds `@playwright/test` to `devDependencies` in `package.json` and
updates `package-lock.json`.

Then add the `test:e2e` script. Edit `package.json` `scripts` to include:

```json
"test:e2e": "playwright test"
```

(Place it after the existing `"test"` line. Keep `"test"` unchanged.)

- [ ] **Step 2: Install the Chromium browser binary**

Run: `npx playwright install chromium`
Expected: downloads Chromium into the Playwright cache (no error).

- [ ] **Step 3: Create `playwright.config.js`**

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
    command: 'node scripts/demo-server.js',
    env: { HOST: '127.0.0.1', PORT },
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
```

- [ ] **Step 4: Add Playwright artifacts to `.gitignore`**

Append to `.gitignore`:

```
# Playwright
test-results/
playwright-report/
/blob-report/
/playwright/.cache/
```

- [ ] **Step 5: Create the smoke canary spec**

Create `tests/e2e/smoke.spec.js`:

```js
import { test, expect } from '@playwright/test';

test('app shell loads without console errors', async ({ page }) => {
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto('/');

  // The shell renders the primary nav with a Library view button.
  await expect(page.locator('[data-view="library"]').first()).toBeVisible();

  // No uncaught console errors during initial load.
  expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);
});
```

- [ ] **Step 6: Run the smoke spec**

Run: `npm run test:e2e -- smoke.spec.js`
Expected: 1 passed. The webServer block boots the demo server on port 3199,
waits for `/healthz`, runs the spec, tears the server down.

If it hangs on "waiting for webServer": confirm the demo server honors
`HOST`/`PORT` (it does — `scripts/demo-server.js` reads them via its config
loader) and that `/healthz` returns 200 (registered in `server/index.js`'s
`buildApp`, which the demo uses).

- [ ] **Step 7: Confirm the unit suite is unaffected**

Run: `npm test`
Expected: 706/706 pass. No `*.spec.js` file is collected by `node --test`
(it only matches `*.test.js`).

Run: `npm run check`
Expected: PASS (unchanged — `playwright.config.js` is not in the `check`
script).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json playwright.config.js .gitignore tests/e2e/smoke.spec.js
git commit -m "Add Playwright e2e harness scaffold + smoke canary

First devDependency (@playwright/test, Chromium only). playwright.config.js
auto-starts the in-memory demo server on a test port via its webServer
block. New \`npm run test:e2e\` command; \`npm test\` stays the fast unit
suite. A smoke spec asserts the app shell loads with no console errors,
proving the harness + webServer wiring end-to-end.
"
```

---

## Task 2 — Seed helper + Links-visibility regression spec

**Files:**
- Create: `tests/e2e/helpers/seed.js`
- Create: `tests/e2e/links-section.spec.js`

This is the centerpiece — it locks the exact bug that shipped in v0.12.0.

- [ ] **Step 1: Create the seed helper**

Create `tests/e2e/helpers/seed.js`:

```js
// API-seeding helpers for e2e specs. Each function takes a Playwright
// APIRequestContext (page.request) so calls share the configured baseURL.

export async function resolveProjectId(request, slug) {
  const res = await request.get('/api/projects');
  if (!res.ok()) throw new Error(`GET /api/projects failed: ${res.status()}`);
  const projects = await res.json();
  const project = projects.find((p) => p.slug === slug);
  if (!project) throw new Error(`No project with slug "${slug}"`);
  return project.id;
}

export async function createDocument(request, doc) {
  const res = await request.post('/api/library/documents', { data: doc });
  if (!res.ok()) throw new Error(`POST document failed: ${res.status()}`);
  return res.json();
}

export async function linkDocuments(request, sourceId, targetId, relation) {
  const res = await request.post(`/api/library/documents/${sourceId}/links`, {
    data: { targetId, relation },
  });
  if (!res.ok()) throw new Error(`POST link failed: ${res.status()}`);
  return res.json();
}

export async function updateDocument(request, id, patch) {
  const res = await request.patch(`/api/library/documents/${id}`, { data: patch });
  if (!res.ok()) throw new Error(`PATCH document failed: ${res.status()}`);
  return res.json();
}

// Higher-level fixture builders. `prefix` makes titles unique across specs
// sharing the one demo-server instance, so rows are located unambiguously.

export async function seedDerivedFromPair(request, prefix) {
  const projectId = await resolveProjectId(request, 'homelab');
  const source = await createDocument(request, {
    title: `${prefix} source`,
    body: '# source\n\noriginal body\n',
    documentType: 'runbook',
    project: projectId,
    tags: ['e2e'],
  });
  const synthesized = await createDocument(request, {
    title: `${prefix} synthesized`,
    body: '# synthesized\n\nderived body\n',
    documentType: 'note',
    project: projectId,
    kind: 'synthesized',
    tags: ['e2e'],
  });
  await linkDocuments(request, synthesized.id, source.id, 'derived-from');
  return { projectId, source, synthesized };
}

export async function seedStalePair(request, prefix) {
  const seeded = await seedDerivedFromPair(request, prefix);
  // Editing the source body changes its content hash, so the snapshot on the
  // derived-from link no longer matches -> the synthesized doc is now stale.
  await updateDocument(request, seeded.source.id, {
    body: '# source\n\nedited body — invalidates the snapshot\n',
  });
  return seeded;
}

export async function seedOrphan(request, prefix) {
  const projectId = await resolveProjectId(request, 'work');
  const orphan = await createDocument(request, {
    title: `${prefix} orphan`,
    body: '# orphan\n',
    documentType: 'note',
    project: projectId,
    tags: ['e2e'],
  });
  return { projectId, orphan };
}
```

- [ ] **Step 2: Create the Links-visibility spec**

Create `tests/e2e/links-section.spec.js`:

```js
import { test, expect } from '@playwright/test';
import { seedDerivedFromPair, seedOrphan } from './helpers/seed.js';

// Open the library view and click the row whose title contains `titleText`.
async function openLibraryDoc(page, titleText) {
  await page.goto('/');
  await page.locator('[data-view="library"]').first().click();
  const row = page.locator('.document-row', { hasText: titleText });
  await expect(row).toBeVisible();
  await row.click();
}

test('Links section is visible on first load of a linked doc', async ({ page }) => {
  const prefix = `links-first-${Date.now()}`;
  await seedDerivedFromPair(page.request, prefix);

  await openLibraryDoc(page, `${prefix} synthesized`);

  // The regression: the Links section must be visible immediately, without a
  // mode switch. toBeVisible() checks real geometry, catching both the CSS
  // clip and the stale-DOM re-render failure modes.
  const links = page.locator('.document-links');
  await expect(links).toBeVisible();
  await expect(links).toContainText('Derived from');
  await expect(links).toContainText(`${prefix} source`);
});

test('Links section stays visible across every detail mode', async ({ page }) => {
  const prefix = `links-modes-${Date.now()}`;
  await seedDerivedFromPair(page.request, prefix);
  await openLibraryDoc(page, `${prefix} synthesized`);

  const links = page.locator('.document-links');
  await expect(links).toBeVisible();

  // edit
  await page.locator('[data-library-mode="edit"]').click();
  await expect(links).toBeVisible();

  // split
  await page.locator('[data-library-mode="split"]').click();
  await expect(links).toBeVisible();

  // info-edit
  await page.locator('[data-action="edit-document-info"]').click();
  await expect(links).toBeVisible();

  // back to preview, then focus
  await page.locator('[data-library-mode="preview"]').click();
  await page.locator('[data-action="toggle-document-focus"]').click();
  await expect(links).toBeVisible();
});

test('Backlinks show the deriving doc on the source', async ({ page }) => {
  const prefix = `links-back-${Date.now()}`;
  await seedDerivedFromPair(page.request, prefix);
  await openLibraryDoc(page, `${prefix} source`);

  const links = page.locator('.document-links');
  await expect(links).toBeVisible();
  await expect(links).toContainText('Backlinks');
  await expect(links).toContainText(`${prefix} synthesized`);
});

test('Links section renders an empty state for an orphan doc', async ({ page }) => {
  const prefix = `links-orphan-${Date.now()}`;
  await seedOrphan(page.request, prefix);
  await openLibraryDoc(page, `${prefix} orphan`);

  const links = page.locator('.document-links');
  await expect(links).toBeVisible();
  await expect(links).toContainText('No links');
});
```

- [ ] **Step 3: Run the Links spec**

Run: `npm run test:e2e -- links-section.spec.js`
Expected: 4 passed.

If the orphan row doesn't appear: the orphan is seeded in the `work` project,
which is fine under the default `all` filter. If the library view scopes to a
project, confirm the project filter shows `all` (fresh context has no
persisted filter).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/helpers/seed.js tests/e2e/links-section.spec.js
git commit -m "e2e: lock the Links-section visibility regression

Seed helper codifies the manual graph smoke (create source +
synthesized, derived-from link, source edit -> stale, orphan) via the
demo HTTP API using page.request. The Links spec asserts the section is
visible on first load and across every detail mode (preview / edit /
split / info / focus), plus Backlinks on the source and the empty state
on an orphan. toBeVisible() is the primitive that catches the layout +
stale-DOM bugs that string-HTML tests can't see.
"
```

---

## Task 3 — Chips + maintenance specs

**Files:**
- Create: `tests/e2e/list-chips.spec.js`
- Create: `tests/e2e/maintenance.spec.js`

- [ ] **Step 1: Create the list-chips spec**

Create `tests/e2e/list-chips.spec.js`:

```js
import { test, expect } from '@playwright/test';
import { seedStalePair, seedOrphan } from './helpers/seed.js';

async function gotoLibrary(page) {
  await page.goto('/');
  await page.locator('[data-view="library"]').first().click();
}

test('synthesized + stale row shows SYNTH and STALE chips', async ({ page }) => {
  const prefix = `chips-${Date.now()}`;
  await seedStalePair(page.request, prefix);
  await gotoLibrary(page);

  const row = page.locator('.document-row', { hasText: `${prefix} synthesized` });
  await expect(row).toBeVisible();
  await expect(row.locator('.chip-synth')).toBeVisible();
  await expect(row.locator('.chip-stale')).toBeVisible();
});

test('plain source row shows neither chip', async ({ page }) => {
  const prefix = `chips-plain-${Date.now()}`;
  await seedOrphan(page.request, prefix);
  await gotoLibrary(page);

  const row = page.locator('.document-row', { hasText: `${prefix} orphan` });
  await expect(row).toBeVisible();
  await expect(row.locator('.chip-synth')).toHaveCount(0);
  await expect(row.locator('.chip-stale')).toHaveCount(0);
});
```

- [ ] **Step 2: Run the chips spec**

Run: `npm run test:e2e -- list-chips.spec.js`
Expected: 2 passed.

- [ ] **Step 3: Create the maintenance spec**

Create `tests/e2e/maintenance.spec.js`:

```js
import { test, expect } from '@playwright/test';
import { seedStalePair, seedOrphan } from './helpers/seed.js';

async function openMaintenance(page) {
  await page.goto('/');
  await page.locator('[data-action="open-admin"]').first().click();
  await expect(page.locator('#library-maintenance-title')).toBeVisible();
}

test('Maintenance shows stale and orphan docs', async ({ page }) => {
  const stalePrefix = `maint-stale-${Date.now()}`;
  const orphanPrefix = `maint-orphan-${Date.now()}`;
  await seedStalePair(page.request, stalePrefix);
  await seedOrphan(page.request, orphanPrefix);

  await openMaintenance(page);

  // The stale synthesized doc appears in the maintenance panel.
  await expect(page.getByText(`${stalePrefix} synthesized`)).toBeVisible();
  // The orphan appears too.
  await expect(page.getByText(`${orphanPrefix} orphan`)).toBeVisible();
});

test('Maintenance [open] navigates to the correct doc', async ({ page }) => {
  const prefix = `maint-open-${Date.now()}`;
  const { synthesized } = await seedStalePair(page.request, prefix);

  await openMaintenance(page);

  // Click the [open] button for the stale synthesized doc.
  await page
    .locator(`[data-action="open-library-doc"][data-library-document-id="${synthesized.id}"]`)
    .first()
    .click();

  // The library workspace opens to that doc — its title shows in the detail
  // header, and the Links section (which only the detail panel renders) is
  // visible. Locating by the unique title proves we landed on the right doc,
  // not a fallback row.
  await expect(page.locator('.library-detail').getByText(`${prefix} synthesized`)).toBeVisible();
  await expect(page.locator('.document-links')).toBeVisible();
});

test('Maintenance project filter scopes the lists', async ({ page }) => {
  const homelabPrefix = `maint-filter-hl-${Date.now()}`;
  const workPrefix = `maint-filter-wk-${Date.now()}`;
  await seedStalePair(page.request, homelabPrefix); // homelab project
  await seedOrphan(page.request, workPrefix);       // work project

  await openMaintenance(page);

  // Switch the maintenance filter to the homelab project, then refresh.
  const homelabId = await page.evaluate(async () => {
    const res = await fetch('/api/projects');
    const projects = await res.json();
    return projects.find((p) => p.slug === 'homelab').id;
  });
  await page.locator('[data-maintenance-project-filter]').selectOption(homelabId);
  await page.locator('[data-action="refresh-maintenance"]').click();

  // The homelab stale doc shows; the work orphan does not.
  await expect(page.getByText(`${homelabPrefix} synthesized`)).toBeVisible();
  await expect(page.getByText(`${workPrefix} orphan`)).toHaveCount(0);
});
```

- [ ] **Step 4: Run the maintenance spec**

Run: `npm run test:e2e -- maintenance.spec.js`
Expected: 3 passed.

If the filter test is flaky because the `<option>` value is an id the test
didn't capture: the `page.evaluate` fetch resolves the homelab id at runtime,
matching the `<option value="<id>">` the renderer emits. Confirm
`renderAdminPanelHtml` emits `<option value="${p.id}">` (it does).

- [ ] **Step 5: Run the full e2e suite**

Run: `npm run test:e2e`
Expected: all specs pass (smoke + links + chips + maintenance = 10 tests).

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/list-chips.spec.js tests/e2e/maintenance.spec.js
git commit -m "e2e: chips + maintenance specs

list-chips locks SYNTH/STALE chip rendering on the right rows. The
maintenance specs assert stale + orphan docs appear in the panel, that
[open] navigates to the correct doc (guards the cross-project /
filtered-target fix), and that the project filter + refresh scope the
lists.
"
```

---

## Task 4 — Mutation-test the harness, wire CI, final review + PR

- [ ] **Step 1: Mutation test — prove the harness catches the shipped bug**

Temporarily re-introduce BOTH v0.12.1 regressions locally, confirm the Links
spec goes red, then restore.

Regression A (CSS): in `public/styles.css`, change `.library-detail`'s
`grid-template-rows` from `auto minmax(0, 1fr) auto` back to
`auto minmax(0, 1fr)`.

Regression B (stale DOM): in `public/js/main.js`, inside `loadDocumentLinks`,
change the re-render from `renderWorkspace();` back to:

```js
const workspace = app.querySelector('[data-workspace]');
if (workspace) renderLibraryWorkspace(workspace);
```

Run: `npm run test:e2e -- links-section.spec.js`
Expected: **FAIL** — at minimum the "visible on first load" test goes red
(regression B leaves the section unrendered until a mode switch; regression A
clips it). This proves the harness is not tautological.

Now **restore both fixes** (revert the two edits above):
- `grid-template-rows: auto minmax(0, 1fr) auto;`
- `renderWorkspace();`

Run: `npm run test:e2e -- links-section.spec.js`
Expected: **4 passed** (green again).

Run: `git diff --stat`
Expected: NO changes to `public/styles.css` or `public/js/main.js` (the
mutation was fully reverted). If either file shows as modified, the restore
was incomplete — fix before continuing.

- [ ] **Step 2: Add the CI job**

Edit `.github/workflows/ci.yml`. Add a new job after the existing `test` job
(sibling to `security` / `dependency-review`):

```yaml
  e2e:
    name: Browser tests
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v6

      - name: Setup Node
        uses: actions/setup-node@v6
        with:
          node-version: 24
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright Chromium
        run: npx playwright install --with-deps chromium

      - name: Run browser tests
        run: npm run test:e2e

      - name: Upload Playwright report
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7
```

- [ ] **Step 3: Verify the full local check sequence**

Run: `npm test`
Expected: 706/706 pass (unit suite unaffected).

Run: `npm run check`
Expected: PASS.

Run: `npm run test:e2e`
Expected: all 10 e2e tests pass.

- [ ] **Step 4: Commit the CI job**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add browser-tests job running the Playwright e2e suite

New e2e job installs Chromium and runs npm run test:e2e against the
auto-started demo server. Uploads the HTML report on failure. Gates PRs
alongside the existing checks, so a layout or stale-DOM regression now
turns CI red.
"
```

- [ ] **Step 5: Dispatch a final Opus reviewer subagent**

Per `subagent-model-routing.md`: Opus for reviewers. Ask for spec compliance
(harness, seed helper, all specs, CI, mutation-test evidence) and code
quality. Confirm the mutation test was actually run (Step 1's red→green) and
that no app source remained mutated. Address any **Important** findings before
opening the PR.

- [ ] **Step 6: Push branch and open PR**

```bash
git push -u origin feature/e2e-test-harness
gh pr create --title "Add Playwright e2e browser-test harness" --body "$(cat <<'EOF'
## Summary

Adds a Playwright browser-test harness — the project's first devDependency — that drives the in-memory demo server and asserts real rendered behavior, catching the layout/visibility and stale-DOM bug classes that string-HTML unit tests cannot. The two v0.12.0 regressions fixed in v0.12.1 were both invisible to the existing `node --test` suite; this harness mutation-tests against them.

- **Config:** `playwright.config.js` auto-starts the demo server on a test port via its `webServer` block. Chromium only. Serial (`workers: 1`) for deterministic shared in-memory state.
- **Separation:** specs are `tests/e2e/*.spec.js` (Node's globber only matches `*.test.js`), run via a new `npm run test:e2e`. `npm test` stays the fast unit suite, untouched.
- **Fixtures:** tests seed their own graph state via the demo HTTP API (`page.request`), so demo seed data stays a clean slate.
- **First test set (v0.12 graph UI surface):** Links-section visibility on first load + every detail mode (the regression centerpiece); SYNTH/STALE chips on the right rows; Admin maintenance stale/orphan tables, [open] click-through landing on the correct doc, and project filter + refresh.
- **CI:** new `e2e` job installs Chromium and runs the suite; uploads the HTML report on failure.

## Mutation test (anti-tautology)

Re-introduced both v0.12.1 regressions locally (2-row grid + the `[data-workspace]` selector), confirmed `links-section.spec.js` went **red**, restored the fixes, confirmed **green**. `git diff` confirmed no app source remained mutated.

## Test plan

- [x] `npm test` green (706 unit tests, unaffected)
- [x] `npm run check` green
- [x] `npm run test:e2e` green (10 browser tests)
- [x] Mutation test: harness catches the exact shipped bug class

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Release (post-merge)

Cuts as **v0.12.2** (patch — tooling + tests, no app behavior change). Standard
ritual:

1. Branch `release-v0.12.2` from main.
2. `npm version 0.12.2 --no-git-tag-version`.
3. Update `compose.image.yaml` and the README image-tag callout to `v0.12.2`.
4. Roll `[Unreleased]` to `[0.12.2] - <today>` in `CHANGELOG.md` with an
   `### Added` entry: "Playwright end-to-end browser test harness (`npm run
   test:e2e`) covering the document-graph UI surface, gated in CI. (#<PR>)"
5. Add the `v0.12.1...v0.12.2` compare link.
6. Commit, PR, merge, `git tag -a v0.12.2 -m "v0.12.2" && git push origin v0.12.2`.
7. Watch the release workflow.
