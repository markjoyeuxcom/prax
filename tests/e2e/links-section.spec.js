import { test, expect } from '@playwright/test';
import { createDocument, resolveProjectId, seedDerivedFromPair } from './helpers/seed.js';

// Open the library and click the card whose title contains `titleText` —
// documents open in the editor screen.
async function openLibraryDoc(page, titleText) {
  await page.goto('/');
  await page.locator('[data-action="nav-library"]').first().click();
  const card = page.locator('.doc-card', { hasText: titleText });
  await expect(card).toBeVisible();
  await card.click();
}

test('Links section is visible on first load of a linked doc', async ({ page }) => {
  const prefix = `links-first-${Date.now()}`;
  await seedDerivedFromPair(page.request, prefix);

  await openLibraryDoc(page, `${prefix} synthesized`);

  // The regression: the Links section must be visible immediately, without a
  // mode switch. toBeVisible() checks real geometry.
  const links = page.locator('[data-document-links]');
  await expect(links).toBeVisible();
  await expect(links).toContainText('Derived from');
  await expect(links).toContainText(`${prefix} source`);
});

test('Links section stays visible across every editor mode', async ({ page }) => {
  const prefix = `links-modes-${Date.now()}`;
  await seedDerivedFromPair(page.request, prefix);
  await openLibraryDoc(page, `${prefix} synthesized`);

  const links = page.locator('[data-document-links]');
  await expect(links).toBeVisible();

  // Edit is the distraction-free writing surface; supporting sections live in
  // preview contexts only.
  await page.locator('[data-action="set-editor-mode"][data-mode="edit"]').click();
  await expect(links).toHaveCount(0);

  // Focus keeps the same edit-only contract.
  await page.locator('[data-action="toggle-focus"]').click();
  await expect(links).toHaveCount(0);
  await page.locator('[data-action="toggle-focus"]').click();

  // split
  await page.locator('[data-action="set-editor-mode"][data-mode="split"]').click();
  await expect(links).toBeVisible();

  // Document info lives in the document-actions menu and renders above the
  // workspace; Links stays visible. Cancel after.
  await page.locator('[data-action="toggle-doc-menu"]').click();
  await page.locator('[data-action="edit-document-info"]').click();
  await expect(links).toBeVisible();
  await page.locator('[data-action="cancel-document-info"]').click();

  // preview
  await page.locator('[data-action="set-editor-mode"][data-mode="preview"]').click();
  await expect(links).toBeVisible();
});

test('Backlinks show the deriving doc on the source', async ({ page }) => {
  const prefix = `links-back-${Date.now()}`;
  await seedDerivedFromPair(page.request, prefix);
  await openLibraryDoc(page, `${prefix} source`);

  const links = page.locator('[data-document-links]');
  await expect(links).toBeVisible();
  await expect(links).toContainText('Backlinks');
  await expect(links).toContainText(`${prefix} synthesized`);
});

test('Links section renders an empty state for a standalone doc', async ({ page }) => {
  const prefix = `links-standalone-${Date.now()}`;
  const project = await resolveProjectId(page.request, 'work');
  await createDocument(page.request, {
    title: `${prefix} source`,
    body: '# source\n',
    documentType: 'note',
    project,
    tags: ['e2e'],
  });
  await openLibraryDoc(page, `${prefix} source`);

  const links = page.locator('[data-document-links]');
  await expect(links).toBeVisible();
  await expect(links).toContainText('No links');
});
