import { test, expect } from '@playwright/test';

// Console shell (2026-10): on a wide window the task drawer docks beside the
// list as a non-modal inspector. The list stays live, ↓ moves the selection
// and the inspector follows it, and Escape still closes it.
test.use({ viewport: { width: 1440, height: 900 } });

test('the docked inspector follows the list selection and never traps focus', async ({ page, request }) => {
  const stamp = Date.now();
  const project = await (await request.post('/api/projects', { data: { name: `Inspector ${stamp}` } })).json();
  const titles = ['First inspected', 'Second inspected', 'Third inspected'].map((title) => `${title} ${stamp}`);
  for (const title of titles) {
    const created = await request.post('/api/tasks', { data: { title, project: project.id, status: 'planned', priority: 'medium' } });
    expect(created.ok()).toBeTruthy();
  }

  await page.goto('/');
  await page.locator(`.panel [data-action="nav-project"][data-project-id="${project.id}"]`).click();
  await page.locator('.task-row__open', { hasText: titles[0] }).click();

  const inspector = page.locator('.drawer--docked');
  await expect(inspector).toBeVisible();
  await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
  await expect(page.locator('.scrim')).toHaveCount(0);
  const firstId = await inspector.getAttribute('data-task-id');

  // Focus leaves the row button (buttons keep their own keys), then ↓ moves
  // the selection and the inspector with it.
  await page.locator('.page-head__title, h1').first().click();
  await page.keyboard.press('ArrowDown');
  await expect(inspector).not.toHaveAttribute('data-task-id', firstId);
  await expect(page.locator('[data-task-title]')).toHaveValue(/inspected/);

  // The list is not inert behind it: another row opens directly.
  await page.locator('.task-row__open', { hasText: titles[2] }).click();
  await expect(page.locator('[data-task-title]')).toHaveValue(titles[2]);

  await page.keyboard.press('Escape');
  await expect(inspector).toHaveCount(0);
});

test('a narrower window keeps the modal drawer', async ({ page, request }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  const stamp = Date.now();
  const project = await (await request.post('/api/projects', { data: { name: `Modal ${stamp}` } })).json();
  await request.post('/api/tasks', { data: { title: `Modal task ${stamp}`, project: project.id, status: 'planned', priority: 'medium' } });
  await page.goto('/');
  await page.locator(`.panel [data-action="nav-project"][data-project-id="${project.id}"]`).click();
  await page.locator('.task-row__open', { hasText: `Modal task ${stamp}` }).click();
  await expect(page.locator('.drawer[aria-modal="true"]')).toBeVisible();
  await expect(page.locator('.drawer--docked')).toHaveCount(0);
});
