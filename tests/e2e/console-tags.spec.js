import { test, expect } from '@playwright/test';

// Tags at scale (Console redesign, 2026-10): tags are normalised at the API,
// Library ▸ Tags suggests merging spellings of one subject, and a merge
// re-tags each document as an ordinary human edit.
test.use({ viewport: { width: 1440, height: 900 } });

async function createDoc(request, title, tags) {
  const response = await request.post('/api/library/documents', { data: { title, body: `# ${title}`, documentType: 'note', project: 'homelab', tags } });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

test('the API normalises tags, and Library ▸ Tags merges a duplicate spelling', async ({ page, request }) => {
  const stamp = Date.now();
  const normalised = await createDoc(request, `Normalised ${stamp}`, ['#Disaster Recovery', 'disaster-recovery', ' K8S ']);
  expect(normalised.tags).toEqual(['disaster-recovery', 'k8s']);

  const keep = await createDoc(request, `Keeper ${stamp}`, [`pgx${stamp}`, 'postgres']);
  const stray = await createDoc(request, `Stray ${stamp}`, [`pgx${stamp}s`]);

  await page.goto('/');
  await page.locator('.places [data-action="nav-library"]').click();
  await page.locator('.panel [data-action="open-tags"]').click();
  await expect(page.locator('h1.page-head__title')).toHaveText('Tags');
  await expect(page.locator('.statusbar__mode')).toHaveText('TAGS');

  const merge = page.locator(`[data-action="merge-tags"][data-into="pgx${stamp}"]`);
  await expect(merge).toHaveAttribute('data-from', `pgx${stamp}s`);
  await merge.click();
  await page.locator('[data-confirm-ok]').click();
  await expect(page.locator(`[data-action="merge-tags"][data-into="pgx${stamp}"]`)).toHaveCount(0);

  const after = await (await request.get(`/api/library/documents/${stray.id}`)).json();
  expect(after.tags).toEqual([`pgx${stamp}`]);
  const untouched = await (await request.get(`/api/library/documents/${keep.id}`)).json();
  expect(untouched.tags).toEqual([`pgx${stamp}`, 'postgres']);
});

test('filtering the Library narrows the panel to the tags in the results', async ({ page, request }) => {
  const stamp = Date.now();
  await createDoc(request, `Narrow A ${stamp}`, [`na${stamp}`, `nb${stamp}`]);
  await createDoc(request, `Narrow C ${stamp}`, [`nc${stamp}`]);
  await page.goto('/');
  await page.locator('.places [data-action="nav-library"]').click();
  // From Library ▸ Tags, a tag opens the Library filtered by it.
  await page.locator('.panel [data-action="open-tags"]').click();
  await page.locator('[data-tags-query]').fill(`na${stamp}`);
  await page.locator(`[data-action="filter-by-tag"][data-tag="na${stamp}"]`).click();
  await expect(page.locator('.doc-card, .doc-table__row')).toHaveCount(1);
  await expect(page.locator(`.panel [data-action="toggle-lib-tag"][data-tag="nb${stamp}"]`)).toBeVisible();
  await expect(page.locator(`.panel [data-action="toggle-lib-tag"][data-tag="nc${stamp}"]`)).toHaveCount(0);
  await expect(page.locator('.panel .side-section', { hasText: 'Tags in 1 result' })).toBeVisible();
});
