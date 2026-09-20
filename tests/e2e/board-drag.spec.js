import { test, expect } from '@playwright/test';
import { resolveProjectId } from './helpers/seed.js';

// Dragging a card to another lane persists the new status: the drop lands
// the card in that column and the API agrees. (HTML5 drag and drop, which
// Playwright drives for real in Chromium.)

test('a board card dragged to another lane stays there and the task takes that status', async ({ page, request }) => {
  const projectId = await resolveProjectId(request, 'homelab');
  const title = `drag-${Date.now()}`;
  const created = await request.post('/api/tasks', { data: { title, project: projectId, status: 'planned', priority: 'medium' } });
  expect(created.ok()).toBe(true);
  const task = await created.json();

  await page.goto('/');
  await page.locator(`[data-action="nav-project"][data-project-id="${projectId}"]`).first().click();
  await page.locator('[data-action="set-tab"][data-tab="board"]').click();
  const card = page.locator('[data-board-column="planned"] .board-card', { hasText: title });
  await expect(card).toBeVisible();

  await card.dragTo(page.locator('[data-board-column="inprogress"]'));

  await expect(page.locator('[data-board-column="inprogress"] .board-card', { hasText: title })).toBeVisible();
  await expect(page.locator('.toast')).toContainText('Moved to');
  await expect.poll(async () => (await (await request.get(`/api/tasks/${task.id}`)).json()).status).toBe('in-progress');
});
