import { test, expect } from '@playwright/test';
import { seedStalePair, resolveProjectId } from './helpers/seed.js';

async function openMaintenance(page) {
  await page.goto('/');
  // Maintenance lives in Settings ▸ Data & admin now.
  await page.locator('[data-action="nav-settings"]').first().click();
  await page.locator('[data-action="set-settings-tab"][data-tab="data"]').click();
  await expect(page.getByText('MAINTENANCE', { exact: true })).toBeVisible();
}

test('Maintenance shows stale docs', async ({ page }) => {
  const stalePrefix = `maint-stale-${Date.now()}`;
  await seedStalePair(page.request, stalePrefix);

  await openMaintenance(page);

  await expect(page.getByText(`${stalePrefix} synthesized`)).toBeVisible();
});

test('Maintenance Open navigates to the correct doc', async ({ page }) => {
  const prefix = `maint-open-${Date.now()}`;
  const { synthesized } = await seedStalePair(page.request, prefix);

  await openMaintenance(page);

  await page
    .locator(`[data-action="open-library-doc"][data-library-document-id="${synthesized.id}"]`)
    .first()
    .click();

  // The editor opens on exactly that doc — its title fills the editable title
  // input, and the Links section renders once fetched.
  await expect(page.locator('[data-doc-title]')).toHaveValue(`${prefix} synthesized`);
  await expect(page.locator('[data-document-links]')).toBeVisible();
});

test('Maintenance project filter scopes the lists', async ({ page }) => {
  const homelabPrefix = `maint-filter-hl-${Date.now()}`;
  const workPrefix = `maint-filter-wk-${Date.now()}`;
  await seedStalePair(page.request, homelabPrefix); // homelab project
  await seedStalePair(page.request, workPrefix, 'work');

  await openMaintenance(page);

  const homelabId = await resolveProjectId(page.request, 'homelab');
  await page.locator('[data-maintenance-project-filter]').selectOption(homelabId);
  await page.locator('[data-action="refresh-maintenance"]').click();

  await expect(page.getByText(`${homelabPrefix} synthesized`)).toBeVisible();
  await expect(page.getByText(`${workPrefix} synthesized`)).toHaveCount(0);
});
