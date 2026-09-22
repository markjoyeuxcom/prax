import { test, expect } from '@playwright/test';
import { createDocument, resolveProjectId } from './helpers/seed.js';

// Background work (toast expiry, context loads, external refresh) re-renders the
// shell while the person types. Every keystroke must stay in the field — and at
// the caret — that the person is typing into; none may fall through to the
// document body or a global shortcut. (Prax task 79ebc0b5.)

async function newDocument(page) {
  await page.goto('/');
  await page.locator('[data-action="toggle-new-menu"]').click();
  await page.locator('[data-action="new-document"]').click();
  await expect(page.locator('.toast')).toContainText('New document');
  await expect(page.locator('[data-doc-title]')).toBeVisible();
}

async function focusMain(page) {
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

// An agent writes a task elsewhere and the window regains focus: the external
// refresh re-renders whatever view is open.
async function externalRefresh(page, request, stamp, project = 'inbox') {
  const title = `Agent wrote this ${stamp}-${Math.random().toString(36).slice(2, 8)}`;
  const response = await request.post('/api/tasks', {
    data: { title, project, priority: 'medium', status: 'planned' },
    headers: { 'x-prax-origin': 'agent', 'x-prax-agent': 'codex' },
  });
  expect(response.ok()).toBe(true);
  await page.evaluate(() => { const el = document.querySelector('.main__scroll'); if (el) el.dataset.renderProbe = 'old'; });
  await focusMain(page);
  // The probe lives on the old DOM; a full render replaces the node.
  await expect.poll(() => page.evaluate(() => document.querySelector('.main__scroll')?.dataset.renderProbe || 'new'), { timeout: 5000 }).toBe('new');
}

// Open a seeded document with its context load held open, so the person is
// typing when the context resolves and the editor re-renders.
async function openDocumentWithHeldContext(page, request, stamp) {
  const doc = await createDocument(request, { title: `Held context ${stamp}`, body: 'alpha\nomega', documentType: 'note', project: 'inbox', tags: [] });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route(`**/api/library/documents/${doc.id}/links**`, async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto('/');
  await page.locator('[data-action="nav-library"]').first().click();
  await page.locator('.doc-card', { hasText: doc.title }).click();
  await expect(page.locator('[data-doc-title]')).toHaveValue(doc.title);
  await expect(page.locator('.cm-content[contenteditable="true"]')).toBeVisible();
  await expect(page.locator('[data-document-links]')).toHaveCount(0);
  return { doc, release };
}

test('typing a new document title across the toast expiry keeps every character in the title', async ({ page }) => {
  await newDocument(page);
  const bodyBefore = await page.locator('[data-document-editor]').inputValue();
  const title = page.locator('[data-doc-title]');
  await title.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('Platform Reliab');
  // The "New document" toast expires (2.4 s) mid-word.
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 5000 });
  await page.keyboard.type('ility runbook');

  await expect(title).toHaveValue('Platform Reliability runbook');
  await expect(title).toBeFocused();
  await expect(page.locator('[data-document-editor]')).toHaveValue(bodyBefore);
  await expect.poll(async () => {
    const response = await page.request.get('/api/library/documents');
    const body = await response.json();
    const docs = Array.isArray(body) ? body : (body.items || body.documents || []);
    return docs.some(doc => doc.title === 'Platform Reliability runbook');
  }, { timeout: 5000 }).toBe(true);
});

test('a mid-document caret survives a toast expiry', async ({ page }) => {
  await newDocument(page);
  const editor = page.locator('.cm-content[contenteditable="true"]');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText('alpha\nomega');
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.press('End');
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 5000 });
  await page.keyboard.type(' beta');

  await expect(page.locator('[data-document-editor]')).toHaveValue('alpha beta\nomega');
  await expect(editor).toBeFocused();
});

test('a checklist item being typed keeps its text and focus across a background refresh', async ({ page, request }) => {
  const stamp = Date.now();
  const inbox = await resolveProjectId(request, 'inbox');
  const task = await (await request.post('/api/tasks', {
    data: { title: `Checklist holder ${stamp}`, project: 'inbox', priority: 'medium', status: 'planned' },
  })).json();
  await page.goto('/');
  await page.locator(`[data-action="nav-project"][data-project-id="${inbox}"]`).first().click();
  await page.locator('.task-row', { hasText: task.title }).click();
  await expect(page.locator('.drawer[data-task-id]')).toBeVisible();
  const related = page.locator('[data-related-knowledge]');
  await expect(related).not.toContainText('Looking for related notes');

  const input = page.locator('[data-checklist-new]');
  await input.click();
  await page.keyboard.type('Buy mi');
  // An agent writes a task elsewhere; the window regains focus and re-renders.
  await request.post('/api/tasks', {
    data: { title: `Agent wrote this ${stamp}`, project: 'inbox', priority: 'medium', status: 'planned' },
    headers: { 'x-prax-origin': 'agent', 'x-prax-agent': 'codex' },
  });
  await focusMain(page);
  await expect(page.locator('.task-row', { hasText: `Agent wrote this ${stamp}` })).toBeVisible({ timeout: 5000 });
  await page.keyboard.type('lk');

  await expect(input).toHaveValue('Buy milk');
  await expect(input).toBeFocused();
  await expect(page.locator('.capture')).toHaveCount(0);

  // Adding the item still clears the field for the next one.
  await page.keyboard.press('Enter');
  await expect(page.locator('.check-item', { hasText: 'Buy milk' })).toBeVisible();
  await expect(input).toHaveValue('');
});

test('a background render during an inline project rename neither saves nor discards the draft', async ({ page, request }) => {
  const stamp = Date.now();
  const created = await (await request.post('/api/projects', { data: { name: `Rename target ${stamp}` } })).json();
  await page.goto('/');
  await page.locator(`[data-action="nav-project"][data-project-id="${created.id}"]`).first().click();
  await page.locator(`[data-action="rename-project"][data-project-id="${created.id}"]`).click();
  const rename = page.locator('[data-project-rename]');
  await expect(rename).toBeFocused();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('Platform Reliab');
  // An agent writes a task into this project; the window regains focus and
  // re-renders the page under the rename field.
  await request.post('/api/tasks', {
    data: { title: `Agent wrote this ${stamp}`, project: created.slug, priority: 'medium', status: 'planned' },
    headers: { 'x-prax-origin': 'agent', 'x-prax-agent': 'codex' },
  });
  await focusMain(page);
  await expect(page.locator('.task-row', { hasText: `Agent wrote this ${stamp}` })).toBeVisible({ timeout: 5000 });
  await page.keyboard.type('ility');

  await expect(rename).toHaveValue('Platform Reliability');
  await expect(rename).toBeFocused();
  const current = async () => (await (await request.get('/api/projects')).json()).find(project => project.id === created.id)?.name;
  expect(await current()).toBe(`Rename target ${stamp}`);
  await page.keyboard.press('Enter');
  await expect.poll(current).toBe('Platform Reliability');
});

test('a mid-document caret survives a document context load', async ({ page, request }) => {
  const { release } = await openDocumentWithHeldContext(page, request, Date.now());
  const editor = page.locator('.cm-content[contenteditable="true"]');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.press('End');
  await page.keyboard.type(' be');
  release();
  await expect(page.locator('[data-document-links]')).toBeVisible();
  await page.keyboard.type('ta');

  await expect(page.locator('[data-document-editor]')).toHaveValue('alpha beta\nomega');
  await expect(page.locator('.cm-content[contenteditable="true"]')).toBeFocused();
});

test('a document title being typed survives a document context load', async ({ page, request }) => {
  const stamp = Date.now();
  const { doc, release } = await openDocumentWithHeldContext(page, request, stamp);
  const title = page.locator('[data-doc-title]');
  await title.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' re');
  release();
  await expect(page.locator('[data-document-links]')).toBeVisible();
  await page.keyboard.type('named');

  await expect(title).toHaveValue(`${doc.title} renamed`);
  await expect(title).toBeFocused();
  await expect(page.locator('[data-document-editor]')).toHaveValue('alpha\nomega');
});

test('the new-project name and its confirm dialog keep typed text and focus across a background render', async ({ page, request }) => {
  const stamp = Date.now();
  await page.goto('/');
  await page.locator('[data-action="nav-all"]').first().click();
  const name = page.locator('[data-new-project-name]');
  await name.click();
  await page.keyboard.type('Half typed');
  await externalRefresh(page, request, stamp);
  await page.keyboard.type(' name');
  await expect(name).toHaveValue('Half typed name');
  await expect(name).toBeFocused();

  // The empty-name path opens the in-app confirm dialog with its own field.
  await name.fill('');
  await page.locator('[data-action="create-project"]').first().click();
  const dialogInput = page.locator('[data-confirm-input]');
  await expect(dialogInput).toBeFocused();
  await page.keyboard.type('Dialog ty');
  await externalRefresh(page, request, stamp);
  await page.keyboard.type('ped');
  await expect(dialogInput).toHaveValue('Dialog typed');
  await expect(dialogInput).toBeFocused();
  await page.locator('[data-action="confirm-cancel"]').first().click();
});

test('unsaved Settings provider fields keep their text and focus across a background render', async ({ page, request }) => {
  const stamp = Date.now();
  const configured = await request.put('/api/settings/semantic-search', {
    data: { backend: 'ollama', model: 'old-model', baseUrl: 'http://127.0.0.1:11434' },
  });
  expect(configured.ok()).toBe(true);
  try {
    await page.goto('/');
    await page.locator('[data-action="nav-settings"]').first().click();
    await page.locator('[data-action="set-settings-tab"][data-tab="intelligence"]').click();
    const model = page.locator('[data-ai-model]');
    const baseUrl = page.locator('[data-ai-base-url]');
    await model.fill('new-model');
    await baseUrl.click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('http://127.0.0.1:');
    await externalRefresh(page, request, stamp);
    await page.keyboard.type('11500');

    await expect(model).toHaveValue('new-model');
    await expect(baseUrl).toHaveValue('http://127.0.0.1:11500');
    await expect(baseUrl).toBeFocused();
  } finally {
    await request.put('/api/settings/semantic-search', { data: { backend: 'none', enabled: false } });
  }
});
