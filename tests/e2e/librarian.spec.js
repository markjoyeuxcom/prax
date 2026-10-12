// Librarian journey (spec 2026-09-23): Run librarian in Library health files an
// unverified proposal; it sits in the review queue (which can sort by recall
// frequency); approval waits for verification and then retires the sources.
// The one demo server is shared, so the spec cleans up every proposal it may
// have caused by dismissing whatever is still open at the end.
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createDocument } from './helpers/seed.js';

const BODY = 'To restore Postgres, stop the app, copy the latest pg_dump from the NAS, run pg_restore with --clean, then start the app and check the row counts.';

async function openHealth(page) {
  await page.goto('/');
  await page.locator('[data-action="nav-library"]').first().click();
  await page.locator('[data-action="toggle-library-menu"]').click();
  await page.locator('[data-action="open-health"]').click();
  await expect(page.locator('[aria-label="Librarian"]')).toBeVisible();
}

test.afterAll(async ({ request }) => {
  const open = await (await request.get('/api/library/librarian/proposals?status=open')).json();
  for (const p of open.items || []) await request.post(`/api/library/librarian/proposals/${p.documentId}/dismiss`, { data: {} });
});

test('Run librarian proposes, the queue sorts by recall, approval needs verification', async ({ page, request }) => {
  const tag = randomUUID().slice(0, 8);
  const a = await createDocument(request, { title: `Restore ${tag}`, body: BODY, project: 'homelab', documentType: 'runbook' }, { origin: 'agent' });
  const b = await createDocument(request, { title: `Restore ${tag} steps`, body: `${BODY}\n\nPage the on-call if the dump is old.`, project: 'homelab', documentType: 'runbook' }, { origin: 'agent' });

  await openHealth(page);
  const card = page.locator('[aria-label="Librarian"]');
  await card.locator('[data-action="run-librarian"]').click();
  await expect(page.locator('.toast')).toContainText(/Librarian filed \d+ proposals? for review/);
  const row = card.locator('.librarian-proposal', { hasText: `Restore ${tag}` });
  await expect(row).toBeVisible();
  await expect(row).toContainText('unverified');
  // Unverified: the row offers Review, not Approve.
  await expect(row.locator('[data-decision="approve"]')).toHaveCount(0);
  const proposalId = await row.locator('[data-action="decide-proposal"][data-decision="dismiss"]').getAttribute('data-proposal-id');

  // Nothing was retired by the run.
  for (const doc of [a, b]) {
    expect((await (await request.get(`/api/library/documents/${doc.id}`)).json()).status).toBe('active');
  }

  // The proposal is in the review queue, and the queue can sort by recall.
  await page.locator('[data-action="back-to-library"]').click();
  await page.locator('[data-action="toggle-library-menu"]').click();
  await page.locator('[data-action="open-review-queue"]').first().click();
  await page.locator('[data-action="review-desk-table"]').click(); // the desk opens first; sorting is a table feature
  await expect(page.locator('.doc-table--review')).toContainText(`Restore ${tag}`);
  const sort = page.locator('[data-action="cycle-lib-sort"]');
  await sort.click();
  await expect(sort).toHaveText('Sort: Title');
  await sort.click();
  await expect(sort).toHaveText('Sort: Most recalled');
  await sort.click();
  await expect(sort).toHaveText('Sort: Updated');

  // A person verifies the draft (the walk does this in the editor), then approves.
  const proposal = await (await request.get(`/api/library/documents/${proposalId}`)).json();
  const verified = await request.post(`/api/library/documents/${proposalId}/verify`, { data: { verified: true, as: 'e2e', revision: proposal.revision } });
  expect(verified.ok()).toBe(true);
  await openHealth(page);
  await page.locator(`[data-decision="approve"][data-proposal-id="${proposalId}"]`).click();
  await expect(page.locator('.toast')).toContainText('Proposal approved — 2 sources superseded.');
  for (const doc of [a, b]) {
    expect((await (await request.get(`/api/library/documents/${doc.id}`)).json()).status).toBe('superseded');
  }
});
