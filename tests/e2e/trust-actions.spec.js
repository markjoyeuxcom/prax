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

test('a human can verify an unverified document from the detail panel', async ({ page }) => {
  const prefix = `trust-verify-${Date.now()}`;
  await seedTrustPair(page.request, prefix);

  await openLibraryDoc(page, `${prefix} primary`);

  const detail = page.locator('.library-detail');
  const verifyBtn = detail.locator('[data-action="toggle-verify"]');

  // The seeded (agent-written) doc starts unverified — exact text, no substring coincidence.
  await expect(verifyBtn).toHaveText('[v] verify');
  await expect(detail.locator('.chip-verified')).toHaveCount(0);
  await expect(detail.locator('.library-detail-meta')).toContainText('unverified');

  // Let the doc's links load so a late re-render can't swallow the click.
  await expect(detail.locator('.document-links')).toBeVisible();
  await verifyBtn.click();

  // Verifying flips the button label (this gates on the reload), shows the chip, updates meta.
  await expect(verifyBtn).toHaveText('[v] unverify');
  await expect(detail.locator('.chip-verified')).toBeVisible();
  await expect(detail.locator('.library-detail-meta')).toContainText('verified by');
});

test('a human can supersede a document by picking a replacement', async ({ page }) => {
  const prefix = `trust-supersede-${Date.now()}`;
  await seedTrustPair(page.request, prefix);

  await openLibraryDoc(page, `${prefix} primary`);

  const detail = page.locator('.library-detail');
  await expect(detail.locator('.document-links')).toBeVisible();
  await detail.locator('[data-action="supersede-document"]').click();

  const picker = page.locator('[data-link-picker]');
  await expect(picker).toBeVisible();
  await expect(picker.locator('#link-picker-title')).toContainText('Supersede');
  await picker.locator('[data-link-picker-doc]', { hasText: `${prefix} replacement` }).click();

  // The old (still-selected) doc flips to superseded: chip + meta + dimmed row, button gone.
  await expect(detail.locator('.chip-superseded')).toBeVisible();
  await expect(detail.locator('.library-detail-meta')).toContainText('superseded');
  await expect(page.locator('.document-row.is-superseded', { hasText: `${prefix} primary` })).toBeVisible();
  await expect(detail.locator('[data-action="supersede-document"]')).toHaveCount(0);

  // The replacement appears under Backlinks (the supersede link is new -> old, inbound on the old doc).
  const links = detail.locator('.document-links');
  await expect(links).toContainText('Backlinks');
  await expect(links).toContainText(`${prefix} replacement`);
});
