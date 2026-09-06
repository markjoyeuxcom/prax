import { test, expect } from '@playwright/test';
import { resolveProjectId } from './helpers/seed.js';

// The main window must show work written OUTSIDE it — the desktop capture bar
// (its own webview), the memory skills, the CLI, MCP — without a reload. It
// used to load its collections once and refetch only after its own writes, so
// a captured task stayed invisible until the app was relaunched.

async function focusMain(page) {
  // What the OS does when the capture bar hides or the user clicks back in.
  // (No bringToFront: in headless Chromium it can blur the document first, which
  // is not what a real window-focus change does to the focused field.)
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

// ---- the gaps Codex found in the first cut ------------------------------------------

async function openDrawer(page, request, title) {
  const inbox = await resolveProjectId(request, 'inbox');
  await page.locator(`[data-action="nav-project"][data-project-id="${inbox}"]`).first().click();
  await page.locator('.task-row', { hasText: title }).click();
  await expect(page.locator('.drawer[data-task-id]')).toBeVisible();
  await page.waitForTimeout(600);
}

test('a refresh snapshot that was in flight when the user saved never overwrites the newer save', async ({ page, request }) => {
  const stamp = Date.now();
  const task = await (await request.post('/api/tasks', { data: { title: `Original ${stamp}`, project: 'inbox', priority: 'medium', status: 'planned' } })).json();
  await page.goto('/');
  await openDrawer(page, request, task.title);

  // Hold the refresh's GET so its (older) snapshot lands after a newer save.
  let releaseGet; const gate = new Promise((resolve) => { releaseGet = resolve; });
  let heldOnce = false; let held; const heldReady = new Promise((resolve) => { held = resolve; });
  await page.route(/\/api\/tasks\??$/, async (route) => {
    if (route.request().method() === 'GET' && !heldOnce) {
      heldOnce = true;
      const response = await route.fetch();
      held();
      await gate;
      await route.fulfill({ response });
      return;
    }
    await route.continue();
  });
  await request.post('/api/tasks', { data: { title: `Unrelated capture ${stamp}`, project: 'inbox', priority: 'medium', status: 'planned' } });
  await focusMain(page);
  await heldReady;

  const newer = `Newer saved title ${stamp}`;
  const saved = page.waitForResponse((r) => r.url().endsWith(`/api/tasks/${task.id}`) && r.request().method() === 'PATCH');
  await page.locator('[data-task-title]').fill(newer);
  await page.locator('[data-task-title]').evaluate((el) => el.blur());
  await saved;
  releaseGet();
  // The discarded snapshot triggers a fresh refresh; the unrelated capture arrives through it.
  await expect(page.locator('.task-row', { hasText: `Unrelated capture ${stamp}` })).toBeVisible({ timeout: 8000 });
  await expect(page.locator('[data-task-title]')).toHaveValue(newer);
  const stored = await (await request.get(`/api/tasks/${task.id}`)).json();
  expect(stored.title).toBe(newer);
  const local = await page.evaluate(async (id) => { const { state } = await import('/js/state.js'); return state.tasks.find((t) => t.id === id)?.title; }, task.id);
  expect(local).toBe(newer);
});

test('a task written outside the window does not re-mount an open document editor or move its caret', async ({ page, request }) => {
  const stamp = Date.now();
  const doc = await (await request.post('/api/library/documents', { data: { project: 'inbox', title: `Live editor ${stamp}`, body: 'abcdef', documentType: 'note' } })).json();
  await page.goto('/');
  await page.locator('[data-action="nav-library"]').first().click();
  await page.locator('.doc-card', { hasText: doc.title }).click();
  await page.locator('.cm-content').waitFor();
  await page.waitForTimeout(500);
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  const fetched = page.waitForResponse((r) => /\/api\/tasks\??$/.test(r.url()) && r.request().method() === 'GET');
  await request.post('/api/tasks', { data: { title: `Capture while editing ${stamp}`, project: 'inbox', priority: 'medium', status: 'planned' } });
  await focusMain(page);
  await fetched;
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => document.activeElement?.classList.contains('cm-content'))).toBe(true);
  await page.keyboard.insertText('X');
  await expect(page.locator('[data-document-editor]')).toHaveValue('abXcdef');
  // The task did arrive in state, ready for the next view.
  const inState = await page.evaluate(async (t) => { const { state } = await import('/js/state.js'); return state.tasks.some((x) => x.title === t); }, `Capture while editing ${stamp}`);
  expect(inState).toBe(true);
});

test('a refresh re-render keeps keyboard focus and the caret in the drawer field being edited', async ({ page, request }) => {
  const stamp = Date.now();
  const task = await (await request.post('/api/tasks', { data: { title: `Focus keeper ${stamp}`, project: 'inbox', priority: 'medium', status: 'planned' } })).json();
  await page.goto('/');
  await openDrawer(page, request, task.title);
  await page.locator('[data-task-title]').fill('Draft stays');
  await page.locator('[data-task-title]').evaluate((el) => el.setSelectionRange(5, 5));
  await request.post('/api/tasks', { data: { title: `Focus stealer ${stamp}`, project: 'inbox', priority: 'medium', status: 'planned' } });
  await focusMain(page);
  await expect(page.locator('.task-row', { hasText: `Focus stealer ${stamp}` })).toBeVisible({ timeout: 5000 });
  expect(await page.evaluate(() => document.activeElement?.hasAttribute('data-task-title'))).toBe(true);
  await page.keyboard.type('n');
  await expect(page.getByRole('dialog', { name: 'Quick capture' })).toHaveCount(0);
  await expect(page.locator('[data-task-title]')).toHaveValue('Draftn stays');
});

test('a capture made while the initial task load is in flight is not lost', async ({ page, request }) => {
  const stamp = Date.now();
  let releaseInitial; const gate = new Promise((resolve) => { releaseInitial = resolve; });
  let heldOnce = false; let held; const heldReady = new Promise((resolve) => { held = resolve; });
  await page.route(/\/api\/tasks\??$/, async (route) => {
    if (route.request().method() === 'GET' && !heldOnce) {
      heldOnce = true;
      const response = await route.fetch();
      held();
      await gate;
      await route.fulfill({ response });
      return;
    }
    await route.continue();
  });
  const navigation = page.goto('/');
  await heldReady;
  const title = `Captured during startup ${stamp}`;
  await request.post('/api/tasks', { data: { title, project: 'inbox', priority: 'medium', status: 'planned' } });
  await page.evaluate(() => {
    const channel = new BroadcastChannel('prax-changes'); channel.postMessage({ type: 'task-created' }); channel.close();
    window.dispatchEvent(new Event('focus'));
  });
  releaseInitial();
  await navigation;
  const inbox = await resolveProjectId(request, 'inbox');
  await page.locator(`[data-action="nav-project"][data-project-id="${inbox}"]`).first().click();
  await expect(page.locator('.task-row', { hasText: title })).toBeVisible({ timeout: 8000 });
});

test('a refresh while the quick-capture overlay is open keeps its mid-text caret', async ({ page, request }) => {
  const stamp = Date.now();
  await page.goto('/');
  await expect(page.locator('[data-action="nav-project"]').first()).toBeVisible();
  // Startup status requests (chat, semantic) re-render an open capture overlay
  // when they land; let them finish so the journey measures the refresh alone.
  await page.waitForLoadState('networkidle');
  await page.keyboard.press('n');
  const input = page.locator('[data-capture-input]');
  await expect(input).toBeVisible();
  await input.fill('hello world');
  await input.evaluate((el) => el.setSelectionRange(5, 5));
  await request.post('/api/tasks', { data: { title: `Arrives during capture ${stamp}`, project: 'inbox', priority: 'medium', status: 'planned' } });
  const fetched = page.waitForResponse((r) => /\/api\/tasks\??$/.test(r.url()) && r.request().method() === 'GET');
  await focusMain(page);
  await fetched;
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => document.activeElement?.hasAttribute('data-capture-input'))).toBe(true);
  await page.keyboard.type('X');
  await expect(input).toHaveValue('helloX world');
});
