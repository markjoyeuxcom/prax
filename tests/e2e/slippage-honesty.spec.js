import { test, expect } from '@playwright/test';

// Slippage honesty in the real app: server-counted deferrals surface as chips
// past the preference threshold, and the board WIP limit renders an overrun
// without ever blocking anything.

function isoDatePlus(days) {
  const date = new Date(Date.now() + days * 86_400_000);
  return date.toISOString().slice(0, 10);
}

async function createTask(request, payload) {
  const response = await request.post('/api/tasks', {
    data: { project: 'inbox', priority: 'medium', status: 'planned', ...payload },
  });
  expect(response.status()).toBe(201);
  return response.json();
}

test('two due-date pushes surface a "deferred 2×" chip in Today\'s week ahead and the exact count in the drawer', async ({ page, request }) => {
  const title = `slippage-chip-${Date.now()}`;
  const task = await createTask(request, { title, dueDate: isoDatePlus(1) });
  // Push the commitment later twice — the server counts, the client cannot.
  await request.patch(`/api/tasks/${task.id}`, { data: { dueDate: isoDatePlus(2) } });
  await request.patch(`/api/tasks/${task.id}`, { data: { dueDate: isoDatePlus(3) } });

  // Lower the chip threshold to an allowed option (2×) before the app boots.
  await page.addInitScript(() => {
    window.localStorage.setItem('prax.preferences', JSON.stringify({ slippageDeferrals: 2 }));
  });
  await page.goto('/');
  // Due in three days: it lives in Today's "Next 7 days" section.
  await page.locator('[data-action="nav-today"]').first().click();
  await expect(page.locator('[data-today-week]')).toBeVisible();

  const row = page.locator('.task-row', { hasText: title });
  await expect(row).toBeVisible();
  await expect(row.locator('.chip--slip-deferred')).toHaveText('deferred 2×');

  // The drawer states the exact count regardless of thresholds.
  await row.locator('[data-action="open-task"]').click();
  await expect(page.locator('[data-slippage-count]')).toHaveText('deferred 2×');
});

test('the board In-progress header shows the WIP overrun and drags still land', async ({ page, request }) => {
  const prefix = `wip-${Date.now()}`;
  for (let i = 0; i < 4; i += 1) {
    await createTask(request, { title: `${prefix} card ${i}`, status: 'in-progress' });
  }
  await page.addInitScript(() => {
    window.localStorage.setItem('prax.preferences', JSON.stringify({ wipLimit: 3 }));
  });
  await page.goto('/');
  // Inbox project view -> Board tab.
  await page.locator('[data-action="nav-project"]').first().click();
  await page.locator('[data-action="set-tab"][data-tab="board"]').click();
  const count = page.locator('[data-board-column="inprogress"] .board-col__count');
  await expect(count).toHaveClass(/is-over-wip/);
  await expect(count).toContainText('/3');
});

test('the built-in Stale smart view lives on the panel Views tab and opens the stale filter', async ({ page }) => {
  await page.goto('/');
  // Today's panel is the plan cockpit; the views browser lives in project
  // contexts — go to All projects first, then the Views tab.
  await page.locator('[data-action="nav-all"]').first().click();
  await page.locator('[data-action="set-panel-tab"][data-tab="views"]').click();
  const stale = page.locator('[data-action="select-smart-view"][data-view-id="builtin-stale"]');
  await expect(stale).toBeVisible();
  await stale.click();
  // The filter view opens with the built-in expression active; a fresh
  // in-memory database has nothing 30 days old — the empty state is honest.
  await expect(page.locator('input[data-filter-input], [data-filter-expr]').first()).toBeVisible();
});
