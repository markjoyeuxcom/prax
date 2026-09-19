import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

async function project(request) {
  const response = await request.post('/api/projects', { data: { name: `review-${randomUUID()}` } });
  expect(response.ok()).toBe(true);
  return response.json();
}
async function titles(request, title) {
  return (await (await request.get('/api/tasks')).json()).filter(t => t.title === title);
}

test('capture completion preserves text typed while the submitted request was pending', async ({ page, request }) => {
  await page.goto('/capture.html');
  let release, seen;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { seen = resolve; });
  await page.route('**/api/tasks', async route => {
    if (route.request().method() === 'POST') { seen(); await gate; }
    await route.continue();
  });
  const input = page.getByLabel('Capture a task');
  const first = `first-${randomUUID()}`, second = `second-${randomUUID()}`;
  await input.fill(first); await input.press('Enter'); await started;
  await input.fill(second); release();
  await expect.poll(async () => (await titles(request, first)).length).toBe(1);
  await expect(page.locator('#capture-hint')).not.toHaveText('Saving…');
  await expect(input).toHaveValue(second);
  await page.reload();
  await expect(input).toHaveValue(second);
});

test('capture retry after a committed response was lost and the page reloaded creates once', async ({ page, request }) => {
  await page.goto('/capture.html');
  let first = true;
  await page.route('**/api/tasks', async route => {
    if (route.request().method() === 'POST' && first) { first = false; await route.fetch(); await route.abort(); return; }
    await route.continue();
  });
  const title = `lost-${randomUUID()}`;
  const input = page.getByLabel('Capture a task');
  await input.fill(title); await input.press('Enter');
  await expect(page.locator('#capture-hint')).toContainText('unreachable');
  await page.reload(); await input.press('Enter');
  await expect(input).toHaveValue('');
  expect(await titles(request, title)).toHaveLength(1);
});

test('project fields edited together both survive saving and reload', async ({ page, request }) => {
  const p = await project(request);
  await page.goto('/');
  await page.locator(`[data-action="nav-project"][data-project-id="${p.id}"]`).first().click();
  // Unset ops fields render as "+ Field" buttons; reveal each before typing.
  await page.locator('[data-action="reveal-ops-field"][data-field="onCall"]').click();
  await page.locator('[data-project-oncall]').fill('First field');
  await page.locator('[data-action="reveal-ops-field"][data-field="handoffNotes"]').click();
  await page.locator('[data-project-handoff]').fill('Second field');
  await expect.poll(async () => (await (await request.get('/api/projects')).json()).find(x => x.id === p.id).handoffNotes).toBe('Second field');
  await page.reload();
  await expect(page.locator('[data-project-oncall]')).toHaveValue('First field');
  await expect(page.locator('[data-project-handoff]')).toHaveValue('Second field');
});

test('body-only autosave preserves a newer remote title', async ({ page, request }) => {
  const p=await project(request);
  const doc=await (await request.post('/api/library/documents',{data:{title:`Original-${randomUUID()}`,body:'Original body',project:p.id,documentType:'note'}})).json();
  await page.goto('/');await page.locator('[data-action="nav-library"]').first().click();await page.locator('.doc-card',{hasText:doc.title}).click();
  await request.patch(`/api/library/documents/${doc.id}`,{data:{title:'New remote title'},headers:{'x-prax-origin':'agent'}});
  await page.locator('.cm-content[contenteditable="true"]').click();await page.keyboard.press('ControlOrMeta+A');await page.keyboard.insertText('Local body edit');
  await expect.poll(async()=> (await (await request.get(`/api/library/documents/${doc.id}`)).json()).body).toBe('Local body edit');
  const saved=await (await request.get(`/api/library/documents/${doc.id}`)).json();
  expect(saved.title).toBe('New remote title');
  await expect(page.locator('[data-doc-title]')).toHaveValue('New remote title');
});

test('Health opens the actual document for review before verification', async ({page,request})=>{
  const doc=await (await request.post('/api/library/documents',{data:{title:`Health-${randomUUID()}`,body:'Previously read content',project:'inbox',documentType:'note'},headers:{'x-prax-origin':'agent'}})).json();
  await page.goto('/');await page.locator('[data-action="nav-library"]').first().click();await page.locator('[data-action="toggle-library-menu"]').click();await page.locator('[data-action="open-health"]').click();
  const verify=page.locator(`[data-action="verify-health-doc"][data-doc-id="${doc.id}"]`);await verify.waitFor();
  await request.patch(`/api/library/documents/${doc.id}`,{data:{body:'New agent content requiring review'},headers:{'x-prax-origin':'agent'}});
  await verify.click();
  await expect(page.locator('.editor-body')).toContainText('New agent content requiring review');
  expect((await (await request.get(`/api/library/documents/${doc.id}`)).json()).verified).toBe(false);
});

test('archive reconciles a lost response and offers undo for the committed task', async ({page,request})=>{
  const title=`Archive-${randomUUID()}`;
  const task=await (await request.post('/api/tasks',{data:{title,project:'inbox',priority:'medium',status:'planned'}})).json();
  await page.goto('/');await page.getByText(title,{exact:true}).first().click();
  await page.route(`**/api/tasks/${task.id}`,async route=>{if(route.request().method()==='DELETE'){await route.fetch();await route.abort();return;}await route.continue();});
  await page.locator('[data-action="archive-task"]').click();
  await expect(page.locator('.toast')).toContainText('Task archived');
  await expect(page.locator('.toast')).toContainText('Undo');
  expect((await (await request.get(`/api/tasks/${task.id}`)).json()).archivedAt).toBeTruthy();
});

test('assistant approval recovers after committed response loss and page reload without duplicates',async({page,request})=>{
  expect((await request.put('/api/settings/ai-answers',{data:{backend:'fake'}})).ok()).toBe(true);
  const title=`Approval-${randomUUID()}`;
  await page.goto('/');await page.locator('[data-action="open-assistant"]').click();
  const input=page.locator('[data-assistant-input]');await expect(input).toBeEnabled();
  await input.fill(`call create_task ${JSON.stringify({title,project:'inbox'})}`);
  await page.locator('[data-action="assistant-send"]').click();await expect(page.locator('.asst__confirm')).toContainText(title);
  let first=true;
  await page.route('**/api/assistant/chat',async route=>{
    if(route.request().postDataJSON().decisions&&first){first=false;await route.fetch();await route.abort();return;}
    await route.continue();
  });
  await page.locator('[data-action="assistant-approve"]').click();
  await expect(page.locator('[data-action="assistant-approve"]')).toHaveText('Retry safely');
  await expect(page.locator('[data-assistant-outcome]')).toContainText('outcome was known');
  // Provider settings can change while an approval outcome is still unknown.
  expect((await request.put('/api/settings/ai-answers',{data:{backend:'none',enabled:false}})).ok()).toBe(true);
  await page.locator('[data-action="assistant-approve"]').click();
  await expect(page.locator('[data-assistant-outcome]')).toContainText('No AI model configured');
  expect((await request.put('/api/settings/ai-answers',{data:{backend:'fake',enabled:true}})).ok()).toBe(true);
  await page.reload();await page.locator('[data-action="open-assistant"]').click();
  await expect(page.locator('[data-action="assistant-approve"]')).toHaveText('Retry safely');
  await page.locator('[data-action="assistant-approve"]').click();
  await expect(page.locator('[data-action="assistant-approve"]')).toHaveCount(0);
  expect(await titles(request,title)).toHaveLength(1);
});

test('a title-only edit merges a remote body into the visible editor',async({page,request})=>{
  const p=await project(request);
  const doc=await (await request.post('/api/library/documents',{data:{title:`Title-${randomUUID()}`,body:'Original body',project:p.id,documentType:'note'}})).json();
  await page.goto('/');await page.locator('[data-action="nav-library"]').first().click();await page.locator('.doc-card',{hasText:doc.title}).click();
  await request.patch(`/api/library/documents/${doc.id}`,{data:{body:'New remote body'},headers:{'x-prax-origin':'agent'}});
  await page.locator('[data-doc-title]').fill('My new title');
  await expect.poll(async()=> (await (await request.get(`/api/library/documents/${doc.id}`)).json()).title).toBe('My new title');
  await expect(page.locator('.cm-content')).toHaveText('New remote body');
  expect((await (await request.get(`/api/library/documents/${doc.id}`)).json()).body).toBe('New remote body');
});

test('a same-field document conflict survives reload without replacing the saved copy', async ({page,request}) => {
  const doc=await (await request.post('/api/library/documents',{data:{title:`Conflict-${randomUUID()}`,body:'Original body',project:'inbox',documentType:'note'}})).json();
  await page.goto('/');await page.locator('[data-action="nav-library"]').first().click();await page.locator('.doc-card',{hasText:doc.title}).click();
  await request.patch(`/api/library/documents/${doc.id}`,{data:{body:'Remote edit'},headers:{'x-prax-origin':'agent'}});
  await page.locator('.cm-content[contenteditable="true"]').click();await page.keyboard.press('ControlOrMeta+A');await page.keyboard.insertText('Local conflicting edit');
  await expect(page.locator('[data-document-save-action]')).toHaveText('Review and save');
  expect((await (await request.get(`/api/library/documents/${doc.id}`)).json()).body).toBe('Remote edit');
  await page.reload();await page.locator('[data-action="nav-library"]').first().click();await page.locator('.doc-card',{hasText:doc.title}).click();
  await expect(page.locator('[data-document-editor]')).toHaveValue('Local conflicting edit');
  await expect(page.locator('[data-document-save-action]')).toHaveText('Review and save');
  await page.waitForTimeout(1600);
  expect((await (await request.get(`/api/library/documents/${doc.id}`)).json()).body).toBe('Remote edit');
});
