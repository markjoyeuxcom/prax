import { test, expect } from '@playwright/test';

test.use({
  viewport: { width: 320, height: 800 },
  hasTouch: true,
  isMobile: true,
});

async function createTask(request, title, overrides = {}) {
  const response = await request.post('/api/tasks', {
    data: {
      title,
      description: 'Narrow and touch production-path fixture',
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

async function openInbox(page) {
  const projects = await (await page.request.get('/api/projects')).json();
  const inbox = projects.find((project) => project.slug === 'inbox');
  await page.goto('/');
  await page.locator(`[data-action="nav-project"][data-project-id="${inbox.id}"]`).first().click();
  return inbox;
}

async function expectNoContentOverflow(page, label) {
  const measurement = await page.locator('.main__scroll').evaluate((scroll) => ({
    clientWidth: scroll.clientWidth,
    scrollWidth: scroll.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(
    measurement.scrollWidth,
    `${label} main content overflows horizontally: ${JSON.stringify(measurement)}`,
  ).toBeLessThanOrEqual(measurement.clientWidth + 1);
  expect(
    measurement.documentWidth,
    `${label} document overflows horizontally: ${JSON.stringify(measurement)}`,
  ).toBeLessThanOrEqual(measurement.viewportWidth + 1);
}

test('core task views reflow at 400%-equivalent width and board columns stack in order', async ({ page }) => {
  const prefix = `human-reflow-${Date.now()}`;
  const planned = await createTask(page.request, `${prefix} planned`);
  const backlog = await createTask(page.request, `${prefix} backlog`, { status: 'notes' });
  const archived = await createTask(page.request, `${prefix} archived`);
  const archiveResponse = await page.request.delete(`/api/tasks/${archived.id}`);
  expect(archiveResponse.ok()).toBe(true);

  await openInbox(page);
  await expect(page.locator('.task-row', { hasText: planned.title })).toBeVisible();
  await expectNoContentOverflow(page, 'task list');

  await page.locator('[data-action="set-tab"][data-tab="board"]').tap();
  await expect(page.locator('.board')).toBeVisible();
  await expectNoContentOverflow(page, 'task board');
  const columnBoxes = await page.locator('.board-col').evaluateAll((columns) => columns.map((column) => {
    const rect = column.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width };
  }));
  expect(columnBoxes).toHaveLength(4);
  for (let index = 1; index < columnBoxes.length; index += 1) {
    expect(Math.abs(columnBoxes[index].x - columnBoxes[0].x)).toBeLessThanOrEqual(1);
    expect(columnBoxes[index].y).toBeGreaterThan(columnBoxes[index - 1].y);
  }

  await page.locator('[data-action="set-tab"][data-tab="backlog"]').tap();
  await expect(page.locator('.plain-row', { hasText: backlog.title })).toBeVisible();
  await expectNoContentOverflow(page, 'backlog');

  await page.locator('[data-action="set-tab"][data-tab="archive"]').tap();
  await expect(page.locator('.plain-row', { hasText: archived.title })).toBeVisible();
  await expectNoContentOverflow(page, 'archive');
});

test('touch users can select tasks explicitly and complete them in bulk', async ({ page }) => {
  const prefix = `human-touch-${Date.now()}`;
  const first = await createTask(page.request, `${prefix} first`);
  const second = await createTask(page.request, `${prefix} second`);

  await openInbox(page);
  const firstSelect = page.getByRole('button', { name: `Select ${first.title}`, exact: true });
  const secondSelect = page.getByRole('button', { name: `Select ${second.title}`, exact: true });
  await expect(firstSelect).toBeVisible();
  await expect(secondSelect).toBeVisible();
  await firstSelect.tap();
  await secondSelect.tap();
  await expect(page.getByRole('toolbar', { name: 'Bulk actions' })).toContainText('2 selected');
  await expectNoContentOverflow(page, 'bulk toolbar');

  await page.getByRole('button', { name: 'Complete', exact: true }).tap();
  await expect(page.locator('.toast')).toContainText('2 tasks → Completed');
  for (const task of [first, second]) {
    const canonical = await (await page.request.get(`/api/tasks/${task.id}`)).json();
    expect(canonical.status).toBe('completed');
  }
  await expect(page.getByRole('toolbar', { name: 'Bulk actions' })).toHaveCount(0);
});

test('operating-system reduced motion removes production animation and transition durations', async ({ page }) => {
  const task = await createTask(page.request, `human-motion-${Date.now()}`);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openInbox(page);
  await expect(page.locator('.task-row', { hasText: task.title })).toBeVisible();

  const styles = await page.locator('.main__scroll, .task-row').evaluateAll((elements) => elements.map((element) => {
    const style = getComputedStyle(element);
    return {
      animationDuration: style.animationDuration,
      transitionDuration: style.transitionDuration,
    };
  }));
  expect(styles.length).toBeGreaterThan(1);
  for (const style of styles) {
    expect(style.animationDuration).toBe('0s');
    expect(style.transitionDuration).toBe('0s');
  }
});
