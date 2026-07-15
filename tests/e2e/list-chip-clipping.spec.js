import { test, expect } from '@playwright/test';
import { resolveProjectId, createDocument } from './helpers/seed.js';

// Regression: a long title must not push the trust chips past the card's
// overflow clip — the SYNTH signal matters most on long agent-written titles.
// toBeInViewport uses IntersectionObserver, so an ancestor-clipped chip fails
// it while a visible one passes.
test('SYNTH chip stays visible on a card with a very long title', async ({ page }) => {
  const prefix = `chipclip-${Date.now()}`;
  const projectId = await resolveProjectId(page.request, 'homelab');
  await createDocument(page.request, {
    title: `${prefix} an extremely long synthesized memory title that absolutely will not fit in the library card without truncating`,
    body: '# long\n',
    documentType: 'note',
    project: projectId,
    kind: 'synthesized',
    tags: ['e2e'],
  });

  await page.goto('/');
  await page.locator('[data-action="nav-library"]').first().click();
  await page.getByRole('searchbox', { name: 'Search library' }).fill(prefix);
  const card = page.locator('.doc-card', { hasText: prefix });
  await expect(card).toBeVisible();

  // The production server is shared across the serial suite, so accumulated
  // facet content may place this unique result below the physical viewport.
  // Normalize only the vertical position before measuring the horizontal
  // ancestor-clipping regression this test owns.
  await card.scrollIntoViewIfNeeded();
  await expect(card).toBeInViewport();
  await expect(card.locator('.chip--synth')).toBeVisible();
  await expect(card.locator('.chip--synth')).toBeInViewport();
});
