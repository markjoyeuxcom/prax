import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFileSync,mkdtempSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {buildApp} from '../../../server/index.js';
import {loadConfig} from '../../../server/config.js';
import {taskToGoogleEvent} from '../../../server/googleCalendar.js';
import {compileWeeklyReview} from '../../../server/weeklyReview.js';
const log=(name,evidence)=>console.log(JSON.stringify({name,...evidence}));
const app=await buildApp({config:loadConfig({PRAX_DB_FILE:':memory:'})});
try {
 let bulk=0;app.calendarPusher.notifyBulkChange=()=>{bulk++;};
 const imported=await app.inject({method:'POST',url:'/api/tasks/import',payload:{project:'inbox',mode:'append',requestId:randomUUID(),tasks:[{title:'dated imported task',dueDate:'2027-01-01'}]}});
 assert.equal(imported.statusCode,201);assert.equal(bulk,0);log('idempotent_import_never_notifies_calendar',{imported:imported.json().imported,notifications:bulk});
 const response=await app.inject('/api/integrations/google-calendar/callback?error='+encodeURIComponent('<h2 id="injected">Review fixture HTML</h2>'));
 assert(response.body.includes('<h2 id="injected">Review fixture HTML</h2>'));log('callback_renders_unescaped_query_html',{status:response.statusCode,rawMarkupAccepted:true,csp:response.headers['content-security-policy']});
 const create=async(title,body)=>(await app.inject({method:'POST',url:'/api/library/documents',payload:{title,body,documentType:'note',project:'inbox'}})).json();
 const a=await create('Same!','First body');const b=await create('Same?','Second body');const ref=await create('Z ref','See source');
 await app.inject({method:'POST',url:`/api/library/documents/${ref.id}/links`,payload:{targetId:b.id,relation:'derived-from'}});
 const archive=await app.inject('/api/library/export?project=inbox');const dir=mkdtempSync('/private/tmp/prax-codex-export-'),zip=dir+'/export.zip';writeFileSync(zip,archive.rawPayload);
 const reference=spawnSync('unzip',['-p',zip,'z-ref.md'],{encoding:'utf8'}).stdout;
 const target=spawnSync('unzip',['-p',zip,'same.md'],{encoding:'utf8'}).stdout;
 assert(reference.includes('ref: same.md'));assert(target.includes('First body'));
 log('deduplicated_export_link_points_to_wrong_document',{targetId:b.id,exportedLink:'same.md',actualTargetFile:'same-2.md',wrongFileBody:'First body'});
} finally {await app.close();}
const event=taskToGoogleEvent({id:randomUUID(),title:'all-day',dueDate:'2026-09-04'});assert.equal(event.start.date,event.end.date);log('google_all_day_event_has_empty_interval',{start:event.start,end:event.end});
const week=compileWeeklyReview({weekStart:'2026-08-31',now:new Date('2026-09-04'),tasks:[{id:'task',title:'Completed last year; notes edited this week',status:'completed',createdAt:'2025-01-01T00:00:00Z',updatedAt:'2026-09-03T00:00:00Z'}],activity:[]});
assert(week.markdown.includes('Completed last year; notes edited this week'));log('weekly_shipped_uses_edit_time',{stats:week.stats,shippedTitle:'Completed last year; notes edited this week'});
