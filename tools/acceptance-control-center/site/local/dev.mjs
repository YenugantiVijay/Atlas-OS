import { spawn } from 'node:child_process';
const processes=[];
let stopping=false;
function start(cmd,args) {
 const p=spawn(cmd,args,{stdio:'inherit',env:process.env,shell:process.platform==='win32'});
 processes.push(p);
 p.on('exit',(code)=>{
  if(!stopping && code!==null && code!==0){stop(code||1);}
 });
}
function stop(code=0) {
 if(stopping)return;
 stopping=true;
 for(const proc of processes)if(!proc.killed)proc.kill();
 process.exit(code);
}
process.on('SIGINT',()=>stop(0));
process.on('SIGTERM',()=>stop(0));
start(process.execPath,['local/server.mjs']);
start(process.platform==='win32'?'npm.cmd':'npm',['run','vite:dev']);
