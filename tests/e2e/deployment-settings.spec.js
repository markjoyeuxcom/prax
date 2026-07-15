import { test, expect } from '@playwright/test';

async function openSettingsTab(page, tab) {
  await page.goto('/');
  await page.locator('[data-action="nav-settings"]').first().click();
  await page.locator(`[data-action="set-settings-tab"][data-tab="${tab}"]`).click();
}

test('Settings reports the production server as local-only and explicitly unauthenticated', async ({ page }) => {
  await openSettingsTab(page, 'data');
  const row = page.locator('.settings-row', { hasText: 'Deployment security' });
  await expect(row).toContainText('Local only');
  await expect(row).toContainText('Listening on 127.0.0.1');
  await expect(row).toContainText('no user accounts or authorization');
});

test('a provider-status load failure cannot masquerade as an Off configuration', async ({ page }) => {
  await page.route('**/api/settings/semantic-search', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"injected status failure"}' });
      return;
    }
    await route.continue();
  });

  await openSettingsTab(page, 'intelligence');
  await expect(page.locator('[role="alert"]', { hasText: 'Prax could not load semantic-search settings.' })).toBeVisible();
  await expect(page.locator('[data-action="set-ai-provider"][data-backend="ollama"]')).toBeDisabled();
  await expect(page.getByText('Pick a provider below to enable searching the library by meaning.')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry status' }).first()).toBeVisible();
});

test('a lost provider-switch response is reconciled without replay and controls are single-flight', async ({ page, request }) => {
  const reset = await request.put('/api/settings/semantic-search', { data: { backend: 'none' } });
  expect(reset.ok()).toBe(true);
  await openSettingsTab(page, 'intelligence');

  let putCount = 0;
  let markCommitted;
  let releaseResponse;
  const committed = new Promise((resolve) => { markCommitted = resolve; });
  const responseGate = new Promise((resolve) => { releaseResponse = resolve; });
  await page.route('**/api/settings/semantic-search', async (route) => {
    if (route.request().method() === 'PUT' && route.request().postDataJSON().backend === 'ollama') {
      putCount += 1;
      await route.fetch();
      markCommitted();
      await responseGate;
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"injected lost response"}' });
      return;
    }
    await route.continue();
  });

  await page.locator('[data-action="set-ai-provider"][data-backend="ollama"]').click();
  await committed;
  await expect(page.locator('[data-action="set-ai-provider"][data-backend="ollama"]')).toBeDisabled();
  await page.locator('[data-action="set-ai-provider"][data-backend="ollama"]').click({ force: true });
  releaseResponse();

  await expect(page.locator('.toast')).toContainText('settings were saved');
  await expect(page.locator('[data-action="set-ai-provider"][data-backend="ollama"]')).toHaveClass(/is-active/);
  expect(putCount).toBe(1);

  const cleanup = await request.put('/api/settings/semantic-search', { data: { backend: 'none', enabled: false } });
  expect(cleanup.ok()).toBe(true);
});

test('a rejected provider save preserves the entered draft for correction', async ({ page, request }) => {
  const configured = await request.put('/api/settings/semantic-search', {
    data: { backend: 'ollama', model: 'old-model', baseUrl: 'http://127.0.0.1:11434' },
  });
  expect(configured.ok()).toBe(true);
  await openSettingsTab(page, 'intelligence');

  await page.route('**/api/settings/semantic-search', async (route) => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({ status: 400, contentType: 'application/json', body: '{"message":"model rejected"}' });
      return;
    }
    await route.continue();
  });

  await page.locator('[data-ai-model]').fill('correct-me-model');
  await page.locator('[data-action="save-ai-provider"]').click();
  await expect(page.locator('.toast')).toContainText('model rejected');
  await expect(page.locator('.toast')).toContainText('review before retrying');
  await expect(page.locator('[data-ai-model]')).toHaveValue('correct-me-model');
  await expect(page.locator('[data-action="save-ai-provider"]')).toBeEnabled();

  const cleanup = await request.put('/api/settings/semantic-search', { data: { backend: 'none', enabled: false } });
  expect(cleanup.ok()).toBe(true);
});
