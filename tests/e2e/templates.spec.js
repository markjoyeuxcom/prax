import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { createDocument, resolveProjectId } from './helpers/seed.js';

test.beforeEach(async ({ page }) => { await page.emulateMedia({ reducedMotion: 'reduce' }); });

async function openStudio(page) {
  await page.locator('.places [data-action="nav-library"]').click();
  await page.locator('[data-action="toggle-new-doc-menu"]').click();
  await page.locator('[data-action="open-template-studio"]').click();
  await expect(page.getByRole('dialog', { name: 'Templates & guides' })).toBeVisible();
}

test('bundled overview is available without seed notes, accessible and copies to the chosen project', async ({ page, request }) => {
  const title = `Overview ${randomUUID()}`;
  const project = await resolveProjectId(request, 'homelab');
  await page.goto('/'); await openStudio(page);
  await page.locator('[data-template-field="source"]').selectOption('project-overview');
  await page.locator('[data-template-field="project"]').selectOption(project);
  await expect(page.locator('[data-template-field="project"]')).toBeFocused();
  await page.locator('[data-template-field="title"]').fill(title);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { document.body.dataset.theme = value; }, theme);
    const scan = await new AxeBuilder({ page }).include('.template-studio').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(scan.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))).toEqual([]);
  }
  await page.evaluate(() => { document.body.dataset.theme = 'light'; });
  await page.screenshot({ path: '/tmp/prax-templates-2026-09-20/chooser.png' });
  await page.setViewportSize({ width: 360, height: 780 });
  expect(await page.locator('.template-studio').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.locator('[data-action="submit-template-studio"]').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Close templates', exact: true })).toBeFocused();
  await page.locator('[data-action="submit-template-studio"]').click();
  await expect(page.locator('[data-doc-title]')).toHaveValue(title);
  const docs = await (await request.get('/api/library/documents')).json();
  const doc = docs.find(d => d.title === title);
  expect(doc.projectId).toBe(project); expect(doc.documentType).toBe('reference'); expect(doc.verified).toBe(false);
  expect(doc.tags).toContain('project-card'); expect(doc.body).toContain('Key entry points');
});

test('custom template copy preserves the verified original and permits another project/type', async ({ page, request }) => {
  const title = `Master ${randomUUID()}`;
  const master = await createDocument(request, { title, body: '# Reusable procedure\n\n- [ ] Check the result', documentType: 'template', project: 'homelab', tags: ['ops'] });
  const verify = await request.post(`/api/library/documents/${master.id}/verify`, { data: { verified: true, revision: master.revision } }); expect(verify.ok()).toBe(true);
  const before = await (await request.get(`/api/library/documents/${master.id}`)).json();
  await page.goto('/'); await page.locator('.places [data-action="nav-library"]').click();
  await page.locator('[data-library-search]').fill(title);
  await page.locator('.doc-card', { hasText: title }).click();
  await page.locator('[data-action="use-document-template"]').click();
  const project = await resolveProjectId(request, 'inbox');
  await page.locator('[data-template-field="project"]').selectOption(project);
  await page.locator('[data-template-field="documentType"]').selectOption('runbook');
  await page.locator('[data-action="submit-template-studio"]').click();
  await expect(page.locator('[data-doc-title]')).toHaveValue(`${title} — copy`);
  expect(await (await request.get(`/api/library/documents/${master.id}`)).json()).toEqual(before);
  const copies = (await (await request.get('/api/library/documents')).json()).filter(d => d.title === `${title} — copy`);
  expect(copies).toHaveLength(1); expect(copies[0].projectId).toBe(project); expect(copies[0].documentType).toBe('runbook'); expect(copies[0].verified).toBe(false);
});

test('lost onboarding response survives reload and retries one task with nine native items', async ({ page, request }) => {
  const title = `Onboarding ${randomUUID()}`;
  await page.goto('/'); await openStudio(page);
  await page.locator('[data-template-field="source"]').selectOption('repository-onboarding');
  await page.locator('[data-template-field="title"]').fill(title);
  const bodies = [];
  await page.route('**/api/tasks/import', async route => {
    bodies.push(route.request().postDataJSON());
    const response = await route.fetch(); expect(response.ok()).toBe(true);
    await route.abort();
  });
  await page.locator('[data-action="submit-template-studio"]').click();
  await expect(page.getByRole('button', { name: 'Retry creation' })).toBeVisible();
  await page.reload(); await page.unroute('**/api/tasks/import');
  await openStudio(page);
  await expect(page.locator('[data-template-field="title"]')).toHaveValue(title);
  await expect(page.locator('[data-template-field="title"]')).toBeDisabled();
  await page.route('**/api/tasks/import', async route => { bodies.push(route.request().postDataJSON()); await route.continue(); });
  await page.getByRole('button', { name: 'Retry creation' }).click();
  await expect(page.locator('.toast')).toContainText('Onboarding task created');
  expect(bodies).toHaveLength(2); expect(bodies[1]).toEqual(bodies[0]);
  const tasks = (await (await request.get('/api/tasks')).json()).filter(t => t.title === title);
  expect(tasks).toHaveLength(1);
  const checklist = await (await request.get(`/api/tasks/${tasks[0].id}/checklist`)).json();
  expect(checklist).toHaveLength(9); expect(checklist.every(x => !x.completed)).toBe(true);
});

test('a lost document response reconciles its copy and double activation stays single-flight', async ({ page, request }) => {
  const title = `One copy ${randomUUID()}`;
  await page.goto('/'); await openStudio(page);
  await page.locator('[data-template-field="title"]').fill(title);
  let count = 0;
  await page.route('**/api/library/documents', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    count++; const response = await route.fetch(); expect(response.ok()).toBe(true); await route.abort();
  });
  await page.locator('[data-action="submit-template-studio"]').evaluate(button => { button.click(); button.click(); });
  await expect(page.locator('[data-doc-title]')).toHaveValue(title);
  expect(count).toBe(1);
  expect((await (await request.get('/api/library/documents')).json()).filter(d => d.title === title)).toHaveLength(1);
});

test('late catalogue response does not reopen a chooser after navigation away', async ({ page }) => {
  let received; const requested = new Promise(resolve => { received = resolve; });
  let release; const held = new Promise(resolve => { release = resolve; });
  await page.route('**/api/library/starters', async route => {
    const response = await route.fetch(); received(); await held; await route.fulfill({ response });
  });
  await page.goto('/');
  await page.locator('.places [data-action="nav-library"]').click();
  await page.locator('[data-action="toggle-new-doc-menu"]').click();
  await page.locator('[data-action="open-template-studio"]').click();
  await requested;
  try { await page.locator('.places [data-action="nav-today"]').click(); }
  finally { release(); }
  await expect(page.locator('.page-head__title')).toHaveText('Today');
  await expect(page.getByRole('dialog', { name: 'Templates & guides' })).toHaveCount(0);
});
