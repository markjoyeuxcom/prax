import { test, expect } from '@playwright/test';

test('approved assistant write remains visibly committed when its follow-up fails', async ({ page }) => {
  const title = `Assistant partial success ${Date.now()}`;

  const configured = await page.request.put('/api/settings/ai-answers', {
    data: { backend: 'fake' },
  });
  expect(configured.ok()).toBe(true);

  const projectsResponse = await page.request.get('/api/projects?status=all');
  expect(projectsResponse.ok()).toBe(true);
  const projects = await projectsResponse.json();
  const inbox = projects.find((project) => project.slug === 'inbox');
  expect(inbox).toBeTruthy();

  await page.goto('/');
  await page.locator('[data-action="open-assistant"]').click();
  const input = page.locator('[data-assistant-input]');
  await expect(input).toBeEnabled();
  await input.fill(`call_fail_after create_task ${JSON.stringify({
    title,
    project: 'inbox',
    priority: 'high',
    status: 'planned',
  })}`);
  await page.locator('[data-action="assistant-send"]').click();

  await expect(page.locator('.asst__confirm')).toContainText(title);
  await page.locator('[data-action="assistant-approve"]').click();

  const tool = page.locator('.asst__tool').filter({ hasText: 'create_task' });
  await expect(tool.locator('.asst__tool-badge')).toHaveText('done');
  const notice = page.locator('[data-assistant-outcome="partial"]');
  await expect(notice).toHaveAttribute('role', 'status');
  await expect(notice).toContainText('approved change completed');
  await expect(notice).toContainText('workspace is refreshed');
  await expect(notice).toContainText('Do not repeat');
  await expect(page.locator('[data-action="assistant-approve"]')).toHaveCount(0);
  await expect(input).toBeEnabled();

  const tasksResponse = await page.request.get(`/api/tasks?project=${encodeURIComponent(inbox.id)}`);
  expect(tasksResponse.ok()).toBe(true);
  const tasks = await tasksResponse.json();
  expect(tasks.filter((task) => task.title === title)).toHaveLength(1);

  // Project navigation does not fetch tasks. Seeing the new task here proves
  // the assistant outcome waited for and installed the refreshed client cache.
  await page.locator('.asst__head [data-action="close-assistant"]').click();
  await page.locator(`[data-action="nav-project"][data-project-id="${inbox.id}"]`).first().click();
  await expect(page.locator('.task-row__title', { hasText: title })).toBeVisible();
});
