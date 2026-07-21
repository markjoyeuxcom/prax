import { test, expect } from '@playwright/test';
import { createDocument, resolveProjectId } from './helpers/seed.js';

async function createDrawerTask(request, prefix, overrides = {}) {
  const response = await request.post('/api/tasks', {
    data: {
      title: `${prefix} saved title`,
      description: 'Saved description',
      notes: 'Saved notes',
      project: 'inbox',
      priority: 'medium',
      status: 'planned',
      ...overrides,
    },
  });
  expect(response.ok()).toBe(true);
  return response.json();
}

async function openDrawer(page, task) {
  const projects = await (await page.request.get('/api/projects')).json();
  const inbox = projects.find((project) => project.slug === 'inbox');
  await page.goto('/');
  await page.locator(`[data-action="nav-project"][data-project-id="${inbox.id}"]`).first().click();
  await page.locator('.task-row', { hasText: task.title }).click();
  await expect(page.locator('.drawer[data-task-id]')).toBeVisible();
  // Wait out the drawer's trailing renders (context + related knowledge):
  // a fill() racing them can write into a just-detached input and vanish.
  const related = page.locator('[data-related-knowledge]');
  await expect(related).toBeVisible();
  await expect(related).not.toContainText('Looking for related notes');
}

// Open the library and click the card whose title contains `titleText` —
// documents open in the editor screen.
async function openLibraryDoc(page, titleText) {
  await page.goto('/');
  await page.locator('[data-action="nav-library"]').first().click();
  const card = page.locator('.doc-card', { hasText: titleText });
  await expect(card).toBeVisible();
  await card.click();
}

async function replaceEditorBody(page, body) {
  const editor = page.locator('.cm-content[contenteditable="true"]');
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(body);
  await expect(page.locator('[data-document-editor]')).toHaveValue(body);
}

test('an out-of-band description edit survives a notes-only autosave', async ({ page, request }) => {
  const prefix = `wave1-notes-only-${Date.now()}`;
  const task = await createDrawerTask(page.request, prefix);
  const draftNotes = 'Notes typed while an agent edits the description';
  const agentDescription = 'Description rewritten by the MCP agent';
  const drawerPatches = [];
  await openDrawer(page, task);
  await page.route(`**/api/tasks/${task.id}`, async (route) => {
    if (route.request().method() === 'PATCH') drawerPatches.push(route.request().postDataJSON());
    await route.continue();
  });

  // The drawer PATCH is the only browser-originated write; the agent edit goes
  // through the API context, which page.route never sees.
  const autosaveFlushed = page.waitForResponse((response) => response.url().endsWith(`/api/tasks/${task.id}`)
    && response.request().method() === 'PATCH');
  await page.locator('[data-task-notes]').fill(draftNotes);
  const agentPatch = await request.patch(`/api/tasks/${task.id}`, { data: { description: agentDescription } });
  expect(agentPatch.ok()).toBe(true);
  await autosaveFlushed;

  // The autosave diffs against state.taskDraftBaseline and PATCHes only the
  // notes; bundling title+description from the stale seed was the regression.
  expect(drawerPatches).toEqual([{ notes: draftNotes }]);
  const stored = await (await page.request.get(`/api/tasks/${task.id}`)).json();
  expect(stored.description).toBe(agentDescription);
  expect(stored.notes).toBe(draftNotes);

  // And it STAYS survived: after the save, untouched draft fields follow the
  // rebased baseline — without that, the post-save dirty check misread the
  // stale description draft as typing and a SECOND autosave resurrected the
  // old value ~1s later. Wait past that window and re-assert.
  await page.waitForTimeout(2000);
  expect(drawerPatches).toEqual([{ notes: draftNotes }], 'no stale-field resurrection autosave fires');
  const settled = await (await page.request.get(`/api/tasks/${task.id}`)).json();
  expect(settled.description).toBe(agentDescription);
  expect(settled.notes).toBe(draftNotes);
});

test('an untouched drawer never resends values a task refresh folded into it', async ({ page, request }) => {
  const prefix = `wave1-untouched-fold-${Date.now()}`;
  const task = await createDrawerTask(page.request, prefix);
  const agentNotes = 'Notes rewritten by the MCP agent';
  const drawerPatches = [];
  await openDrawer(page, task);
  await page.route(`**/api/tasks/${task.id}`, async (route) => {
    if (route.request().method() === 'PATCH') drawerPatches.push(route.request().postDataJSON());
    await route.continue();
  });

  // The agent edit lands out-of-band; the user touches nothing in the drawer.
  const agentPatch = await request.patch(`/api/tasks/${task.id}`, { data: { notes: agentNotes } });
  expect(agentPatch.ok()).toBe(true);

  // A successful quick capture runs loadTasks() + renderApp() with the drawer
  // still open: the refresh reconcile folds the agent's notes into draft
  // state while the drawer DOM still shows the old value. Reading that stale
  // unfocused DOM as "typing" armed an autosave that PATCHed the old notes
  // back over the agent's edit.
  await page.keyboard.press('n');
  const capture = page.getByRole('dialog', { name: 'Quick capture' });
  await expect(capture).toBeVisible();
  await capture.getByLabel('Task title').fill(`${prefix} unrelated capture`);
  await capture.getByRole('button', { name: 'Add task', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('Added to');

  await expect(page.locator('[data-task-notes]')).toHaveValue(agentNotes);
  await page.waitForTimeout(2000);
  expect(drawerPatches).toEqual([]);
  const settled = await (await page.request.get(`/api/tasks/${task.id}`)).json();
  expect(settled.notes).toBe(agentNotes);
});

test('a committed notes-only save with a lost response reconciles as saved despite an agent description edit', async ({ page, request }) => {
  const prefix = `wave1-lost-notes-${Date.now()}`;
  const task = await createDrawerTask(page.request, prefix);
  const draftNotes = 'Notes committed but the response was lost';
  const agentDescription = 'Description rewritten by the MCP agent';
  let notesPatches = 0;
  await openDrawer(page, task);
  await page.route(`**/api/tasks/${task.id}`, async (route) => {
    const isNotesPatch = route.request().method() === 'PATCH'
      && Object.hasOwn(route.request().postDataJSON(), 'notes');
    if (!isNotesPatch) {
      await route.continue();
      return;
    }
    notesPatches += 1;
    // The agent's description edit commits first, then the notes PATCH
    // commits but its response is lost. The readback must judge only the
    // SENT field (notes) — a whole-snapshot compare read the agent's
    // description as a conflict and blocked close for a save that landed.
    const agentPatch = await request.patch(`/api/tasks/${task.id}`, { data: { description: agentDescription } });
    expect(agentPatch.ok()).toBe(true);
    await route.fetch();
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'injected lost notes response' }),
    });
  });

  const autosaveFlushed = page.waitForResponse((response) => response.url().endsWith(`/api/tasks/${task.id}`)
    && response.request().method() === 'PATCH');
  await page.locator('[data-task-notes]').fill(draftNotes);
  await autosaveFlushed;

  await expect(page.locator('[data-task-draft-save-status]')).toHaveText('Saved');
  await page.waitForTimeout(1500);
  expect(notesPatches).toBe(1);
  const settled = await (await page.request.get(`/api/tasks/${task.id}`)).json();
  expect(settled.description).toBe(agentDescription);
  expect(settled.notes).toBe(draftNotes);
});

test('a Document-info rename survives the next body-keystroke autosave', async ({ page }) => {
  const prefix = `wave1-doc-rename-${Date.now()}`;
  const projectId = await resolveProjectId(page.request, 'homelab');
  const doc = await createDocument(page.request, {
    title: `${prefix} original`,
    body: '# doc\n\noriginal body\n',
    documentType: 'note',
    project: projectId,
    tags: ['e2e'],
  });
  const renamedTitle = `${prefix} renamed`;
  const renamedBody = '# doc\n\nbody typed after the rename\n';
  const bodyPatches = [];
  await openLibraryDoc(page, doc.title);
  await page.route(`**/api/library/documents/${doc.id}`, async (route) => {
    if (route.request().method() === 'PATCH') {
      const payload = route.request().postDataJSON();
      if (Object.hasOwn(payload, 'body')) bodyPatches.push(payload);
    }
    await route.continue();
  });

  // Let the doc's links load so a late re-render can't swallow the click.
  await expect(page.locator('[data-document-links]')).toBeVisible();
  await page.locator('[data-action="toggle-doc-menu"]').click();
  await page.locator('.menu__panel [data-action="edit-document-info"]').click();
  await page.locator('[data-doc-info-title]').fill(renamedTitle);
  await page.locator('[data-action="save-document-info"]').click();
  await expect(page.locator('[data-doc-info-title]')).toHaveCount(0);

  await replaceEditorBody(page, renamedBody);
  await expect(page.locator('[data-document-save-status]')).toHaveText('Saved');

  // The body autosave sends title+body; before the fix save-document-info left
  // state.documentDraftTitle stale, so this PATCH renamed the document back.
  await expect.poll(() => bodyPatches.length).toBe(1);
  expect(bodyPatches[0].title).toBe(renamedTitle);
  const stored = await (await page.request.get(`/api/library/documents/${doc.id}`)).json();
  expect(stored.title).toBe(renamedTitle);
  expect(stored.body).toBe(renamedBody);
});

test('project navigation cannot silently discard a dirty drawer draft', async ({ page }) => {
  const prefix = `wave1-go-project-${Date.now()}`;
  const task = await createDrawerTask(page.request, prefix, { notes: '' });
  const draftNotes = 'Notes typed just before jumping to the board';
  await openDrawer(page, task);

  // Type notes and, inside the 1s autosave debounce, navigate through a
  // goProject path that is NOT the guarded close button: the command palette's
  // "Go to board" command. The fixed goProject flushes the draft first and
  // vetoes with a toast if the flush fails.
  await page.locator('[data-task-notes]').fill(draftNotes);
  await page.keyboard.press('Control+k');
  await expect(page.locator('[data-palette-input]')).toBeVisible();
  await page.locator('.palette__item', { hasText: 'Go to board' }).click();

  let outcome = 'unsettled';
  await expect.poll(async () => {
    const drawerOpen = (await page.locator('.drawer[data-task-id]').count()) > 0;
    const stored = await (await page.request.get(`/api/tasks/${task.id}`)).json();
    if (stored.notes === draftNotes) outcome = 'flushed';
    else if (drawerOpen && (await page.locator('.toast').count()) > 0) outcome = 'vetoed';
    else outcome = 'unsettled';
    return outcome;
  }).not.toBe('unsettled');
  expect(['flushed', 'vetoed']).toContain(outcome);

  // Silent loss is the failure: the drawer is gone AND the typed notes never
  // reached the server. Either a completed flush or a veto that kept the
  // drawer open is a pass.
  const stored = await (await page.request.get(`/api/tasks/${task.id}`)).json();
  const drawerOpen = (await page.locator('.drawer[data-task-id]').count()) > 0;
  expect(drawerOpen || stored.notes === draftNotes).toBe(true);
});
