import { test, expect } from '@playwright/test';
import { createDocument, resolveProjectId } from './helpers/seed.js';

// Ask Prax as a page (Console redesign, 2026-10). With no chat model the page
// shows the retrieved sources and says why there is no
// written answer; the question lands in the per-device history.
test.use({ viewport: { width: 1440, height: 900 } });

test('Ask opens a page: question, sources rail, honest no-model notice, history', async ({ page, request }) => {
  const stamp = Date.now();
  const projectId = await resolveProjectId(page.request, 'homelab');
  await createDocument(request, {
    title: `Zircon failover ${stamp}`, body: `# Zircon failover ${stamp}\n\nPromote the replica, then repoint the app.`, documentType: 'runbook', project: projectId,
  });

  // The full suite may have enabled its fake model in an earlier spec.
  const previousBackend = (await (await request.get('/api/settings/ai-answers')).json()).backend;
  expect((await request.put('/api/settings/ai-answers', { data: { backend: 'none' } })).ok()).toBe(true);
  test.info().annotations.push({ type: 'fixture', description: `Restores answer backend ${previousBackend}` });
  try {
    await askWithoutModel(page, stamp);
  } finally {
    expect((await request.put('/api/settings/ai-answers', { data: { backend: previousBackend } })).ok()).toBe(true);
  }
});

async function askWithoutModel(page, stamp) {
  await page.goto('/');
  await page.locator('.titlebar [data-action="open-ask-page"]').click();
  await expect(page.locator('.ask-intro__title')).toHaveText('Ask Prax');
  await expect(page.locator('.statusbar__mode')).toHaveText('ASK');

  const input = page.locator('[data-ask-page-input]');
  await input.fill(`zircon failover ${stamp}`);
  await input.press('Enter');
  await expect(page.locator('.ask-q')).toHaveText(`zircon failover ${stamp}`);
  await expect(page.locator('.ask-notice')).toContainText('No AI model is set');
  await expect(page.locator('.ask-src', { hasText: `Zircon failover ${stamp}` })).toBeVisible();
  await expect(page.locator('.ask-hist__item', { hasText: `zircon failover ${stamp}` })).toBeVisible();

  // A source opens its document.
  await page.locator('.ask-src', { hasText: `Zircon failover ${stamp}` }).click();
  await expect(page.locator('[data-doc-title]')).toHaveValue(`Zircon failover ${stamp}`);

  // Back on the page, the history entry restores the answer without asking again.
  await page.locator('.titlebar [data-action="open-ask-page"]').click();
  await page.locator('.ask-hist__item', { hasText: `zircon failover ${stamp}` }).click();
  await expect(page.locator('.ask-q')).toHaveText(`zircon failover ${stamp}`);
}

test('the palette opens the same page, and the Library no longer repeats Ask', async ({ page }) => {
  await page.goto('/');
  await page.locator('.places [data-action="nav-library"]').click();
  await expect(page.locator('main [data-action="open-ask-prax"]')).toHaveCount(0);
  await page.locator('.titlebar [data-action="open-palette"]').click();
  await page.keyboard.type('Ask Prax');
  await page.locator('.palette__item', { hasText: 'Ask Prax' }).first().click();
  await expect(page.locator('.ask-page')).toBeVisible();
  await expect(page.locator('[data-overlay="askprax"]')).toHaveCount(0);
});

test('the composer takes new lines with Shift+Enter and empties when the question is asked', async ({ page, request }) => {
  const previousBackend = (await (await request.get('/api/settings/ai-answers')).json()).backend;
  expect((await request.put('/api/settings/ai-answers', { data: { backend: 'none' } })).ok()).toBe(true);
  try {
    await page.goto('/');
    await page.locator('.titlebar [data-action="open-ask-page"]').click();
    const input = page.locator('[data-ask-page-input]');
    await input.click();
    await page.keyboard.type('first line');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('second line');
    await expect(input).toHaveValue('first line\nsecond line');
    await page.keyboard.press('Enter');
    await expect(page.locator('.ask-q')).toContainText('first line');
    await expect(input).toHaveValue('');
    await expect(page.locator('[data-action="run-ask-prax"]')).toBeDisabled();
  } finally {
    expect((await request.put('/api/settings/ai-answers', { data: { backend: previousBackend } })).ok()).toBe(true);
  }
});

test('closing Ask returns to where it was opened, by button or Esc', async ({ page }) => {
  await page.goto('/');
  await page.locator('.places [data-action="nav-library"]').click();
  await page.locator('.titlebar [data-action="open-ask-page"]').click();
  await expect(page.locator('.ask-page')).toBeVisible();
  await page.getByRole('button', { name: 'Close Ask Prax' }).click();
  await expect(page.locator('.ask-page')).toHaveCount(0);
  await expect(page.locator('[data-library-search]')).toBeVisible();

  await page.locator('.places [data-action="nav-today"]').click();
  await page.locator('.titlebar [data-action="open-ask-page"]').click();
  await expect(page.locator('[data-ask-page-input]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.ask-page')).toHaveCount(0);
  await expect(page.locator('.statusbar__mode')).not.toHaveText('ASK');
});
