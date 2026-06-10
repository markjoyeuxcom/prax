import { test, expect } from '@playwright/test';
import { resolveProjectId, createDocument } from './helpers/seed.js';

// Regression: a long title used to push the trust chips past the row's
// overflow clip, hiding them exactly on the long agent-written titles that
// need the SYNTH signal most. toBeInViewport uses IntersectionObserver, so
// an ancestor-clipped chip fails it while a visible one passes.
test('SYNTH chip stays visible on a row with a very long title', async ({ page }) => {
  const prefix = `chipclip-${Date.now()}`;
  const projectId = await resolveProjectId(page.request, 'homelab');
  await createDocument(page.request, {
    title: `${prefix} an extremely long synthesized memory title that absolutely will not fit in the list panel without truncating`,
    body: '# long\n',
    documentType: 'note',
    project: projectId,
    kind: 'synthesized',
    tags: ['e2e'],
  });

  await page.goto('/');
  await page.locator('button.nav-button[data-view="library"]').first().click();
  const row = page.locator('.document-row', { hasText: prefix });
  await expect(row).toBeVisible();

  // Other specs share the demo instance and may push this row below the fold —
  // scroll it into view first so the assertion only measures horizontal
  // clipping (which ancestor overflow still fails via IntersectionObserver).
  await row.scrollIntoViewIfNeeded();
  await expect(row.locator('.chip-synth')).toBeInViewport();
});
