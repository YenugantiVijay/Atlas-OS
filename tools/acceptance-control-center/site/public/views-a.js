(function(){
'use strict';
const {html,Status,Head,PanelHead,External,formatDate,EvidenceSteps}=window.AtlasUI;
const V=window.AtlasViews||(window.AtlasViews={});
V.Migrations=function Migrations({state,selected,onSelected,onMark}){
 const ms=state.migrations;const current=ms.find(m=>m.version===selected)||ms[ms.length-1];
 const completed=ms.filter(m=>m.status==='verified').length;
 return html`<div>
   <${Head} eyebrow="POSTGRESQL / SCHEMA CONTROL" title="Migration ledger"
     subtitle="Exact migrations 001–048 from staging. Schema presence is separate from real authenticated workflow acceptance."/>
   <div className="panel">
     <div className="panel-header"><div><h3 className="panel-title">Staging migration sequence</h3>
       <div className="panel-subtitle">001 → 048 · ATLAS-OS-Staging · Supabase PostgreSQL</div></div>
       <div style=${{textAlign:'right'}}><strong style=${{fontSize:'18px',color:'#278c70'}}>${completed} / 48</strong>
         <div className="mig-progress" style=${{marginTop:'8px'}}><div style=${{width:Math.min(100,completed/48*100)+'%'}}></div></div></div>
     </div>
     <hr className="separator"/>
     <div className="mig-wall">${ms.map(m=>html`<button key=${m.version}
       className=${'mig-tile '+m.status+(selected===m.version?' selected':'')}
       aria-label=${'Migration '+String(m.version).padStart(3,'0')+' '+m.status}
       onClick=${()=>onSelected(m.version)}>
       <span className="number">${String(m.version).padStart(3,'0')}</span>
       <span className="mini-state">${m.status==='verified'?'✓ Applied':m.status==='unknown'?'? Unknown':m.status}</span>
     </button>`)}</div>
     ${current?html`<div className="mig-detail">
       <div><strong>Migration ${String(current.version).padStart(3,'0')} · ${current.name.replaceAll('_',' ')}</strong>
         <p>${current.observed_from} · ${formatDate(current.verified_at)}</p>
         <p>Supabase migration ID: <span className="mono">${current.observed_id || 'Not available'}</span></p></div>
       <div className="btn-row"><${Status} value=${current.status}/>
         <${External} url=${current.evidence_url}>Evidence</${External}>
         <button className="btn sm" onClick=${()=>onMark(current)}>Update status</button></div>
     </div>`:null}
   </div>
   <div className="notice blue section-gap"><span>ⓘ</span><span>Migrations were verified through the staging Supabase management connection. They do not revalidate themselves automatically. If schema changes, check staging again and record the result here.</span></div>
 </div>`;
};
V.Workflows=function Workflows({state,selected,onSelect,onInspect,onRecord}){
 const groups=window.AtlasGuidance.flowGroups;const group=groups.find(x=>x.id===selected)||groups[0];
 const checks=group.matches.map(id=>state.checks.find(c=>c.id===id)).filter(Boolean);
 return html`<div>
 <${Head} eyebrow="OPERATOR WORKFLOWS / REAL SESSIONS" title="Authenticated workflow lab"
   subtitle="Guided staging scenarios: sign-in, goods receiving, supplier price history and safeguards. Real JWT sessions and linked traces are mandatory."/>
 <div className="flow-steps">${groups.map(g=>{
 const list=g.matches.map(id=>state.checks.find(c=>c.id===id)).filter(Boolean);
 const ready=list.length>0&&list.every(c=>c.effective_status==='verified');
 const outcome=ready?'verified':list.some(c=>c.effective_status==='failed')?'failed':'unknown';
 return html`<button key=${g.id} className=${'flow-step '+(selected===g.id?'active':'')} onClick=${()=>onSelect(g.id)}>
 <div className="flow-step-num">${g.eyebrow}</div><h4>${g.name}</h4><p>${g.sub}</p>
 <div style=${{marginTop:'11px'}}><${Status} value=${outcome}/></div></button>`})}</div>
 <div className="two-col">
   <div className="panel"><${PanelHead} title=${group.name+' — verification procedure'}
     subtitle="Run the checks in order and attach the observed outcome."/>
     <div style=${{padding:'0 21px 20px'}}>
       ${checks.map(c=>html`<div key=${c.id} style=${{borderTop:'1px solid #f2eff7',padding:'18px 1px'}}>
         <div style=${{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'12px'}}>
           <div><div className="kicker-line">${c.id} · ${c.section}</div>
             <h3 style=${{fontSize:'13px',margin:'8px 0 7px',color:'#38344e'}}>${c.title}</h3></div>
           <${Status} value=${c.effective_status}/>
         </div>
         <${EvidenceSteps} steps=${c.next_steps}/>
         <div className="btn-row" style=${{marginTop:'14px'}}>
           <button className="btn sm subtle" onClick=${()=>onRecord(c)}>＋ Record outcome</button>
           <button className="btn sm" onClick=${()=>onInspect(c)}>Details</button></div>
       </div>`)}
     </div>
   </div>
   <div><div className="panel panel-pad">
       <div className="eyebrow">PRE-FLIGHT CONDITIONS</div><h3 className="panel-title" style=${{marginTop:'9px'}}>Staging test contract</h3>
       <${EvidenceSteps} steps=${[
         'Confirm staging is ACTIVE_HEALTHY and migrations 001–048 remain applied.',
         'Use disposable staging identities and real Supabase-issued authenticated sessions.',
         'Record the exact current main commit and operator. Do not use production credentials.',
         'Collect browser trace or authenticated API report, plus database readback.',
         'Clean up staging fixtures and attach the observed evidence link.'
       ]}/>
     </div>
     <div className="notice section-gap"><span>!</span><div><strong>Simulated roles ≠ real authentication.</strong> Existing restricted PostgreSQL role checks passed, but cannot be used to certify the remaining browser/API sign-in checks.</div></div>
   </div>
 </div></div>`;
};
V.Security=function Security({state,onInspect,onRecord}){
 const roles=['Owner','Admin','Inventory','Accounts','Sales'];
 const checks=state.checks.filter(c=>['Isolation','Permissions','Audit','Integrity','Price safeguards','Stock safeguards'].includes(c.section));
 return html`<div>
 <${Head} eyebrow="TENANT ISOLATION / ZERO-TRUST OPERATIONS" title="Security & roles"
   subtitle="Expected authorization policy from PR #57. These are intended permissions until real staging JWTs verify them."/>
 <div className="panel table-wrap">
   <${PanelHead} title="Role authorization policy" subtitle="✓ Expected allowed · — Expected denied. Verify with real staging sessions."/>
   <table className="role-matrix">
     <thead><tr><th>Action</th>${roles.map(r=>html`<th key=${r}>${r}</th>`)}</tr></thead>
     <tbody>${window.AtlasGuidance.roleRows.map((r,i)=>html`<tr key=${i}><td>${r[0]}</td>${r.slice(1).map((yes,j)=>html`<td key=${j} className=${yes?'allowed':'denied'}>${yes?'✓':'—'}</td>`)}</tr>`)}</tbody>
   </table>
 </div>
 <div className="section-gap"><div className="heading-row"><div><div className="eyebrow">ENFORCEMENT EVIDENCE</div><h2 className="panel-title" style=${{marginTop:'7px'}}>Security checkpoints</h2></div></div>
   <div className="callout-grid">${checks.map(c=>html`<div className="callout" key=${c.id}>
     <div style=${{display:'flex',justifyContent:'space-between',gap:'8px',alignItems:'center'}}>
       <span className="kicker-line">${c.id} · ${c.section}</span><${Status} value=${c.effective_status}/></div>
     <h4 style=${{marginTop:'12px'}}>${c.title}</h4><p>${c.description}</p>
     <div className="btn-row" style=${{marginTop:'16px'}}><button className="btn sm" onClick=${()=>onInspect(c)}>Steps</button>
       <button className="btn sm subtle" onClick=${()=>onRecord(c)}>＋ Record</button></div>
   </div>`)}</div>
 </div>
 <div className="notice blue section-gap"><span>ⓘ</span><span>Accounts can read recorded supplier rates but cannot record quotes; sales cannot read those rates. Cross-organization access must be denied even through crafted API requests.</span></div>
 </div>`;
};
})();