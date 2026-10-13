// The project page's Overview button: opens the project's card in the editor,
// creating it from the bundled starter first when the project has none. The
// system projects have no button.
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

async function openProject(page, project) {
  await page.goto('/');
  await page.locator('[data-action="nav-all"]').first().click();
  await page.locator(`.proj-card[data-project-id="${project.id}"]`).click();
  await expect(page.locator('.page-head__title')).toHaveText(project.name);
}

test('a new project opens its seeded card; an older project gets one on first use', async ({ page, request }) => {
  const tag = randomUUID().slice(0, 8);
  const seeded = await (await request.post('/api/projects', { data: { name: `Seeded ${tag}` } })).json();
  expect(seeded.overviewDocumentId).toBeTruthy();
  const bare = await (await request.post('/api/projects', { data: { name: `Bare ${tag}`, overview: false } })).json();

  await openProject(page, seeded);
  const button = page.locator('[data-action="open-project-overview"]');
  await expect(button).toHaveText('Overview');
  await button.click();
  await expect(page.locator('[data-doc-title]')).toHaveValue(`Seeded ${tag} project overview`);
  await expect(page.locator('[data-document-editor]')).toHaveValue(/^# Seeded .* project overview/);
  await expect(page.locator('.editor-head__tags .chip--verified')).toHaveCount(0, 'the starter is never verified');
  await expect(page.locator('.toast', { hasText: 'Created the project overview' })).toHaveCount(0, 'an existing card opens without a creation toast');

  await openProject(page, bare);
  await page.locator('[data-action="open-project-overview"]').click();
  await expect(page.locator('.toast')).toContainText('Created the project overview');
  await expect(page.locator('[data-doc-title]')).toHaveValue(`Bare ${tag} project overview`);
  const docs = await (await request.get(`/api/library/documents?project=${bare.slug}`)).json();
  const cards = docs.filter((d) => d.tags.includes('project-card'));
  expect(cards).toHaveLength(1);
  expect(cards[0].verified).toBe(false);

  // Asking again reuses the card instead of creating a second one.
  await openProject(page, bare);
  await page.locator('[data-action="open-project-overview"]').click();
  await expect(page.locator('[data-doc-title]')).toHaveValue(`Bare ${tag} project overview`);
  const again = await (await request.get(`/api/library/documents?project=${bare.slug}`)).json();
  expect(again.filter((d) => d.tags.includes('project-card'))).toHaveLength(1);
});

test('system projects have no Overview button', async ({ page, request }) => {
  const projects = await (await request.get('/api/projects')).json();
  for (const slug of ['inbox', 'memory']) {
    await openProject(page, projects.find((p) => p.slug === slug));
    await expect(page.locator('[data-action="open-project-overview"]')).toHaveCount(0);
  }
});
