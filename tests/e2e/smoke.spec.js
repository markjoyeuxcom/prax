import { test, expect } from '@playwright/test';

test('app shell loads without console errors', async ({ page }) => {
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto('/');

  // The shell renders the sidebar with a Library nav entry.
  await expect(page.locator('[data-action="nav-library"]').first()).toBeVisible();

  // No uncaught console errors during initial load.
  expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);
});
