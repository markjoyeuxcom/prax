import { test, expect } from '@playwright/test';
import { createDocument, resolveProjectId } from './helpers/seed.js';

// The editor in the Console redesign: selecting text shows a floating bar
// with the writing actions that work on a selection and Ask Prax about it;
// [[ offers document titles with their type and trust.
test.use({ viewport: { width: 1440, height: 900 } });

test('selecting text shows the action bar, and Ask Prax carries the selection', async ({ page }) => {
  const stamp = Date.now();
  const projectId = await resolveProjectId(page.request, 'homelab');
  const doc = await createDocument(page.request, {
    title: `Selection bar ${stamp}`, body: `# Selection bar ${stamp}\n\nTake an etcd snapshot before the upgrade window.`, documentType: 'runbook', project: projectId,
  });
  await page.goto('/');
  await page.locator('.places [data-action="nav-library"]').click();
  await page.locator('[data-library-search]').fill(`Selection bar ${stamp}`);
  await page.locator('.doc-card, .doc-table__row').first().click();
  await expect(page.locator('[data-doc-title]')).toHaveValue(doc.title);

  const line = page.locator('.cm-line', { hasText: 'Take an etcd snapshot' });
  await line.click({ clickCount: 3 });
  const bar = page.locator('.selbar');
  await expect(bar).toBeVisible();
  await expect(bar.locator('[data-action="write-action"][data-write="rewrite"]')).toBeVisible();
  await bar.locator('[data-action="selbar-ask"]').click();
  await expect(page.locator('.ask-page')).toBeVisible();
  await expect(page.locator('[data-ask-prax-input]')).toHaveValue(/Take an etcd snapshot/);
});

test('[[ suggests titles with their type and trust', async ({ page }) => {
  const stamp = Date.now();
  const projectId = await resolveProjectId(page.request, 'homelab');
  const target = await createDocument(page.request, {
    title: `Quorum check ${stamp}`, body: '# Quorum check\n\netcdctl endpoint status.', documentType: 'runbook', project: projectId,
  });
  await page.request.post(`/api/library/documents/${target.id}/verify`, { data: { verified: true, as: 'e2e', revision: target.revision } });
  const doc = await createDocument(page.request, {
    title: `Linking ${stamp}`, body: `# Linking ${stamp}\n\n`, documentType: 'note', project: projectId,
  });
  await page.goto('/');
  await page.locator('.places [data-action="nav-library"]').click();
  await page.locator('[data-library-search]').fill(`Linking ${stamp}`);
  await page.locator('.doc-card, .doc-table__row').first().click();
  await expect(page.locator('[data-doc-title]')).toHaveValue(doc.title);
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(`[[Quorum check ${stamp}`);
  const option = page.locator('.cm-tooltip-autocomplete li', { hasText: `Quorum check ${stamp}` });
  await expect(option).toBeVisible();
  await expect(option.locator('.cm-completionDetail')).toHaveText('runbook ✓');
});
