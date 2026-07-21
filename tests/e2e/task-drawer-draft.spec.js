import { test, expect } from '@playwright/test';

async function createDrawerTask(request, prefix) {
  const response = await request.post('/api/tasks', {
    data: {
      title: `${prefix} saved title`,
      description: 'Saved description',
      notes: 'Saved notes',
      project: 'inbox',
      priority: 'medium',
      status: 'planned',
    },
  });
  expect(response.ok()).toBe(true);
  return response.json();
}

async function openDrawer(page, task) {
  const projects = await (await page.request.get('/api/projects')).json();
  const inbox = projects.find((project) => project.slug === 'inbox');
  await page.goto('/');
  await page.locator(`[data-action="nav-project"][data-project-id="${inbox.id}"]`).first().click();
  await page.locator('.task-row', { hasText: task.title }).click();
  await expect(page.locator('.drawer[data-task-id]')).toBeVisible();
  await settleDrawer(page);
}

// The drawer re-renders up to three times right after opening (context load,
// related-knowledge loading, related-knowledge result). A one-shot fill() can
// resolve an input from an earlier render and write into a node the next
// render just detached — the value and its input event then vanish. Real
// typing is safe (every keystroke lands in state and the focused-field
// capture restores values across renders); tests must simply wait for the
// LAST trailing render before typing.
async function settleDrawer(page) {
  const related = page.locator('[data-related-knowledge]');
  await expect(related).toBeVisible();
  await expect(related).not.toContainText('Looking for related notes');
}

async function fillTaskDraft(page, draft) {
  await page.locator('[data-task-title]').fill(draft.title);
  await page.locator('[data-task-description]').fill(draft.description);
  await page.locator('[data-task-notes]').fill(draft.notes);
}

// Any PATCH carrying draft text fields. Deliberately NOT "all three": drafts
// save per-field (only fields diverging from the seeded baseline travel), and
// the 1s autosave debounce can fire between protocol actions under full-suite
// load — splitting one draft into partial patches. A predicate pinned to the
// full trio lets those partials slip past every interception below, which is
// exactly the flake this file used to have.
function isDraftPatch(route) {
  if (route.request().method() !== 'PATCH') return false;
  const payload = route.request().postDataJSON();
  return ['title', 'description', 'notes'].some((field) => Object.hasOwn(payload, field));
}

test('task title, description, and notes survive an unrelated render and commit exactly once each', async ({ page }) => {
  const prefix = `task-draft-render-${Date.now()}`;
  const task = await createDrawerTask(page.request, prefix);
  const draft = {
    title: `${prefix} coherent title`,
    description: 'Coherent description after priority render',
    notes: 'Coherent notes after priority render',
  };
  const textPatches = [];
  await openDrawer(page, task);
  await page.route(`**/api/tasks/${task.id}`, async (route) => {
    if (isDraftPatch(route)) textPatches.push(route.request().postDataJSON());
    await route.continue();
  });

  await fillTaskDraft(page, draft);
  await page.locator('[data-action="set-task-priority"][data-priority="high"]').click();

  await expect(page.locator('[data-task-title]')).toHaveValue(draft.title);
  await expect(page.locator('[data-task-description]')).toHaveValue(draft.description);
  await expect(page.locator('[data-task-notes]')).toHaveValue(draft.notes);
  // 'Saved' arrives after the 1s autosave debounce + the save round-trip.
  await expect(page.locator('[data-task-draft-save-status]')).toHaveText('Saved', { timeout: 10_000 });
  // Per-field saving may deliver the draft as one patch or several (the
  // debounce decides) — the contract is that every field arrives with the
  // draft's value exactly once, never bundled stale, never re-sent.
  const sentEntries = textPatches.flatMap((patch) => Object.entries(patch));
  expect(Object.fromEntries(sentEntries)).toEqual(draft);
  expect(new Map(sentEntries).size).toBe(sentEntries.length);
  const stored = await (await page.request.get(`/api/tasks/${task.id}`)).json();
  expect({ title: stored.title, description: stored.description, notes: stored.notes }).toEqual(draft);
});

test('closing the task drawer waits for its exact draft PATCH', async ({ page }) => {
  const prefix = `task-draft-close-${Date.now()}`;
  const task = await createDrawerTask(page.request, prefix);
  const draft = {
    title: `${prefix} close barrier`,
    description: 'Description saved before close',
    notes: 'Notes saved before close',
  };
  let releasePatch;
  let markPatchStarted;
  const patchGate = new Promise((resolve) => { releasePatch = resolve; });
  const patchStarted = new Promise((resolve) => { markPatchStarted = resolve; });
  await openDrawer(page, task);
  await page.route(`**/api/tasks/${task.id}`, async (route) => {
    if (isDraftPatch(route)) {
      markPatchStarted();
      await patchGate;
    }
    await route.continue();
  });

  await fillTaskDraft(page, draft);
  await page.locator('.drawer__close').click();
  await patchStarted;
  await expect(page.locator('.drawer')).toBeVisible();
  releasePatch();
  await expect(page.locator('.drawer')).toHaveCount(0);

  const stored = await (await page.request.get(`/api/tasks/${task.id}`)).json();
  expect({ title: stored.title, description: stored.description, notes: stored.notes }).toEqual(draft);
});

test('failed close survives reload and a rapid retry commits one exact task draft', async ({ page }) => {
  const prefix = `task-draft-recovery-${Date.now()}`;
  const task = await createDrawerTask(page.request, prefix);
  const draft = {
    title: `${prefix} recovered title`,
    description: 'Recovered description',
    notes: 'Recovered notes',
  };
  // Fail-until-observed, not fail-the-first-attempt: under load the autosave
  // debounce can fire before the close click, so WHICH save hits the wire
  // first is not deterministic — but "every save fails until the user sees
  // Save failed" is. Nothing commits while the flag is up (fulfill never
  // touches the server), so recovery + retry semantics stay exact.
  let failInjections = true;
  let failedAttempts = 0;
  const committed = [];
  await openDrawer(page, task);
  await page.route(`**/api/tasks/${task.id}`, async (route) => {
    if (!isDraftPatch(route)) {
      await route.continue();
      return;
    }
    if (failInjections) {
      failedAttempts += 1;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'injected task draft failure' }),
      });
      return;
    }
    committed.push(route.request().postDataJSON());
    await route.continue();
  });

  await fillTaskDraft(page, draft);
  await page.locator('.drawer__close').click();
  await expect(page.locator('[data-task-draft-save-status]')).toHaveText('Save failed', { timeout: 10_000 });
  await expect(page.locator('[data-task-draft-save-action]')).toHaveText('Retry');
  await expect(page.locator('.drawer')).toBeVisible();
  expect(failedAttempts).toBeGreaterThanOrEqual(1);
  expect(committed).toEqual([]);
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage)
    .filter((key) => key.startsWith('prax.taskDraftRecovery.v1.')).length)).toBe(1);

  await page.reload();
  expect(await page.evaluate(() => Object.keys(localStorage)
    .filter((key) => key.startsWith('prax.taskDraftRecovery.v1.')).length)).toBe(1);
  const projects = await (await page.request.get('/api/projects')).json();
  const inbox = projects.find((project) => project.slug === 'inbox');
  await page.locator(`[data-action="nav-project"][data-project-id="${inbox.id}"]`).first().click();
  await page.locator('.task-row', { hasText: task.title }).click();
  await expect(page.locator('[data-task-title]')).toHaveValue(draft.title);
  await expect(page.locator('[data-task-description]')).toHaveValue(draft.description);
  await expect(page.locator('[data-task-notes]')).toHaveValue(draft.notes);
  await expect(page.locator('[data-task-draft-save-status]')).toHaveText('Recovered draft');

  failInjections = false;
  await page.locator('[data-task-draft-save-action]').dblclick();
  await expect(page.locator('[data-task-draft-save-status]')).toHaveText('Saved');
  // The rapid double-click is the point: exactly ONE commit, carrying the
  // exact recovered draft — nothing partial ever landed while saves failed.
  expect(committed).toEqual([draft]);
  expect(await page.evaluate(() => Object.keys(localStorage)
    .filter((key) => key.startsWith('prax.taskDraftRecovery.v1.')))).toEqual([]);
});

test('a failed save that observes a newer saved copy requires explicit replacement', async ({ page, request }) => {
  const prefix = `task-draft-conflict-${Date.now()}`;
  const task = await createDrawerTask(page.request, prefix);
  const draft = {
    title: `${prefix} local draft`,
    description: 'Local draft description',
    notes: 'Local draft notes',
  };
  const remote = {
    title: `${prefix} remote revision`,
    description: 'Remote description',
    notes: 'Remote notes',
  };
  // The first draft patch — autosave or close-save, whichever wins the race —
  // collides with a concurrent remote revision and loses its response. Any
  // split partial always leads with the title (filled first), and the remote
  // revision differs on title, so the conflict is detected either way; the
  // conflict verdict then blocks every automatic retry, keeping the ordinal
  // deterministic until the explicit confirmation.
  let draftPatchAttempts = 0;
  await openDrawer(page, task);
  await page.route(`**/api/tasks/${task.id}`, async (route) => {
    if (!isDraftPatch(route)) {
      await route.continue();
      return;
    }
    draftPatchAttempts += 1;
    if (draftPatchAttempts === 1) {
      const remoteWrite = await request.patch(`/api/tasks/${task.id}`, { data: remote });
      expect(remoteWrite.ok()).toBe(true);
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'injected failure after concurrent edit' }),
      });
      return;
    }
    await route.continue();
  });

  await fillTaskDraft(page, draft);
  await page.locator('.drawer__close').click();
  await expect(page.locator('[data-task-draft-save-status]'))
    .toHaveText('Recovered draft — saved copy changed');
  await expect(page.locator('[data-task-draft-save-action]')).toHaveText('Review and save');
  await expect(page.locator('[data-task-title]')).toHaveValue(draft.title);
  expect(draftPatchAttempts).toBe(1);

  await page.locator('[data-task-draft-save-action]').click();
  await expect(page.getByRole('alertdialog')).toContainText('saved task changed');
  expect(draftPatchAttempts).toBe(1);
  const beforeConfirm = await (await request.get(`/api/tasks/${task.id}`)).json();
  expect({
    title: beforeConfirm.title,
    description: beforeConfirm.description,
    notes: beforeConfirm.notes,
  }).toEqual(remote);

  await page.locator('[data-confirm-ok]').click();
  await expect(page.locator('[data-task-draft-save-status]')).toHaveText('Saved');
  expect(draftPatchAttempts).toBe(2);
  const afterConfirm = await (await request.get(`/api/tasks/${task.id}`)).json();
  expect({
    title: afterConfirm.title,
    description: afterConfirm.description,
    notes: afterConfirm.notes,
  }).toEqual(draft);
});

test('a lost task PATCH response is reconciled without a duplicate write', async ({ page }) => {
  const prefix = `task-draft-reconcile-${Date.now()}`;
  const task = await createDrawerTask(page.request, prefix);
  const draft = {
    title: `${prefix} committed once`,
    description: 'Committed description',
    notes: 'Committed notes',
  };
  // EVERY draft patch commits server-side but loses its response — whether
  // the debounce delivers the draft as one patch or several, each must be
  // reconciled by readback and none may be replayed.
  const lostPayloads = [];
  await openDrawer(page, task);
  await page.route(`**/api/tasks/${task.id}`, async (route) => {
    if (!isDraftPatch(route)) {
      await route.continue();
      return;
    }
    lostPayloads.push(route.request().postDataJSON());
    await route.fetch();
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'injected lost task response' }),
    });
  });

  await fillTaskDraft(page, draft);
  await page.locator('.drawer__close').click();
  await expect(page.locator('.drawer')).toHaveCount(0);
  // No payload was ever re-sent: a replay after readback would repeat an
  // identical body, and the committed fields must union to the exact draft.
  expect(lostPayloads.length).toBeGreaterThanOrEqual(1);
  expect(new Set(lostPayloads.map((payload) => JSON.stringify(payload))).size).toBe(lostPayloads.length);
  expect(Object.assign({}, ...lostPayloads)).toEqual(draft);

  const stored = await (await page.request.get(`/api/tasks/${task.id}`)).json();
  expect({ title: stored.title, description: stored.description, notes: stored.notes }).toEqual(draft);
});
