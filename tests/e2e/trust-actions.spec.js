import { test, expect } from '@playwright/test';
import { seedTrustPair } from './helpers/seed.js';

// Open the library and click the card whose title contains `titleText` —
// documents open in the editor screen.
async function openLibraryDoc(page, titleText) {
  await page.goto('/');
  await page.locator('[data-action="nav-library"]').first().click();
  const card = page.locator('.doc-card', { hasText: titleText });
  await expect(card).toBeVisible();
  await card.click();
}

test('a human can verify an unverified document from the editor', async ({ page }) => {
  const prefix = `trust-verify-${Date.now()}`;
  await seedTrustPair(page.request, prefix);

  await openLibraryDoc(page, `${prefix} primary`);

  const strip = page.locator('.trust-strip');
  const verifyBtn = strip.locator('[data-action="toggle-verify"]');

  // The seeded (agent-written) doc starts unverified.
  await expect(verifyBtn).toHaveText('Verify');
  await expect(strip.locator('.chip--verified')).toHaveCount(0);
  await expect(strip.locator('.trust-strip__meta')).toContainText('unverified');

  // Let the doc's links load so a late re-render can't swallow the click.
  await expect(page.locator('[data-document-links]')).toBeVisible();
  await verifyBtn.click();

  // Verifying flips the label (gates on the reload), shows the chip, updates meta.
  await expect(verifyBtn).toHaveText('Unverify');
  await expect(strip.locator('.chip--verified')).toBeVisible();
  await expect(strip.locator('.trust-strip__meta')).toContainText('verified by');
});

test('a human can supersede a document by picking a replacement', async ({ page }) => {
  const prefix = `trust-supersede-${Date.now()}`;
  await seedTrustPair(page.request, prefix);

  await openLibraryDoc(page, `${prefix} primary`);

  const strip = page.locator('.trust-strip');
  await expect(page.locator('[data-document-links]')).toBeVisible();
  await strip.locator('[data-action="supersede-document"]').click();

  const picker = page.locator('[data-link-picker]');
  await expect(picker).toBeVisible();
  await expect(picker.locator('#link-picker-title')).toContainText('Supersede');
  await picker.locator('[data-link-picker-doc]', { hasText: `${prefix} replacement` }).click();

  // The old (still-open) doc flips to superseded: chip + meta, button gone.
  await expect(strip.locator('.chip--superseded')).toBeVisible();
  await expect(strip.locator('.trust-strip__meta')).toContainText('superseded');
  await expect(strip.locator('[data-action="supersede-document"]')).toHaveCount(0);

  // The replacement appears under Backlinks (supersede link is new → old, inbound on the old doc).
  const links = page.locator('[data-document-links]');
  await expect(links).toContainText('Backlinks');
  await expect(links).toContainText(`${prefix} replacement`);

  // Back in the library, the old card carries the SUPERSEDED chip.
  await page.locator('[data-action="back-to-library"]').click();
  const oldCard = page.locator('.doc-card', { hasText: `${prefix} primary` });
  await expect(oldCard.locator('.chip--superseded')).toBeVisible();
});
