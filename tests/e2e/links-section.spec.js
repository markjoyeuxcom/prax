import { test, expect } from '@playwright/test';
import { seedDerivedFromPair, seedOrphan } from './helpers/seed.js';

// Open the library view and click the row whose title contains `titleText`.
async function openLibraryDoc(page, titleText) {
  await page.goto('/');
  await page.locator('[data-view="library"]').first().click();
  const row = page.locator('.document-row', { hasText: titleText });
  await expect(row).toBeVisible();
  await row.click();
}

test('Links section is visible on first load of a linked doc', async ({ page }) => {
  const prefix = `links-first-${Date.now()}`;
  await seedDerivedFromPair(page.request, prefix);

  await openLibraryDoc(page, `${prefix} synthesized`);

  // The regression: the Links section must be visible immediately, without a
  // mode switch. toBeVisible() checks real geometry, catching both the CSS
  // clip and the stale-DOM re-render failure modes.
  const links = page.locator('.document-links');
  await expect(links).toBeVisible();
  await expect(links).toContainText('Derived from');
  await expect(links).toContainText(`${prefix} source`);
});

test('Links section stays visible across every detail mode', async ({ page }) => {
  const prefix = `links-modes-${Date.now()}`;
  await seedDerivedFromPair(page.request, prefix);
  await openLibraryDoc(page, `${prefix} synthesized`);

  const links = page.locator('.document-links');
  await expect(links).toBeVisible();

  // edit
  await page.locator('[data-library-mode="edit"]').click();
  await expect(links).toBeVisible();

  // focus (focus button lives inside the editor pane, only rendered in edit /
  // split mode — test it here while still in edit mode before switching away)
  await page.locator('[data-action="toggle-document-focus"]').click();
  await expect(links).toBeVisible();
  // exit focus mode
  await page.locator('[data-action="toggle-document-focus"]').click();

  // split
  await page.locator('[data-library-mode="split"]').click();
  await expect(links).toBeVisible();

  // info-edit: the info form replaces the document workspace but the Links
  // section is rendered outside that conditional, so it must stay visible.
  // Exit info-edit via cancel before the next assertion.
  await page.locator('[data-action="edit-document-info"]').click();
  await expect(links).toBeVisible();
  await page.locator('[data-action="cancel-document-info"]').click();

  // preview
  await page.locator('[data-library-mode="preview"]').click();
  await expect(links).toBeVisible();
});

test('Backlinks show the deriving doc on the source', async ({ page }) => {
  const prefix = `links-back-${Date.now()}`;
  await seedDerivedFromPair(page.request, prefix);
  await openLibraryDoc(page, `${prefix} source`);

  const links = page.locator('.document-links');
  await expect(links).toBeVisible();
  await expect(links).toContainText('Backlinks');
  await expect(links).toContainText(`${prefix} synthesized`);
});

test('Links section renders an empty state for an orphan doc', async ({ page }) => {
  const prefix = `links-orphan-${Date.now()}`;
  await seedOrphan(page.request, prefix);
  await openLibraryDoc(page, `${prefix} orphan`);

  const links = page.locator('.document-links');
  await expect(links).toBeVisible();
  await expect(links).toContainText('No links');
});
