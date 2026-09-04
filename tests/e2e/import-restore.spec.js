import { test, expect } from '@playwright/test';
import { createDocument, resolveProjectId } from './helpers/seed.js';

function taskExport(title) {
  return JSON.stringify({
    format: 'moomora.tasks',
    version: 1,
    project: 'source',
    tasks: [{
      title,
      description: 'Imported through the human restore flow',
      priority: 'high',
      status: 'planned',
      checklist: [{ label: 'Verify restored task', completed: false }],
    }],
  });
}

async function openDataSettingsFromProject(page, slug) {
  const projectId = await resolveProjectId(page.request, slug);
  await page.goto('/');
  await page.locator(`[data-action="nav-project"][data-project-id="${projectId}"]`).first().click();
  await page.locator('[data-action="nav-settings"]').first().click();
  await page.locator('[data-action="set-settings-tab"][data-tab="data"]').click();
  await expect(page.locator('[data-import-project]')).toHaveValue(projectId);
  return projectId;
}

async function chooseTaskExport(page, title) {
  await page.locator('[data-import-file]').setInputFiles({
    name: `${title}.json`,
    mimeType: 'application/json',
    buffer: Buffer.from(taskExport(title)),
  });
  await expect(page.locator('[data-import-file-summary]')).toContainText(`${title}.json`);
}

test('task restore keeps the visible destination and selected file across mode changes', async ({ page }) => {
  const title = `restore-destination-${Date.now()}`;
  const homelabId = await openDataSettingsFromProject(page, 'homelab');
  const inboxId = await resolveProjectId(page.request, 'inbox');
  await chooseTaskExport(page, title);

  // Mode selection re-renders Settings; the parsed file must survive even
  // though a native file input cannot retain its FileList across that render.
  await page.locator('[name="import-mode"][value="append"]').check();
  await expect(page.locator('[data-import-file-summary]')).toContainText(`${title}.json`);

  let posts = 0;
  await page.route('**/api/tasks/import', async (route) => {
    posts += 1;
    await new Promise(resolve => setTimeout(resolve, 150));
    await route.continue();
  });
  await page.locator('[data-action="import-tasks"]').dblclick();
  await expect(page.locator('[data-import-status]')).toContainText('Imported 1; skipped 0');
  expect(posts).toBe(1);

  const homelabTasks = await (await page.request.get(`/api/tasks?project=${homelabId}`)).json();
  const inboxTasks = await (await page.request.get(`/api/tasks?project=${inboxId}`)).json();
  expect(homelabTasks.filter(task => task.title === title)).toHaveLength(1);
  expect(inboxTasks.filter(task => task.title === title)).toHaveLength(0);
});

test('a response lost after task-import commit retries with the same operation and creates once', async ({ page }) => {
  const title = `restore-lost-response-${Date.now()}`;
  const projectId = await openDataSettingsFromProject(page, 'work');
  await chooseTaskExport(page, title);
  await page.locator('[name="import-mode"][value="append"]').check();

  const requestIds = [];
  let loseFirstResponse = true;
  await page.route('**/api/tasks/import', async (route) => {
    requestIds.push(route.request().postDataJSON().requestId);
    if (loseFirstResponse) {
      loseFirstResponse = false;
      const committed = await route.fetch();
      await committed.body();
      await route.abort('connectionfailed');
      return;
    }
    await route.continue();
  });

  await page.locator('[data-action="import-tasks"]').click();
  await expect(page.locator('[data-import-status]')).toContainText('Retry is safe');
  await expect(page.locator('[data-import-file-summary]')).toContainText(`${title}.json`);

  await page.locator('[data-action="import-tasks"]').click();
  await expect(page.locator('[data-import-status]')).toContainText('recovered from an earlier commit');
  expect(requestIds).toHaveLength(2);
  expect(requestIds[1]).toBe(requestIds[0]);

  const tasks = await (await page.request.get(`/api/tasks?project=${projectId}`)).json();
  expect(tasks.filter(task => task.title === title)).toHaveLength(1);
});

test('a committed task import is not reported as failed when collection refresh fails', async ({ page }) => {
  const title = `restore-refresh-${Date.now()}`;
  const projectId = await openDataSettingsFromProject(page, 'personal');
  await chooseTaskExport(page, title);

  let failNextTaskCollection = false;
  await page.route('**/api/tasks/import', async (route) => {
    const response = await route.fetch();
    failNextTaskCollection = true;
    await route.fulfill({ response });
  });
  await page.route('**/api/tasks?*', async (route) => {
    const url = new URL(route.request().url());
    if (failNextTaskCollection && route.request().method() === 'GET' && url.pathname === '/api/tasks') {
      failNextTaskCollection = false;
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"injected refresh failure"}' });
      return;
    }
    await route.continue();
  });

  await page.locator('[data-action="import-tasks"]').click();
  await expect(page.locator('[data-import-status]')).toContainText('Imported 1 task into Personal; skipped 0. The task list could not refresh');
  await expect(page.locator('.toast')).toContainText('Import committed, but the task list could not refresh');

  const tasks = await (await page.request.get(`/api/tasks?project=${projectId}`)).json();
  expect(tasks.filter(task => task.title === title)).toHaveLength(1);
});

test('Markdown intake selects ownership inside Library, retries exactly once, filters, and reassigns', async ({ page }) => {
  const suffix = Date.now();
  const goodTitle = `plain-import-good-${suffix}`;
  const failedTitle = `plain-import-failed-${suffix}`;
  const markerTitle = `homelab-only-${suffix}`;
  const homelabId = await resolveProjectId(page.request, 'homelab');
  const workId = await resolveProjectId(page.request, 'work');
  const personalId = await resolveProjectId(page.request, 'personal');
  await createDocument(page.request, {
    title: markerTitle,
    body: '# Homelab marker\n',
    documentType: 'note',
    project: homelabId,
    tags: ['e2e'],
  });

  await page.goto('/');
  await page.locator('[data-action="nav-library"]').first().click();

  const action = page.locator('[data-action="import-documents"]').first();
  await expect(action).toHaveText('Import Markdown…');
  await action.click();

  const dialog = page.getByRole('dialog', { name: 'Import Markdown' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-markdown-import-project]')).toBeFocused();
  await dialog.getByRole('button', { name: 'Cancel' }).focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close Markdown import' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(action).toBeFocused();
  await action.click();
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-markdown-import-project]').selectOption(workId);
  await expect(dialog.locator('[data-markdown-import-project]')).toHaveValue(workId);

  const failedRequestIds = [];
  let loseFailedResponse = true;
  await page.route('**/api/library/documents', async (route) => {
    const payload = route.request().postDataJSON();
    if (payload.title === failedTitle) {
      failedRequestIds.push(payload.id);
      if (loseFailedResponse) {
        loseFailedResponse = false;
        const committed = await route.fetch();
        await committed.body();
        await route.abort('connectionfailed');
        return;
      }
      await route.continue();
      return;
    }
    await route.continue();
  });

  await dialog.locator('[data-markdown-import-files]').setInputFiles([
    { name: `${goodTitle}.md`, mimeType: 'text/markdown', buffer: Buffer.from(`# ${goodTitle}\n\nBody\n`) },
    { name: `${failedTitle}.md`, mimeType: 'text/markdown', buffer: Buffer.from(`# ${failedTitle}\n\nBody\n`) },
  ]);
  await expect(dialog.locator('[data-markdown-import-summary]')).toContainText('2 files ready');
  await expect(dialog.locator('[data-markdown-import-summary]')).toContainText(goodTitle);
  await dialog.getByRole('button', { name: 'Import 2' }).click();

  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('status')).toContainText('Imported 1 note into Work. 1 file remains; retry is exact-once safe.');
  await expect(dialog.locator('[data-markdown-import-summary]')).toContainText('1 file ready');
  await expect(dialog.locator('[data-markdown-import-summary]')).toContainText(failedTitle);
  await expect(dialog.locator('[data-markdown-import-summary]')).not.toContainText(goodTitle);
  await expect(dialog.locator('[data-markdown-import-project]')).toBeDisabled();
  await expect(dialog.locator('[data-markdown-import-files]')).toBeDisabled();

  await dialog.getByRole('button', { name: 'Retry failed' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.toast')).toContainText('Imported 1 note into Work.');
  expect(failedRequestIds).toHaveLength(2);
  expect(failedRequestIds[1]).toBe(failedRequestIds[0]);

  const documents = await (await page.request.get('/api/library/documents')).json();
  expect(documents.filter(document => document.title === goodTitle && document.projectId === workId)).toHaveLength(1);
  expect(documents.filter(document => document.title === failedTitle && document.projectId === workId)).toHaveLength(1);

  const workFacet = page.locator(`[data-action="toggle-lib-project"][data-facet="${workId}"]`);
  await expect(workFacet).toContainText('Work');
  await workFacet.click();
  await expect(page.locator('.doc-card', { hasText: goodTitle })).toBeVisible();
  await expect(page.locator('.doc-card', { hasText: markerTitle })).toHaveCount(0);

  await page.locator('.doc-card', { hasText: goodTitle }).click();
  await expect(page.locator('.editor-head__tags .chip--project')).toHaveText('Work');
  await page.locator('[data-action="toggle-doc-menu"]').click();
  await page.locator('[data-action="edit-document-info"]').click();
  const projectSelect = page.locator('[data-doc-info-project]');
  await expect(projectSelect).toHaveValue(workId);
  await projectSelect.selectOption(personalId);
  await page.locator('[data-action="save-document-info"]').click();
  await expect(page.locator('.editor-head__tags .chip--project')).toHaveText('Personal');

  const reassigned = await (await page.request.get(`/api/library/documents/${documents.find(document => document.title === goodTitle).id}`)).json();
  expect(reassigned.projectId).toBe(personalId);
});

test('a staged large import recovers a lost commit after reload with identical chunks and operation',async({page})=>{
  const title=`staged-restore-${Date.now()}`;
  const projectId=await openDataSettingsFromProject(page,'homelab');
  const payload={format:'moomora.tasks',version:1,project:'source',tasks:Array.from({length:501},(_,index)=>({title:`${title}-${index}`,description:'Large staged restore',priority:'medium',status:'planned',checklist:[]}))};
  const choose=async()=>{
    await page.locator('[data-import-file]').setInputFiles({name:`${title}.json`,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(payload))});
    await page.locator('[name="import-mode"][value="append"]').check();
  };
  await choose();
  const requestIds=[], chunks=[];let first=true;
  await page.route('**/api/tasks/import-sessions',async route=>{requestIds.push(route.request().postDataJSON().requestId);await route.continue();});
  await page.route('**/api/tasks/import-sessions/*/chunks/*',async route=>{chunks.push(route.request().url());await route.continue();});
  await page.route('**/api/tasks/import-sessions/*/commit',async route=>{
    if(first){first=false;const committed=await route.fetch();expect(committed.ok()).toBe(true);await committed.body();await route.abort('connectionfailed');return;}
    await route.continue();
  });
  await page.locator('[data-action="import-tasks"]').click();
  await expect(page.locator('[data-import-status]')).toContainText('Retry is safe');
  await page.reload();await page.locator('[data-action="nav-settings"]').first().click();await page.locator('[data-action="set-settings-tab"][data-tab="data"]').click();
  await page.locator('[data-import-project]').selectOption(projectId);await choose();
  await page.locator('[data-action="import-tasks"]').click();
  await expect(page.locator('[data-import-status]')).toContainText('recovered from an earlier commit');
  expect(requestIds).toHaveLength(2);expect(requestIds[1]).toBe(requestIds[0]);
  expect(chunks).toHaveLength(6);expect(chunks.slice(3)).toEqual(chunks.slice(0,3));
  const tasks=await (await page.request.get(`/api/tasks?project=${projectId}`)).json();
  expect(tasks.filter(task=>task.title.startsWith(title))).toHaveLength(501);
});
