import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {tmpdir} from 'node:os';
import {readiness,validateRecord} from './readiness.mjs';
import {createInitialState} from './checks.mjs';
const main='a'.repeat(40);
test('acceptance rules never equate simulated SQL with authenticated browser evidence',()=>{
 const state=createInitialState();
 state.github.main_sha=main;
 assert.equal(readiness(state.checks,state.migrations,state.github).decision,'NO-GO');
 const check=state.checks.find(x=>x.id==='AUTH-01');
 assert.throws(()=>validateRecord({status:'verified',method:'restricted-sql',environment:'staging',
   notes:'SQL role simulation only',evidence_url:'https://example.com',commit_sha:main},check,main),/Real-auth/);
 assert.throws(()=>validateRecord({status:'verified',method:'authenticated-browser',environment:'production',
   notes:'Not allowed to test production',evidence_url:'https://example.com',commit_sha:main},check,main),/Production/);
 assert.throws(()=>validateRecord({status:'verified',method:'authenticated-browser',environment:'staging',
   notes:'Session proved against outdated commit',evidence_url:'https://example.com',commit_sha:'b'.repeat(40)},check,main),/Real-auth/);
});
async function port(){
 return new Promise((resolve,reject)=>{
  const server=net.createServer();
  server.on('error',reject);
  server.listen(0,'127.0.0.1',()=>{
   const p=server.address().port;server.close(()=>resolve(p));
  });
 });
}
test('private API blocks forged auth and writes evidence to its own local file', {timeout:25000},async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'atlas-local-'));
 const apiPort=await port();
 const file=path.join(dir,'acceptance.json');
 const child=spawn(process.execPath,['local/server.mjs'],{
  cwd:path.resolve(import.meta.dirname,'..'),stdio:'ignore',
  env:{...process.env,ATLAS_TRACKER_PORT:String(apiPort),ATLAS_TRACKER_DATA_FILE:file,ATLAS_TRACKER_DISABLE_GITHUB_SYNC:'1'}
 });
 const base='http://127.0.0.1:'+apiPort;
 try{
  let alive=false;
  for(let i=0;i<60;i++){
   try{if((await fetch(base+'/api/health')).ok){alive=true;break;}}catch{}
   if(child.exitCode!==null)break;
   await new Promise(r=>setTimeout(r,60));
  }
  assert.ok(alive,'Local API started');
  const data=await (await fetch(base+'/api/state')).json();
  assert.equal(data.summary.decision,'NO-GO');
  assert.equal(data.migrations.length,48);
  assert.equal(data.checks.find(c=>c.id==='AUTH-01').effective_status,'blocked');
  const request=async(payload,origin='http://127.0.0.1:4178')=>fetch(base+'/api/runs/record',{
   method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(payload)
  });
  const forged={check_id:'AUTH-01',status:'verified',method:'restricted-sql',
   notes:'Not valid genuine JWT acceptance proof',environment:'staging',evidence_url:'https://example.com',commit_sha:main};
  assert.equal((await request(forged)).status,400);
  assert.equal((await request({...forged,method:'authenticated-browser',environment:'production'})).status,400);
  assert.equal((await request({...forged,method:'authenticated-browser'})).status,400);
  const rejected=await request({...forged,status:'blocked',method:'manual-review',commit_sha:'',evidence_url:'',
    notes:'Staging users have not been provisioned'});
  assert.equal(rejected.status,201);
  const saved=JSON.parse(await readFile(file,'utf8'));
  assert.equal(saved.runs.length,1);
  assert.equal(saved.checks.find(c=>c.id==='AUTH-01').status,'blocked');
  assert.equal((await request(forged,'https://untrusted.invalid')).status,403);
 }finally{
  child.kill('SIGTERM');
  await new Promise(r=>child.once('exit',r));
  await rm(dir,{recursive:true,force:true});
 }
});
