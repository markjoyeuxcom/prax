// Evidence for the 2026-09-20 Codex review of 6f609dd. Run from the repository root.
// Historical evidence only: use an unmodified 6f609dd checkout. The repair tests
// live in tests/backend/reviewRepairs.test.js and tests/frontend/reviewAsync.test.js.
// This asserts the reported BUGS exist; a repaired case should make its assertion fail.
// Uses in-memory SQLite, local mock transports and exact source functions in a VM.
// It does not contact Prax, a model provider or Google Calendar, or change production data.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
const root = process.cwd();
const fromRepo = (p) => import(pathToFileURL(`${root}/${p}`));
const { buildApp } = await fromRepo('server/index.js');
const { loadConfig } = await fromRepo('server/config.js');
const { createClient } = await fromRepo('cli/lib/apiClient.js');
const { remember } = await fromRepo('cli/lib/remember.js');
const app = await buildApp({ config: loadConfig({ PRAX_DB_FILE: ':memory:', EMBEDDING_BACKEND: 'none' }) });
const req = async (method, url, payload, headers) => {
  const r = await app.inject({method, url, ...(payload ? {payload} : {}), ...(headers ? {headers} : {})});
  assert.ok(r.statusCode < 400, `${method} ${url}: ${r.statusCode} ${r.body}`);
  return r.body ? r.json() : null;
};
try {
  const project = await req('POST','/api/projects',{name:'Review fixture'});
  const doc = await req('POST','/api/library/documents',{title:'Durable procedure',body:'baseline',project:project.id,documentType:'note'}, {'x-prax-origin':'agent'});
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts={}) => {
    const u = new URL(url);
    const r = await app.inject({method:opts.method || 'GET',url:u.pathname + u.search,headers:opts.headers,payload:opts.body});
    return new Response(r.body,{status:r.statusCode,headers:r.headers});
  };
  try {
    const result = await remember(createClient({baseUrl:'http://review.invalid'}), {title:doc.title,body:'refined cross-project body',project:'memory',crossProject:true});
    assert.equal(result.action,'created');
    assert.notEqual(result.doc.id,doc.id);
    assert.equal((await req('GET',`/api/library/documents/${doc.id}`)).body,'baseline');
    console.log('R03 reproduced: cross-project remember created a duplicate in memory and left the original unchanged.');
  } finally { globalThis.fetch = originalFetch; }
  let patches = 0;
  let injectedNewer = false;
  globalThis.fetch = async (url, opts={}) => {
    const path = new URL(url).pathname + new URL(url).search;
    const r = await app.inject({method:opts.method || 'GET',url:path,headers:opts.headers,payload:opts.body});
    if (opts.method === 'PATCH' && path.endsWith(doc.id) && ++patches === 1) {
      assert.equal(r.statusCode,200);
      await req('PATCH',path,{body:'newer accepted human edit'});
      injectedNewer = true;
      throw new TypeError('Simulated lost response after commit');
    }
    return new Response(r.body,{status:r.statusCode,headers:r.headers});
  };
  try {
    await remember(createClient({baseUrl:'http://review.invalid'}), {id:doc.id,title:doc.title,body:'older agent write',project:'memory',crossProject:true});
  } finally { globalThis.fetch = originalFetch; }
  const after = await req('GET',`/api/library/documents/${doc.id}`);
  assert.equal(injectedNewer,true); assert.equal(patches,2); assert.equal(after.body,'older agent write');
  console.log('R01 reproduced: remember --id retried PATCH and overwrote a newer accepted edit.');

  const source = readFileSync(`${root}/public/js/main.js`,'utf8');
  // Run exact checked-in functions with deferred IO; no browser or reimplementation of the handlers.
  const start = source.indexOf('async function advanceReviewWalk()');
  const end = source.indexOf('// Archive every selected document',start);
  const state = {documents:['a','b','c'].map(id=>({id,updatedBy:'agent',verified:false,status:'active'})), editorDocId:'a',reviewWalk:{ids:['a','b','c'],index:0,verified:0}};
  const opened=[]; let finishVerify;
  const verification = new Promise(resolve=>{finishVerify=resolve;});
  const context = vm.createContext({state,Map,
    setState:patch=>Object.assign(state,patch),currentDocument:()=>state.documents.find(d=>d.id===state.editorDocId),
    isReviewQueueDoc:doc=>Boolean(doc && doc.updatedBy==='agent' && !doc.verified),
    performDocumentLifecycleOnce:(_key,fn)=>fn(),
    changeDocumentVerification:async(id)=>{await verification; state.documents.find(d=>d.id===id).verified=true;},
    openWalkDocument:async(id)=>{opened.push(id);state.editorDocId=id;},
    goLibrary:async()=>{},showToast:()=>{},
  });
  vm.runInContext(source.slice(start,end),context);
  const verifying = vm.runInContext('reviewWalkVerify()',context);
  await vm.runInContext('advanceReviewWalk()',context); // Skip remains enabled while verification is pending.
  assert.equal(state.editorDocId,'b');
  finishVerify(); await verifying;
  assert.equal(state.editorDocId,'c'); assert.equal(state.documents[1].verified,false);
  console.log('R05 reproduced: Skip during verification opens B; the late verification then advances past B to C.');
} finally { await app.close(); }

// Verification conflict arriving after the user opened another document.
{
  const source = readFileSync(`${root}/public/js/main.js`,'utf8');
  const { resolveDocumentDraftRecovery } = await fromRepo('public/js/documentDraftRecovery.js');
  const oldDoc={id:'a',title:'A',body:'baseline',revision:'a'.repeat(64)};
  const newerDoc={...oldDoc,body:'remote edit',revision:'b'.repeat(64)};
  const state={navType:'editor',editorDocId:'a',documentDraftId:'a',documentDraftBase:oldDoc,documentDraftTitle:'A',documentDraftBody:'baseline',isDocumentDirty:false};
  let resolveConflict;
  const pending = new Promise(resolve=>{resolveConflict=resolve;});
  const context=vm.createContext({state,clearTimeout,documentAutosaveTimer:null,documentSavePromise:null,
    setState:patch=>Object.assign(state,patch),documentDraftIsDirty:()=>false,
    reconcileDocumentLifecycle:()=>pending,cacheLifecycleDocument:()=>{},
    documentDraftStorage:()=>null,loadDocumentDraftRecovery:()=>null,resolveDocumentDraftRecovery,clearDocumentDraftRecovery:()=>{},
    destroyEditorController:()=>{},renderApp:()=>{},showToast:()=>{},reportUncommittedLifecycle:()=>{},
  });
  const start=source.indexOf('async function changeDocumentVerification(');
  const end=source.indexOf('async function restoreKnowledgeDocument(',start);
  vm.runInContext(source.slice(start,end),context);
  const seedStart=source.indexOf('function seedEditorDraft(');
  const seedEnd=source.indexOf('// ---------------------------------------------------------------------------',seedStart);
  vm.runInContext(source.slice(seedStart,seedEnd),context);
  const verifying=vm.runInContext("changeDocumentVerification('a',true)",context);
  Object.assign(state,{editorDocId:'b',documentDraftId:'b',documentDraftTitle:'B',documentDraftBody:'new unsaved B input',isDocumentDirty:true});
  resolveConflict({committed:false,document:newerDoc,outcome:'failed'});
  await verifying;
  assert.equal(state.editorDocId,'a');assert.equal(state.documentDraftBody,'remote edit');assert.equal(state.isDocumentDirty,false);
  console.log('R02 reproduced: late verification conflict replaced the newer B editor/draft with A. Storage-unavailable case loses the in-window B draft.');
}

// External-refresh predicates against real document verification responses.
{
  const { collectionFingerprint }=await fromRepo('public/js/externalRefresh.js');
  const app=await buildApp({config:loadConfig({PRAX_DB_FILE:':memory:',EMBEDDING_BACKEND:'none'})});
  try {
    const project=(await app.inject({method:'GET',url:'/api/projects'})).json()[0];
    const before=(await app.inject({method:'POST',url:'/api/library/documents',headers:{'x-prax-origin':'agent'},payload:{title:'External verification',body:'body',project:project.id,documentType:'note'}})).json();
    const response=await app.inject({method:'POST',url:`/api/library/documents/${before.id}/verify`,payload:{verified:true,revision:before.revision}});
    assert.equal(response.statusCode,200);
    const after=response.json();assert.equal(after.verified,true);assert.equal(before.verified,false);
    assert.equal(collectionFingerprint([before]),collectionFingerprint([after]));
    const state={navType:'library',editorDocId:null,tasks:[],documents:[before]};let renders=0,docLoads=0;
    const context=vm.createContext({state,collectionFingerprint,
      loadTasks:async()=>true,loadDocuments:async()=>{docLoads++;state.documents=[after];return true;},
      externalRefresh:{trigger:()=>{}},captureFocus:()=>null,restoreFocus:()=>{},renderApp:()=>{renders++;},
    });
    const source=readFileSync(`${root}/public/js/main.js`,'utf8');
    const a=source.indexOf('async function refreshFromOutside()');
    const b=source.indexOf('const externalRefresh =',a);
    vm.runInContext(source.slice(a,b),context);
    assert.equal(await vm.runInContext('refreshFromOutside()',context),false);assert.equal(renders,0);assert.equal(docLoads,1);
    console.log('R07 reproduced: external verification was fetched, but its unchanged fingerprint suppressed the UI refresh.');
    state.navType='today'; state.editorDocId=before.id;docLoads=0;
    await vm.runInContext('refreshFromOutside()',context);
    assert.equal(docLoads,0);
    console.log('R06 reproduced: a retained editorDocId suppresses document refresh after leaving the editor for Today.');
  } finally {await app.close();}
}

// Calendar projection after project deletion, with a local fake Google transport.
{
  const events=new Map();let settings={calendarId:'review-calendar'};
  const client={ensurePraxCalendar:async()=>settings.calendarId,
    listEventIds:async()=>[...events.keys()],upsertEvent:async(_id,event)=>events.set(event.id,event),deleteEvent:async(_id,eventId)=>events.delete(eventId)};
  const provider={client:async()=>client,getSettings:async()=>settings,putSettings:async(patch)=>{settings={...settings,...patch};}};
  const app=await buildApp({config:loadConfig({PRAX_DB_FILE:':memory:',EMBEDDING_BACKEND:'none'}),googleCalendarProvider:provider});
  try {
    const project=(await app.inject({method:'POST',url:'/api/projects',payload:{name:'Calendar fixture'}})).json();
    const taskResponse=await app.inject({method:'POST',url:'/api/tasks',payload:{title:'Scheduled fixture',priority:'medium',status:'planned',dueDate:'2026-10-01',project:project.id}});
    assert.equal(taskResponse.statusCode,201);
    await app.calendarPusher.flush();assert.equal(events.size,1);
    const deleted=await app.inject({method:'DELETE',url:`/api/projects/${project.id}/permanent`});
    assert.equal(deleted.statusCode,200);assert.equal(deleted.json().deleted.tasks,1);
    await app.calendarPusher.flush();assert.equal(events.size,1);
    app.calendarPusher.notifyBulkChange();await app.calendarPusher.flush();assert.equal(events.size,0);
    console.log('R08 reproduced: project deletion left its Google event behind; explicitly notifying bulk change removed it.');
  } finally {await app.close();}
}

// Gemini adapter drops provider metadata needed to continue a tool call.
{
  const {createGeminiChat}=await fromRepo('server/chat/gemini.js');
  const {runAssistant}=await fromRepo('server/assistant/agent.js');
  const requests=[];
  const chat=createGeminiChat({model:'gemini-3-flash-preview',fetch:async(_url,opts)=>{
    requests.push(JSON.parse(opts.body));
    const parts=requests.length===1 ? [{functionCall:{name:'list_fixture',args:{}},thoughtSignature:'fixture-signature'}] : [{text:'Done'}];
    return new Response(JSON.stringify({candidates:[{content:{role:'model',parts}}]}),{status:200,headers:{'content-type':'application/json'}});
  }});
  await runAssistant({chat,tools:[{name:'list_fixture',description:'Read fixture',readOnly:true,parameters:{type:'object',properties:{}},handler:async()=>({content:[{text:'fixture'}]})}],messages:[{role:'user',content:'Read the fixture'}]});
  assert.equal(requests.length,2);
  const replayedCall=requests[1].contents.find(turn=>turn.role==='model').parts.find(part=>part.functionCall);
  assert.equal(replayedCall.thoughtSignature,undefined);
  console.log('R09 reproduced: the second Gemini tool-loop request discarded thoughtSignature. Google documents this as HTTP 400 for Gemini 3.');
}

// Recall includes unverified memory; supersession must not strand a cycle.
{
  const {recall}=await fromRepo('cli/lib/recall.js');
  const app=await buildApp({config:loadConfig({PRAX_DB_FILE:':memory:',EMBEDDING_BACKEND:'none'})});
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async(url,opts={})=>{
    const u=new URL(url); const r=await app.inject({method:opts.method || 'GET',url:u.pathname+u.search,headers:opts.headers,payload:opts.body});
    return new Response(r.body,{status:r.statusCode,headers:r.headers});
  };
  try {
    const client=createClient({baseUrl:'http://review.invalid'});
    const project=(await client.listProjects())[0];
    const a=await client.createMemory({title:'Cycle fixture alpha',body:'Unverified procedure',project:project.id,documentType:'note'});
    const b=await client.createMemory({title:'Cycle fixture beta',body:'Replacement procedure',project:project.id,documentType:'note'});
    const recalled=await recall(client,{query:'Cycle fixture alpha'});
    assert.equal(recalled.kind,'hit');assert.equal(recalled.top.id,a.id);assert.equal(recalled.top.verified,false);
    console.log('R10 reproduced: normal query recall returns an unverified agent document despite the review UI claiming verified-only recall.');
    await client.supersede(a.id,b.id);await client.supersede(b.id,a.id);
    assert.equal((await client.getDocument(a.id)).status,'superseded');
    assert.equal((await client.getDocument(b.id)).status,'superseded');
    const docs=await client.listDocuments(project.slug,{status:'active'});
    assert.equal(docs.filter(doc=>[a.id,b.id].includes(doc.id)).length,0);
    console.log('R04 reproduced: A→B→A supersession is accepted; both documents disappear from active retrieval.');
  } finally {globalThis.fetch=originalFetch;await app.close();}
}
