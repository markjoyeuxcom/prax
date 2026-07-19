import { test, expect } from '@playwright/test';

// The task context surface in the production app. The e2e server runs with
// embeddings OFF, which is itself a covered state: the Related knowledge row
// must degrade to a quiet labelled line — never an error — while the
// working-note spawn works in full.

async function createTask(request, title) {
  const response = await request.post('/api/tasks', {
    data: { title, project: 'inbox', priority: 'medium', status: 'planned' },
  });
  expect(response.status()).toBe(201);
  return response.json();
}

test('drawer shows the honest embeddings-off line and spawns a pre-linked working note', async ({ page, request }) => {
  const title = `context-surface-${Date.now()}`;
  await createTask(request, title);

  await page.goto('/');
  await page.locator('[data-action="nav-today"]').first().click();
  // The undated task is not on Today — go to the Inbox list instead.
  await page.locator('[data-action="nav-project"]').first().click();
  await page.locator('.task-row', { hasText: title }).locator('[data-action="open-task"]').click();

  // Related knowledge fills after the drawer renders, degrading honestly.
  const related = page.locator('[data-related-knowledge]');
  await expect(related).toBeVisible();
  await expect(related).toContainText('Semantic search is off');

  // Spawn the working note: created, linked, opened in the editor.
  await page.locator('[data-action="start-working-note"]').click();
  await expect(page.locator('body')).toContainText(`Working note — ${title}`, { timeout: 10_000 });
  await expect(page.locator('body')).toContainText('Referenced by 1 task(s)');

  // The link is server-truth: the task's linked documents carry the note.
  const tasks = await (await request.get(`/api/tasks?q=${encodeURIComponent(title)}`)).json();
  const task = tasks.find((entry) => entry.title === title);
  const linked = await (await request.get(`/api/tasks/${task.id}/documents`)).json();
  expect(linked.some((doc) => doc.title === `Working note — ${title}`)).toBe(true);
});
