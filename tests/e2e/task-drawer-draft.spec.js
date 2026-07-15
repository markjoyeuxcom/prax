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
}

async function fillTaskDraft(page, draft) {
  await page.locator('[data-task-title]').fill(draft.title);
  await page.locator('[data-task-description]').fill(draft.description);
  await page.locator('[data-task-notes]').fill(draft.notes);
}

function isTextDraftPatch(route) {
  if (route.request().method() !== 'PATCH') return false;
  const payload = route.request().postDataJSON();
  return Object.hasOwn(payload, 'title')
    && Object.hasOwn(payload, 'description')
    && Object.hasOwn(payload, 'notes');
}

test('task title, description, and notes survive an unrelated render and save atomically', async ({ page }) => {
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
    if (isTextDraftPatch(route)) textPatches.push(route.request().postDataJSON());
    await route.continue();
  });

  await fillTaskDraft(page, draft);
  await page.locator('[data-action="set-task-priority"][data-priority="high"]').click();

  await expect(page.locator('[data-task-title]')).toHaveValue(draft.title);
  await expect(page.locator('[data-task-description]')).toHaveValue(draft.description);
  await expect(page.locator('[data-task-notes]')).toHaveValue(draft.notes);
  await expect(page.locator('[data-task-draft-save-status]')).toHaveText('Saved');
  expect(textPatches).toEqual([draft]);
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
    if (isTextDraftPatch(route)) {
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
  let patchAttempts = 0;
  const committed = [];
  await openDrawer(page, task);
  await page.route(`**/api/tasks/${task.id}`, async (route) => {
    if (!isTextDraftPatch(route)) {
      await route.continue();
      return;
    }
    patchAttempts += 1;
    if (patchAttempts === 1) {
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
  await expect(page.locator('[data-task-draft-save-status]')).toHaveText('Save failed');
  await expect(page.locator('[data-task-draft-save-action]')).toHaveText('Retry');
  await expect(page.locator('.drawer')).toBeVisible();
  expect(patchAttempts).toBe(1);
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

  await page.locator('[data-task-draft-save-action]').dblclick();
  await expect(page.locator('[data-task-draft-save-status]')).toHaveText('Saved');
  expect(patchAttempts).toBe(2);
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
  let draftPatchAttempts = 0;
  await openDrawer(page, task);
  await page.route(`**/api/tasks/${task.id}`, async (route) => {
    if (!isTextDraftPatch(route)) {
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
  let textPatchCount = 0;
  await openDrawer(page, task);
  await page.route(`**/api/tasks/${task.id}`, async (route) => {
    if (!isTextDraftPatch(route)) {
      await route.continue();
      return;
    }
    textPatchCount += 1;
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
  expect(textPatchCount).toBe(1);

  const stored = await (await page.request.get(`/api/tasks/${task.id}`)).json();
  expect({ title: stored.title, description: stored.description, notes: stored.notes }).toEqual(draft);
});
