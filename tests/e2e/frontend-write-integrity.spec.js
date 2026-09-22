import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createDocument } from './helpers/seed.js';

// 2026-09-22 review (Medium, frontend): the plan/shutdown walk by keyboard,
// one create per repeated activation, truthful partial outcomes, the title
// autosave's trailing space and the preview checkboxes — end to end against
// the production app. The server is shared by every spec, so each test seeds
// unique titles and walks past everyone else's rows.

function localISO(daysFromNow = 0) {
  const date = new Date(Date.now() + daysFromNow * 86_400_000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Later specs count today's plan and the project list on the shared server,
// so every task, project and plan change made here is undone after each test.
const seededTasks = [];
const seededProjectNames = [];
const plannedBefore = new Map(); // task id → plannedFor before a bulk plan-add

async function createTask(request, payload) {
  const response = await request.post('/api/tasks', {
    data: { project: 'inbox', priority: 'medium', status: 'planned', ...payload },
  });
  expect(response.status()).toBe(201);
  const task = await response.json();
  seededTasks.push(task.id);
  return task;
}

test.afterEach(async ({ request }) => {
  if (plannedBefore.size) {
    for (const task of await (await request.get('/api/tasks')).json()) {
      const before = plannedBefore.get(task.id);
      if (before !== undefined && !seededTasks.includes(task.id) && (task.plannedFor ?? null) !== before) {
        await request.patch(`/api/tasks/${task.id}`, { data: { plannedFor: before } });
      }
    }
    plannedBefore.clear();
  }
  for (const id of seededTasks.splice(0)) await request.delete(`/api/tasks/${id}`);
  if (seededProjectNames.length) {
    const projects = await (await request.get('/api/projects?status=all')).json();
    for (const project of projects.filter((entry) => seededProjectNames.includes(entry.name))) {
      await request.delete(`/api/projects/${project.id}/permanent`);
    }
    seededProjectNames.length = 0;
  }
});

async function readTask(request, id) {
  return (await request.get(`/api/tasks/${id}`)).json();
}

// Hold matching requests for `ms` before they reach the server, so a second
// activation lands while the first is still in flight.
async function delay(page, pattern, method, ms = 400) {
  await page.route(pattern, async (route) => {
    if (route.request().method() === method) await new Promise((resolve) => setTimeout(resolve, ms));
    await route.continue();
  });
}

async function openInboxDrawer(page, task) {
  const projects = await (await page.request.get('/api/projects')).json();
  const inbox = projects.find((project) => project.slug === 'inbox');
  await page.goto('/');
  await page.locator(`[data-action="nav-project"][data-project-id="${inbox.id}"]`).first().click();
  await page.locator('.task-row', { hasText: task.title }).click();
  await expect(page.locator('.drawer[data-task-id]')).toBeVisible();
  const related = page.locator('[data-related-knowledge]');
  await expect(related).toBeVisible();
  await expect(related).not.toContainText('Looking for related notes');
}

// Walk the open plan/shutdown overlay: press S on everyone else's cards and
// hand each of ours to `decide`, until `decide` has seen `count` of them.
async function walkOurs(page, prefix, count, decide) {
  const dialog = page.locator('[data-overlay="planmode"]');
  let seen = 0;
  for (let guard = 0; guard < 200 && seen < count; guard += 1) {
    const progress = await dialog.locator('.planmode__progress').innerText({ timeout: 2000 }).catch(() => null);
    if (progress === null) break;
    const title = await dialog.locator('.planmode__title').innerText();
    if (title.includes(prefix)) {
      await decide(seen, title, progress);
      seen += 1;
    } else {
      await page.keyboard.press('s');
    }
    await expect(dialog.locator('.planmode__progress')).not.toHaveText(progress, { timeout: 5000 }).catch(async () => {
      await expect(dialog.locator('.planmode__doneword')).toBeVisible();
    });
  }
  return seen;
}

test('0eec1ac9: the plan and shutdown walks run the decision the keyboard chose', async ({ page, request }) => {
  const prefix = `kbd-walk-${randomUUID()}`;
  const tasks = [];
  for (const n of [1, 2, 3]) tasks.push(await createTask(request, { title: `${prefix} ${n}`, dueDate: localISO(0) }));
  const byTitle = (title) => tasks.find((task) => title.includes(task.title));

  await page.goto('/');
  await page.locator('[data-action="nav-today"]').first().click();
  await page.locator('[data-action="open-plan-mode"]').first().click();
  const dialog = page.locator('[data-overlay="planmode"]');
  await expect(dialog).toBeVisible();
  // Each card opens on its primary decision.
  await expect(dialog.locator('.planmode__actions .btn-primary')).toBeFocused();

  const planned = [];
  const skipped = [];
  const seen = await walkOurs(page, prefix, 3, async (index, title) => {
    const task = byTitle(title);
    if (index === 0) {
      // Default focus: Enter adds to today.
      await page.keyboard.press('Enter');
      planned.push(task.id);
    } else if (index === 1) {
      // Tab to Skip; Enter runs Skip, not the primary.
      await page.keyboard.press('Tab');
      await expect(dialog.locator('[data-action="plan-mode-skip"]')).toBeFocused();
      await page.keyboard.press('Enter');
      skipped.push(task.id);
    } else {
      // Focus on <body> (a click on the card text): Enter still decides.
      await dialog.locator('.planmode__title').click();
      await expect(page.locator('body')).toBeFocused();
      await page.keyboard.press('Enter');
      planned.push(task.id);
    }
  });
  expect(seen).toBe(3);
  await expect(page.locator('.drawer')).toHaveCount(0); // Enter never opened a task behind the walk
  for (const id of planned) await expect.poll(async () => (await readTask(request, id)).plannedFor).toBe(localISO(0));
  expect((await readTask(request, skipped[0])).plannedFor).toBeFalsy();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // Shutdown: Drop focused + Enter drops; default Enter carries.
  await page.locator('[data-action="open-shutdown"]').first().click();
  await expect(dialog).toBeVisible();
  const dropped = [];
  const carried = [];
  const shut = await walkOurs(page, prefix, 2, async (index, title) => {
    const task = byTitle(title);
    if (index === 0) {
      await dialog.locator('[data-action="shutdown-drop"]').focus();
      await page.keyboard.press('Enter');
      dropped.push(task.id);
    } else {
      await expect(dialog.locator('[data-action="shutdown-carry"]')).toBeFocused();
      await page.keyboard.press('Enter');
      carried.push(task.id);
    }
  });
  expect(shut).toBe(2);
  await expect.poll(async () => (await readTask(request, dropped[0])).plannedFor ?? null).toBeNull();
  expect((await readTask(request, dropped[0])).carryCount).toBe(0);
  await expect.poll(async () => (await readTask(request, carried[0])).plannedFor).toBe(localISO(1));
});

test('0eec1ac9: a double click on a plan decision applies it once and shows the next item', async ({ page, request }) => {
  const prefix = `dbl-walk-${randomUUID()}`;
  const first = await createTask(request, { title: `${prefix} 1`, dueDate: localISO(0) });
  await createTask(request, { title: `${prefix} 2`, dueDate: localISO(0) });
  await page.goto('/');
  await page.locator('[data-action="nav-today"]').first().click();
  await page.locator('[data-action="open-plan-mode"]').first().click();
  const dialog = page.locator('[data-overlay="planmode"]');
  await delay(page, '**/api/tasks/*', 'PATCH');
  const patches = [];
  page.on('request', (req) => { if (req.method() === 'PATCH' && /\/api\/tasks\/[^/]+$/.test(req.url())) patches.push(req.url()); });
  await walkOurs(page, prefix, 1, async (_index, title, progress) => {
    expect(title).toContain(first.title);
    await dialog.locator('[data-action="plan-mode-add"]').dblclick();
    const [position, total] = progress.split(' of ').map(Number);
    await expect(dialog.locator('.planmode__progress')).toHaveText(`${position + 1} of ${total}`);
  });
  expect(patches).toHaveLength(1);
  expect(patches[0]).toContain(first.id);
});

test('d469a9c0: a double Enter or double click creates one checklist item, project and document', async ({ page, request }) => {
  const prefix = `dbl-create-${randomUUID()}`;
  const task = await createTask(request, { title: `${prefix} task` });
  await openInboxDrawer(page, task);
  await delay(page, `**/api/tasks/${task.id}/checklist`, 'POST');
  const field = page.locator('[data-checklist-new]');
  await field.click();
  await page.keyboard.insertText('Renew cert');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(page.locator('.drawer')).toContainText('Renew cert');
  await page.waitForTimeout(600);
  const checklist = await (await request.get(`/api/tasks/${task.id}/checklist`)).json();
  expect(checklist.filter((item) => item.label === 'Renew cert')).toHaveLength(1);
  await page.locator('.drawer__close').click();
  await expect(page.locator('.drawer')).toHaveCount(0);

  // New project: Enter twice in the name field.
  await delay(page, '**/api/projects', 'POST');
  await page.locator('[data-action="nav-all"]').first().click();
  const projectName = `${prefix} project`;
  seededProjectNames.push(projectName, `${prefix} confirmed`);
  await page.locator('[data-new-project-name]').fill(projectName);
  await page.locator('[data-new-project-name]').press('Enter');
  await page.locator('[data-new-project-name]').press('Enter').catch(() => {});
  await expect(page.locator('.toast')).toContainText(`Project "${projectName}" created`);
  // The confirm dialog: an empty name asks in-app; Enter twice there.
  await page.locator('[data-action="nav-all"]').first().click();
  await page.locator('[data-action="create-project"]').click();
  const confirmName = `${prefix} confirmed`;
  await page.locator('[data-confirm-input]').fill(confirmName);
  await page.locator('[data-confirm-input]').press('Enter');
  await page.locator('[data-confirm-input]').press('Enter').catch(() => {});
  await expect(page.locator('.toast')).toContainText(`Project "${confirmName}" created`);
  await page.waitForTimeout(600);
  const projects = await (await request.get('/api/projects?status=all')).json();
  expect(projects.filter((project) => project.name === projectName)).toHaveLength(1);
  expect(projects.filter((project) => project.name === confirmName)).toHaveLength(1);

  // New document: one double click on the menu item.
  const posts = [];
  page.on('request', (req) => { if (req.method() === 'POST' && /\/api\/library\/documents$/.test(req.url())) posts.push(req.url()); });
  await delay(page, '**/api/library/documents', 'POST');
  await page.locator('[data-action="nav-library"]').first().click();
  await page.locator('[data-action="toggle-new-doc-menu"]').click();
  await page.locator('.menu__panel [data-action="new-document"]').first().dblclick();
  await expect(page.locator('[data-doc-title]')).toBeVisible();
  await page.waitForTimeout(600);
  expect(posts).toHaveLength(1);
});

test('a68bd2cf: a failed promote and a failed link say what actually happened', async ({ page, request }) => {
  const prefix = `truth-${randomUUID()}`;
  const backlog = await createTask(request, { title: `${prefix} backlog`, status: 'notes' });
  const projects = await (await request.get('/api/projects')).json();
  const inbox = projects.find((project) => project.slug === 'inbox');
  await page.route(`**/api/tasks/${backlog.id}`, (route) => (route.request().method() === 'PATCH'
    ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' })
    : route.continue()));
  await page.goto('/');
  await page.locator(`[data-action="nav-project"][data-project-id="${inbox.id}"]`).first().click();
  await page.locator('[data-action="set-tab"][data-tab="backlog"]').click();
  await page.locator('.plain-row', { hasText: backlog.title }).locator('[data-action="promote-task"]').click();
  await expect(page.locator('.toast')).toContainText('Prax could not promote this task.');
  await expect(page.locator('.toast')).not.toContainText('Promoted');
  expect((await readTask(request, backlog.id)).status).toBe('notes');

  const task = await createTask(request, { title: `${prefix} note` });
  await openInboxDrawer(page, task);
  await page.route(`**/api/tasks/${task.id}/documents`, (route) => (route.request().method() === 'POST'
    ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' })
    : route.continue()));
  await page.locator('[data-action="start-working-note"]').click();
  await expect(page.locator('.toast')).toContainText('Working note created, but Prax could not link it to the task.');
  await expect(page.locator('[data-doc-title]')).toHaveValue(`Working note — ${task.title}`);
});

test('a68bd2cf: adding due-today tasks to the plan reports the one that failed', async ({ page, request }) => {
  const prefix = `plan-add-${randomUUID()}`;
  const good = await createTask(request, { title: `${prefix} good`, dueDate: localISO(0) });
  const bad = await createTask(request, { title: `${prefix} bad`, dueDate: localISO(0) });
  await page.route(`**/api/tasks/${bad.id}`, (route) => (route.request().method() === 'PATCH'
    ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' })
    : route.continue()));
  await page.goto('/');
  await page.locator('[data-action="nav-today"]').first().click();
  // The button plans every task due today, other specs' too: restore theirs.
  for (const task of await (await request.get('/api/tasks')).json()) plannedBefore.set(task.id, task.plannedFor ?? null);
  await page.locator('[data-action="plan-add-today"]').first().click();
  await expect(page.locator('.toast')).toContainText(/added to today's plan; 1 could not be added\./);
  expect((await readTask(request, good.id)).plannedFor).toBe(localISO(0));
  expect((await readTask(request, bad.id)).plannedFor).toBeFalsy();
});

test('40285cca: pausing after a trailing space in the title keeps the space', async ({ page, request }) => {
  const doc = await createDocument(request, { title: `title-space-${randomUUID()}`, body: '# Body\n', documentType: 'note', project: 'homelab' });
  await page.goto('/');
  await page.locator('[data-action="nav-library"]').first().click();
  await page.locator('[data-library-search]').fill(doc.title);
  await page.locator('.doc-card, .doc-table__row', { hasText: doc.title }).first().click();
  const title = page.locator('[data-doc-title]');
  await expect(title).toHaveValue(doc.title);
  await title.click();
  await page.keyboard.press('ControlOrMeta+A');
  const saved = page.waitForResponse((response) => response.url().endsWith(`/api/library/documents/${doc.id}`) && response.request().method() === 'PATCH');
  await page.keyboard.type('Post ');
  await saved; // the autosave of "Post" landed while the space was in the input
  await page.waitForTimeout(200);
  await expect(title).toHaveValue('Post ');
  await page.keyboard.type('mortem');
  await expect(title).toHaveValue('Post mortem');
  await expect.poll(async () => (await (await request.get(`/api/library/documents/${doc.id}`)).json()).title).toBe('Post mortem');
});

test('61f85e96: preview checkboxes toggle by click and Space; URLs keep their underscores', async ({ page, request }) => {
  const body = '# Checks\n\n- [ ] Renew cert\n- [x] Rotate keys\n\nSee [init](https://github.com/org/repo/blob/main/pkg/__init__.py).\n';
  const doc = await createDocument(request, { title: `preview-check-${randomUUID()}`, body, documentType: 'note', project: 'homelab' });
  await page.goto('/');
  await page.locator('[data-action="nav-library"]').first().click();
  await page.locator('[data-library-search]').fill(doc.title);
  await page.locator('.doc-card, .doc-table__row', { hasText: doc.title }).first().click();
  await page.locator('[data-action="set-editor-mode"][data-mode="preview"]').click();
  const preview = page.locator('[data-markdown-preview]');
  await expect(preview.locator('a', { hasText: 'init' })).toHaveAttribute('href', 'https://github.com/org/repo/blob/main/pkg/__init__.py');
  const renew = preview.locator('[role="checkbox"]', { hasText: 'Renew cert' });
  await expect(renew).toHaveAttribute('aria-checked', 'false');
  await renew.click();
  await expect(preview.locator('[role="checkbox"]', { hasText: 'Renew cert' })).toHaveAttribute('aria-checked', 'true');
  const rotate = preview.locator('[role="checkbox"]', { hasText: 'Rotate keys' });
  await rotate.focus();
  await page.keyboard.press(' ');
  await expect(preview.locator('[role="checkbox"]', { hasText: 'Rotate keys' })).toHaveAttribute('aria-checked', 'false');
  await expect.poll(async () => (await (await request.get(`/api/library/documents/${doc.id}`)).json()).body)
    .toBe('# Checks\n\n- [x] Renew cert\n- [ ] Rotate keys\n\nSee [init](https://github.com/org/repo/blob/main/pkg/__init__.py).\n');
});
