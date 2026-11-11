(function(){
'use strict';
const {html,Status,Head,PanelHead,External,shortSha,formatDate,Empty}=window.AtlasUI;
const V=window.AtlasViews||(window.AtlasViews={});
V.Overview=function Overview({state,onNavigate,onInspect,onRecord,onRefresh,refreshing}){
 const {checks,summary,github,events}=state;
 const pct=summary.total?Math.round(summary.completed/summary.total*100):0;
 const outstanding=checks.filter(c=>c.priority==='critical'&&c.effective_status!=='verified');
 return html`<div>
   <${Head} eyebrow="QUALITY ASSURANCE / RELEASE OPS" title="Release readiness"
     subtitle="One place to track real authenticated acceptance, audit-safe inventory and supplier pricing across the Atlas OS release train."
     actions=${html`<button className="btn" onClick=${onRefresh} disabled=${refreshing}>${refreshing?'⟳ Syncing…':'↻ Sync GitHub'}</button>`}/>
   <div className="hero">
     <div>
       <div className="hero-kicker">PR #57 → #58 · AUTHENTICATED ACCEPTANCE</div>
       <h2>Know exactly when Atlas OS is ready to ship.</h2>
       <p>CI and simulated database roles are not substitutes for real Supabase sessions. Every release gate is backed by named evidence, steps and a commit reference.</p>
       <div className="hero-label"><span className=${'release-pill '+(summary.decision==='GO'?'go':'')}>● ${summary.decision}</span>
         <span className="fine">${summary.criticalVerified} / ${summary.criticalTotal} critical gates verified</span></div>
     </div>
     <div className="hero-ring" style=${{background:'conic-gradient(#8b5cf6 '+pct+'%, #e8dff8 '+pct+'% 100%)'}}>
       <div className="hero-ring-inner"><div className="ring-n">${pct}%</div><div className="ring-text">checks verified</div></div>
     </div>
   </div>
   <div className="summary-grid">
     <div className="panel metric"><div className="metric-label">Critical gates</div><div className="metric-num">${summary.criticalVerified}<span className="muted" style=${{fontSize:'15px'}}> / ${summary.criticalTotal}</span></div><div className="metric-meta">Must pass on current main</div><div className="metric-icon">◈</div></div>
     <div className="panel metric"><div className="metric-label">Applied migrations</div><div className="metric-num">${summary.migrationVerified}<span className="muted" style=${{fontSize:'15px'}}> / 48</span></div><div className="metric-meta">Staging schema snapshot</div><div className="metric-icon green">▥</div></div>
     <div className="panel metric"><div className="metric-label">Waiting for evidence</div><div className="metric-num">${summary.counts.unknown+summary.counts.blocked}</div><div className="metric-meta">Unknown + blocked checks</div><div className="metric-icon amber">◷</div></div>
     <div className="panel metric"><div className="metric-label">Main-branch CI gate</div><div className="metric-num" style=${{fontSize:'22px'}}>${summary.ciGate?'Passed':'Not proven'}</div><div className="metric-meta">Current main commit ${shortSha(github.main_sha)}</div><div className="metric-icon">⌘</div></div>
   </div>
   <div className="two-col">
     <div className="panel">
       <${PanelHead} title="Next release blockers" subtitle="Prioritized actions preventing a production GO."
         right=${html`<button className="btn sm" onClick=${()=>onNavigate('matrix')}>View all checks →</button>`}/>
       <div className="blocker-list">
         ${outstanding.length?outstanding.slice(0,5).map((c,i)=>html`<div className="blocker" key=${c.id}>
            <div className="blocker-num">${String(i+1).padStart(2,'0')}</div>
            <div className="blocker-main"><h4>${c.title}</h4><p>${c.next_steps?.[0]||c.description}</p></div>
            <div style=${{display:'flex',gap:'8px',alignItems:'center'}}><${Status} value=${c.effective_status}/><button className="blocker-go" onClick=${()=>onInspect(c)}>→</button></div>
         </div>`):html`<${Empty} title="No outstanding critical checks" description="Review CI and staging freshness before considering production GO." />`}
       </div>
     </div>
     <div className="panel">
       <${PanelHead} title="Latest release activity" subtitle="Test evidence, CI and merge notes from GitHub."
         right=${html`<button className="btn sm" onClick=${()=>onNavigate('releases')}>Release train →</button>`}/>
       <div className="timeline">
         ${events.slice(0,5).map(ev=>html`<div className="timeline-item" key=${ev.id}>
           <span className="timeline-icon">${ev.event_type==='merge'?'↗':ev.event_type==='test'?'✓':'⌘'}</span>
           <div><h4>${ev.title}</h4><p>${formatDate(ev.occurred_at)} · ${ev.detail||''}</p>
             ${ev.source_url?html`<${External} url=${ev.source_url} small>Evidence</${External}>`:null}</div>
         </div>`)}
         ${!events.length?html`<${Empty} title="Activity starts here" description="Record a test run or sync GitHub to fill the timeline." />`:null}
       </div>
     </div>
   </div>
   <div className="notice section-gap"><span style=${{fontSize:'17px'}}>◈</span><div><strong>Production remains untouched.</strong> All new verification runs are staging-only; the 200-entry Demo Mode test is excluded. Merging PRs never upgrades real-authenticated checks to verified.</div></div>
 </div>`;
};

V.Matrix=function Matrix({state,filter,onFilter,query,onQuery,onInspect,onRecord}){
 const checks=state.checks;
 const results=checks.filter(c=>(filter==='all'||c.effective_status===filter) &&
   (!query||[c.title,c.description,c.id,c.section].join(' ').toLowerCase().includes(query.toLowerCase())));
 return html`<div>
 <${Head} eyebrow="RELEASE GATES / EVIDENCE" title="Acceptance matrix"
   subtitle="Status, evidence and exact procedures for every PR #57 acceptance requirement. A stale commit never counts as verified."
   actions=${html`<button className="btn primary" onClick=${()=>onRecord(null)}>＋ Record test run</button>`}/>
 <div className="filter-row">
   <div className="tabs">${['all','verified','failed','blocked','unknown'].map(x=>html`<button className=${'tab '+(filter===x?'active':'')} onClick=${()=>onFilter(x)} key=${x}>${x==='all'?'All checks':x[0].toUpperCase()+x.slice(1)} ${x==='all'?checks.length:state.summary.counts[x]}</button>`)}</div>
   <input className="search-input" value=${query} onInput=${ev=>onQuery(ev.target.value)} placeholder="⌕  Search check, ID, or section…"/>
 </div>
 <div className="panel table-wrap"><table className="data-table">
   <thead><tr><th>Verification requirement</th><th>Area</th><th>Evidence</th><th>Status</th><th>Action</th></tr></thead>
   <tbody>${results.map(c=>html`<tr key=${c.id}>
     <td><div className="cell-name">${c.title}</div><div className="cell-desc">${c.id} · ${c.description}</div></td>
     <td><span className="tag">${c.section}</span></td>
     <td><div className="mono">${c.tested_commit?shortSha(c.tested_commit):'Awaiting run'}</div>
       ${c.evidence_url?html`<${External} url=${c.evidence_url} small>View evidence</${External}>`:html`<span className="fine">No attached evidence</span>`}</td>
     <td><${Status} value=${c.effective_status}/>${c.effective_status!==c.status?html`<div className="fine">Previous result stale</div>`:null}</td>
     <td><div className="btn-row"><button className="btn sm" onClick=${()=>onInspect(c)}>Steps</button><button className="btn sm subtle" onClick=${()=>onRecord(c)}>＋ Run</button></div></td>
   </tr>`)}</tbody>
 </table>
 ${!results.length?html`<${Empty} title="No matching verification checks" description="Choose another status or search term." />`:null}
 </div>
 </div>`;
};
})();