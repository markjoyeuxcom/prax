import assert from 'node:assert/strict';
import { chromium } from '../../../node_modules/playwright/index.mjs';
import { buildApp } from '../../../server/index.js';
import { loadConfig } from '../../../server/config.js';
const app=await buildApp({config:loadConfig({PRAX_DB_FILE:':memory:'})});
const app2=await buildApp({config:loadConfig({PRAX_DB_FILE:':memory:'})});
const base=await app.listen({port:0,host:'127.0.0.1'}),base2=await app2.listen({port:0,host:'127.0.0.1'});
const browser=await chromium.launch();const context=await browser.newContext();const page=await context.newPage();
const log=(name,evidence)=>console.log(JSON.stringify({name,...evidence}));
try {
 const project=(await app.inject({method:'POST',url:'/api/projects',payload:{name:'Codex UI review'}})).json();
 const doc=(await app.inject({method:'POST',url:'/api/library/documents',payload:{title:'Original title',body:'Original body',project:project.slug,documentType:'note'}})).json();
 await page.goto(base);await page.locator(`[data-action="nav-project"][data-project-id="${project.id}"]`).first().click();
 await page.locator('[data-project-oncall]').fill('First field');await page.locator('[data-project-handoff]').fill('Second field');
 await page.waitForTimeout(900);
 const storedProject=(await app.inject('/api/projects')).json().find(x=>x.id===project.id);
 assert.equal(storedProject.onCall,null);assert.equal(storedProject.handoffNotes,'Second field');
 log('project_debounce_discards_prior_field',{onCall:storedProject.onCall,handoffNotes:storedProject.handoffNotes});
 await page.locator('[data-action="nav-library"]').first().click();await page.locator('.doc-card',{hasText:doc.title}).click();
 await app.inject({method:'PATCH',url:`/api/library/documents/${doc.id}`,payload:{title:'New remote title'},headers:{'x-prax-origin':'agent'}});
 await page.locator('.cm-content[contenteditable="true"]').click();await page.keyboard.press('Meta+A');await page.keyboard.insertText('Local body edit');
 await page.waitForTimeout(1400);
 const saved=(await app.inject(`/api/library/documents/${doc.id}`)).json();
 assert.equal(saved.title,'Original title');assert.equal(saved.body,'Local body edit');
 log('body_only_edit_overwrites_remote_title',{expectedTitle:'New remote title',savedTitle:saved.title,body:saved.body});
 await page.evaluate(async()=>{
  const prefs=await import('/js/preferences.js');prefs.savePreferences({...prefs.DEFAULT_PREFERENCES,theme:'dark'});
  const recovery=await import('/js/documentDraftRecovery.js');recovery.storeDocumentDraftRecovery(localStorage,{document:{id:'review-doc',title:'Saved',body:'Saved'},title:'Draft',body:'Unsaved text'});
 });
 const first=await page.evaluate(()=>({theme:JSON.parse(localStorage.getItem('prax.preferences')).theme,draft:localStorage.getItem('prax.documentDraftRecovery.v1.review-doc')!==null}));
 await page.goto(base2);
 const second=await page.evaluate(async()=>({theme:(await import('/js/preferences.js')).loadPreferences().theme,draft:(await import('/js/documentDraftRecovery.js')).loadDocumentDraftRecovery(localStorage,'review-doc')}));
 assert.equal(first.theme,'dark');assert.equal(first.draft,true);assert.equal(second.theme,'light');assert.equal(second.draft,null);
 log('ephemeral_desktop_origin_loses_local_state',{firstOrigin:base,nextOrigin:base2,first,second});

 await page.goto(base+'/capture.html');
 let release;let started;const ready=new Promise(r=>started=r),gate=new Promise(r=>release=r);
 await page.route('**/api/tasks',async route=>{if(route.request().method()==='POST'){started();await gate;}await route.continue();});
 const input=page.getByLabel('Capture a task');await input.fill('First pending capture');await input.press('Enter');await ready;
 await input.fill('Second unsaved capture');release();await page.waitForTimeout(1000);
 const current=await input.inputValue(),draft=await page.evaluate(()=>localStorage.getItem('prax.captureBar.draft'));
 assert.equal(current,'');assert.equal(draft,null);log('capture_success_discards_newer_input',{typed:'Second unsaved capture',current,draft});
 await page.unroute('**/api/tasks');
 await page.goto(base+'/capture.html');let firstCaptureAttempt=true;
 await page.route('**/api/tasks',async route=>{if(route.request().method()==='POST'&&firstCaptureAttempt){firstCaptureAttempt=false;await route.fetch();await route.abort();return;}await route.continue();});
 await input.fill('Lost response and reload');await input.press('Enter');await page.waitForTimeout(200);await page.reload();await input.press('Enter');await page.waitForTimeout(400);
 const duplicates=(await app.inject('/api/tasks')).json().filter(t=>t.title==='Lost response and reload');
 assert.equal(duplicates.length,2);log('capture_reload_forgets_retry_identity',{taskCount:duplicates.length});
} finally {await browser.close();await app.close();await app2.close();}
