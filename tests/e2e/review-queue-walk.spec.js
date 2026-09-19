import { test, expect } from '@playwright/test';
import { createDocument, resolveProjectId } from './helpers/seed.js';

// The review-queue walk against the production app: from the queue, Review
// next opens the first unverified agent document with a strip that says
// where you are; Verify and next verifies THIS saved content (the same
// read-then-verify route as the editor menu) and lands on the next one;
// the last one finishes back on the queue with a summary.

test('Review next walks the queue: verify and next, verify and finish, back on the queue', async ({ page, request }) => {
  const prefix = `walk-${Date.now()}`;
  const projectId = await resolveProjectId(page.request, 'homelab');
  const first = await createDocument(request, {
    title: `${prefix} drain order`, body: '# Drain order\n\nWorkers first.', documentType: 'runbook', project: projectId, tags: ['walk'],
  }, { origin: 'agent' });
  const second = await createDocument(request, {
    title: `${prefix} listBuckets`, body: '# listBuckets\n\nGrant it on the key.', documentType: 'known-issue', project: projectId, tags: ['walk'],
  }, { origin: 'agent' });

  await page.goto('/');
  await page.locator('.rail [data-action="nav-library"]').click();
  await page.locator('.panel [data-action="open-review-queue"]').click();
  await expect(page.locator('.doc-table--review')).toBeVisible();

  // Narrow the queue to this spec's two documents; the walk is a snapshot of
  // what is shown, so it holds exactly these.
  await page.locator('[data-library-search]').fill(prefix);
  await expect(page.locator('.doc-table--review .doc-table__row')).toHaveCount(2);

  await page.locator('[data-action="review-next"]').click();
  const strip = page.locator('.review-walk');
  await expect(strip).toBeVisible();
  await expect(strip).toContainText('1 of 2');
  const openedFirst = await page.locator('[data-doc-title]').inputValue();
  expect([first.title, second.title]).toContain(openedFirst);

  await strip.locator('[data-action="review-walk-verify"]').click();
  await expect(strip).toContainText('2 of 2');
  await expect(strip).toContainText('1 verified');
  const openedSecond = await page.locator('[data-doc-title]').inputValue();
  expect(openedSecond).not.toBe(openedFirst);
  expect([first.title, second.title]).toContain(openedSecond);

  await expect(strip.locator('[data-action="review-walk-verify"]')).toHaveText('Verify and finish');
  await strip.locator('[data-action="review-walk-verify"]').click();

  // Back on the queue, with the summary; both documents are verified for real.
  await expect(page.locator('.page-head__sub')).toHaveText('Review queue');
  await expect(page.locator('.toast')).toContainText('Queue walked — 2 documents verified.');
  for (const doc of [first, second]) {
    const saved = await (await request.get(`/api/library/documents/${doc.id}`)).json();
    expect(saved.verified).toBe(true);
  }
  await expect(page.locator('.review-walk')).toHaveCount(0);
});

test('Skip moves on without verifying, and Back to queue leaves the walk', async ({ page, request }) => {
  const prefix = `walk-skip-${Date.now()}`;
  const projectId = await resolveProjectId(page.request, 'homelab');
  const first = await createDocument(request, {
    title: `${prefix} one`, body: '# One', documentType: 'note', project: projectId, tags: ['walk'],
  }, { origin: 'agent' });
  await createDocument(request, {
    title: `${prefix} two`, body: '# Two', documentType: 'note', project: projectId, tags: ['walk'],
  }, { origin: 'agent' });

  await page.goto('/');
  await page.locator('.rail [data-action="nav-library"]').click();
  await page.locator('.panel [data-action="open-review-queue"]').click();
  await page.locator('[data-library-search]').fill(prefix);
  await expect(page.locator('.doc-table--review .doc-table__row')).toHaveCount(2);

  // A row's own Review starts the walk at that row, in the order shown.
  const rows = page.locator('.doc-table--review .doc-table__row');
  const leadId = await rows.first().getAttribute('data-document-id');
  const leadTitle = leadId === first.id ? first.title : `${prefix} two`;
  const otherTitle = leadId === first.id ? `${prefix} two` : first.title;
  await rows.first().locator('[data-action="review-doc"]').click();
  const strip = page.locator('.review-walk');
  await expect(strip).toBeVisible();
  await expect(strip).toContainText('1 of 2');
  await expect(page.locator('[data-doc-title]')).toHaveValue(leadTitle);

  await strip.locator('[data-action="review-walk-skip"]').click();
  await expect(strip).toContainText('2 of 2');
  await expect(page.locator('[data-doc-title]')).toHaveValue(otherTitle);
  const skipped = await (await request.get(`/api/library/documents/${leadId}`)).json();
  expect(skipped.verified).toBe(false);
  // The last unverified document can still be skipped, and says so.
  await expect(strip.locator('[data-action="review-walk-skip"]')).toHaveText('Skip and finish');

  await strip.locator('[data-action="back-to-library"]').click();
  await expect(page.locator('.page-head__sub')).toHaveText('Review queue');
  await expect(page.locator('.review-walk')).toHaveCount(0);
});
