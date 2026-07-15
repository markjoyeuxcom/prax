import { test, expect } from '@playwright/test';

async function createLifecycleTask(request, prefix, overrides = {}) {
  const response = await request.post('/api/tasks', {
    data: {
      title: `${prefix} task`,
      description: '',
      notes: '',
      project: 'inbox',
      priority: 'medium',
      status: 'planned',
      ...overrides,
    },
  });
  expect(response.ok()).toBe(true);
  return response.json();
}

async function openLifecycleDrawer(page, task) {
  const projects = await (await page.request.get('/api/projects')).json();
  const inbox = projects.find((project) => project.slug === 'inbox');
  await page.goto('/');
  await page.locator(`[data-action="nav-project"][data-project-id="${inbox.id}"]`).first().click();
  await page.locator('.task-row', { hasText: task.title }).click();
  await expect(page.locator(`.drawer[data-task-id="${task.id}"]`)).toBeVisible();
}

test('schedule, recurrence, and snooze controls serialize and work from the keyboard', async ({ page }) => {
  const prefix = `task-lifecycle-schedule-${Date.now()}`;
  const task = await createLifecycleTask(page.request, prefix);
  let releaseDueDate;
  let markDueDateStarted;
  let markRecurrenceStarted;
  let recurrenceHasStarted = false;
  const dueDateGate = new Promise((resolve) => { releaseDueDate = resolve; });
  const dueDateStarted = new Promise((resolve) => { markDueDateStarted = resolve; });
  const recurrenceStarted = new Promise((resolve) => { markRecurrenceStarted = resolve; });
  await openLifecycleDrawer(page, task);
  await page.route(`**/api/tasks/${task.id}`, async (route) => {
    if (route.request().method() !== 'PATCH') {
      await route.continue();
      return;
    }
    const payload = route.request().postDataJSON();
    if (Object.hasOwn(payload, 'dueDate')) {
      markDueDateStarted();
      await dueDateGate;
    }
    if (payload.recurrence === 'daily') {
      recurrenceHasStarted = true;
      markRecurrenceStarted();
    }
    await route.continue();
  });

  await page.getByLabel('Due date').fill('2032-04-12');
  await dueDateStarted;
  const daily = page.getByRole('group', { name: 'Repeat' }).getByRole('button', { name: 'Daily' });
  await daily.focus();
  await daily.press('Enter');
  await page.waitForTimeout(100);
  expect(recurrenceHasStarted).toBe(false);

  releaseDueDate();
  await recurrenceStarted;
  await expect(page.getByRole('group', { name: 'Repeat' }).getByRole('button', { name: 'Daily' }))
    .toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Due time').fill('08:45');

  const tomorrow = page.getByRole('group', { name: 'Snooze' }).getByRole('button', { name: 'Tomorrow' });
  await tomorrow.focus();
  await tomorrow.press('Enter');
  const unsnooze = page.getByRole('group', { name: 'Snooze' }).getByRole('button', { name: 'Unsnooze' });
  await expect(unsnooze).toBeVisible();
  let canonical = await (await page.request.get(`/api/tasks/${task.id}`)).json();
  expect(canonical.dueDate).toBe('2032-04-12');
  expect(canonical.dueTime).toBe('08:45');
  expect(canonical.recurrence).toBe('daily');
  expect(new Date(canonical.deferredUntil).getTime()).toBeGreaterThan(Date.now());

  await unsnooze.focus();
  await unsnooze.press('Enter');
  await expect(page.getByRole('group', { name: 'Snooze' }).getByRole('button', { name: 'Tomorrow' }))
    .toBeVisible();
  canonical = await (await page.request.get(`/api/tasks/${task.id}`)).json();
  expect(canonical.deferredUntil).toBeNull();
});

test('lost recurring-completion response schedules once and undo cannot duplicate the series', async ({ page }) => {
  const prefix = `task-lifecycle-recurrence-${Date.now()}`;
  const task = await createLifecycleTask(page.request, prefix, {
    dueDate: '2034-05-10',
    dueTime: '09:15',
    recurrence: 'daily',
    labels: ['maintenance'],
  });
  let completionPatchCount = 0;
  await openLifecycleDrawer(page, task);
  await page.route(`**/api/tasks/${task.id}`, async (route) => {
    if (route.request().method() === 'PATCH'
      && route.request().postDataJSON().status === 'completed'
      && completionPatchCount === 0) {
      completionPatchCount += 1;
      await route.fetch();
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'injected lost completion response' }),
      });
      return;
    }
    await route.continue();
  });

  await page.locator('.drawer [data-action="toggle-task-done"]').click();
  await expect(page.locator('.toast')).toContainText('next occurrence scheduled');
  expect(completionPatchCount).toBe(1);
  let instances = (await (await page.request.get('/api/tasks?project=inbox')).json())
    .filter((candidate) => candidate.title === task.title);
  expect(instances).toHaveLength(2);
  const completed = instances.find((candidate) => candidate.id === task.id);
  const successor = instances.find((candidate) => candidate.id !== task.id);
  expect(completed.status).toBe('completed');
  expect(successor.status).toBe('planned');
  expect(successor.dueDate).toBe('2034-05-11');
  expect(successor.dueTime).toBe('09:15');
  expect(successor.labels).toEqual(['maintenance']);

  await expect(page.locator('[data-action="toast-undo"]')).toHaveText('Reopen');
  await page.locator('[data-action="toast-undo"]').click();
  await expect(page.locator('.toast')).toContainText('Reopened as one-off');
  const reopened = await (await page.request.get(`/api/tasks/${task.id}`)).json();
  expect(reopened.status).toBe('planned');
  expect(reopened.recurrence).toBeNull();

  await page.locator('.drawer [data-action="toggle-task-done"]').click();
  await expect(page.locator('.toast')).toContainText('Completed — nice');
  instances = (await (await page.request.get('/api/tasks?project=inbox')).json())
    .filter((candidate) => candidate.title === task.title);
  expect(instances).toHaveLength(2);
});

test('recurring completion stays truthful when successor list refresh fails', async ({ page, request }) => {
  const prefix = `task-lifecycle-refresh-${Date.now()}`;
  const task = await createLifecycleTask(request, prefix, {
    dueDate: '2034-09-20',
    recurrence: 'weekly',
  });
  let completionCommitted = false;
  let collectionFailureInjected = false;
  await openLifecycleDrawer(page, task);
  await page.route('**/api/tasks**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'PATCH'
      && url.pathname === `/api/tasks/${task.id}`
      && route.request().postDataJSON().status === 'completed') {
      const response = await route.fetch();
      completionCommitted = true;
      await route.fulfill({ response });
      return;
    }
    if (route.request().method() === 'GET'
      && url.pathname === '/api/tasks'
      && completionCommitted
      && !collectionFailureInjected) {
      collectionFailureInjected = true;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'injected task collection refresh failure' }),
      });
      return;
    }
    await route.continue();
  });

  await page.locator('.drawer [data-action="toggle-task-done"]').click();
  await expect(page.locator('.toast'))
    .toContainText('Completed — next occurrence scheduled; reload to show it.');
  expect(collectionFailureInjected).toBe(true);
  const instances = (await (await request.get('/api/tasks?project=inbox')).json())
    .filter((candidate) => candidate.title === task.title);
  expect(instances).toHaveLength(2);
  expect(instances.some((candidate) => candidate.status === 'completed')).toBe(true);
  expect(instances.some((candidate) => candidate.status === 'planned')).toBe(true);
});
