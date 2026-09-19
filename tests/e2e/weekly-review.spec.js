import { test, expect } from '@playwright/test';

// The one-click weekly review: Library action compiles the week into a doc,
// opens it, and regenerating updates the SAME doc — never a duplicate.

test('Library ▸ Weekly review compiles, opens, and regenerates idempotently', async ({ page, request }) => {
  // Seed one completed task so the review has something honest to say.
  const seed = await request.post('/api/tasks', {
    data: { title: `review-seed-${Date.now()}`, project: 'inbox', priority: 'medium', status: 'planned' },
  });
  const task = await seed.json();
  await request.patch(`/api/tasks/${task.id}`, { data: { status: 'completed' } });

  await page.goto('/');
  await page.locator('[data-action="nav-library"]').first().click();
  await page.locator('[data-action="toggle-library-menu"]').click();
  await page.locator('[data-action="generate-weekly-review"]').click();

  // The generated review opens in the editor: its tag chip and synthesized
  // marker are visible, and the compiled sections are in the document.
  await expect(page.locator('body')).toContainText('#weekly-review', { timeout: 10_000 });
  await expect(page.locator('body')).toContainText('Shipped');

  // Regenerate from the Library: still exactly one review doc for the week.
  await page.locator('[data-action="nav-library"]').first().click();
  await page.locator('[data-action="toggle-library-menu"]').click();
  await page.locator('[data-action="generate-weekly-review"]').click();
  await expect(page.locator('body')).toContainText('#weekly-review', { timeout: 10_000 });

  const documents = await (await request.get('/api/library/documents')).json();
  const list = Array.isArray(documents) ? documents : documents.documents || [];
  const reviews = list.filter((doc) => /^Weekly review — \d{4}-W\d{2}$/.test(doc.title));
  expect(reviews).toHaveLength(1);
  expect(reviews[0].tags).toContain('weekly-review');
});
