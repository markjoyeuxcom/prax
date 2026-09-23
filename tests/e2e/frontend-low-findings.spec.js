import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createDocument } from './helpers/seed.js';

// Regression evidence for the frontend low-severity findings of the
// 2026-09-22 review: modal focus, keyboard-reachable links, links that leave
// the app, the answer-model draft, IME-safe keys and the persistent live region.

async function tasksWithTitle(request, title) {
  const response = await request.get(`/api/tasks?q=${encodeURIComponent(title)}`);
  expect(response.ok()).toBe(true);
  return (await response.json()).filter(task => task.title === title);
}

async function focusStaysIn(page, selector, presses, key = 'Tab') {
  for (let index = 0; index < presses; index += 1) {
    await page.keyboard.press(key);
    const inside = await page.evaluate((sel) => Boolean(document.activeElement?.closest(sel)), selector);
    expect(inside, `${key} #${index + 1} left ${selector}`).toBe(true);
  }
}

async function openDocumentPreview(page, doc) {
  await page.locator('[data-action="nav-library"]').first().click();
  await page.locator('[data-library-search]').fill(doc.title);
  await page.locator('.doc-card, .doc-table__row', { hasText: doc.title }).first().click();
  await expect(page.locator('[data-doc-title]')).toHaveValue(doc.title);
  await page.locator('[data-action="set-editor-mode"][data-mode="preview"]').click();
  return page.locator('[data-markdown-preview]');
}

test('every aria-modal overlay keeps Tab inside and makes the workspace behind it inert', async ({ page, request }) => {
  const title = `modal-focus-${randomUUID()}`;
  const created = await request.post('/api/tasks', { data: { title, description: '', notes: '', project: 'inbox', priority: 'medium', status: 'planned', labels: [] } });
  expect(created.ok()).toBe(true);
  const projects = await (await request.get('/api/projects')).json();
  const inbox = projects.find(project => project.slug === 'inbox');

  await page.goto('/');
  await page.locator(`[data-action="nav-project"][data-project-id="${inbox.id}"]`).first().click();
  await page.locator('.task-row', { hasText: title }).click();
  const drawer = page.locator('.drawer[role="dialog"]');
  await expect(drawer).toBeVisible();
  await expect(page.locator('#app > .desk')).toHaveJSProperty('inert', true);
  await focusStaysIn(page, '.drawer', 40);
  await focusStaysIn(page, '.drawer', 10, 'Shift+Tab');
  // The drawer's scrim stays live: a click on it still closes the drawer.
  await page.locator('.scrim').click({ position: { x: 5, y: 5 } });
  await expect(drawer).toHaveCount(0);
  await expect(page.locator('#app > .desk')).toHaveJSProperty('inert', false);

  // A confirm: Tab wraps inside it, and a one-key shortcut from <body> does
  // not act on the workspace behind it.
  await page.locator('[data-action="nav-filter"]').first().click();
  await page.locator('[data-filter-input]').fill('open');
  await page.locator('[data-action="save-smart-view"]').click();
  const confirm = page.getByRole('alertdialog', { name: 'Confirm' });
  await expect(confirm).toBeVisible();
  await expect(page.locator('#app > .desk')).toHaveJSProperty('inert', true);
  await focusStaysIn(page, '.confirm', 8);
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('n');
  await expect(page.getByRole('dialog', { name: 'Quick capture' })).toHaveCount(0);
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest('.confirm')))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(confirm).toHaveCount(0);

  // Quick capture.
  await page.locator('[data-action="toggle-new-menu"]').click();
  await page.getByRole('menuitem', { name: /^New task/ }).click();
  await expect(page.getByRole('dialog', { name: 'Quick capture' })).toBeVisible();
  await focusStaysIn(page, '.capture', 8);
  await focusStaysIn(page, '.capture', 4, 'Shift+Tab');
});

test('wiki links are focusable links that open their document without navigating', async ({ page, request }) => {
  const stamp = randomUUID();
  const target = await createDocument(request, { title: `wiki-target-${stamp}`, body: `# Target\n\ntarget-body-${stamp}\n`, documentType: 'note', project: 'homelab' });
  const source = await createDocument(request, { title: `wiki-source-${stamp}`, body: `# Source\n\nSee [[${target.title}]].\n`, documentType: 'note', project: 'homelab' });
  await page.goto('/');
  const preview = await openDocumentPreview(page, source);
  const link = preview.locator('a.wikilink', { hasText: target.title });
  await expect(link).toHaveAttribute('href', '#');
  await link.focus();
  await expect(link).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-doc-title]')).toHaveValue(target.title);
  expect(new URL(page.url()).hash).toBe('');
});

test('a web link in a document opens a new tab and leaves the workspace in place (browser build)', async ({ page, request, context }) => {
  const stamp = randomUUID();
  await context.route('https://example.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>external</p>' }));
  const doc = await createDocument(request, { title: `external-link-${stamp}`, body: `# Links\n\nSee [the vendor](https://example.com/prax-${stamp}).\n`, documentType: 'note', project: 'homelab' });
  await page.goto('/');
  const preview = await openDocumentPreview(page, doc);
  const opened = context.waitForEvent('page');
  await preview.locator('a', { hasText: 'the vendor' }).click();
  const tab = await opened;
  await tab.waitForLoadState();
  expect(tab.url()).toBe(`https://example.com/prax-${stamp}`);
  expect(new URL(page.url()).origin).toBe(new URL(test.info().project.use.baseURL).origin);
  await expect(page.locator('[data-doc-title]')).toHaveValue(doc.title);
});

test('the desktop app hands a clicked web link to the system browser', async ({ page, request, context }) => {
  const stamp = randomUUID();
  await page.addInitScript(() => {
    window.__opened = [];
    window.__TAURI__ = { core: { invoke: async (command, args) => { window.__opened.push({ command, args }); return null; } } };
  });
  const doc = await createDocument(request, { title: `desktop-link-${stamp}`, body: `# Links\n\nSee [the vendor](https://example.com/desktop-${stamp}).\n`, documentType: 'note', project: 'homelab' });
  let newPages = 0;
  context.on('page', () => { newPages += 1; });
  await page.goto('/?shell=desktop&platform=macos');
  const preview = await openDocumentPreview(page, doc);
  await preview.locator('a', { hasText: 'the vendor' }).click();
  await expect.poll(() => page.evaluate(() => window.__opened)).toEqual([
    { command: 'plugin:shell|open', args: { path: `https://example.com/desktop-${stamp}` } },
  ]);
  expect(newPages).toBe(0);
  await expect(page.locator('[data-doc-title]')).toHaveValue(doc.title);
});

test('a failed answer-model save keeps the typed binary path', async ({ page }) => {
  const status = { backend: 'claude-cli', available: true, model: 'haiku', binaryPath: '', connected: false };
  await page.route('**/api/settings/ai-answers', async (route) => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"injected save failure"}' });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(status) });
  });
  await page.goto('/');
  await page.locator('[data-action="nav-settings"]').first().click();
  await page.locator('[data-action="set-settings-tab"][data-tab="intelligence"]').click();
  const binary = page.locator('[data-ai-chat-binary]');
  await expect(binary).toBeEnabled();
  await binary.fill('/opt/custom/bin/claude');
  await page.locator('[data-action="save-ai-chat"]').click();
  await expect(page.locator('.toast')).toContainText('review before retrying');
  await expect(page.locator('[data-ai-chat-binary]')).toHaveValue('/opt/custom/bin/claude');
});

test('Escape and Enter that belong to an IME composition never close or submit capture', async ({ page, request }) => {
  const title = `ime-capture-${randomUUID()}`;
  await page.goto('/');
  await page.locator('[data-action="toggle-new-menu"]').click();
  await page.getByRole('menuitem', { name: /^New task/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Quick capture' });
  const input = page.locator('[data-capture-input]');
  await input.fill(title);
  const composing = (key, init) => input.evaluate((element, [name, options]) => {
    const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...options });
    if (options.keyCode) Object.defineProperty(event, 'keyCode', { get: () => options.keyCode });
    element.dispatchEvent(event);
  }, [key, init]);
  await composing('Escape', { isComposing: true });
  await composing('Enter', { isComposing: false, keyCode: 229 }); // WebKit's committing Enter
  await page.waitForTimeout(300);
  await expect(dialog).toBeVisible();
  await expect(input).toHaveValue(title);
  expect(await tasksWithTitle(request, title)).toHaveLength(0);
  await input.press('Enter');
  await expect.poll(async () => (await tasksWithTitle(request, title)).length).toBe(1);
});

test('toasts are announced through one live region that survives every render', async ({ page, request }) => {
  const title = `announce-${randomUUID()}`;
  await page.goto('/');
  const region = page.locator('#app-announcer');
  await expect(region).toHaveAttribute('aria-live', 'polite');
  await page.evaluate(() => { window.__announcer = document.getElementById('app-announcer'); });
  await page.locator('[data-action="toggle-new-menu"]').click();
  await page.getByRole('menuitem', { name: /^New task/ }).click();
  await page.locator('[data-capture-input]').fill(title);
  await page.locator('[data-capture-input]').press('Enter');
  await expect(page.locator('.toast')).toContainText('Added to');
  await expect(region).toContainText('Added to');
  expect(await page.evaluate(() => window.__announcer === document.getElementById('app-announcer')
    && !document.getElementById('app').contains(window.__announcer))).toBe(true);
  expect(await tasksWithTitle(request, title)).toHaveLength(1);
});
