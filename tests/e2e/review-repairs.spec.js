import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createDocument } from './helpers/seed.js';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
async function seedQueue(request, count = 3) {
  const prefix = `repair-${randomUUID()}`;
  const docs = [];
  for (let i = 0; i < count; i++) docs.push(await createDocument(request, {
    title: `${prefix} ${i}`, body: `Original body ${i}`, documentType: 'note', project: 'homelab', tags: ['review-repair'],
  }, { origin: 'agent' }));
  return { prefix, docs };
}
async function openQueue(page, prefix, count) {
  await page.goto('/');
  await page.locator('.places [data-action="nav-library"]').click();
  await page.locator('.panel [data-action="nav-review"]').click();
  // The queue opens on the one-at-a-time desk; the walk starts from the table.
  await page.locator('[data-action="review-desk-table"]').click();
  await page.locator('[data-library-search]').fill(prefix);
  await expect(page.locator('.doc-table--review .doc-table__row')).toHaveCount(count);
  const ids = await page.locator('.doc-table--review .doc-table__row').evaluateAll(rows => rows.map(row => row.dataset.documentId));
  await page.locator('[data-action="review-next"]').click();
  await expect(page.locator('.review-walk')).toContainText(`1 of ${count}`);
  return ids;
}

for (const action of ['skip', 'back']) {
  test(`R05: late verification does not advance after ${action}`, async ({ page, request }) => {
    const { prefix, docs } = await seedQueue(request);
    const ids = await openQueue(page, prefix, 3);
    const received = deferred(); const release = deferred();
    await page.route(`**/api/library/documents/${ids[0]}/verify`, async route => {
      const response = await route.fetch();
      received.resolve(); await release.promise;
      await route.fulfill({ response });
    });
    await page.locator('[data-action="review-walk-verify"]').click();
    await received.promise;
    try {
      if (action === 'skip') {
        await page.locator('[data-action="review-walk-skip"]').click();
        await expect(page.locator('.review-walk')).toContainText('2 of 3');
      } else {
        await page.locator('.review-walk [data-action="back-to-library"]').click();
        await expect(page.locator('.page-head__title')).toHaveText('Review queue');
      }
    } finally { release.resolve(); }
    await expect(page.locator('.toast')).toContainText('Document verified');
    if (action === 'skip') {
      await expect(page.locator('[data-doc-title]')).toHaveValue(docs.find(d => d.id === ids[1]).title);
      await expect(page.locator('.review-walk')).toContainText('2 of 3');
      await expect(page.locator('.review-walk')).toContainText('1 verified');
    } else await expect(page.locator('.review-walk')).toHaveCount(0);
    const untouched = await (await request.get(`/api/library/documents/${ids[1]}`)).json();
    expect(untouched.verified).toBe(false);
  });
}

test('R02: delayed verification conflict leaves the newer unsaved editor intact', async ({ page, request }) => {
  const { prefix, docs } = await seedQueue(request, 2);
  const ids = await openQueue(page, prefix, 2);
  const other = docs.find(d => d.id !== ids[0]);
  const changed = await request.patch(`/api/library/documents/${ids[0]}`, { data: { body: 'Remote edit while reviewing' }, headers: { 'x-prax-origin': 'agent' } });
  expect(changed.ok()).toBe(true);
  const received = deferred(); const release = deferred();
  await page.route(`**/api/library/documents/${ids[0]}/verify`, async route => {
    const response = await route.fetch();
    expect(response.status()).toBe(409);
    received.resolve(); await release.promise;
    await route.fulfill({ response });
  });
  await page.locator('[data-action="review-walk-verify"]').click();
  await received.promise;
  try {
    await page.locator('.places [data-action="nav-library"]').click();
    await page.locator('.doc-card', { hasText: other.title }).click();
    await page.locator('[data-action="set-editor-mode"][data-mode="edit"]').click();
    await page.route(`**/api/library/documents/${other.id}`, route => route.request().method() === 'PATCH' ? route.abort() : route.continue());
    const editor = page.locator('.cm-content[contenteditable="true"]');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.insertText('New unsaved input must survive');
    await expect(page.locator('[data-document-editor]')).toHaveValue('New unsaved input must survive');
  } finally { release.resolve(); }
  await expect(page.locator('.toast')).toContainText('current draft is kept');
  await expect(page.locator('[data-doc-title]')).toHaveValue(other.title);
  await expect(page.locator('[data-document-editor]')).toHaveValue('New unsaved input must survive');
});

test('R06/R07: after leaving the editor, focus refresh updates agent memory and verification', async ({ page, request }) => {
  const { prefix } = await seedQueue(request, 1);
  await openQueue(page, prefix, 1);
  await page.locator('.places [data-action="nav-today"]').click();
  const fresh = await createDocument(request, { title: `External-${randomUUID()}`, body: 'External body', documentType: 'note', project: 'homelab' }, { origin: 'agent' });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const row = page.locator('[data-today-agents] .agent-row', { hasText: fresh.title });
  await expect(row).toContainText('UNVERIFIED');
  expect((await request.post(`/api/library/documents/${fresh.id}/verify`, { data: { verified: true, revision: fresh.revision } })).ok()).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(row.locator('.chip')).toHaveText('VERIFIED');
  expect((await request.post(`/api/library/documents/${fresh.id}/verify`, { data: { verified: false } })).ok()).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(row.locator('.chip')).toHaveText('UNVERIFIED');
});
