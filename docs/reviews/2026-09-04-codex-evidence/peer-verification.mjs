import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,symlinkSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
const root=process.cwd(),dir=mkdtempSync('/private/tmp/prax codex paths-');
for(const path of ['server','public','mcp','package.json'])cpSync(join(root,path),join(dir,path),{recursive:true});symlinkSync(join(root,'node_modules'),join(dir,'node_modules'));
const launch=spawnSync(process.execPath,[join(dir,'server/index.js')],{cwd:dir,env:{...process.env,PRAX_DB_FILE:':memory:',PORT:'0',HOST:'127.0.0.1',EMBEDDING_BACKEND:'none'},encoding:'utf8',timeout:2000});
assert.equal(launch.status,0);assert.equal(launch.stdout,'');console.log(JSON.stringify({name:'claude_H2_space_path_entry_guard',exit:launch.status,outputBytes:launch.stdout.length}));
const {buildApp}=await import(pathToFileURL(join(dir,'server/index.js')).href);const {loadConfig}=await import(pathToFileURL(join(dir,'server/config.js')).href);
const config=loadConfig({PRAX_DB_FILE:':memory:'});const app=await buildApp({config});
try{
 const health=await app.inject('/healthz'),index=await app.inject('/');assert.equal(health.statusCode,200);assert.equal(index.statusCode,404);
 console.log(JSON.stringify({name:'claude_H3_encoded_static_path',health:health.statusCode,index:index.statusCode,publicDir:config.publicDir}));
 const id='11111111-1111-4111-8111-111111111111';const outcomes={};for(const suffix of ['tasks','similar','links','runs']){const r=await app.inject(`/api/library/documents/${id}/${suffix}`);outcomes[suffix]={status:r.statusCode,body:r.json()};}
 assert.equal(outcomes.tasks.status,200);assert.equal(outcomes.similar.status,200);console.log(JSON.stringify({name:'claude_M2_owner_collections',outcomes}));
}finally{await app.close();}
