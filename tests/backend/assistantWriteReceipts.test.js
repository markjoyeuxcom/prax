import test from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../../server/db.js';
import { runMigrations } from '../../server/migrate.js';
import { createAssistantWriteReceipts } from '../../server/assistant/writeReceipts.js';

test('assistant receipts survive a new executor and reject changed intent', async () => {
  const db=createDb(':memory:'); await runMigrations(db);
  try {
    const one=createAssistantWriteReceipts(db); let calls=0;
    const payload={name:'create_task',input:{title:'once'}};
    const expected={content:'created',isError:false};
    assert.deepEqual(await one.execute('approval',payload,async()=>{calls++;return expected;}),expected);
    const restarted=createAssistantWriteReceipts(db);
    assert.deepEqual(await restarted.execute('approval',payload,async()=>{calls++;return null;}),expected);
    assert.equal(calls,1);
    await assert.rejects(()=>restarted.execute('approval',{...payload,input:{title:'different'}},async()=>{}),/different action/);
  } finally {await db.close();}
});
test('interrupted assistant receipt never blindly repeats an uncertain write', async () => {
  const db=createDb(':memory:'); await runMigrations(db);
  try {
    const receipts=createAssistantWriteReceipts(db);
    let started;const began=new Promise(r=>{started=r;});let release;const gate=new Promise(r=>{release=r;});
    const work=receipts.execute('interrupted',{name:'write'},async()=>{started();await gate;return 'done';});
    await began;
    let repeated=false;
    await assert.rejects(()=>createAssistantWriteReceipts(db).execute('interrupted',{name:'write'},async()=>{repeated=true;}),error=>error.code==='WRITE_OUTCOME_UNKNOWN');
    assert.equal(repeated,false);release();await work;
  } finally {await db.close();}
});

test('explicit demo receipt store deduplicates concurrent approvals and guards changed intents', async () => {
  const { createMemoryAssistantWriteReceipts } = await import('../../server/assistant/writeReceipts.js');
  const receipts = createMemoryAssistantWriteReceipts();
  let writes=0;
  const work=async()=>{writes++;return {id:'demo-task'};};
  const results=await Promise.all([receipts.execute('demo-approval',{title:'One'},work),receipts.execute('demo-approval',{title:'One'},work)]);
  assert.deepEqual(results,[{id:'demo-task'},{id:'demo-task'}]);
  assert.equal(writes,1);
  assert.deepEqual(await receipts.execute('demo-approval',{title:'One'},work),{id:'demo-task'});
  await assert.rejects(receipts.execute('demo-approval',{title:'Changed'},work),/different action/);
  assert.equal(writes,1);
});
