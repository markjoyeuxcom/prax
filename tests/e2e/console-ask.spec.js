import { test, expect } from '@playwright/test';
import { createDocument, resolveProjectId } from './helpers/seed.js';

// Ask Prax as a page (Console redesign, 2026-10). With no chat model the page
// shows the retrieved sources and says why there is no
// written answer; the question lands in the per-device history.
test.use({ viewport: { width: 1440, height: 900 } });

test('Ask opens a page: question, sources rail, honest no-model notice, history', async ({ page, request }) => {
  const stamp = Date.now();
  const projectId = await resolveProjectId(page.request, 'homelab');
  await createDocument(request, {
    title: `Zircon failover ${stamp}`, body: `# Zircon failover ${stamp}\n\nPromote the replica, then repoint the app.`, documentType: 'runbook', project: projectId,
  });

  // The full suite may have enabled its fake model in an earlier spec.
  const previousBackend = (await (await request.get('/api/settings/ai-answers')).json()).backend;
  expect((await request.put('/api/settings/ai-answers', { data: { backend: 'none' } })).ok()).toBe(true);
  test.info().annotations.push({ type: 'fixture', description: `Restores answer backend ${previousBackend}` });
  try {
    await askWithoutModel(page, stamp);
  } finally {
    expect((await request.put('/api/settings/ai-answers', { data: { backend: previousBackend } })).ok()).toBe(true);
  }
});

async function askWithoutModel(page, stamp) {
  await page.goto('/');
  await page.locator('.titlebar [data-action="open-ask-page"]').click();
  await expect(page.locator('.ask-intro__title')).toHaveText('Ask Prax');
  await expect(page.locator('.statusbar__mode')).toHaveText('ASK');

  const input = page.locator('[data-ask-page-input]');
  await input.fill(`zircon failover ${stamp}`);
  await input.press('Enter');
  await expect(page.locator('.ask-q')).toHaveText(`zircon failover ${stamp}`);
  await expect(page.locator('.ask-notice')).toContainText('No AI model is set');
  await expect(page.locator('.ask-src', { hasText: `Zircon failover ${stamp}` })).toBeVisible();
  await expect(page.locator('.ask-hist__item', { hasText: `zircon failover ${stamp}` })).toBeVisible();

  // A source opens its document.
  await page.locator('.ask-src', { hasText: `Zircon failover ${stamp}` }).click();
  await expect(page.locator('[data-doc-title]')).toHaveValue(`Zircon failover ${stamp}`);

  // Back on the page, the history entry restores the answer without asking again.
  await page.locator('.titlebar [data-action="open-ask-page"]').click();
  await page.locator('.ask-hist__item', { hasText: `zircon failover ${stamp}` }).click();
  await expect(page.locator('.ask-q')).toHaveText(`zircon failover ${stamp}`);
}

test('the palette opens the same page, and the Library no longer repeats Ask', async ({ page }) => {
  await page.goto('/');
  await page.locator('.places [data-action="nav-library"]').click();
  await expect(page.locator('main [data-action="open-ask-prax"]')).toHaveCount(0);
  await page.locator('.titlebar [data-action="open-palette"]').click();
  await page.keyboard.type('Ask Prax');
  await page.locator('.palette__item', { hasText: 'Ask Prax' }).first().click();
  await expect(page.locator('.ask-page')).toBeVisible();
  await expect(page.locator('[data-overlay="askprax"]')).toHaveCount(0);
});

test('the composer takes new lines with Shift+Enter and empties when the question is asked', async ({ page, request }) => {
  const previousBackend = (await (await request.get('/api/settings/ai-answers')).json()).backend;
  expect((await request.put('/api/settings/ai-answers', { data: { backend: 'none' } })).ok()).toBe(true);
  try {
    await page.goto('/');
    await page.locator('.titlebar [data-action="open-ask-page"]').click();
    const input = page.locator('[data-ask-page-input]');
    await input.click();
    await page.keyboard.type('first line');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('second line');
    await expect(input).toHaveValue('first line\nsecond line');
    await page.keyboard.press('Enter');
    await expect(page.locator('.ask-q')).toContainText('first line');
    await expect(input).toHaveValue('');
    await expect(page.locator('[data-action="run-ask-prax"]')).toBeDisabled();
  } finally {
    expect((await request.put('/api/settings/ai-answers', { data: { backend: previousBackend } })).ok()).toBe(true);
  }
});

test('closing Ask returns to where it was opened, by button or Esc', async ({ page }) => {
  await page.goto('/');
  await page.locator('.places [data-action="nav-library"]').click();
  await page.locator('.titlebar [data-action="open-ask-page"]').click();
  await expect(page.locator('.ask-page')).toBeVisible();
  await page.getByRole('button', { name: 'Close Ask Prax' }).click();
  await expect(page.locator('.ask-page')).toHaveCount(0);
  await expect(page.locator('[data-library-search]')).toBeVisible();

  await page.locator('.places [data-action="nav-today"]').click();
  await page.locator('.titlebar [data-action="open-ask-page"]').click();
  await expect(page.locator('[data-ask-page-input]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.ask-page')).toHaveCount(0);
  await expect(page.locator('.statusbar__mode')).not.toHaveText('ASK');
});

test('suggested tasks: unticked proposals, scoped to the project, created only on request', async ({ page, request }) => {
  const stamp = Date.now();
  const projectId = await resolveProjectId(request, 'homelab');
  const source = await createDocument(request, {
    title: `B2 key scopes ${stamp}`, body: '# B2 key scopes\n\nRestore needs listAllBucketNames.', documentType: 'known-issue', project: projectId,
  });
  const previousBackend = (await (await request.get('/api/settings/ai-answers')).json()).backend;
  expect((await request.put('/api/settings/ai-answers', { data: { backend: 'fake' } })).ok()).toBe(true);
  const askBodies = [];
  await page.route('**/api/library/ask', async (route) => {
    const payload = route.request().postDataJSON();
    askBodies.push(payload);
    await route.fulfill({ json: {
      query: payload.q, answer: `Recreate the key with listAllBucketNames [${source.title}].`, degraded: false, markdown: '',
      sources: [{ id: source.id, title: source.title, documentType: 'known-issue', verified: false, kind: 'source', stale: false }],
      retrieval: { mode: 'semantic' }, model: 'fake-chat',
    } });
  });
  await page.route('**/api/library/ask/tasks', async (route) => route.fulfill({ json: { degraded: false, model: 'fake-chat', tasks: [
    { title: `Recreate B2 key ${stamp}`, priority: 'high', dueDate: null, sourceId: source.id, sourceTitle: source.title },
    { title: `Not this one ${stamp}`, priority: 'low', dueDate: null, sourceId: source.id, sourceTitle: source.title },
  ] } }));
  try {
    await page.goto('/');
    await page.locator('.titlebar [data-action="open-ask-page"]').click();
    await page.locator('[data-ask-scope]').selectOption(projectId);
    await page.locator('[data-action="toggle-ask-trust"]').click();
    await expect(page.locator('[data-action="toggle-ask-trust"]')).toHaveText('✓ Verified only');
    const input = page.locator('[data-ask-page-input]');
    await input.fill(`why does the restore fail ${stamp}`);
    await input.press('Enter');
    await expect.poll(() => askBodies.at(-1)).toMatchObject({ project: projectId, trust: 'verified' });

    const card = page.getByRole('region', { name: 'Suggested tasks' });
    await expect(card).toContainText('Suggested tasks · Homelab');
    await expect(card.getByRole('checkbox')).toHaveCount(2);
    // Proposals arrive unticked: nothing is chosen until the person ticks it.
    await expect(card.getByRole('checkbox', { name: new RegExp(`Not this one ${stamp}`) })).toHaveAttribute('aria-checked', 'false');
    await expect(card.getByRole('button', { name: 'Create tasks' })).toBeDisabled();
    await card.getByRole('checkbox', { name: new RegExp(`Recreate B2 key ${stamp}`) }).click();
    await card.getByRole('button', { name: 'Create 1 task' }).click();
    // The created proposal says so in place; the other stays available to tick later.
    await expect(card.getByRole('checkbox', { name: new RegExp(`Recreate B2 key ${stamp}`) })).toContainText('✓ created in Homelab');
    await expect(card.getByRole('checkbox', { name: new RegExp(`Recreate B2 key ${stamp}`) })).toBeDisabled();
    await expect(card.getByRole('button', { name: 'Create tasks' })).toBeDisabled();

    const created = await (await request.get(`/api/tasks?q=${encodeURIComponent(`Recreate B2 key ${stamp}`)}`)).json();
    const list = Array.isArray(created) ? created : (created.tasks || created.items || []);
    expect(list.filter((task) => task.title === `Recreate B2 key ${stamp}`)).toHaveLength(1);
    expect(list[0].projectId).toBe(projectId);
    const skipped = await (await request.get(`/api/tasks?q=${encodeURIComponent(`Not this one ${stamp}`)}`)).json();
    expect((Array.isArray(skipped) ? skipped : (skipped.tasks || skipped.items || [])).length).toBe(0);
  } finally {
    expect((await request.put('/api/settings/ai-answers', { data: { backend: previousBackend } })).ok()).toBe(true);
  }
});
