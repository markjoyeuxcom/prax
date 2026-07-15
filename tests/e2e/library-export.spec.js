import { test, expect } from '@playwright/test';
import { resolveProjectId } from './helpers/seed.js';

test('Library export chooses scope and writes the ZIP through the browser Save dialog', async ({ page }) => {
  await page.addInitScript(() => {
    window.__libraryExportCapture = { events: [], pickerOptions: null, bytes: 0, type: '', closed: false };
    window.showSaveFilePicker = async (options) => {
      window.__libraryExportCapture.events.push('picker');
      window.__libraryExportCapture.pickerOptions = options;
      return {
        async createWritable() {
          window.__libraryExportCapture.events.push('writable');
          return {
            async write(blob) {
              window.__libraryExportCapture.events.push('write');
              window.__libraryExportCapture.bytes = (await blob.arrayBuffer()).byteLength;
              window.__libraryExportCapture.type = blob.type;
            },
            async close() {
              window.__libraryExportCapture.events.push('close');
              window.__libraryExportCapture.closed = true;
            },
          };
        },
      };
    };
  });

  await page.goto('/');
  await page.locator('[data-action="nav-library"]').first().click();

  const action = page.locator('[data-action="export-library"]').first();
  await expect(action).toHaveText('Export…');
  await action.click();

  const dialog = page.getByRole('dialog', { name: 'Export Library' });
  await expect(dialog).toBeVisible();
  const scope = dialog.locator('[data-library-export-scope]');
  await expect(scope).toBeFocused();
  await expect(dialog).toContainText('Browser Save dialog');
  await expect(dialog.getByRole('button', { name: 'Choose location & export' })).toBeVisible();

  // Tab stays inside the dialog, and Escape returns focus to the exact opener.
  await dialog.getByRole('button', { name: 'Choose location & export' }).focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close Library export' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(action).toBeFocused();

  await action.click();
  await scope.selectOption('work');
  await expect(scope).toHaveValue('work');
  await expect(dialog.locator('[data-library-export-filename]')).toHaveText(/prax-library-work-\d{4}-\d{2}-\d{2}\.zip/);
  await dialog.getByRole('button', { name: 'Choose location & export' }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.toast')).toContainText(/Saved prax-library-work-\d{4}-\d{2}-\d{2}\.zip/);
  const capture = await page.evaluate(() => window.__libraryExportCapture);
  expect(capture.events).toEqual(['picker', 'writable', 'write', 'close']);
  expect(capture.pickerOptions.suggestedName).toMatch(/^prax-library-work-\d{4}-\d{2}-\d{2}\.zip$/);
  expect(capture.pickerOptions.types[0].accept).toEqual({ 'application/zip': ['.zip'] });
  expect(capture.bytes).toBeGreaterThan(0);
  expect(capture.type).toBe('application/zip');
  expect(capture.closed).toBe(true);
});

test('cancelling the browser Save dialog leaves Library export open without an error', async ({ page }) => {
  await page.addInitScript(() => {
    window.showSaveFilePicker = async () => {
      throw new DOMException('The user aborted a request.', 'AbortError');
    };
  });
  await page.goto('/');
  await page.locator('[data-action="nav-library"]').first().click();
  await page.locator('[data-action="export-library"]').first().click();

  const dialog = page.getByRole('dialog', { name: 'Export Library' });
  await dialog.getByRole('button', { name: 'Choose location & export' }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[role="alert"]')).toHaveCount(0);
  await expect(dialog.locator('[data-library-export-scope]')).toBeEnabled();
});

test('Settings project and entire-Library actions use the same export dialog', async ({ page }) => {
  const homelabId = await resolveProjectId(page.request, 'homelab');
  await page.goto('/');
  await page.locator(`[data-action="nav-project"][data-project-id="${homelabId}"]`).first().click();
  await page.locator('[data-action="nav-settings"]').first().click();
  await page.locator('[data-action="set-settings-tab"][data-tab="data"]').click();

  const projectAction = page.locator('[data-action="export-library-project"]');
  await projectAction.click();
  const dialog = page.getByRole('dialog', { name: 'Export Library' });
  await expect(dialog.locator('[data-library-export-scope]')).toHaveValue('homelab');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(projectAction).toBeFocused();

  const allAction = page.locator('[data-action="export-library-all"]');
  await allAction.click();
  await expect(dialog.locator('[data-library-export-scope]')).toHaveValue('all');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(allAction).toBeFocused();
});
