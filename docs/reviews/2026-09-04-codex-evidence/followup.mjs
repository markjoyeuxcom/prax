import assert from 'node:assert/strict';
import {chromium} from '../../../node_modules/playwright/index.mjs';
import {buildApp} from '../../../server/index.js';
import {loadConfig} from '../../../server/config.js';
const app=await buildApp({config:loadConfig({PRAX_DB_FILE:':memory:'})});const base=await app.listen({port:0,host:'127.0.0.1'});const browser=await chromium.launch();const page=await browser.newPage();
const log=(name,evidence)=>console.log(JSON.stringify({name,...evidence}));
try{
 const task=(await app.inject({method:'POST',url:'/api/tasks',payload:{title:'Archive fixture',project:'inbox',priority:'medium',status:'planned',dueDate:'2026-01-01',plannedFor:'2026-01-01'}})).json();
 await Promise.all(['2026-02-01','2026-03-01'].map(date=>app.inject({method:'PATCH',url:`/api/tasks/${task.id}`,payload:{dueDate:date,plannedFor:date}})));
 const updated=(await app.inject(`/api/tasks/${task.id}`)).json();

 log('concurrent_task_counter_candidate_not_reproduced',{successfulChanges:2,deferralCount:updated.deferralCount,carryCount:updated.carryCount});
 const doc=(await app.inject({method:'POST',url:'/api/library/documents',payload:{title:'Health review fixture',body:'Previously read content',project:'inbox',documentType:'note'},headers:{'x-prax-origin':'agent'}})).json();
 await page.goto(base);await page.locator('[data-action="nav-library"]').first().click();await page.locator('[data-action="open-health"]').click();await page.locator(`[data-action="verify-health-doc"][data-doc-id="${doc.id}"]`).waitFor();
 await app.inject({method:'PATCH',url:`/api/library/documents/${doc.id}`,payload:{body:'New agent content never shown to the reviewer'},headers:{'x-prax-origin':'agent'}});
 await page.locator(`[data-action="verify-health-doc"][data-doc-id="${doc.id}"]`).click();await page.waitForTimeout(300);
 const verified=(await app.inject(`/api/library/documents/${doc.id}`)).json();assert.equal(verified.verified,true);
 log('health_verification_blesses_unseen_new_content',{verified:verified.verified,body:verified.body,shown:await page.locator('body').textContent().then(x=>x.includes(verified.body))});
 await page.goto(base);await page.getByText('Archive fixture',{exact:true}).first().click();await page.locator('[data-action="archive-task"]').waitFor();
 await page.route(`**/api/tasks/${task.id}`,async route=>{if(route.request().method()==='DELETE'){await route.fetch();await route.abort();return;}await route.continue();});
 await page.locator('[data-action="archive-task"]').click();await page.waitForTimeout(400);
 const archived=(await app.inject(`/api/tasks/${task.id}`)).json();const notice=await page.locator('.toast').textContent();assert(archived.archivedAt);assert(notice.includes('could not'));
 log('committed_archive_reported_as_failure',{archived:true,notice});
}finally{await browser.close();await app.close();}
