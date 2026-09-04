import test from 'node:test';
import assert from 'node:assert/strict';
import { importRequestFor, completeImportRequest } from '../../public/js/importRecovery.js';
test('reselecting an unchanged import after reload keeps its operation identity until success',async()=>{
 const map=new Map(),storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};
 const first=await importRequestFor(storage,'same file and destination');
 const reloaded=await importRequestFor(storage,'same file and destination');
 assert.equal(first.id,reloaded.id);
 assert.notEqual(first.id,(await importRequestFor(storage,'different file')).id);
 completeImportRequest(storage,first);
 assert.notEqual(first.id,(await importRequestFor(storage,'same file and destination')).id);
});
