import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

function start(dir) {
  const child=spawn(process.execPath,[fileURLToPath(new URL('../../server/index.js',import.meta.url))],{
    env:{...process.env,HOST:'127.0.0.1',PORT:'0',PRAX_DB_FILE:join(dir,'test.db'),PRAX_DESKTOP_CONTROL:'stdio',PRAX_DESKTOP_PORT_FILE:join(dir,'webview-port'),EMBEDDING_BACKEND:'none',CHAT_BACKEND:'none'},
    stdio:['pipe','pipe','pipe'],
  });
  let output='';
  const exited=new Promise(resolve=>child.once('exit',resolve));
  const ready=new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error(`Desktop child readiness timeout: ${output}`)),10000);
    child.once('exit',code=>{clearTimeout(timeout);reject(new Error(`Desktop child exited ${code}: ${output}`));});
    for(const stream of [child.stdout,child.stderr]) stream.on('data',data=>{
      output+=data;const match=output.match(/PRAX_DESKTOP_READY \{"port":(\d+)\}/);
      if(match){clearTimeout(timeout);resolve(`http://127.0.0.1:${match[1]}`);}
    });
  });
  return {ready,async stop(){child.stdin.end('shutdown\n');const timer=setTimeout(()=>child.kill('SIGKILL'),5000);await exited;clearTimeout(timer);}};
}

test('desktop child restart retains capture input and unsaved document recovery at the same origin',async({browser})=>{
  const dir=mkdtempSync(join(tmpdir(),'prax-desktop-drafts-'));
  const context=await browser.newContext();let child=start(dir);
  try {
    const origin=await child.ready;
    const page=await context.newPage(),capture=await context.newPage();
    const response=await context.request.post(`${origin}/api/library/documents`,{data:{title:'Desktop recovery document',body:'Saved body',project:'inbox',documentType:'note'}});
    expect(response.ok()).toBe(true);const doc=await response.json();
    await capture.goto(`${origin}/capture.html`);await capture.getByLabel('Capture a task').fill('Unsent desktop capture');
    await page.goto(origin);await page.locator('[data-action="nav-library"]').first().click();await page.locator('.doc-card',{hasText:doc.title}).click();
    await page.route(`**/api/library/documents/${doc.id}`,async route=>{
      if(route.request().method()==='PATCH'){await route.fulfill({status:503,contentType:'application/json',body:'{"message":"injected draft save failure"}'});return;}
      await route.continue();
    });
    await page.locator('.cm-content[contenteditable="true"]').click();await page.keyboard.press('ControlOrMeta+A');await page.keyboard.insertText('Uncommitted desktop body');
    await expect(page.locator('[data-document-save-status]')).toHaveText('Save failed');
    await child.stop();child=start(dir);expect(await child.ready).toBe(origin);
    await capture.reload();await expect(capture.getByLabel('Capture a task')).toHaveValue('Unsent desktop capture');
    await page.reload();await page.locator('[data-action="nav-library"]').first().click();await page.locator('.doc-card',{hasText:doc.title}).click();
    await expect(page.locator('[data-document-editor]')).toHaveValue('Uncommitted desktop body');
    await expect(page.locator('[data-document-save-status]')).toHaveText('Recovered draft');
    expect((await (await context.request.get(`${origin}/api/library/documents/${doc.id}`)).json()).body).toBe('Saved body');
  } finally {await context.close();await child.stop();rmSync(dir,{recursive:true,force:true});}
});
