import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, mkdir, rename, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createInitialState, migrationCatalog } from './checks.mjs';
import { readiness, effectiveStatus, validateRecord, STATUSES } from './readiness.mjs';

const DIR=path.dirname(fileURLToPath(import.meta.url));
const DIST=path.resolve(DIR,'../dist');
const FILE=process.env.ATLAS_TRACKER_DATA_FILE
  ? path.resolve(process.env.ATLAS_TRACKER_DATA_FILE) : path.resolve(DIR,'../.data/acceptance.json');
const PORT=Number(process.env.ATLAS_TRACKER_PORT || 4179);
const HOST='127.0.0.1'; // Intentionally private. No public hosting or production credentials.
const DISABLE_GITHUB_SYNC=process.env.ATLAS_TRACKER_DISABLE_GITHUB_SYNC==='1';
let state, writeQueue=Promise.resolve(), syncTask=null;

function serialize(action) {
 const next=writeQueue.then(action,action);
 writeQueue=next.catch(()=>{});
 return next;
}
async function save() {
 await mkdir(path.dirname(FILE),{recursive:true});
 const temp=FILE+'.'+process.pid+'.tmp';
 await writeFile(temp,JSON.stringify(state,null,2)+'\n',{mode:0o600});
 await rename(temp,FILE);
}
async function initialize() {
 try{state=JSON.parse(await readFile(FILE,'utf8'));}
 catch(error){
  if(error.code!=='ENOENT')throw error;
  state=createInitialState();
  await save();
 }
 // Upgrade placeholder migration labels on existing installs without resetting
 // any evidence, manually recorded statuses, notes or verification timestamps.
 if(Array.isArray(state.migrations)){
  let corrected=false;
  for(const row of state.migrations){
   const official=migrationCatalog.find(x=>x.version===Number(row.version));
   if(official && (row.name!==official.name || row.observed_id!==official.observed_id)){
    row.name=official.name;
    row.observed_id=official.observed_id;
    corrected=true;
   }
  }
  if(corrected)await save();
 }
}
const respond=(res,code,data)=>{
 res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'});
 res.end(JSON.stringify(data));
};
function localOrigin(req) {
 const origin=req.headers.origin;
 if(!origin)return true; // command-line clients on loopback
 try{
  const url=new URL(origin);
  return url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)
    && ['4178','4179','4180'].includes(url.port);
 }catch{return false;}
}
async function readJSON(req) {
 let raw='';
 for await(const chunk of req){
  raw+=chunk.toString();
  if(raw.length>32_000)throw new Error('Evidence report exceeds size limit.');
 }
 return JSON.parse(raw||'{}');
}
async function github(endpoint) {
 const abort=new AbortController();
 const timeout=setTimeout(()=>abort.abort(),8000);
 try{
  const headers={'Accept':'application/vnd.github+json','User-Agent':'Atlas-Acceptance-Standalone'};
  if(process.env.GITHUB_TOKEN)headers.Authorization='Bearer '+process.env.GITHUB_TOKEN;
  const res=await fetch('https://api.github.com/repos/YenugantiVijay/Atlas-OS'+endpoint,
   {headers,signal:abort.signal});
  if(!res.ok)throw new Error('GitHub returned HTTP '+res.status);
  return res.json();
 }finally{clearTimeout(timeout);}
}
function noteEvent(type,title,detail,url='') {
 state.events.unshift({id:randomUUID(),event_type:type,title,detail,source_url:url,
  occurred_at:new Date().toISOString()});
 state.events=state.events.slice(0,250);
}
async function synchronize(force=false) {
 if(DISABLE_GITHUB_SYNC)return {ok:false,error:'GitHub synchronization disabled in isolated test mode.'};
 if(syncTask)return syncTask;
 if(!force && state.github.last_synced_at &&
   Date.now()-Date.parse(state.github.last_synced_at)<180000)return {ok:true,skipped:true};
 syncTask=(async()=>{
  try{
   const [main,dev,prs,runs]=await Promise.all([
    github('/branches/main'),github('/branches/Vijay-Atlas'),
    github('/pulls?state=all&per_page=20&sort=updated&direction=desc'),
    github('/actions/runs?per_page=25')
   ]);
   const next={
    repo:'YenugantiVijay/Atlas-OS',main_sha:main.commit.sha,dev_sha:dev.commit.sha,
    pull_requests:prs.map(p=>({number:p.number,title:p.title,merged_at:p.merged_at,
      state:p.merged_at?'merged':p.draft?'draft':p.state,url:p.html_url,
      head_sha:p.head?.sha||'',updated_at:p.updated_at})),
    ci_runs:(runs.workflow_runs||[]).map(r=>({id:r.id,name:r.name,branch:r.head_branch,
      status:r.status,conclusion:r.conclusion,head_sha:r.head_sha,url:r.html_url,at:r.updated_at})),
    last_synced_at:new Date().toISOString(),last_error:''
   };
   await serialize(async()=>{
    const prior=state.github.main_sha;
    state.github=next;
    if(prior && prior!==next.main_sha)noteEvent('merge','main changed to '+next.main_sha.slice(0,8),
      'Recheck real-authenticated evidence on the new commit.',
      'https://github.com/YenugantiVijay/Atlas-OS/commits/main');
    await save();
   });
   return {ok:true,main_sha:next.main_sha};
  }catch(error){
   await serialize(async()=>{
    state.github.last_error=String(error.message||error);
    await save();
   });
   return {ok:false,error:state.github.last_error};
  }finally{syncTask=null;}
 })();
 return syncTask;
}
function snapshot() {
 const checks=state.checks.map(c=>({...c,effective_status:effectiveStatus(c,state.github.main_sha)}));
 return {...state,checks,summary:readiness(state.checks,state.migrations,state.github),
  policy:{productionReadOnly:true,excluded:'200-entry Demo Mode test',
   branchFlow:['Vijay-Atlas','Test / CI','Pull request','main'],
   realAuthRequired:true,storage:'local JSON; no Hatchable or Atlas production database'}};
}
async function staticFile(res,pathname) {
 let absolute;
 try{absolute=path.resolve(DIST,'.'+decodeURIComponent(pathname==='/'?'/index.html':pathname));}
 catch{return respond(res,400,{error:'Invalid path'});}
 if(absolute!==path.join(DIST,'index.html') &&
   !absolute.startsWith(DIST+path.sep))return respond(res,403,{error:'Forbidden path'});
 try{
  const info=await stat(absolute);
  if(!info.isFile())throw new Error('Not a file');
 }catch{absolute=path.join(DIST,'index.html');}
 try{
  const content=await readFile(absolute);
  const ext=path.extname(absolute);
  const types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8',
   '.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json'};
  res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream',
   'X-Frame-Options':'DENY','X-Content-Type-Options':'nosniff'});
  res.end(content);
 }catch{return respond(res,404,{error:'Run npm run build, or use npm run dev.'});}
}

await initialize();
http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url||'/', 'http://127.0.0.1:'+PORT);
  const p=url.pathname;
  if(p==='/api/health' && req.method==='GET')
   return respond(res,200,{ok:true,productionWrites:false,storage:'localhost-only'});
  if(p.startsWith('/api/')&&!localOrigin(req))
   return respond(res,403,{error:'Only local Atlas OS dashboard clients are permitted.'});
  if(p==='/api/state'&&req.method==='GET'){
   if(!state.github.last_synced_at)void synchronize(false);
   return respond(res,200,snapshot());
  }
  if(p==='/api/github/refresh'&&req.method==='POST'){
   const result=await synchronize(true);
   return respond(res,result.ok?200:502,result);
  }
  if(p==='/api/runs/record'&&req.method==='POST'){
   const input=await readJSON(req);
   const check=state.checks.find(x=>x.id===String(input.check_id));
   if(!check)return respond(res,404,{error:'Acceptance check not found.'});
   const run=validateRecord(input,check,state.github.main_sha);
   const entry=await serialize(async()=>{
    const at=new Date().toISOString();
    Object.assign(check,{status:run.status,evidence_method:run.method,evidence_url:run.evidence_url,
      evidence_notes:run.notes,tested_commit:run.commit_sha,verified_at:run.status==='verified'?at:null,
      last_updated:at,pr_number:run.pr_number});
    const record={id:randomUUID(),check_id:check.id,recorded_at:at,...run};
    state.runs.unshift(record);
    noteEvent('test',check.id+' · '+run.status,run.method+' · '+run.notes.slice(0,180),run.evidence_url);
    await save();
    return record;
   });
   return respond(res,201,{ok:true,run_id:entry.id,
    summary:readiness(state.checks,state.migrations,state.github)});
  }
  if(p==='/api/migrations/record'&&req.method==='POST'){
   const input=await readJSON(req),version=Number(input.version);
   const migration=state.migrations.find(x=>x.version===version);
   if(!migration)return respond(res,404,{error:'Migration version must be 001–048.'});
   if(!STATUSES.includes(input.status))throw new Error('Invalid migration status.');
   const note=String(input.notes||'').trim(),link=String(input.evidence_url||'').trim();
   if(note.length<12||note.length>2000)throw new Error('Provide factual migration notes.');
   if(link&&(!/^https:\/\//i.test(link)||link.length>1400))throw new Error('Evidence must be HTTPS.');
   if(input.status==='verified'&&!link)throw new Error('Verified migration needs HTTPS evidence.');
   await serialize(async()=>{
    migration.status=input.status;migration.evidence_url=link;
    migration.verified_at=input.status==='verified'?new Date().toISOString():null;
    migration.observed_from='Local verification: '+note;
    noteEvent('migration','Migration '+String(version).padStart(3,'0')+' · '+input.status,note,link);
    await save();
   });
   return respond(res,200,{ok:true,version,status:input.status});
  }
  if(p==='/api/export'&&req.method==='GET')return respond(res,200,snapshot());
  if(p.startsWith('/api/'))return respond(res,404,{error:'Not found'});
  if(req.method==='GET')return staticFile(res,p);
  return respond(res,405,{error:'Unsupported method'});
 }catch(error){return respond(res,400,{error:String(error.message||error)});}
}).listen(PORT,HOST,()=>console.log('Atlas OS private acceptance API: http://'+HOST+':'+PORT));
if(!DISABLE_GITHUB_SYNC)setInterval(()=>{void synchronize(false);},180000).unref();
