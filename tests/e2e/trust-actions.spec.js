import { test, expect } from '@playwright/test';
import { seedTrustPair } from './helpers/seed.js';

// Open the library view and click the row whose title contains `titleText`.
async function openLibraryDoc(page, titleText) {
  await page.goto('/');
  await page.locator('[data-view="library"]').first().click();
  const row = page.locator('.document-row', { hasText: titleText });
  await expect(row).toBeVisible();
  await row.click();
}

test('a human can verify a document from the detail panel', async ({ page }) => {
  const prefix = `trust-verify-${Date.now()}`;
  await seedTrustPair(page.request, prefix);

  await openLibraryDoc(page, `${prefix} primary`);

  const detail = page.locator('.library-detail');
  // Wait for the initial loadDocumentLinks to settle before triggering verify,
  // to avoid a race where the stale links re-render overwrites the post-verify state.
  await expect(detail.locator('.document-links')).toBeVisible();
  await expect(detail.locator('[data-action="toggle-verify"]')).toContainText('verify');

  await detail.locator('[data-action="toggle-verify"]').click();

  await expect(detail.locator('.chip-verified')).toBeVisible();
  await expect(detail.locator('.library-detail-meta')).toContainText('verified');
  await expect(detail.locator('[data-action="toggle-verify"]')).toContainText('unverify');
});

test('a human can supersede a document by picking a replacement', async ({ page }) => {
  const prefix = `trust-supersede-${Date.now()}`;
  await seedTrustPair(page.request, prefix);

  await openLibraryDoc(page, `${prefix} primary`);

  await page.locator('[data-action="supersede-document"]').click();
  const picker = page.locator('[data-link-picker]');
  await expect(picker).toBeVisible();
  await expect(picker.locator('#link-picker-title')).toContainText('Supersede');
  await picker.locator('[data-link-picker-doc]', { hasText: `${prefix} replacement` }).click();

  const detail = page.locator('.library-detail');
  await expect(detail.locator('.chip-superseded')).toBeVisible();
  await expect(detail.locator('.library-detail-meta')).toContainText('superseded');
  await expect(page.locator('.document-row.is-superseded', { hasText: `${prefix} primary` })).toBeVisible();

  await expect(detail.locator('[data-action="supersede-document"]')).toHaveCount(0);

  const links = detail.locator('.document-links');
  await expect(links).toContainText('Backlinks');
  await expect(links).toContainText(`${prefix} replacement`);
});
