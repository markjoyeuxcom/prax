import { test, expect } from '@playwright/test';
import { seedStalePair, seedOrphan } from './helpers/seed.js';

async function gotoLibrary(page) {
  await page.goto('/');
  await page.locator('[data-action="nav-library"]').first().click();
}

test('synthesized + stale card shows SYNTH and STALE chips', async ({ page }) => {
  const prefix = `chips-${Date.now()}`;
  await seedStalePair(page.request, prefix);
  await gotoLibrary(page);

  const card = page.locator('.doc-card', { hasText: `${prefix} synthesized` });
  await expect(card).toBeVisible();
  await expect(card.locator('.chip--synth')).toBeVisible();
  await expect(card.locator('.chip--stale')).toBeVisible();
});

test('plain source card shows neither chip', async ({ page }) => {
  const prefix = `chips-plain-${Date.now()}`;
  await seedOrphan(page.request, prefix);
  await gotoLibrary(page);

  const card = page.locator('.doc-card', { hasText: `${prefix} orphan` });
  await expect(card).toBeVisible();
  await expect(card.locator('.chip--synth')).toHaveCount(0);
  await expect(card.locator('.chip--stale')).toHaveCount(0);
});
