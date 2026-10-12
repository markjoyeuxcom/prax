import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createDocument } from './helpers/seed.js';

for (const returnButton of ['back', 'breadcrumb']) test(`Library ${returnButton} restores tags, project, trust, type, query, sort and layout`, async ({ page, request }) => {
  const tag = `return-${randomUUID()}`;
  const doc = await createDocument(request, { title: `Return view ${tag}`, body: 'Preserve my filters', tags: [tag], documentType: 'note', project: 'work' }, { origin: 'agent' });
  await page.goto('/'); await page.locator('.places [data-action="nav-library"]').click();
  await page.locator('[data-library-search]').fill('Return view');
  // Earlier tests leave many tags; use the sidebar's real overflow search.
  const tagSearch = page.getByRole('textbox', { name: 'Find a tag', exact: true });
  if (await tagSearch.isVisible()) await tagSearch.fill(tag);
  await page.locator(`[data-action="toggle-lib-tag"][data-tag="${tag}"]`).first().click();
  await page.locator(`[data-action="toggle-lib-project"][data-facet="${doc.projectId}"]`).click();
  await page.locator('[data-action="toggle-lib-type"][data-facet="note"]').click();
  await page.locator('[data-action="toggle-lib-trust"][data-facet="agent"]').click();
  await page.locator('[data-action="cycle-lib-sort"]').click();
  await page.locator('[data-action="set-library-layout"][data-layout="table"]').click();
  const filters = await page.getByLabel('Active filters').textContent();
  const sort = await page.locator('[data-action="cycle-lib-sort"]').innerText();
  await page.locator(`[data-action="open-doc"][data-document-id="${doc.id}"]`).click();
  if (returnButton === 'back') await page.getByRole('button', { name: 'Back to library', exact: true }).click();
  else await page.locator('[data-action="breadcrumb"][data-target="back-to-library"]').click();
  await expect(page.getByLabel('Active filters')).toHaveText(filters);
  await expect(page.locator('[data-library-search]')).toHaveValue('Return view');
  await expect(page.locator('[data-action="cycle-lib-sort"]')).toHaveText(sort);
  await expect(page.locator('[data-action="set-library-layout"][data-layout="table"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator(`.doc-table [data-action="open-doc"][data-document-id="${doc.id}"]`)).toBeFocused();
});

test('Library return keeps the expanded result window and scroll position', async ({ page, request }) => {
  const tag = `window-${randomUUID()}`;
  for (let i = 0; i < 65; i++) await createDocument(request, { title: `${tag} ${String(i).padStart(2, '0')}`, body: 'Window test', tags: [tag], documentType: 'note', project: 'work' });
  await page.goto('/'); await page.locator('.places [data-action="nav-library"]').click();
  await page.locator('[data-library-search]').fill(tag);
  await page.locator('[data-action="show-more-library"]').click();
  await expect(page.locator('.doc-card')).toHaveCount(65);
  const last = page.locator('.doc-card').last(); await last.scrollIntoViewIfNeeded();
  const scroll = await page.locator('.main__scroll').evaluate(el => el.scrollTop);
  expect(scroll).toBeGreaterThan(200);
  await last.click(); await page.getByRole('button', { name: 'Back to library', exact: true }).click();
  await expect(page.locator('.doc-card')).toHaveCount(65);
  await expect.poll(async () => page.locator('.main__scroll').evaluate(el => el.scrollTop)).toBe(scroll);
  await expect(page.locator('.doc-card').last()).toBeFocused();
});

test('failed editor save blocks Back, preserving the draft and Library origin until saved', async ({ page, request }) => {
  const tag = `draft-${randomUUID()}`;
  const doc = await createDocument(request, { title: tag, body: 'Original', tags: [tag], documentType: 'note', project: 'work' });
  await page.goto('/'); await page.locator('.places [data-action="nav-library"]').click();
  await page.locator('[data-library-search]').fill(tag);
  await page.locator(`[data-action="open-doc"][data-document-id="${doc.id}"]`).click();
  await page.locator('[data-action="set-editor-mode"][data-mode="edit"]').click();
  await page.route(`**/api/library/documents/${doc.id}`, route => route.request().method() === 'PATCH' ? route.abort() : route.continue());
  await page.locator('.cm-content[contenteditable="true"]').click();
  await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.insertText('Unsent draft survives Back');
  await page.getByRole('button', { name: 'Back to library', exact: true }).click();
  await expect(page.locator('[data-document-editor]')).toHaveValue('Unsent draft survives Back');
  await expect(page.locator('.editor-head')).toBeVisible();
  await page.unroute(`**/api/library/documents/${doc.id}`);
  await page.getByRole('button', { name: 'Back to library', exact: true }).click();
  await expect(page.locator('[data-library-search]')).toHaveValue(tag);
  expect((await (await request.get(`/api/library/documents/${doc.id}`)).json()).body).toBe('Unsent draft survives Back');
});

test('archived and linked documents preserve their Library origin', async ({ page, request }) => {
  const tag = `linked-${randomUUID()}`;
  const target = await createDocument(request, { title: `${tag} target`, body: 'Linked target', documentType: 'note', project: 'work' });
  const source = await createDocument(request, { title: `${tag} source`, body: `[[${target.title}]]`, documentType: 'note', tags: [tag], project: 'work' });
  await page.goto('/'); await page.locator('.places [data-action="nav-library"]').click();
  await page.locator('[data-library-search]').fill(source.title);
  await page.locator(`[data-action="open-doc"][data-document-id="${source.id}"]`).click();
  await page.locator(`a[data-document-id="${target.id}"]`).click();
  await expect(page.locator('[data-doc-title]')).toHaveValue(target.title);
  await page.getByRole('button', { name: 'Back to library', exact: true }).click();
  await expect(page.locator('[data-library-search]')).toHaveValue(source.title);
  expect((await request.delete(`/api/library/documents/${source.id}`)).ok()).toBe(true);
  await page.locator('[data-action="toggle-library-menu"]').click();
  await page.locator('[data-action="toggle-library-view"]').click();
  await page.locator(`[data-action="open-doc"][data-document-id="${source.id}"]`).click();
  await page.getByRole('button', { name: 'Back to library', exact: true }).click();
  await expect(page.locator('.page-head__sub')).toHaveText('Archive');
  await expect(page.locator('[data-library-search]')).toHaveValue(source.title);
  await expect(page.locator(`[data-action="restore-document"][data-document-id="${source.id}"]`)).toBeVisible();
});

test('semantic return retains loaded matches and refreshes changed source content', async ({ page, request }) => {
  await request.put('/api/settings/semantic-search', { data: { backend: 'fake', enabled: true } });
  try {
    const doc = await createDocument(request, { title: `Semantic return ${randomUUID()}`, body: 'Initial content', documentType: 'note', project: 'work' });
    let searches = 0;
    await page.route('**/api/library/documents/semantic-search*', async route => {
      searches++;
      const current = await (await request.get(`/api/library/documents/${doc.id}`)).json();
      await route.fulfill({ json: { items: [{ ...current, snippet: current.body, similarity: 0.9 }], page: { offset: 0, limit: 20, returned: 1, total: 1, hasMore: false, nextOffset: null } } });
    });
    await page.goto('/'); await page.locator('.places [data-action="nav-library"]').click();
    await page.locator('[data-action="set-search-mode"][data-mode="semantic"]').click();
    await page.locator('[data-library-search]').fill('semantic return'); await page.locator('[data-library-search]').press('Enter');
    await page.locator('.sem-card').click();
    const count = searches;
    await page.getByRole('button', { name: 'Back to library', exact: true }).click();
    await expect(page.locator('.sem-card')).toContainText('Initial content'); expect(searches).toBe(count);
    await page.locator('.sem-card').click();
    await request.patch(`/api/library/documents/${doc.id}`, { data: { body: 'Current source content' } });
    await page.getByRole('button', { name: 'Back to library', exact: true }).click();
    await expect(page.locator('.sem-card')).toContainText('Current source content');
    await expect(page.locator('[data-library-search]')).toHaveValue('semantic return');
    expect(searches).toBeGreaterThan(count);
  } finally { await request.put('/api/settings/semantic-search', { data: { backend: 'none', enabled: false } }); }
});
