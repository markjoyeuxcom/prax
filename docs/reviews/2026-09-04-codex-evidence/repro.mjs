import assert from 'node:assert/strict';
import { buildApp } from '../../../server/index.js';
import { loadConfig } from '../../../server/config.js';
import { createEmbeddingService } from '../../../server/embeddingService.js';
import { createCalendarPusher } from '../../../server/googleCalendarSync.js';
import { runPortableRoundTripDrill } from '../../../scripts/verify-portable-round-trip.js';
const app = await buildApp({ config: loadConfig({PRAX_DB_FILE: ':memory:'}), chat: {supportsTools:true, model:'review-fake', complete: async()=>({text:'Done',model:'review-fake'})} });
const api = async (method,url,payload,agent=false) => {
  const res = await app.inject({method,url,payload,headers:agent?{'x-prax-origin':'agent'}:{}});
  return {status:res.statusCode,body:res.headers['content-type']?.includes('json')?res.json():res.body};
};
const log = (name,evidence)=>console.log(JSON.stringify({name,...evidence}));
try {
  const project = (await api('POST','/api/projects',{name:'Codex isolated review'})).body;
  const doc = (await api('POST','/api/library/documents',{title:'Reviewed safe title',body:'Unchanged body',documentType:'note',project:project.slug},true)).body;
  await api('PATCH',`/api/library/documents/${doc.id}`,{title:'Unreviewed agent title'},true);
  const verified = await api('POST',`/api/library/documents/${doc.id}/verify`,{verified:true,as:'review-fixture',contentHash:doc.contentHash});
  assert.equal(verified.body.verified,true);
  log('verification_accepts_unreviewed_title',{status:verified.status,title:verified.body.title,verified:verified.body.verified,hashUnchanged:verified.body.contentHash===doc.contentHash});

  let resolveOld; let startedResolve;
  const started = new Promise(r=>startedResolve=r);
  const oldService = createEmbeddingService({repository:app.libraryRepository,embedder:{backend:'review-fake',embed:async text=>{startedResolve();await new Promise(r=>resolveOld=r);return {vector:[1,0],model:'same-model',dim:2};}}});
  const oldJob=oldService.embedDocument(doc.id); await started;
  const retitled=(await api('PATCH',`/api/library/documents/${doc.id}`,{title:'Newest title'},true)).body;
  await app.libraryRepository.setDocumentEmbedding(doc.id,{vector:[0,1],backend:'review-fake',model:'same-model',dim:2,contentHash:retitled.contentHash});
  resolveOld();const oldAccepted=await oldJob;
  const stored=(await app.db.query('select embedding from markdown_documents where id=$1',[doc.id])).rows[0];
  assert.equal(oldAccepted,true);assert.equal(stored.embedding,'[1,0]');
  log('older_title_embedding_overwrites_newer',{oldAccepted,storedVector:JSON.parse(stored.embedding)});

  await api('PATCH',`/api/library/documents/${doc.id}`,{body:'Wholly different latest content'},true);
  const ranked=await app.libraryRepository.searchDocumentsSemantic([1,0],'review-fake',{model:'other-model',minSimilarity:0,topDrop:1});
  const counts=await app.libraryRepository.countEmbeddings('review-fake','other-model');
  assert(ranked.some(x=>x.id===doc.id));assert.equal(counts.embedded,0);
  log('semantic_search_uses_stale_content_and_model',{rankedBody:ranked.find(x=>x.id===doc.id).body,embeddedCountForActiveModel:counts.embedded});

  const messages=[{role:'user',content:'create the fixture task'},{role:'assistant',content:'Create a task',toolCalls:[{id:'same-approval-call',name:'create_task',input:{title:'Repeated approval fixture',project:project.slug}}]}];
  const approval={messages,decisions:{'same-approval-call':'approve'}};
  const a=await api('POST','/api/assistant/chat',approval);const b=await api('POST','/api/assistant/chat',approval);
  const tasks=(await api('GET',`/api/tasks?project=${project.slug}`)).body.filter(t=>t.title==='Repeated approval fixture');
  assert.equal(tasks.length,2);
  log('same_assistant_approval_creates_twice',{statuses:[a.status,b.status],taskCount:tasks.length,distinctIds:new Set(tasks.map(t=>t.id)).size});

  const nonAscii=await api('GET','/api/library/documents?q='+encodeURIComponent('数据库'));
  assert(nonAscii.body.some(x=>x.id===doc.id));
  log('unicode_keyword_query_returns_unrelated_documents',{query:'数据库',titles:nonAscii.body.map(x=>x.title)});
} finally {await app.close();}

let releaseUpsert;let startedPushResolve;const startedPush=new Promise(r=>startedPushResolve=r);let pushCount=0;
const provider={client:async()=>({ensurePraxCalendar:async()=> 'calendar',upsertEvent:async()=>{pushCount++;startedPushResolve();await new Promise(r=>releaseUpsert=r);},deleteEvent:async()=>{}}),getSettings:async()=>({calendarId:'calendar'}),putSettings:async()=>{}};
const keepAlive=setInterval(()=>{},1000);
const pusher=createCalendarPusher({provider,tasksRepository:{getTask:async id=>({id,title:'task',status:'planned',dueDate:'2027-01-01'})},debounceMs:5});
pusher.notifyTaskChanged('00000000-0000-4000-8000-000000000001');await startedPush;
pusher.notifyTaskChanged('00000000-0000-4000-8000-000000000002');await new Promise(r=>setTimeout(r,25));releaseUpsert();await new Promise(r=>setTimeout(r,30));pusher.stop();clearInterval(keepAlive);
assert.equal(pushCount,1);log('calendar_change_stranded_during_slow_push',{notified:2,pushed:pushCount});
try {await runPortableRoundTripDrill({profile:'large'});log('large_portable_roundtrip',{unexpected:'passed'});} catch(error){assert.match(error.message,/413/);log('large_portable_roundtrip',{error:error.message});}
