import { test, expect } from '@playwright/test';
import { seedStalePair, seedOrphan } from './helpers/seed.js';

async function gotoLibrary(page) {
  await page.goto('/');
  await page.locator('[data-view="library"]').first().click();
}

test('synthesized + stale row shows SYNTH and STALE chips', async ({ page }) => {
  const prefix = `chips-${Date.now()}`;
  await seedStalePair(page.request, prefix);
  await gotoLibrary(page);

  const row = page.locator('.document-row', { hasText: `${prefix} synthesized` });
  await expect(row).toBeVisible();
  await expect(row.locator('.chip-synth')).toBeVisible();
  await expect(row.locator('.chip-stale')).toBeVisible();
});

test('plain source row shows neither chip', async ({ page }) => {
  const prefix = `chips-plain-${Date.now()}`;
  await seedOrphan(page.request, prefix);
  await gotoLibrary(page);

  const row = page.locator('.document-row', { hasText: `${prefix} orphan` });
  await expect(row).toBeVisible();
  await expect(row.locator('.chip-synth')).toHaveCount(0);
  await expect(row.locator('.chip-stale')).toHaveCount(0);
});
