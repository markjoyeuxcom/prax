import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';

for (const width of [1440, 360]) {
  test(`system project controls and purpose remain clear at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const projects = await (await request.get('/api/projects')).json();
    const inbox = projects.find(p => p.slug === 'inbox');
    await page.goto('/');
    const pinnedInbox = page.locator(`[data-action="nav-project"][data-project-id="${inbox.id}"]`).first();
    await pinnedInbox.focus();
    await pinnedInbox.press('Enter');
    await expect(page.locator('.page-head__title')).toHaveText('Inbox');
    await expect(page.locator('.page-head .chip--system')).toHaveText('System · capture and review');
    await expect(page.locator('.view-hint')).toContainText('owning project');
    await expect(page.locator('[data-action="rename-project"], .page-head__ops-toggle, .proj-ops')).toHaveCount(0);

    for (const theme of ['light', 'dark']) {
      await page.locator('body').evaluate((body, value) => body.setAttribute('data-theme', value), theme);
      const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      expect(audit.violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }

    await page.locator('[data-action="nav-all"]').first().click();
    for (const slug of ['inbox', 'memory']) {
      const project = projects.find(p => p.slug === slug);
      const card = page.locator(`.proj-card[data-project-id="${project.id}"]`);
      await expect(card.locator('.chip--system')).toContainText('System');
      await expect(card.locator('[data-action="delete-project"], [data-action="set-project-state"]')).toHaveCount(0);
    }
    const memory = projects.find(p => p.slug === 'memory');
    await page.locator(`.proj-card[data-project-id="${memory.id}"]`).click();
    await expect(page.locator('.page-head .chip--system')).toHaveText('System · shared guidance');
    await expect(page.locator('[data-action="rename-project"], .page-head__ops-toggle, .proj-ops')).toHaveCount(0);
    await page.locator('[data-action="nav-all"]').first().click();
    const work = projects.find(p => p.slug === 'work');
    await page.locator(`.proj-card[data-project-id="${work.id}"]`).click();
    await expect(page.locator('[data-action="rename-project"]')).toBeVisible();
    await expect(page.locator('.page-head__ops-toggle')).toBeVisible();
  });
}

test('context-free capture defaults to Inbox and can be filed into an owning project', async ({ page, request }) => {
  const projects = await (await request.get('/api/projects')).json();
  const inbox = projects.find(p => p.slug === 'inbox');
  const work = projects.find(p => p.slug === 'work');
  const title = `Inbox capture ${randomUUID()}`;
  await page.goto('/');
  await page.locator('[data-action="nav-all"]').first().click();
  await page.locator('[data-action="toggle-new-menu"]').click();
  await page.locator('[data-action="open-capture"]').click();
  const dialog = page.getByRole('dialog', { name: 'Quick capture' });
  await expect(dialog.locator('[data-action="toggle-capture-menu"]')).toContainText('Inbox');
  await dialog.getByLabel('Task title').fill(title);
  await dialog.getByLabel('Task title').press('Enter');
  await expect(dialog).not.toBeVisible();
  const tasks = await (await request.get('/api/tasks?project=inbox')).json();
  const task = tasks.find(t => t.title === title);
  expect(task?.projectId).toBe(inbox.id);
  await page.locator(`[data-action="nav-project"][data-project-id="${inbox.id}"]`).first().click();
  await page.locator('.task-row', { hasText: title }).click();
  await page.locator('[data-task-project]').selectOption(work.id);
  await expect.poll(async () => (await (await request.get(`/api/tasks/${task.id}`)).json()).projectId).toBe(work.id);
  await page.keyboard.press('Escape');
  await expect(page.locator('.task-row', { hasText: title })).toHaveCount(0);
});
