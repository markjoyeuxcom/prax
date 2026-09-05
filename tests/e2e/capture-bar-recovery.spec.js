import { test, expect } from '@playwright/test';

// Regression spec for C06: captureBar 409 identity retention and reconciliation.
// When a POST commits but the response is lost, and the task is modified or archived
// before retry, the retry receives HTTP 409. captureBar must NOT release the pending
// identity and mint a duplicate on subsequent Enter. It must read the canonical task,
// safely reconcile the outcome, and prevent duplicate creation.

async function allTasks(request) {
  const response = await request.get('/api/tasks?archived=all');
  expect(response.ok()).toBe(true);
  return response.json();
}

test('lost response -> modified created task -> reload -> retry -> retry again creates no duplicate', async ({ page, request }) => {
  const title = `capture-modify-${Date.now()}`;
  await page.goto('/capture.html');

  let intercepted = false;
  await page.route('**/api/tasks', async (route) => {
    if (route.request().method() === 'POST' && !intercepted) {
      intercepted = true;
      // Let the request execute on the server so it commits to the database
      await route.fetch();
      // Drop the response so the browser sees an unreachable/aborted network failure
      await route.abort('failed');
      return;
    }
    await route.continue();
  });

  const input = page.getByLabel('Capture a task');
  await input.fill(title);
  await input.press('Enter');

  // Browser sees network failure; hint indicates unreachable and kept
  await expect(page.locator('#capture-hint')).toContainText('unreachable');

  // Verify task was actually committed on the server
  const tasksAfterFirst = await allTasks(request);
  const createdTask = tasksAfterFirst.find((t) => t.title === title);
  expect(createdTask).toBeTruthy();

  // Modify the task via API (simulating another client or sync modifying it)
  const patchRes = await request.patch(`/api/tasks/${createdTask.id}`, {
    data: { title: `${title} (modified by peer)` },
  });
  expect(patchRes.ok()).toBe(true);

  // Reload the capture bar page (recovery pending record persists in localStorage)
  await page.unroute('**/api/tasks');
  await page.reload();
  await expect(input).toHaveValue(title);

  // Retry the submission: sends the SAME pending UUID, receives 409 Conflict
  await input.press('Enter');

  // captureBar must reconcile the canonical task, not discard identity and let user duplicate
  await expect(page.locator('#capture-hint')).not.toContainText('task id was already used for different content');
  await expect(input).toHaveValue('');

  // Press Enter again on now-empty or retry state: must NOT create a second task
  await input.press('Enter');

  // Verify only 1 task with this ID exists, no duplicate was created
  const tasksFinal = await allTasks(request);
  const matchingTasks = tasksFinal.filter((t) => t.id === createdTask.id || t.title.startsWith(title));
  expect(matchingTasks).toHaveLength(1);
  expect(matchingTasks[0].id).toBe(createdTask.id);
});

test('lost response -> archived created task -> reload -> retry -> retry again creates no duplicate', async ({ page, request }) => {
  const title = `capture-archive-${Date.now()}`;
  await page.goto('/capture.html');

  let intercepted = false;
  await page.route('**/api/tasks', async (route) => {
    if (route.request().method() === 'POST' && !intercepted) {
      intercepted = true;
      await route.fetch();
      await route.abort('failed');
      return;
    }
    await route.continue();
  });

  const input = page.getByLabel('Capture a task');
  await input.fill(title);
  await input.press('Enter');

  await expect(page.locator('#capture-hint')).toContainText('unreachable');

  const tasksAfterFirst = await allTasks(request);
  const createdTask = tasksAfterFirst.find((t) => t.title === title);
  expect(createdTask).toBeTruthy();

  // Archive the task via API
  const archiveRes = await request.delete(`/api/tasks/${createdTask.id}`);
  expect(archiveRes.ok()).toBe(true);

  // Reload the capture bar page
  await page.unroute('**/api/tasks');
  await page.reload();
  await expect(input).toHaveValue(title);

  // Retry: sends same UUID, gets 409
  await input.press('Enter');

  // Must communicate archived outcome, not raw 409 error
  await expect(page.locator('#capture-hint')).toContainText('archived');
  await expect(input).toHaveValue('');

  // Pressing Enter again must NOT create a duplicate task
  await input.press('Enter');

  const tasksFinal = await allTasks(request);
  const matchingTasks = tasksFinal.filter((t) => t.id === createdTask.id || t.title.startsWith(title));
  expect(matchingTasks).toHaveLength(1);
  expect(matchingTasks[0].id).toBe(createdTask.id);
  expect(matchingTasks[0].archivedAt).toBeTruthy();
});

test('lost response -> modified task -> user types newer text -> 409 reconciles previous, preserves newer text, and subsequent Enter adds it', async ({ page, request }) => {
  const firstTitle = `capture-first-${Date.now()}`;
  const secondTitle = `capture-second-${Date.now()}`;
  await page.goto('/capture.html');

  let intercepted = false;
  await page.route('**/api/tasks', async (route) => {
    if (route.request().method() === 'POST' && !intercepted) {
      intercepted = true;
      await route.fetch();
      await route.abort('failed');
      return;
    }
    await route.continue();
  });

  const input = page.getByLabel('Capture a task');
  await input.fill(firstTitle);
  await input.press('Enter');

  await expect(page.locator('#capture-hint')).toContainText('unreachable');

  const tasksAfterFirst = await allTasks(request);
  const firstTask = tasksAfterFirst.find((t) => t.title === firstTitle);
  expect(firstTask).toBeTruthy();

  // Modify the first task via API
  await request.patch(`/api/tasks/${firstTask.id}`, {
    data: { title: `${firstTitle} (modified)` },
  });

  // User types newer text into the capture bar before retrying
  await page.unroute('**/api/tasks');
  await input.fill(secondTitle);

  // Press Enter: first pending intent is reconciled against 409, newer text is kept
  await input.press('Enter');
  await expect(page.locator('#capture-hint')).toContainText('Your current text is kept; Enter adds it');
  await expect(input).toHaveValue(secondTitle);

  // Press Enter again: submits the second task
  await input.press('Enter');
  await expect(page.locator('#capture-hint')).toContainText('Added to Inbox ✓');
  await expect(input).toHaveValue('');

  // Verify both tasks exist, no duplicate of first task
  const allFinal = await allTasks(request);
  const matchingFirst = allFinal.filter((t) => t.id === firstTask.id || t.title.startsWith(firstTitle));
  const matchingSecond = allFinal.filter((t) => t.title === secondTitle);
  expect(matchingFirst).toHaveLength(1);
  expect(matchingSecond).toHaveLength(1);
});

test('409 read failure keeps pending identity and unknown outcome (never mints new identity implicitly)', async ({ page, request }) => {
  const title = `capture-readfail-${Date.now()}`;
  await page.goto('/capture.html');

  let intercepted = false;
  await page.route('**/api/tasks', async (route) => {
    if (route.request().method() === 'POST' && !intercepted) {
      intercepted = true;
      await route.fetch();
      await route.abort('failed');
      return;
    }
    await route.continue();
  });

  const input = page.getByLabel('Capture a task');
  await input.fill(title);
  await input.press('Enter');

  await expect(page.locator('#capture-hint')).toContainText('unreachable');

  const tasksAfterFirst = await allTasks(request);
  const createdTask = tasksAfterFirst.find((t) => t.title === title);
  expect(createdTask).toBeTruthy();

  // Archive task so POST will 409
  await request.delete(`/api/tasks/${createdTask.id}`);

  await page.unroute('**/api/tasks');

  // Intercept GET /api/tasks/:id so canonical read fails
  await page.route(`**/api/tasks/${createdTask.id}`, async (route) => {
    if (route.request().method() === 'GET') {
      await route.abort('failed');
      return;
    }
    await route.continue();
  });

  // Retry: POST gets 409, GET /api/tasks/:id fails
  await input.press('Enter');

  // Error hint shown with server message, input kept, pending identity NOT released
  await expect(page.locator('#capture-hint')).toHaveAttribute('data-kind', 'error');
  await expect(page.locator('#capture-hint')).toContainText('this capture was already created and has since been archived');
  await expect(input).toHaveValue(title);

  // Track next POST request body to verify it still sends the SAME UUID, not a minted new one
  let retryIdSent = null;
  await page.unroute(`**/api/tasks/${createdTask.id}`);
  await page.route('**/api/tasks', async (route) => {
    if (route.request().method() === 'POST') {
      retryIdSent = JSON.parse(route.request().postData()).id;
    }
    await route.continue();
  });

  await input.press('Enter');
  expect(retryIdSent).toBe(createdTask.id);
});
