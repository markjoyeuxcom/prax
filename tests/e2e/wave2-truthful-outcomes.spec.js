import { test, expect } from '@playwright/test';

async function createDrawerTask(request, prefix, overrides = {}) {
  const response = await request.post('/api/tasks', {
    data: {
      title: `${prefix} saved title`,
      description: 'Saved description',
      notes: 'Saved notes',
      project: 'inbox',
      priority: 'medium',
      status: 'planned',
      ...overrides,
    },
  });
  expect(response.ok()).toBe(true);
  return response.json();
}

async function openInboxList(page) {
  const projects = await (await page.request.get('/api/projects')).json();
  const inbox = projects.find((project) => project.slug === 'inbox');
  await page.goto('/');
  await page.locator(`[data-action="nav-project"][data-project-id="${inbox.id}"]`).first().click();
}

async function openDrawer(page, task) {
  await openInboxList(page);
  await page.locator('.task-row', { hasText: task.title }).click();
  await expect(page.locator('.drawer[data-task-id]')).toBeVisible();
  // Wait out the drawer's trailing renders (context + related knowledge):
  // a fill() racing them can write into a just-detached input and vanish.
  const related = page.locator('[data-related-knowledge]');
  await expect(related).toBeVisible();
  await expect(related).not.toContainText('Looking for related notes');
}

async function openCapture(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'New task', exact: true }).first().click();
  await expect(page.getByRole('dialog', { name: 'Quick capture' })).toBeVisible();
}

async function tasksWithTitle(request, title) {
  const response = await request.get(`/api/tasks?q=${encodeURIComponent(title)}`);
  expect(response.ok()).toBe(true);
  return (await response.json()).filter(task => task.title === title);
}

test('capture keeps its exact-once identity across type-and-revert', async ({ page, request }) => {
  const prefix = `wave2-capture-revert-${Date.now()}`;
  const title = `${prefix} exact once`;
  let postCount = 0;
  const requestIds = [];
  await openCapture(page);
  await page.route('**/api/tasks**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'POST' && url.pathname === '/api/tasks') {
      postCount += 1;
      requestIds.push(route.request().postDataJSON().id);
      if (postCount === 1) {
        // Network-level failure: the outcome is genuinely unknown, so the
        // retry-unchanged-is-safe copy and the stored identity must both hold.
        await route.abort();
        return;
      }
    }
    await route.continue();
  });

  await page.getByLabel('Task title').fill(title);
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  // Scoped to the dialog: bare role lookups collide with the task list's
  // "Showing 100 of N" status banner once the suite server accumulates rows.
  await expect(page.getByRole('dialog', { name: 'Quick capture' }).getByRole('alert'))
    .toContainText('retry unchanged is safe');

  // Type one character and delete it again. The input handler used to clear
  // captureRequestPayload/Intent on ANY keystroke, so this no-op edit minted a
  // fresh id and "retry unchanged" could commit the create twice.
  const input = page.getByLabel('Task title');
  await input.press('End');
  await input.press('x');
  await expect(input).toHaveValue(`${title}x`);
  await input.press('Backspace');
  await expect(input).toHaveValue(title);

  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Quick capture' })).toHaveCount(0);
  await expect(page.locator('.toast')).toContainText('Added to Inbox');
  expect(postCount).toBe(2);
  expect(requestIds[1]).toBe(requestIds[0]);
  const matches = await tasksWithTitle(request, title);
  expect(matches).toHaveLength(1);
  expect(matches[0].id).toBe(requestIds[0]);
});

test('a deterministic server rejection is not presented as retry-safe', async ({ page, request }) => {
  const prefix = `wave2-capture-reject-${Date.now()}`;
  const title = `${prefix} permanent rejection`;
  let postCount = 0;
  const requestIds = [];
  await openCapture(page);
  await page.route('**/api/tasks**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'POST' && url.pathname === '/api/tasks') {
      postCount += 1;
      requestIds.push(route.request().postDataJSON().id);
      if (postCount === 1) {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'title is required' }),
        });
        return;
      }
    }
    await route.continue();
  });

  await page.getByLabel('Task title').fill(title);
  await page.getByRole('button', { name: 'Add task', exact: true }).click();

  // A 4xx is the server saying no to THIS payload: repeating it unchanged can
  // only fail again, so the copy must not promise a safe retry.
  const captureAlert = page.getByRole('dialog', { name: 'Quick capture' }).getByRole('alert');
  await expect(captureAlert).toContainText(/rejected this capture/);
  await expect(captureAlert).not.toContainText('retry unchanged is safe');
  expect(await tasksWithTitle(request, title)).toHaveLength(0);

  // The rejection also cleared the retry identity, so the next submit mints a
  // fresh creation id instead of replaying the refused one forever.
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Quick capture' })).toHaveCount(0);
  await expect(page.locator('.toast')).toContainText('Added to Inbox');
  expect(postCount).toBe(2);
  expect(requestIds[1]).not.toBe(requestIds[0]);
  const matches = await tasksWithTitle(request, title);
  expect(matches).toHaveLength(1);
  expect(matches[0].id).toBe(requestIds[1]);
});

test("an externally archived task's drawer offers Discard instead of an invisible veto", async ({ page, request }) => {
  const prefix = `wave2-archived-trap-${Date.now()}`;
  const task = await createDrawerTask(page.request, prefix);
  let releaseNotesPatch;
  const notesPatchGate = new Promise((resolve) => { releaseNotesPatch = resolve; });
  await openDrawer(page, task);
  // Hold the notes autosave until the external archive has committed, so the
  // dirty draft deterministically meets an already-archived row (letting the
  // 1s debounce race the DELETE makes the autosave sometimes succeed first).
  await page.route(`**/api/tasks/${task.id}`, async (route) => {
    if (route.request().method() === 'PATCH'
      && Object.hasOwn(route.request().postDataJSON(), 'notes')) {
      await notesPatchGate;
    }
    await route.continue();
  });

  await page.locator('[data-task-notes]').fill('Notes typed while the task is archived elsewhere');
  const archived = await request.delete(`/api/tasks/${task.id}`);
  expect(archived.ok()).toBe(true);
  releaseNotesPatch();
  await expect(page.locator('[data-task-draft-save-status]')).toHaveText('Save failed');

  // A failing drawer PATCH is the deterministic refresh trigger: patchTask's
  // failure path runs loadTasks, the archived task drops out of state.tasks,
  // and the re-render must show the fallback drawer with an explicit Discard —
  // rendering nothing here left an INVISIBLE dirty draft vetoing every close
  // and navigation forever.
  await page.locator('[data-action="set-task-priority"][data-priority="high"]').click();
  const fallback = page.getByRole('dialog', { name: 'Task unavailable' });
  await expect(fallback).toBeVisible();
  await expect(fallback.getByRole('button', { name: 'Discard draft' })).toBeVisible();

  await fallback.getByRole('button', { name: 'Discard draft' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Discard the unsaved task draft?');
  await page.locator('[data-confirm-ok]').click();
  await expect(page.locator('.drawer')).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(localStorage)
    .filter((key) => key.startsWith('prax.taskDraftRecovery.v1.')))).toEqual([]);

  // The app is navigable again: leaving for Today works and no drawer returns.
  await page.locator('[data-action="nav-today"]').first().click();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await expect(page.locator('.drawer')).toHaveCount(0);
});

test('the completion toast tells the truth about the next occurrence', async ({ page, request }) => {
  const prefix = `wave2-recurrence-toast-${Date.now()}`;
  const task = await createDrawerTask(page.request, prefix, {
    dueDate: '2035-02-10',
    recurrence: 'daily',
  });
  await openInboxList(page);

  await page.locator('.task-row', { hasText: task.title })
    .locator('[data-action="toggle-task-done"]').click();

  // The toast is gated on the PATCH response's nextOccurrenceTaskId — the
  // OUTCOME — not on the recurrence token being truthy, so announcing it here
  // must coincide with a successor actually existing on the server.
  await expect(page.locator('.toast')).toContainText('next occurrence scheduled');
  const instances = (await (await request.get('/api/tasks?project=inbox')).json())
    .filter((candidate) => candidate.title === task.title);
  expect(instances).toHaveLength(2);
  const completed = instances.find((candidate) => candidate.id === task.id);
  const successor = instances.find((candidate) => candidate.id !== task.id);
  expect(completed.status).toBe('completed');
  expect(successor.status).toBe('planned');
  expect(successor.dueDate).toBe('2035-02-11');
  expect(successor.recurrence).toBe('daily');
});
