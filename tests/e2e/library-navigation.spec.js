import { test, expect } from '@playwright/test';
import { createDocument, resolveProjectId } from './helpers/seed.js';

test('a delayed Active response cannot overwrite the newer Archive view', async ({ page }) => {
  const prefix = `library-load-race-${Date.now()}`;
  const projectId = await resolveProjectId(page.request, 'homelab');
  const active = await createDocument(page.request, {
    title: `${prefix} active`,
    body: '# Active\n',
    documentType: 'note',
    project: projectId,
  });
  const archived = await createDocument(page.request, {
    title: `${prefix} archived`,
    body: '# Archived\n',
    documentType: 'note',
    project: projectId,
  });
  const archivedResponse = await page.request.delete(`/api/library/documents/${archived.id}`);
  expect(archivedResponse.ok()).toBe(true);

  await page.goto('/');
  await expect(page.locator('[data-action="nav-library"]').first()).toBeVisible();
  let releaseActive;
  let markActiveStarted;
  let markActiveCompleted;
  const activeGate = new Promise((resolve) => { releaseActive = resolve; });
  const activeStarted = new Promise((resolve) => { markActiveStarted = resolve; });
  const activeCompleted = new Promise((resolve) => { markActiveCompleted = resolve; });

  await page.route('**/api/library/documents*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== '/api/library/documents') {
      await route.continue();
      return;
    }
    if (!url.searchParams.has('archived')) {
      markActiveStarted();
      await activeGate;
      const response = await route.fetch();
      await route.fulfill({ response });
      markActiveCompleted();
      return;
    }
    await route.continue();
  });

  await page.locator('[data-action="nav-library"]').first().click();
  await activeStarted;
  await page.locator('[data-action="toggle-library-menu"]').click();
  await page.locator('[data-action="toggle-library-view"]').click();
  // The archive is named in the header once the toggle sits inside the ⋯ overflow.
  await expect(page.locator('.page-head__sub')).toHaveText('Archive');
  await expect(page.locator('.plain-row', { hasText: archived.title })).toBeVisible();

  releaseActive();
  await activeCompleted;
  await expect(page.locator('.page-head__sub')).toHaveText('Archive');
  await expect(page.locator('.plain-row', { hasText: archived.title })).toBeVisible();
  await expect(page.getByText(active.title, { exact: true })).toHaveCount(0);

  const archivedOpen = page.locator('.plain-row__open', { hasText: archived.title });
  await archivedOpen.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-doc-title]')).toHaveValue(archived.title);
  await expect(page.locator('[data-doc-title]')).toHaveAttribute('readonly', '');
});

test('a slow semantic query cannot overwrite newer visible results', async ({ page }) => {
  const configured = await page.request.put('/api/settings/semantic-search', {
    data: { backend: 'fake', enabled: true },
  });
  expect(configured.ok()).toBe(true);

  await page.goto('/');
  await expect(page.locator('[data-action="nav-library"]').first()).toBeVisible();
  await page.locator('[data-action="nav-library"]').first().click();
  await page.locator('[data-action="set-search-mode"][data-mode="semantic"]').click();

  let releaseFirst;
  let markFirstStarted;
  let markFirstCompleted;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const firstStarted = new Promise((resolve) => { markFirstStarted = resolve; });
  const firstCompleted = new Promise((resolve) => { markFirstCompleted = resolve; });
  await page.route('**/api/library/documents/semantic-search*', async (route) => {
    const query = new URL(route.request().url()).searchParams.get('q');
    if (query === 'first slow query') {
      markFirstStarted();
      await firstGate;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ id: 'first-result', title: 'First stale result', documentType: 'note', snippet: 'old', similarity: 0.9 }]),
      });
      markFirstCompleted();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ id: 'second-result', title: 'Second current result', documentType: 'runbook', snippet: 'new', similarity: 0.8 }]),
    });
  });

  const search = page.locator('[data-library-search]');
  await search.fill('first slow query');
  await search.press('Enter');
  await firstStarted;
  await expect(page.getByRole('heading', { name: 'Searching by meaning…' })).toBeVisible();

  await search.fill('second current query');
  await search.press('Enter');
  await expect(page.getByText('Second current result', { exact: true })).toBeVisible();

  releaseFirst();
  await firstCompleted;
  await expect(page.getByText('Second current result', { exact: true })).toBeVisible();
  await expect(page.getByText('First stale result', { exact: true })).toHaveCount(0);

  const reset = await page.request.put('/api/settings/semantic-search', {
    data: { backend: 'none', enabled: false },
  });
  expect(reset.ok()).toBe(true);
});
