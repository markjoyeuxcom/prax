import { test, expect } from '@playwright/test';
import { seedStalePair, seedOrphan, resolveProjectId } from './helpers/seed.js';

async function openMaintenance(page) {
  await page.goto('/');
  // The topbar admin button is the in-viewport one (the hamburger-drawer copy
  // is off-screen until the drawer is opened). Scope to .topbar-actions to
  // avoid resolving to the off-screen duplicate.
  await page.locator('.topbar-actions [data-action="open-admin"]').click();
  await expect(page.locator('#library-maintenance-title')).toBeVisible();
}

test('Maintenance shows stale and orphan docs', async ({ page }) => {
  const stalePrefix = `maint-stale-${Date.now()}`;
  const orphanPrefix = `maint-orphan-${Date.now()}`;
  await seedStalePair(page.request, stalePrefix);
  await seedOrphan(page.request, orphanPrefix);

  await openMaintenance(page);

  // The stale synthesized doc appears in the maintenance panel.
  await expect(page.getByText(`${stalePrefix} synthesized`)).toBeVisible();
  // The orphan appears too.
  await expect(page.getByText(`${orphanPrefix} orphan`)).toBeVisible();
});

test('Maintenance [open] navigates to the correct doc', async ({ page }) => {
  const prefix = `maint-open-${Date.now()}`;
  const { synthesized } = await seedStalePair(page.request, prefix);

  await openMaintenance(page);

  // Click the [open] button for the stale synthesized doc.
  await page
    .locator(`[data-action="open-library-doc"][data-library-document-id="${synthesized.id}"]`)
    .first()
    .click();

  // The library workspace opens to that doc — its title shows in the detail
  // header, and the Links section (which only the detail panel renders) is
  // visible. Locating by the unique title proves we landed on the right doc,
  // not a fallback row.
  await expect(page.locator('.library-detail').getByText(`${prefix} synthesized`)).toBeVisible();
  await expect(page.locator('.document-links')).toBeVisible();
});

test('Maintenance project filter scopes the lists', async ({ page }) => {
  const homelabPrefix = `maint-filter-hl-${Date.now()}`;
  const workPrefix = `maint-filter-wk-${Date.now()}`;
  await seedStalePair(page.request, homelabPrefix); // homelab project
  await seedOrphan(page.request, workPrefix);       // work project

  await openMaintenance(page);

  // Switch the maintenance filter to the homelab project, then refresh.
  const homelabId = await resolveProjectId(page.request, 'homelab');
  await page.locator('[data-maintenance-project-filter]').selectOption(homelabId);
  await page.locator('[data-action="refresh-maintenance"]').click();

  // The homelab stale doc shows; the work orphan does not.
  await expect(page.getByText(`${homelabPrefix} synthesized`)).toBeVisible();
  await expect(page.getByText(`${workPrefix} orphan`)).toHaveCount(0);
});
