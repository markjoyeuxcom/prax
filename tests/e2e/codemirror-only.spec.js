import { test, expect } from '@playwright/test';
import { seedDerivedFromPair } from './helpers/seed.js';

test('a saved Plain preference opens CodeMirror and preserves editing and appearance choices', async ({ page }) => {
  const { synthesized } = await seedDerivedFromPair(page.request, `codemirror-only-${Date.now()}`);
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('prax.preferences', JSON.stringify({
    editorEngine: 'plain', theme: 'dark', editorFont: 'monospace', lineNumbers: true, readingScale: 1.1,
  })));
  await page.reload();
  await page.locator('[data-action="nav-library"]').first().click();
  await page.locator('.doc-card', { hasText: synthesized.title }).click();

  const editor = page.locator('.cm-content[contenteditable="true"]');
  await expect(editor).toBeVisible();
  await expect(page.locator('.cm-lineNumbers')).toBeVisible();
  await expect(page.locator('.cm-scroller')).toHaveCSS('font-family', /monospace/);
  await expect(page.locator('body')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('[data-document-editor]')).toBeHidden();
  await expect(page.locator('[data-document-editor]')).toHaveValue(synthesized.body);

  const body = '# CodeMirror only\n\nSaved from the retired Plain preference.\n';
  await editor.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(body);
  await expect(page.locator('[data-document-save-status]')).toHaveText('Saved');
  expect((await (await page.request.get(`/api/library/documents/${synthesized.id}`)).json()).body).toBe(body);

  await page.locator('[data-action="nav-settings"]').first().click();
  await expect(page.locator('[data-action="set-editor-engine"]')).toHaveCount(0);
  await expect(page.getByText('Editor engine', { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-action="set-editor-font"][data-font="monospace"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-action="set-editor-font"][data-font="proportional"]').click();
  const preferences = await page.evaluate(() => JSON.parse(localStorage.getItem('prax.preferences')));
  expect(preferences).not.toHaveProperty('editorEngine');
  expect(preferences).toMatchObject({ theme: 'dark', editorFont: 'proportional', lineNumbers: true, readingScale: 1.1 });

  await page.reload();
  await page.locator('[data-action="nav-library"]').first().click();
  await page.locator('.doc-card', { hasText: synthesized.title }).click();
  await expect(editor).toBeVisible();
  await expect(page.locator('.cm-scroller')).toHaveCSS('font-family', /Instrument Sans/);
  await expect(page.locator('[data-document-editor]')).toHaveValue(body);
});
