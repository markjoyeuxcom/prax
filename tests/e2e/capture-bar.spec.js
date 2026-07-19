import { test, expect } from '@playwright/test';

// The system-wide capture bar page (public/capture.html) against the real
// server. The tray/global-shortcut summoning is desktop-shell territory
// (documented manual check); everything the page itself does — resolve,
// submit, exact-once retry, draft retention — is drivable right here.

async function tasksWithTitle(request, title) {
  const response = await request.get(`/api/tasks?q=${encodeURIComponent(title)}`);
  expect(response.ok()).toBe(true);
  return (await response.json()).filter(task => task.title === title);
}

test('capture bar resolves shorthand, shows the destination, and creates the task', async ({ page, request }) => {
  const title = `capture-bar-basic-${Date.now()}`;
  await page.goto('/capture.html');
  const input = page.getByLabel('Capture a task');
  await input.fill(`${title} !high tomorrow @errands`);
  await expect(page.locator('#capture-hint')).toContainText('→ Inbox');
  await expect(page.locator('#capture-hint')).toContainText('high');
  await input.press('Enter');
  await expect(page.locator('#capture-hint')).toContainText('Added to Inbox ✓');

  const created = await tasksWithTitle(request, title);
  expect(created).toHaveLength(1);
  expect(created[0].priority).toBe('high');
  expect(created[0].labels).toEqual(['errands']);
  expect(created[0].dueDate).toBeTruthy();
  // Success clears the field and the persisted draft.
  await expect(input).toHaveValue('');
  expect(await page.evaluate(() => window.localStorage.getItem('prax.captureBar.draft'))).toBeNull();
});

test('a failed submit keeps the text and the retry replays the SAME create (no duplicate)', async ({ page, request }) => {
  const title = `capture-bar-retry-${Date.now()}`;
  await page.goto('/capture.html');

  let firstAttemptSeen = false;
  await page.route('**/api/tasks', async (route) => {
    if (route.request().method() === 'POST' && !firstAttemptSeen) {
      firstAttemptSeen = true;
      await route.abort();
      return;
    }
    await route.continue();
  });

  const input = page.getByLabel('Capture a task');
  await input.fill(title);
  await input.press('Enter');
  await expect(page.locator('#capture-hint')).toContainText('unreachable');
  await expect(input).toHaveValue(title);

  await input.press('Enter');
  await expect(page.locator('#capture-hint')).toContainText('Added to Inbox ✓');
  expect(await tasksWithTitle(request, title)).toHaveLength(1);
});

test('typed text survives a reload via the draft store', async ({ page }) => {
  const draft = `capture-bar-draft-${Date.now()}`;
  await page.goto('/capture.html');
  await page.getByLabel('Capture a task').fill(draft);
  await page.reload();
  await expect(page.getByLabel('Capture a task')).toHaveValue(draft);
});

test('an unknown #project token routes to Inbox with the token kept in the title', async ({ page, request }) => {
  const base = `capture-bar-unknown-${Date.now()}`;
  await page.goto('/capture.html');
  const input = page.getByLabel('Capture a task');
  await input.fill(`${base} #no-such-project`);
  await expect(page.locator('#capture-hint')).toContainText('→ Inbox');
  await input.press('Enter');
  await expect(page.locator('#capture-hint')).toContainText('Added to Inbox ✓');
  const created = await tasksWithTitle(request, `${base} #no-such-project`);
  expect(created).toHaveLength(1);
});
