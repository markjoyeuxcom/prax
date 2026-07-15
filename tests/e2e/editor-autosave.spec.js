import { test, expect } from '@playwright/test';
import { seedDerivedFromPair } from './helpers/seed.js';

async function replaceEditorBody(page, body) {
  const editor = page.locator('.cm-content[contenteditable="true"]');
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(body);
  await expect(page.locator('[data-document-editor]')).toHaveValue(body);
}

test('switching documents flushes the old draft without corrupting the new document', async ({ page }) => {
  const prefix = `autosave-switch-${Date.now()}`;
  const { source, synthesized } = await seedDerivedFromPair(page.request, prefix);

  await page.goto('/');
  await page.locator('[data-action="nav-library"]').first().click();
  await page.locator('.doc-card', { hasText: synthesized.title }).click();
  await expect(page.locator('[data-document-links]')).toBeVisible();

  // Hold the body PATCH open long enough for navigation to overlap it. The UI
  // must wait for this save before replacing the editor context.
  await page.route(`**/api/library/documents/${synthesized.id}`, async (route) => {
    if (route.request().method() === 'PATCH') {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    await route.continue();
  });

  const revisedBody = '# synthesized\n\nbody saved before switching\n';
  await replaceEditorBody(page, revisedBody);
  await page.locator('[data-doc-title]').fill(`${prefix} synthesized renamed`);
  await page.locator('[data-document-links] .doc-row', { hasText: source.title }).click();

  await expect(page.locator('[data-doc-title]')).toHaveValue(source.title);
  await expect.poll(async () => {
    const response = await page.request.get(`/api/library/documents/${synthesized.id}`);
    return (await response.json()).title;
  }).toBe(`${prefix} synthesized renamed`);

  const savedOld = await (await page.request.get(`/api/library/documents/${synthesized.id}`)).json();
  const untouchedNew = await (await page.request.get(`/api/library/documents/${source.id}`)).json();
  expect(savedOld.body).toBe(revisedBody);
  expect(savedOld.title).toBe(`${prefix} synthesized renamed`);
  expect(untouchedNew.title).toBe(source.title);
  expect(untouchedNew.body).toBe(source.body);
});

test('top-level project navigation waits for the exact editor draft to commit', async ({ page }) => {
  const prefix = `autosave-project-nav-${Date.now()}`;
  const { synthesized } = await seedDerivedFromPair(page.request, prefix);
  const projects = await (await page.request.get('/api/projects')).json();
  const inbox = projects.find((project) => project.slug === 'inbox');
  const revisedTitle = `${prefix} saved before project navigation`;
  const revisedBody = '# Navigation barrier\n\nPersist this exact draft before leaving.\n';
  let releasePatch;
  let markPatchStarted;
  const patchGate = new Promise((resolve) => { releasePatch = resolve; });
  const patchStarted = new Promise((resolve) => { markPatchStarted = resolve; });

  await page.goto('/');
  await page.locator('[data-action="nav-library"]').first().click();
  await page.locator('.doc-card', { hasText: synthesized.title }).click();
  await page.route(`**/api/library/documents/${synthesized.id}`, async (route) => {
    if (route.request().method() === 'PATCH') {
      markPatchStarted();
      await patchGate;
    }
    await route.continue();
  });

  await page.locator('[data-doc-title]').fill(revisedTitle);
  await replaceEditorBody(page, revisedBody);
  await page.locator(`[data-action="nav-project"][data-project-id="${inbox.id}"]`).first().click();
  await patchStarted;

  await expect(page.locator('[data-doc-title]')).toHaveValue(revisedTitle);
  await expect(page.locator(`[data-action="nav-project"][data-project-id="${inbox.id}"]`).first()).not.toHaveAttribute('aria-current', 'true');
  releasePatch();

  await expect(page.locator(`[data-action="nav-project"][data-project-id="${inbox.id}"]`).first()).toHaveAttribute('aria-current', 'true');
  const saved = await (await page.request.get(`/api/library/documents/${synthesized.id}`)).json();
  expect(saved.title).toBe(revisedTitle);
  expect(saved.body).toBe(revisedBody);
});

test('failed save blocks top-level navigation and keeps recovery in the editor', async ({ page }) => {
  const prefix = `autosave-block-nav-${Date.now()}`;
  const { synthesized } = await seedDerivedFromPair(page.request, prefix);
  const projects = await (await page.request.get('/api/projects')).json();
  const inbox = projects.find((project) => project.slug === 'inbox');
  const revisedTitle = `${prefix} must stay visible`;
  const revisedBody = '# Failed navigation save\n\nStay with this draft.\n';

  await page.goto('/');
  await page.locator('[data-action="nav-library"]').first().click();
  await page.locator('.doc-card', { hasText: synthesized.title }).click();
  await page.route(`**/api/library/documents/${synthesized.id}`, async (route) => {
    if (route.request().method() === 'PATCH') {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'injected navigation save failure' }),
      });
      return;
    }
    await route.continue();
  });

  await page.locator('[data-doc-title]').fill(revisedTitle);
  await replaceEditorBody(page, revisedBody);
  await page.locator(`[data-action="nav-project"][data-project-id="${inbox.id}"]`).first().click();

  await expect(page.locator('[data-document-save-status]')).toHaveText('Save failed');
  await expect(page.locator('[data-document-save-action]')).toHaveText('Retry');
  await expect(page.locator('[data-doc-title]')).toHaveValue(revisedTitle);
  await expect(page.locator('[data-document-editor]')).toHaveValue(revisedBody);
  await expect(page.getByText('Save this document before leaving it.')).toBeVisible();
  await expect(page.locator(`[data-action="nav-project"][data-project-id="${inbox.id}"]`).first()).not.toHaveAttribute('aria-current', 'true');

  const stored = await (await page.request.get(`/api/library/documents/${synthesized.id}`)).json();
  expect(stored.title).toBe(synthesized.title);
  expect(stored.body).toBe(synthesized.body);
});

test('failed title/body save survives reload and one coalesced retry commits the exact draft', async ({ page }) => {
  const prefix = `autosave-recovery-${Date.now()}`;
  const { synthesized } = await seedDerivedFromPair(page.request, prefix);
  const revisedTitle = `${prefix} recovered title`;
  const revisedBody = '# Recovered draft\n\nExact body kept through failure and reload.\n';
  let patchAttempts = 0;
  const committedPatches = [];

  await page.route(`**/api/library/documents/${synthesized.id}`, async (route) => {
    if (route.request().method() !== 'PATCH') {
      await route.continue();
      return;
    }
    patchAttempts += 1;
    const payload = route.request().postDataJSON();
    if (patchAttempts === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'injected persistence failure' }),
      });
      return;
    }
    committedPatches.push(payload);
    await route.continue();
  });

  await page.goto('/');
  await page.locator('[data-action="nav-library"]').first().click();
  await page.locator('.doc-card', { hasText: synthesized.title }).click();
  await expect(page.locator('[data-document-editor]')).toHaveValue(synthesized.body);
  await page.locator('[data-doc-title]').fill(revisedTitle);
  await replaceEditorBody(page, revisedBody);

  await expect(page.locator('[data-document-save-status]')).toHaveText('Save failed');
  await expect(page.locator('[data-document-save-action]')).toHaveText('Retry');
  await expect(page.locator('[data-document-save-action]')).toBeVisible();
  expect(patchAttempts).toBe(1);
  expect(committedPatches).toHaveLength(0);

  // Reload discards page memory. Reopening the still-old server document must
  // restore the exact locally protected draft without silently autosaving it.
  await page.reload();
  await page.locator('[data-action="nav-library"]').first().click();
  await page.locator('.doc-card', { hasText: synthesized.title }).click();
  await expect(page.locator('[data-doc-title]')).toHaveValue(revisedTitle);
  await expect(page.locator('[data-document-editor]')).toHaveValue(revisedBody);
  await expect(page.locator('[data-document-save-status]')).toHaveText('Recovered draft');
  await expect(page.locator('[data-document-save-action]')).toHaveText('Save recovered draft');
  await page.waitForTimeout(1400);
  expect(patchAttempts).toBe(1);

  // Dispatch twice in the same task. The in-flight promise must coalesce both
  // activations into one successful PATCH of one coherent title/body version.
  await page.locator('[data-document-save-action]').evaluate((button) => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await expect(page.locator('[data-document-save-status]')).toHaveText('Saved');
  await expect(page.locator('[data-document-save-action]')).toBeHidden();
  await page.waitForTimeout(1400);

  expect(patchAttempts).toBe(2);
  expect(committedPatches).toEqual([{ title: revisedTitle, body: revisedBody }]);
  const saved = await (await page.request.get(`/api/library/documents/${synthesized.id}`)).json();
  expect(saved.title).toBe(revisedTitle);
  expect(saved.body).toBe(revisedBody);
  expect(await page.evaluate(() => Object.keys(localStorage)
    .filter((key) => key.startsWith('prax.documentDraftRecovery.v1.')))).toEqual([]);
});

test('a lost success response is reconciled without reporting failure or retrying the write', async ({ page }) => {
  const prefix = `autosave-reconcile-${Date.now()}`;
  const { synthesized } = await seedDerivedFromPair(page.request, prefix);
  const revisedTitle = `${prefix} committed once`;
  const revisedBody = '# Committed\n\nThe response was lost, not the write.\n';
  let committedPatches = 0;

  await page.route(`**/api/library/documents/${synthesized.id}`, async (route) => {
    if (route.request().method() !== 'PATCH') {
      await route.continue();
      return;
    }
    committedPatches += 1;
    // Let the production route commit, then replace only its response. The UI
    // must read back the canonical record before calling this a failed write.
    await route.fetch();
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'injected lost response' }),
    });
  });

  await page.goto('/');
  await page.locator('[data-action="nav-library"]').first().click();
  await page.locator('.doc-card', { hasText: synthesized.title }).click();
  await expect(page.locator('[data-document-editor]')).toHaveValue(synthesized.body);
  await page.locator('[data-doc-title]').fill(revisedTitle);
  await replaceEditorBody(page, revisedBody);

  await expect(page.locator('[data-document-save-status]')).toHaveText('Saved');
  await expect(page.locator('[data-document-save-action]')).toBeHidden();
  await page.waitForTimeout(1400);
  expect(committedPatches).toBe(1);

  const saved = await (await page.request.get(`/api/library/documents/${synthesized.id}`)).json();
  expect(saved.title).toBe(revisedTitle);
  expect(saved.body).toBe(revisedBody);
});
