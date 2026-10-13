import { test, expect } from '@playwright/test';
import { createDocument, resolveProjectId } from './helpers/seed.js';

test('semantic retrieval reports exact totals, preserves trust, and loads every page', async ({ page }) => {
  const configured = await page.request.put('/api/settings/semantic-search', {
    data: { backend: 'fake', enabled: true },
  });
  expect(configured.ok()).toBe(true);

  const refs = Array.from({ length: 21 }, (_, index) => ({
    id: `semantic-result-${index}`,
    title: `Recovery reference ${String(index + 1).padStart(2, '0')}`,
    documentType: index === 0 ? 'note' : 'runbook',
    snippet: `Recovery evidence ${index + 1}`,
    similarity: 0.99 - (index * 0.01),
    kind: index === 0 ? 'synthesized' : 'source',
    stale: index === 0,
    verified: index !== 0,
    status: 'active',
  }));
  const offsets = [];
  await page.route('**/api/library/documents/semantic-search*', async (route) => {
    const url = new URL(route.request().url());
    const offset = Number(url.searchParams.get('offset') || 0);
    const limit = Number(url.searchParams.get('limit') || 20);
    offsets.push(offset);
    const items = refs.slice(offset, offset + limit);
    const hasMore = offset + items.length < refs.length;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items,
        index: {total:30,embedded:21,pending:9},
        degraded: true, reason: 'index-incomplete',
        page: {
          offset,
          limit,
          returned: items.length,
          total: refs.length,
          hasMore,
          nextOffset: hasMore ? offset + items.length : null,
        },
      }),
    });
  });

  await page.goto('/');
  await page.locator('[data-action="nav-library"]').first().click();
  await page.locator('[data-action="set-search-mode"][data-mode="semantic"]').click();
  const search = page.getByRole('searchbox', { name: 'Search library' });
  await search.fill('database recovery');
  await search.press('Enter');

  await expect(page.getByText('20 of 21 documents matched by meaning.')).toBeVisible();
  await expect(page.locator('.sem-card')).toHaveCount(20);
  await expect(page.locator('[data-semantic-coverage]')).toContainText('21 of 30 documents are current; 9 pending');
  const first = page.locator('.sem-card').first();
  await expect(first.locator('.chip--synth')).toHaveText('SYNTH');
  await expect(first.locator('.chip--stale')).toHaveText('STALE');
  await expect(first.locator('.chip--verified')).toHaveCount(0);
  await expect(first.locator('.chip--unverified')).toHaveText('UNVERIFIED');

  await page.getByRole('button', { name: /Load more/ }).click();
  await expect(page.getByText('21 documents matched by meaning.')).toBeVisible();
  await expect(page.locator('.sem-card')).toHaveCount(21);
  await expect(page.getByText('Recovery reference 21', { exact: true })).toBeVisible();
  expect(offsets).toEqual([0, 20]);

  const reset = await page.request.put('/api/settings/semantic-search', {
    data: { backend: 'none', enabled: false },
  });
  expect(reset.ok()).toBe(true);
});

test('a stale Ask Prax answer cannot overwrite the newer answer and its source opens directly', async ({ page }) => {
  const projectId = await resolveProjectId(page.request, 'homelab');
  const source = await createDocument(page.request, {
    title: `Trusted retrieval source ${Date.now()}`,
    body: '# Trusted retrieval source\n\nPromote the standby only after checking replication lag.',
    documentType: 'runbook',
    project: projectId,
  });
  const verified = await page.request.post(`/api/library/documents/${source.id}/verify`, {
    data: { verified: true, as: 'retrieval-e2e', revision: source.revision },
  });
  expect(verified.ok()).toBe(true);

  let releaseFirst;
  let markFirstStarted;
  let markFirstCompleted;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const firstStarted = new Promise((resolve) => { markFirstStarted = resolve; });
  const firstCompleted = new Promise((resolve) => { markFirstCompleted = resolve; });

  await page.route('**/api/library/ask', async (route) => {
    const payload = route.request().postDataJSON();
    if (payload.q === 'first slow question') {
      markFirstStarted();
      await firstGate;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          query: payload.q,
          answer: `First stale answer [${source.title}].`,
          degraded: false,
          markdown: '',
          sources: [{ id: source.id, title: source.title, documentType: 'runbook', verified: true, kind: 'source', stale: false }],
          retrieval: { mode: 'semantic', fallback: false, reason: null },
          model: 'fake-chat',
        }),
      });
      markFirstCompleted();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        query: payload.q,
        answer: `Second current answer [${source.title}].`,
        degraded: false,
        markdown: '',
        sources: [{ id: source.id, title: source.title, documentType: 'runbook', verified: true, kind: 'source', stale: false }],
        retrieval: { mode: 'semantic', fallback: false, reason: null },
        model: 'fake-chat',
      }),
    });
  });

  await page.goto('/');
  await page.locator('[data-action="nav-library"]').first().click();
  await page.locator('.titlebar [data-action="open-ask-page"]').click();
  const input = page.getByRole('textbox', { name: 'Question for Prax' });
  await input.fill('first slow question');
  await input.press('Enter');
  await firstStarted;
  await expect(page.getByText(/Reading the most relevant doc/)).toBeVisible();

  await input.fill('second current question');
  await input.press('Enter');
  await expect(page.getByText(/Second current answer/)).toBeVisible();
  await expect(page.getByText(/First stale answer/)).toHaveCount(0);

  releaseFirst();
  await firstCompleted;
  await expect(page.getByText(/Second current answer/)).toBeVisible();
  await expect(page.getByText(/First stale answer/)).toHaveCount(0);

  const sourceButton = page.getByRole('button', {
    name: new RegExp(`^Open Source \\d+, ${source.title}, runbook, verified`),
  });
  await sourceButton.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-doc-title]')).toHaveValue(source.title);
  await expect(page.getByRole('dialog', { name: 'Ask Prax' })).toHaveCount(0);
});
