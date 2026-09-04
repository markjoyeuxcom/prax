import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAssistantRecovery, saveAssistantRecovery } from '../../public/js/assistantRecovery.js';
test('an attempted approval retains canonical identities across reload', () => {
  const map=new Map(),storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
  const value={messages:[{role:'assistant',toolCalls:[{id:'call',approvalId:'stable',name:'create_task',input:{title:'task'}}]}],pending:[{id:'call',name:'create_task'}],attempted:true};
  assert.equal(saveAssistantRecovery(storage,value),true);
  assert.deepEqual(loadAssistantRecovery(storage),value);
  saveAssistantRecovery(storage,null);assert.equal(loadAssistantRecovery(storage),null);
});
