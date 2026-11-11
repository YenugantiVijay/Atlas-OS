(function(){
'use strict';
const {html,Head,Status,EvidenceSteps,External,formatDate,shortSha}=window.AtlasUI;
const {useState,useEffect,useCallback}=window.React;
const V=window.AtlasViews;
const NAV=window.AtlasGuidance.sections;
const pickTab=()=>{const h=location.hash.replace('#','');return NAV.some(n=>n.key===h)?h:'overview'};
const API=async(path,opts={})=>{
 const r=await fetch(path,{credentials:'same-origin',headers:{'Content-Type':'application/json'},...opts});
 const data=await r.json().catch(()=>({error:'Non-JSON response'}));
 if(!r.ok)throw new Error(data.error||'Request failed ('+r.status+')');
 return data;
};
const cleanForm=(check,main)=>({
 check_id:check?.id||'AUTH-01',status:'unknown',
 method:check?.requires_auth?'authenticated-browser':'schema-inspection',
 environment:'staging',commit_sha:main||'',pr_number:57,
 evidence_url:'',notes:'',actor:'release owner'
});
const modalHeading=(mode)=>mode==='record'?'Record a staging test':mode==='migration'?'Reverify a migration':'Verification details';

function App(){
 const [data,setData]=useState(null),[page,setPage]=useState(pickTab);
 const [loading,setLoading]=useState(true),[error,setError]=useState('');
 const [refreshing,setRefreshing]=useState(false),[saving,setSaving]=useState(false);
 const [toast,setToast]=useState('');
 const [filter,setFilter]=useState('all'),[query,setQuery]=useState('');
 const [selectedMigration,setSelectedMigration]=useState(48),[flow,setFlow]=useState('auth');
 const [drawer,setDrawer]=useState(null),[form,setForm]=useState(cleanForm(null,'')),[formError,setFormError]=useState('');
 const [migForm,setMigForm]=useState({version:48,status:'verified',evidence_url:'',notes:''});
 const notify=message=>{setToast(message);window.setTimeout(()=>setToast(''),4200)};
 const load=useCallback(async()=>{
   try{const s=await API('/api/state');setData(s);setError('');}
   catch(err){setError(err.message||String(err));}
   finally{setLoading(false);}
 },[]);
 useEffect(()=>{load();},[load]);
 useEffect(()=>{
   const change=()=>setPage(pickTab());
   window.addEventListener('hashchange',change);
   return()=>window.removeEventListener('hashchange',change);
 },[]);
 useEffect(()=>{
   // Local independent tracker refreshes after each test and periodically for GitHub merges.
   const timer=window.setInterval(()=>{void load();},60000);
   return ()=>window.clearInterval(timer);
 },[load]);
 const navigate=key=>{location.hash=key;setPage(key);window.scrollTo({top:0,behavior:'smooth'});};
 const sync=async()=>{
  setRefreshing(true);
  try{
    const r=await API('/api/github/refresh',{method:'POST',body:'{}'});
    await load();
    notify(r.skipped?'GitHub was synchronized recently.':'GitHub releases and CI refreshed.');
  }catch(e){notify('GitHub sync: '+e.message);}
  finally{setRefreshing(false);}
 };
 const record=(c)=>{
   const check=c||data?.checks.find(x=>x.requires_auth)||data?.checks[0];
   setForm(cleanForm(check,data?.github.main_sha||''));
   setFormError('');
   setDrawer({mode:'record',check});
 };
 const inspect=c=>{setDrawer({mode:'inspect',check:c});setFormError('');};
 const markMigration=m=>{
   setMigForm({version:m.version,status:m.status,evidence_url:m.evidence_url||'',notes:''});
   setFormError('');
   setDrawer({mode:'migration',migration:m});
 };
 const submit=async(ev)=>{
   ev.preventDefault();setSaving(true);setFormError('');
   try{
     if(drawer.mode==='record'){
       await API('/api/runs/record',{method:'POST',body:JSON.stringify(form)});
       notify('Test outcome recorded. Release decision recalculated.');
     }else if(drawer.mode==='migration'){
       await API('/api/migrations/record',{method:'POST',body:JSON.stringify(migForm)});
       notify('Migration evidence updated.');
     }
     setDrawer(null);await load();
   }catch(err){setFormError(err.message||'Unable to save.');}
   finally{setSaving(false);}
 };
 const exportReport=()=>{
  if(!data)return;
  const snapshot={project:'Atlas OS',environment:'staging',generated_at:new Date().toISOString(),
    decision:data.summary,github:data.github,checks:data.checks,migrations:data.migrations,
    runs:data.runs,events:data.events,excluded:'200-entry Demo Mode test'};
  const blob=new Blob([JSON.stringify(snapshot,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='atlas-acceptance-'+new Date().toISOString().slice(0,10)+'.json';
  document.body.appendChild(a);a.click();a.remove();window.setTimeout(()=>URL.revokeObjectURL(url),4000);
 };
 const side=html`<aside className="sidebar">
   <div className="brand"><div className="brand-mark">A</div><div><div className="brand-title">Atlas OS</div><div className="brand-sub">Control Center</div></div></div>
   <div className="nav-caption">RELEASE MANAGEMENT</div>
   <nav className="nav" aria-label="Dashboard navigation">${NAV.map(n=>html`<button key=${n.key} className=${'nav-btn '+(page===n.key?'active':'')}
     onClick=${()=>navigate(n.key)}><span className="nav-icon">${n.icon}</span><span>${n.label}</span></button>`)}</nav>
   <div className="sidebar-bottom"><div className="stage-pill"><span className="live-dot"></span> STAGING ONLY</div>
     <p className="side-note">Production write access disabled.<br/>200-entry Demo Mode test excluded.<br/>Single active branch + main.</p></div>
 </aside>`;
 const header=html`<header className="topbar">
   <div className="top-breadcrumb">Workspace <span style=${{color:'#bbb5ca',margin:'0 7px'}}>›</span> Atlas OS <span style=${{color:'#bbb5ca',margin:'0 7px'}}>›</span> <span>${NAV.find(x=>x.key===page)?.label||'Overview'}</span></div>
   <div className="top-actions"><span className="top-sync">${data?'Main · '+shortSha(data.github.main_sha):'Connecting'}</span>
     <span className="top-chip">◉ Release control</span>
     <button className="icon-btn" onClick=${exportReport} title="Export evidence snapshot" aria-label="Export evidence snapshot">⇩</button>
     <button className="icon-btn" onClick=${()=>{void load();notify('Snapshot refreshed.')}} title="Refresh dashboard" aria-label="Refresh dashboard">↻</button>
     <span className="avatar" title="Private release workspace">AO</span></div>
 </header>`;
 let content;
 if(!data){
  content=html`<div className="panel panel-pad" style=${{marginTop:'30px'}}><h2 className="panel-title">${loading?'Loading release dashboard…':'Unable to load acceptance evidence'}</h2>
   <p className="page-subtitle">${error||'Establishing the private workspace connection.'}</p>
   <button className="btn" onClick=${()=>void load()} style=${{marginTop:'20px'}}>Retry connection</button></div>`;
 }else{
   const props={state:data,onRecord:record,onInspect:inspect,onNavigate:navigate,onRefresh:sync,refreshing};
   if(page==='matrix') content=html`<${V.Matrix} ...${props} filter=${filter} onFilter=${setFilter} query=${query} onQuery=${setQuery}/>`;
   else if(page==='migrations') content=html`<${V.Migrations} state=${data} selected=${selectedMigration} onSelected=${setSelectedMigration} onMark=${markMigration}/>`;
   else if(page==='workflows') content=html`<${V.Workflows} ...${props} selected=${flow} onSelect=${setFlow}/>`;
   else if(page==='security') content=html`<${V.Security} ...${props}/>`;
   else if(page==='evidence') content=html`<${V.Evidence} ...${props}/>`;
   else if(page==='releases') content=html`<${V.Releases} ...${props}/>`;
   else content=html`<${V.Overview} ...${props}/>`;
 }
 return html`<div className="app">${side}<div className="main">${header}<main className="page">${content}</main></div>
   ${drawer?html`<div className="drawer-layer" onClick=${ev=>{if(ev.target===ev.currentTarget&&!saving)setDrawer(null)}}>
     <div className="drawer" role="dialog" aria-modal="true" aria-label=${modalHeading(drawer.mode)}>
       <div className="drawer-top"><div><div className="eyebrow">ATLAS / STAGING EVIDENCE</div>
         <h2>${modalHeading(drawer.mode)}</h2></div><button className="icon-btn" onClick=${()=>setDrawer(null)} disabled=${saving} aria-label="Close dialog">✕</button></div>
       ${drawer.mode==='inspect'?html`<div>
         <p><span className="mono">${drawer.check.id}</span> · ${drawer.check.section}</p>
         <h3 className="panel-title" style=${{fontSize:'18px',margin:'16px 0 10px'}}>${drawer.check.title}</h3>
         <${Status} value=${drawer.check.effective_status} large/>
         <p>${drawer.check.description}</p><hr/>
         <div className="eyebrow">EXACT NEXT VERIFICATION STEPS</div>
         <${EvidenceSteps} steps=${drawer.check.next_steps}/>
         <hr/>
         <div className="eyebrow">CURRENT EVIDENCE</div>
         <p>${drawer.check.evidence_notes||'No operator-attested browser evidence attached yet.'}</p>
         <div className="btn-row"><${External} url=${drawer.check.evidence_url}>Open evidence</${External}>
         <span className="mono">${shortSha(drawer.check.tested_commit)}</span></div>
         <div className="drawer-actions"><button className="btn primary" onClick=${()=>record(drawer.check)}>＋ Record staging result</button>
           <button className="btn" onClick=${()=>setDrawer(null)}>Close</button></div>
       </div>`:drawer.mode==='record'?html`<form onSubmit=${submit}>
         <p>Record factual evidence for a staging-only run. Changes immediately update the release summary and are retained in the run journal.</p>
         <label className="field-label">Verification check</label>
         <select className="field" value=${form.check_id} onChange=${ev=>{
           const c=data?.checks.find(c=>c.id===ev.target.value);setForm(cleanForm(c,data?.github.main_sha||''));}}>
           ${data?.checks.map(c=>html`<option key=${c.id} value=${c.id}>${c.id} — ${c.title}</option>`)}</select>
         <label className="field-label">Observed result</label>
         <div className="status-select">${['verified','failed','blocked','unknown'].map(x=>html`<button type="button" key=${x} className=${'status-choice '+(form.status===x?'sel':'')}
           onClick=${()=>setForm({...form,status:x})}>${x}</button>`)}</div>
         <label className="field-label">Verification method</label>
         <select className="field" value=${form.method} onChange=${ev=>setForm({...form,method:ev.target.value})}>
           ${[['authenticated-browser','Real Supabase Auth browser'],['authenticated-api','Real Supabase Auth API'],['restricted-sql','Restricted SQL role'],['schema-inspection','Read-only schema inspection'],['ci','CI / Playwright'],['manual-review','Manual review']].map(x=>html`<option value=${x[0]} key=${x[0]}>${x[1]}</option>`)}</select>
         <div className="callout" style=${{padding:'11px 12px',marginTop:'13px',background:'#f9f8ff'}}>
           <span className="fine">Target environment: <strong>staging only</strong>. For verified real-auth checks, the method must be authenticated-browser/API, with evidence on the current main commit.</span></div>
         <label className="field-label">Commit SHA (current main)</label>
         <input className="field mono" value=${form.commit_sha} onChange=${ev=>setForm({...form,commit_sha:ev.target.value})} maxLength="40" required=${form.status==='verified'&&Boolean(data?.checks.find(c=>c.id===form.check_id)?.requires_auth)}/>
         <div className="btn-row">
           <div style=${{flex:1}}><label className="field-label">PR number</label><input className="field" type="number" min="1" value=${form.pr_number||''} onChange=${ev=>setForm({...form,pr_number:Number(ev.target.value)||null})}/></div>
           <div style=${{flex:1}}><label className="field-label">Test operator</label><input className="field" value=${form.actor} onChange=${ev=>setForm({...form,actor:ev.target.value})} maxLength="80"/></div></div>
         <label className="field-label">HTTPS trace, report or evidence link</label>
         <input className="field" type="url" placeholder="https://github.com/.../actions/runs/..." value=${form.evidence_url}
           onChange=${ev=>setForm({...form,evidence_url:ev.target.value})} required=${form.status==='verified'}/>
         <label className="field-label">Actual observation & cleanup notes *</label>
         <textarea className="field textarea" placeholder="Which identity signed in? What happened? Expected vs observed? Were staging fixtures cleaned up?" value=${form.notes}
           onChange=${ev=>setForm({...form,notes:ev.target.value})} minLength="12" required></textarea>
         ${formError?html`<div className="drawer-alert">${formError}</div>`:null}
         <div className="drawer-actions"><button className="btn primary" type="submit" disabled=${saving}>${saving?'Saving…':'Save test evidence'}</button>
           <button className="btn" type="button" onClick=${()=>setDrawer(null)} disabled=${saving}>Cancel</button></div>
       </form>`:html`<form onSubmit=${submit}>
         <p>Recheck the migration using the staging Supabase management connection. Never change Atlas production from this dashboard.</p>
         <div className="tag">Migration ${String(migForm.version).padStart(3,'0')}</div>
         <label className="field-label">Observed status</label>
         <div className="status-select">${['verified','failed','blocked','unknown'].map(x=>html`<button type="button" key=${x} className=${'status-choice '+(migForm.status===x?'sel':'')}
           onClick=${()=>setMigForm({...migForm,status:x})}>${x}</button>`)}</div>
         <label className="field-label">Staging evidence URL</label>
         <input className="field" type="url" value=${migForm.evidence_url} onChange=${ev=>setMigForm({...migForm,evidence_url:ev.target.value})} required=${migForm.status==='verified'}/>
         <label className="field-label">Observation notes *</label>
         <textarea className="field textarea" value=${migForm.notes} onChange=${ev=>setMigForm({...migForm,notes:ev.target.value})}
            placeholder="Confirm version, order, schema verification, and observed outcome." minLength="12" required></textarea>
         ${formError?html`<div className="drawer-alert">${formError}</div>`:null}
         <div className="drawer-actions"><button className="btn primary" type="submit" disabled=${saving}>${saving?'Saving…':'Update migration evidence'}</button>
           <button className="btn" type="button" onClick=${()=>setDrawer(null)} disabled=${saving}>Cancel</button></div>
       </form>`}
     </div>
   </div>`:null}
   ${toast?html`<div className="toast" role="status">${toast}</div>`:null}
 </div>`;
}
if(!window.React||!window.ReactDOM||!window.htm||!window.AtlasViews){
 document.getElementById('root').textContent='Unable to load the release dashboard. Refresh or check the network connection.';
}else{
 window.ReactDOM.createRoot(document.getElementById('root')).render(html`<${App}/>`);
}
})();