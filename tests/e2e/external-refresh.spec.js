import { test, expect } from '@playwright/test';
import { resolveProjectId } from './helpers/seed.js';

// The main window must show work written OUTSIDE it — the desktop capture bar
// (its own webview), the memory skills, the CLI, MCP — without a reload. It
// used to load its collections once and refetch only after its own writes, so
// a captured task stayed invisible until the app was relaunched.

async function focusMain(page) {
  // What the OS does when the capture bar hides or the user clicks back in.
  await page.bringToFront();
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

test('a task captured from the capture bar appears in the main window on focus, without a reload', async ({ browser }) => {
  const context = await browser.newContext();
  const main = await context.newPage();
  await main.goto('/');
  await expect(main.locator('[data-action="nav-project"]').first()).toBeVisible();
  const reloads = [];
  main.on('framenavigated', (frame) => { if (frame === main.mainFrame()) reloads.push(frame.url()); });

  const title = `External refresh via bar ${Date.now()}`;
  const bar = await context.newPage();
  await bar.goto('/capture.html?shell=desktop');
  await bar.fill('#capture-input', title);
  await bar.keyboard.press('Enter');
  await expect(bar.locator('#capture-hint')).toContainText('Added to Inbox');

  await focusMain(main);
  const inbox = await resolveProjectId(main.request, 'inbox');
  await main.locator(`[data-action="nav-project"][data-project-id="${inbox}"]`).first().click();
  await expect(main.locator('.task-row', { hasText: title })).toBeVisible({ timeout: 5000 });
  expect(reloads, 'the main window was never reloaded').toEqual([]);
  await context.close();
});

test('a task written by an agent through the API appears after the window regains focus, and an open draft survives the refresh', async ({ page, request }) => {
  const stamp = Date.now();
  const inbox = await resolveProjectId(request, 'inbox');
  const seeded = await (await request.post('/api/tasks', { data: { title: `Draft holder ${stamp}`, project: 'inbox', priority: 'medium', status: 'planned' } })).json();
  await page.goto('/');
  await page.locator(`[data-action="nav-project"][data-project-id="${inbox}"]`).first().click();
  await page.locator('.task-row', { hasText: seeded.title }).click();
  await expect(page.locator('.drawer[data-task-id]')).toBeVisible();
  // Let the drawer's post-open renders settle before typing (see task-drawer-draft.spec.js).
  await page.waitForTimeout(600);
  const typed = `Draft holder ${stamp} edited but unsaved`;
  await page.locator('[data-task-title]').fill(typed);

  // Meanwhile an agent (skill / CLI / MCP) creates a task in the same project.
  const external = await (await request.post('/api/tasks', {
    data: { title: `Agent wrote this ${stamp}`, project: 'inbox', priority: 'medium', status: 'planned' },
    headers: { 'x-prax-origin': 'agent', 'x-prax-agent': 'codex' },
  })).json();
  expect(external.title).toContain('Agent wrote this');

  await focusMain(page);
  await expect(page.locator('.task-row', { hasText: external.title })).toBeVisible({ timeout: 5000 });
  await expect(page.locator('[data-task-title]')).toHaveValue(typed);
});

test('a document written by an agent appears in the Library after focus', async ({ page, request }) => {
  const stamp = Date.now();
  await page.goto('/');
  await page.locator('[data-action="nav-library"]').first().click();
  await expect(page.locator('[data-action="nav-library"]').first()).toBeVisible();
  const title = `Agent memory ${stamp}`;
  const created = await (await request.post('/api/library/documents', {
    data: { title, body: 'remembered from outside the window', project: 'inbox', documentType: 'note' },
    headers: { 'x-prax-origin': 'agent', 'x-prax-agent': 'claude' },
  })).json();
  expect(created.id).toBeTruthy();
  await focusMain(page);
  await expect(page.getByText(title).first()).toBeVisible({ timeout: 5000 });
});
