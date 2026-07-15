import { test, expect } from '@playwright/test';

async function projectsBySlug(request) {
  const response = await request.get('/api/projects');
  expect(response.ok()).toBe(true);
  const projects = await response.json();
  return Object.fromEntries(projects.map(project => [project.slug, project]));
}

async function openCapture(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'New task', exact: true }).first().click();
  await expect(page.getByRole('dialog', { name: 'Quick capture' })).toBeVisible();
}

async function chooseCaptureProject(page, name) {
  await page.getByRole('button', { name: /Choose destination project/ }).click();
  await page.getByRole('option', { name }).click();
}

async function tasksWithTitle(request, title) {
  const response = await request.get(`/api/tasks?q=${encodeURIComponent(title)}`);
  expect(response.ok()).toBe(true);
  return (await response.json()).filter(task => task.title === title);
}

test('capture organizes shorthand fields and the drawer can reassign project and labels', async ({ page, request }) => {
  const prefix = `task-capture-organize-${Date.now()}`;
  const title = `${prefix} release`;
  const projects = await projectsBySlug(request);
  await openCapture(page);
  await chooseCaptureProject(page, 'Work');
  await page.getByLabel('Task title').fill(`${title} @Waiting !high 2032-08-19`);
  await page.getByRole('button', { name: 'Add task', exact: true }).click();

  await expect(page.getByRole('dialog', { name: 'Quick capture' })).toHaveCount(0);
  await expect(page.locator('.toast')).toContainText('Added to Work');
  let matches = await tasksWithTitle(request, title);
  expect(matches).toHaveLength(1);
  expect(matches[0]).toMatchObject({
    title,
    projectId: projects.work.id,
    priority: 'high',
    status: 'planned',
    dueDate: '2032-08-19',
    labels: ['waiting'],
  });

  const task = matches[0];
  await page.locator(`[data-action="nav-project"][data-project-id="${projects.work.id}"]`).first().click();
  await page.locator('.task-row', { hasText: title }).click();
  const drawer = page.locator(`.drawer[data-task-id="${task.id}"]`);
  await expect(drawer).toBeVisible();
  let projectPatchCount = 0;
  await page.route(`**/api/tasks/${task.id}`, async (route) => {
    if (route.request().method() === 'PATCH'
      && route.request().postDataJSON().project === projects.personal.id) {
      projectPatchCount += 1;
      await route.fetch();
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'injected lost project response' }),
      });
      return;
    }
    await route.continue();
  });
  await drawer.getByLabel('Project').selectOption(projects.personal.id);
  await expect(drawer.getByLabel('Project')).toHaveValue(projects.personal.id);
  expect(projectPatchCount).toBe(1);
  await drawer.getByLabel('Add label').fill('@PagerDuty');
  await drawer.getByLabel('Add label').press('Enter');

  await expect.poll(async () => {
    const response = await request.get(`/api/tasks/${task.id}`);
    const stored = await response.json();
    return { projectId: stored.projectId, labels: stored.labels };
  }).toEqual({ projectId: projects.personal.id, labels: ['waiting', 'pagerduty'] });
});

test('a lost create response is acknowledged by id without replaying the POST', async ({ page, request }) => {
  const prefix = `task-capture-lost-${Date.now()}`;
  const title = `${prefix} exact once`;
  let postCount = 0;
  let taskId = null;
  await openCapture(page);
  await page.route('**/api/tasks**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'POST' && url.pathname === '/api/tasks') {
      postCount += 1;
      taskId = route.request().postDataJSON().id;
      await route.fetch();
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'injected lost create response' }),
      });
      return;
    }
    await route.continue();
  });

  await page.getByLabel('Task title').fill(title);
  await page.getByLabel('Task title').press('Enter');
  await expect(page.getByRole('dialog', { name: 'Quick capture' })).toHaveCount(0);
  await expect(page.locator('.toast')).toContainText('Added to Inbox');
  expect(postCount).toBe(1);
  expect(taskId).toMatch(/^[0-9a-f-]{36}$/);
  const matches = await tasksWithTitle(request, title);
  expect(matches).toHaveLength(1);
  expect(matches[0].id).toBe(taskId);
  expect(await page.evaluate(() => localStorage.getItem('prax.taskCaptureRecovery.v1'))).toBeNull();
});

test('pending capture cannot be edited, dismissed, or submitted twice', async ({ page }) => {
  const title = `task-capture-pending-${Date.now()}`;
  let releaseCreate;
  let markCreateStarted;
  let postCount = 0;
  const createGate = new Promise(resolve => { releaseCreate = resolve; });
  const createStarted = new Promise(resolve => { markCreateStarted = resolve; });
  await openCapture(page);
  await page.route('**/api/tasks**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'POST' && url.pathname === '/api/tasks') {
      postCount += 1;
      markCreateStarted();
      await createGate;
    }
    await route.continue();
  });

  await page.getByLabel('Task title').fill(title);
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  await createStarted;
  const dialog = page.getByRole('dialog', { name: 'Quick capture' });
  await expect(dialog).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByLabel('Task title')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Adding…' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await page.locator('[data-overlay="capture"]').click({ position: { x: 2, y: 2 } });
  await expect(dialog).toBeVisible();
  expect(postCount).toBe(1);

  releaseCreate();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.toast')).toContainText('Added to Inbox');
  expect(postCount).toBe(1);
});

test('acknowledged capture stays successful when the collection refresh fails', async ({ page, request }) => {
  const prefix = `task-capture-refresh-${Date.now()}`;
  const title = `${prefix} committed`;
  let committed = false;
  let refreshFailed = false;
  await openCapture(page);
  await chooseCaptureProject(page, 'Work');
  await page.route('**/api/tasks**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'POST' && url.pathname === '/api/tasks') {
      const response = await route.fetch();
      committed = true;
      await route.fulfill({ response });
      return;
    }
    if (route.request().method() === 'GET' && url.pathname === '/api/tasks' && committed && !refreshFailed) {
      refreshFailed = true;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'injected collection refresh failure' }),
      });
      return;
    }
    await route.continue();
  });

  await page.getByLabel('Task title').fill(title);
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Quick capture' })).toHaveCount(0);
  await expect(page.locator('.toast')).toContainText('Added to Work; reload to show it.');
  expect(refreshFailed).toBe(true);
  expect(await tasksWithTitle(request, title)).toHaveLength(1);
});

test('failed capture survives reload and retries with the same creation identity', async ({ page, request }) => {
  const prefix = `task-capture-recovery-${Date.now()}`;
  const title = `${prefix} safe retry`;
  let postCount = 0;
  const requestIds = [];
  await openCapture(page);
  await chooseCaptureProject(page, 'Work');
  await page.route('**/api/tasks**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'POST' && url.pathname === '/api/tasks') {
      postCount += 1;
      requestIds.push(route.request().postDataJSON().id);
      if (postCount === 1) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'injected pre-commit create failure' }),
        });
        return;
      }
    }
    await route.continue();
  });

  await page.getByLabel('Task title').fill(`${title} @waiting !high`);
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not confirm creation');
  await expect(page.getByLabel('Task title')).toHaveValue(`${title} @waiting !high`);
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem('prax.taskCaptureRecovery.v1')))).toBe(true);

  await page.reload();
  await expect(page.getByRole('dialog', { name: 'Quick capture' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Recovered unfinished task');
  await expect(page.getByLabel('Task title')).toHaveValue(`${title} @waiting !high`);
  await expect(page.getByRole('button', { name: /Choose destination project, current Work/ })).toBeVisible();
  await page.getByRole('button', { name: 'Add task', exact: true }).click();

  await expect(page.getByRole('dialog', { name: 'Quick capture' })).toHaveCount(0);
  expect(postCount).toBe(2);
  expect(requestIds[1]).toBe(requestIds[0]);
  const matches = await tasksWithTitle(request, title);
  expect(matches).toHaveLength(1);
  expect(matches[0]).toMatchObject({ id: requestIds[0], priority: 'high', labels: ['waiting'] });
  expect(await page.evaluate(() => localStorage.getItem('prax.taskCaptureRecovery.v1'))).toBeNull();
});
