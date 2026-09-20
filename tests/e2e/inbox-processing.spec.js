import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { createDocument } from './helpers/seed.js';

async function seedTask(request, extra = {}) {
  const response = await request.post('/api/tasks', { data: { title: `Capture ${randomUUID()}`, project: 'inbox', status: 'planned', priority: 'medium', notes: 'Keep the release checklist', ...extra } });
  expect(response.ok()).toBe(true); return response.json();
}
async function inboxPage(page, request, tab = 'inbox') {
  const projects = await (await request.get('/api/projects')).json();
  const inbox = projects.find(p => p.slug === 'inbox');
  await page.goto('/');
  await page.locator(`[data-action="nav-project"][data-project-id="${inbox.id}"]`).first().click();
  await page.locator(`[data-action="set-tab"][data-tab="${tab}"]`).click();
  await expect(page.locator('.inbox-view')).toBeVisible();
  return projects;
}
async function process(page, item) {
  await page.locator(`[data-action="inbox-start"][data-id="${item.id}"]`).click();
  const dialog = page.getByRole('dialog', { name: 'Process Inbox' });
  await expect(dialog.getByRole('heading', { name: item.title, exact: true })).toBeVisible();
  return dialog;
}
async function closePass(page, title) {
  await expect(page.getByRole('dialog', { name: 'Process Inbox' }).getByRole('heading', { name: title, exact: true })).not.toBeVisible();
  const close = page.getByRole('button', { name: 'Close Inbox processing' });
  if (await close.isVisible()) await close.click();
}

for (const width of [1440, 360]) test(`Inbox processing reflows and supports keyboard, filing and undo at ${width}px`, async ({ page, request }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const task = await seedTask(request);
  await request.post(`/api/tasks/${task.id}/checklist`, { data: { label: 'Check published downloads' } });
  const projects = await inboxPage(page, request), work = projects.find(p => p.slug === 'work');
  const dialog = await process(page, task);
  await expect(dialog.locator('.inbox-source')).toContainText('Check published downloads');
  for (const theme of ['light', 'dark']) {
    await page.locator('body').evaluate((body, value) => body.setAttribute('data-theme', value), theme);
    const audit = await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();
    expect(audit.violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  await dialog.getByLabel('Owning project').selectOption(work.id);
  await dialog.getByLabel('Plan for (optional)').fill('2030-04-10');
  await dialog.locator('[data-action="inbox-item-reload"]').focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close Inbox processing' })).toBeFocused();
  await dialog.getByRole('button', { name: 'File task', exact: true }).click();
  await expect.poll(async () => (await (await request.get(`/api/tasks/${task.id}`)).json()).projectId).toBe(work.id);
  await expect.poll(async () => (await (await request.get(`/api/tasks/${task.id}`)).json()).plannedFor).toBe('2030-04-10');
  await closePass(page, task.title);
  await page.getByRole('button', { name: 'Undo last decision' }).click();
  await expect.poll(async () => (await (await request.get(`/api/tasks/${task.id}`)).json()).projectId).toBe(projects.find(p => p.slug === 'inbox').id);
  await expect.poll(async () => (await (await request.get(`/api/tasks/${task.id}`)).json()).plannedFor).toBeNull();
});

test('lost reference response survives reload, retries without duplication and can be undone', async ({ page, request }) => {
  const task = await seedTask(request); const projects = await inboxPage(page, request);
  const dialog = await process(page, task);
  await dialog.getByLabel('Owning project').selectOption(projects.find(p => p.slug === 'work').id);
  let committed;
  await page.route(`**/api/inbox/items/task/${task.id}/actions`, async route => {
    committed = await (await route.fetch()).json(); await route.abort();
  }, { times: 1 });
  await dialog.getByRole('button', { name: 'Keep as reference', exact: true }).click();
  await expect(dialog).toContainText('The result is unconfirmed');
  expect(committed.created).toHaveLength(1);
  await page.reload();
  await page.getByRole('button', { name: 'Process Inbox', exact: true }).click();
  await expect(dialog).toContainText('Recovered unfinished decision');
  await dialog.getByRole('button', { name: 'Retry same decision' }).click();
  await expect(dialog).not.toBeVisible();
  const docs = await (await request.get('/api/library/documents')).json();
  expect(docs.filter(doc => doc.title === task.title)).toHaveLength(1);
  await page.getByRole('button', { name: 'Undo last decision' }).click();
  await expect.poll(async () => (await (await request.get(`/api/tasks/${task.id}`)).json()).archivedAt).toBeNull();
  expect((await (await request.get(`/api/library/documents/${committed.created[0].id}`)).json()).archivedAt).toBeTruthy();
});

test('saved reviews stay separate, return to Inbox and link to the processing view', async ({ page, request }) => {
  const review = await createDocument(request, { title: `Saved review ${randomUUID()}`, body: '[Process Inbox](#inbox-process)', project: 'inbox', documentType: 'note', tags: ['weekly-review'] });
  await inboxPage(page, request);
  await expect(page.locator(`[data-action="inbox-open"][data-id="${review.id}"]`)).toHaveCount(0);
  await page.locator('[data-action="set-tab"][data-tab="reviews"]').click();
  await page.locator(`[data-action="inbox-open"][data-id="${review.id}"]`).click();
  await page.getByRole('button', { name: 'Back to Inbox', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Saved reviews' })).toBeVisible();
  await page.locator(`[data-action="inbox-open"][data-id="${review.id}"]`).click();
  await page.getByRole('link', { name: 'Process Inbox', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Items to process' })).toBeVisible();
});

test('AI filing is a reviewable form suggestion and manual actions remain available on failure', async ({ page, request }) => {
  const previousBackend = (await (await request.get('/api/settings/ai-answers')).json()).backend;
  test.info().annotations.push({ type: 'fixture', description: `Restores answer backend ${previousBackend}` });
  const task = await seedTask(request); const projects = await inboxPage(page, request); const work = projects.find(p => p.slug === 'work');
  const dialog = await process(page, task);
  await page.route(`**/api/inbox/items/task/${task.id}/suggest`, async route => route.fulfill({ json: {
    fingerprint: route.request().postDataJSON().fingerprint, projectId: work.id, documentType: 'reference', reason: 'Release guidance belongs with this work.',
    coverage: { projectsShown: 3, projectsTotal: 3, candidatesShown: 4, candidatesTotal: 4, sourceTruncated: false }, duplicates: [], advisory: true,
  } }));
  await dialog.getByRole('button', { name: 'Suggest filing with AI' }).click();
  await expect(dialog).toContainText('Release guidance belongs with this work');
  await dialog.getByRole('button', { name: 'Use suggestion in form' }).click();
  await expect(dialog.getByLabel('Owning project')).toHaveValue(work.id);
  expect((await (await request.get(`/api/tasks/${task.id}`)).json()).projectId).toBe(projects.find(p => p.slug === 'inbox').id);
  await page.unroute(`**/api/inbox/items/task/${task.id}/suggest`);
  // The full suite may have enabled its fake model in an earlier spec.
  expect((await request.put('/api/settings/ai-answers', { data: { backend: 'none' } })).ok()).toBe(true);
  try {
    await dialog.getByRole('button', { name: 'Suggest filing with AI' }).click();
    await expect(dialog).toContainText('No answer model is available');
    await dialog.getByRole('button', { name: 'Complete task', exact: true }).click();
    await expect.poll(async () => (await (await request.get(`/api/tasks/${task.id}`)).json()).status).toBe('completed');
  } finally {
    expect((await request.put('/api/settings/ai-answers', { data: { backend: previousBackend } })).ok()).toBe(true);
  }
});
