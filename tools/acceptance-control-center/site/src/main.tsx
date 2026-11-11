import React from 'react';
import { createRoot } from 'react-dom/client';
import htm from 'htm';

// Version-controlled Vite + TypeScript entry, matching the deployed React UI.
type RuntimeWindow=Window & { React?:typeof React; ReactDOM?:{createRoot:typeof createRoot}; htm?:typeof htm };
const runtime=window as RuntimeWindow;
runtime.React=React;
runtime.ReactDOM={createRoot};
runtime.htm=htm;

function loadFile(src:string):Promise<void>{
 return new Promise<void>((resolve,reject)=>{
  const script=document.createElement('script');
  script.src=src;
  script.onload=()=>resolve();
  script.onerror=()=>reject(new Error('Could not load '+src));
  document.body.appendChild(script);
 });
}
async function boot(){
 for(const file of ['/components.js','/guide.js','/views-overview.js','/views-a.js','/views-b.js','/app.js']){
  await loadFile(file);
 }
}
void boot().catch(error=>{
 const root=document.getElementById('root');
 if(root) root.textContent='Acceptance Control Center initialization failed: '+String(error);
});