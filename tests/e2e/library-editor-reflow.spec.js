import { test, expect } from '@playwright/test';
import { createDocument, resolveProjectId } from './helpers/seed.js';

test.use({
  viewport: { width: 320, height: 800 },
  hasTouch: true,
  isMobile: true,
});

test.afterEach(async ({ request }) => {
  await request.put('/api/settings/semantic-search', {
    data: { backend: 'none', enabled: false },
  });
});

async function expectNoContentOverflow(page, label) {
  const measurement = await page.locator('.main__scroll').evaluate((scroll) => ({
    clientWidth: scroll.clientWidth,
    scrollWidth: scroll.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(
    measurement.scrollWidth,
    `${label} main content overflows horizontally: ${JSON.stringify(measurement)}`,
  ).toBeLessThanOrEqual(measurement.clientWidth + 1);
  expect(
    measurement.documentWidth,
    `${label} document overflows horizontally: ${JSON.stringify(measurement)}`,
  ).toBeLessThanOrEqual(measurement.viewportWidth + 1);
}

async function openLibrary(page) {
  await page.goto('/');
  await page.locator('[data-action="nav-library"]').first().tap();
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();
}

async function replaceEditorBody(page, body) {
  const editor = page.locator('.cm-content[contenteditable="true"]');
  await editor.tap();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(body);
  await expect(page.locator('[data-document-editor]')).toHaveValue(body);
}

test('active Library and archive reflow long ownership, trust, tags, and actions', async ({ page }) => {
  const projectId = await resolveProjectId(page.request, 'homelab');
  const prefix = `library-reflow-${Date.now()}`;
  const active = await createDocument(page.request, {
    title: `${prefix} an intentionally long operational recovery document title`,
    body: '# Recovery\n\nA long excerpt that must remain inside its card at four hundred percent equivalent zoom.\n',
    documentType: 'runbook',
    project: projectId,
    kind: 'synthesized',
    tags: ['database-recovery', 'high-availability', 'incident-response'],
  }, { origin: 'agent' });
  const archived = await createDocument(page.request, {
    title: `${prefix} archived document with a deliberately long title`,
    body: '# Archived\n',
    documentType: 'known-issue',
    project: projectId,
    tags: ['historical-incident'],
  });
  const archivedResponse = await page.request.delete(`/api/library/documents/${archived.id}`);
  expect(archivedResponse.ok()).toBe(true);

  await openLibrary(page);
  const card = page.locator('.doc-card', { hasText: active.title });
  await expect(card).toBeVisible();
  await expect(card.getByText('Homelab', { exact: true })).toBeVisible();
  await expectNoContentOverflow(page, 'active Library');

  await page.locator('[data-action="toggle-library-menu"]').tap();
  await page.locator('[data-action="toggle-library-view"]').tap();
  const archivedRow = page.locator('.plain-row', { hasText: archived.title });
  await expect(archivedRow).toBeVisible();
  await expect(archivedRow.getByRole('button', { name: 'Restore' })).toBeVisible();
  await expect(archivedRow.getByRole('button', { name: 'Delete' })).toBeVisible();
  await expectNoContentOverflow(page, 'Library archive');
});

test('semantic result metadata reflows without page-level horizontal travel', async ({ page }) => {
  const projectId = await resolveProjectId(page.request, 'homelab');
  const configured = await page.request.put('/api/settings/semantic-search', {
    data: { backend: 'fake', enabled: true },
  });
  expect(configured.ok()).toBe(true);
  await page.route('**/api/library/documents/semantic-search*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{
        id: 'narrow-semantic-result',
        title: 'A semantic result with a very long operational title',
        body: '# Result\n',
        documentType: 'runbook',
        projectId,
        kind: 'synthesized',
        verified: false,
        snippet: 'A deliberately long semantic explanation that must wrap within the result card.',
        similarity: 0.876,
      }]),
    });
  });

  await openLibrary(page);
  await page.locator('[data-action="set-search-mode"][data-mode="semantic"]').tap();
  const search = page.getByLabel('Search library');
  await search.fill('recover the database safely');
  await search.press('Enter');
  await expect(page.getByText('A semantic result with a very long operational title', { exact: true })).toBeVisible();
  await expect(page.getByText('UNVERIFIED', { exact: true })).toBeVisible();
  await expectNoContentOverflow(page, 'semantic Library results');
});

test('narrow editor stacks split panes, exposes controls and outline, and saves an exact draft', async ({ page }) => {
  const projectId = await resolveProjectId(page.request, 'homelab');
  const prefix = `editor-reflow-${Date.now()}`;
  const doc = await createDocument(page.request, {
    title: `${prefix} narrow editor document`,
    body: '# Narrow editor\n\n## First section\n\nInitial body.\n\n## Second section\n\n```text\nthis-is-an-intentionally-long-code-line-that-may-scroll-only-inside-its-code-container\n```\n',
    documentType: 'runbook',
    project: projectId,
    tags: ['responsive-editor', 'recovery'],
  });

  await openLibrary(page);
  await page.locator('.doc-card', { hasText: doc.title }).tap();
  await expect(page.locator('[data-doc-title]')).toHaveValue(doc.title);
  await expectNoContentOverflow(page, 'split editor');

  const paneBoxes = await page.locator('.editor-body > .pane').evaluateAll((panes) => panes.map((pane) => {
    const rect = pane.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width };
  }));
  expect(paneBoxes).toHaveLength(2);
  expect(Math.abs(paneBoxes[1].x - paneBoxes[0].x)).toBeLessThanOrEqual(1);
  expect(paneBoxes[1].y).toBeGreaterThan(paneBoxes[0].y);

  for (const name of ['Outline', '▶ Run', 'Export', 'Edit', 'Preview', 'Split', 'Focus']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  }
  const outlineToggle = page.getByRole('button', { name: 'Outline', exact: true });
  if (await outlineToggle.getAttribute('aria-pressed') !== 'true') await outlineToggle.tap();
  const outline = page.getByRole('complementary', { name: 'Document outline' });
  await expect(outline).toBeVisible();
  const outlineAndBody = await page.locator('.outline, .editor-body').evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, width: rect.width };
  }));
  expect(outlineAndBody[0].x).toBeCloseTo(outlineAndBody[1].x, 0);
  expect(outlineAndBody[0].width).toBeLessThanOrEqual(outlineAndBody[1].width + 1);
  await expectNoContentOverflow(page, 'editor with outline');

  await page.getByTitle('Document actions').tap();
  await page.getByRole('button', { name: 'Document info…' }).tap();
  await expect(page.locator('.editor-info')).toBeVisible();
  await expectNoContentOverflow(page, 'document info');
  await page.getByRole('button', { name: 'Cancel', exact: true }).tap();

  await page.getByRole('button', { name: 'Edit', exact: true }).tap();
  const revisedTitle = `${prefix} exact narrow draft`;
  const revisedBody = '# Exact narrow draft\n\nSaved without zooming out.\n';
  await page.locator('[data-doc-title]').fill(revisedTitle);
  await replaceEditorBody(page, revisedBody);
  await expect(page.locator('[data-document-save-status]')).toHaveText('Saved');
  await expect.poll(async () => {
    const response = await page.request.get(`/api/library/documents/${doc.id}`);
    const saved = await response.json();
    return { title: saved.title, body: saved.body };
  }).toEqual({ title: revisedTitle, body: revisedBody });
  await expectNoContentOverflow(page, 'narrow edit mode');
});
