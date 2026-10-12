import { test, expect } from '@playwright/test';
import { createDocument, resolveProjectId } from './helpers/seed.js';

// The review desk (Console redesign, 2026-10): agent memory one document at a
// time — queue, saved revision, provenance — decided with single keys. Verify
// binds to the revision shown; Reject archives (restorable).
test.use({ viewport: { width: 1440, height: 900 } });

test('the desk verifies with V, rejects with R, and keeps a record of what was decided', async ({ page, request }) => {
  const prefix = `desk-${Date.now()}`;
  const projectId = await resolveProjectId(page.request, 'homelab');
  const keep = await createDocument(request, {
    title: `${prefix} keep`, body: '# Keep\n\nThe listBuckets grant is required.', documentType: 'known-issue', project: projectId, tags: ['desk'],
  }, { origin: 'agent' });
  const drop = await createDocument(request, {
    title: `${prefix} drop`, body: '# Drop\n\nA wrong guess.', documentType: 'note', project: projectId, tags: ['desk'],
  }, { origin: 'agent' });

  await page.goto('/');
  await page.locator('.places [data-action="nav-review"]').click();
  await expect(page.locator('.rq')).toBeVisible();
  await expect(page.locator('.statusbar__mode')).toHaveText('REVIEW');

  // Narrow to this spec's two documents (the desk honours the search box).
  await page.locator('[data-action="review-desk-select"]', { hasText: `${prefix} keep` }).click();
  await expect(page.locator('.rq-memory__title')).toHaveText(`${prefix} keep`);
  await expect(page.locator('.rq-memory__body')).toContainText('The listBuckets grant is required.');
  await expect(page.locator('[data-action="review-desk-verify"]')).toBeEnabled();

  await page.locator('.rq-memory__title').click();
  await page.keyboard.press('v');
  await expect(page.locator('.rq-item--done', { hasText: `${prefix} keep` })).toBeVisible();
  expect((await (await request.get(`/api/library/documents/${keep.id}`)).json()).verified).toBe(true);

  await page.locator('[data-action="review-desk-select"]', { hasText: `${prefix} drop` }).click();
  await expect(page.locator('.rq-memory__title')).toHaveText(`${prefix} drop`);
  await page.locator('.rq-memory__title').click();
  await page.keyboard.press('r');
  await expect(page.locator('.rq-item--done', { hasText: `${prefix} drop` })).toBeVisible();
  const dropped = await (await request.get(`/api/library/documents/${drop.id}`)).json();
  expect(Boolean(dropped.archivedAt)).toBe(true);
});

test('Verify refuses a revision that changed after the desk loaded it', async ({ page, request }) => {
  const prefix = `desk-rev-${Date.now()}`;
  const projectId = await resolveProjectId(page.request, 'homelab');
  const doc = await createDocument(request, {
    title: `${prefix} moving`, body: '# Moving\n\nFirst version.', documentType: 'note', project: projectId,
  }, { origin: 'agent' });
  await page.goto('/');
  await page.locator('.places [data-action="nav-review"]').click();
  await page.locator('[data-action="review-desk-select"]', { hasText: `${prefix} moving` }).click();
  await expect(page.locator('.rq-memory__body')).toContainText('First version.');

  // An agent rewrites it while the person reads.
  await request.patch(`/api/library/documents/${doc.id}`, {
    data: { body: '# Moving\n\nSecond version.' }, headers: { 'x-prax-origin': 'agent', 'x-prax-agent': 'codex' },
  });
  await page.locator('[data-action="review-desk-verify"]').click();
  expect((await (await request.get(`/api/library/documents/${doc.id}`)).json()).verified).toBe(false);
  // The desk reloads the saved revision for a second look.
  await expect(page.locator('.rq-memory__body')).toContainText('Second version.');
});
