(function(){
'use strict';
const {html,Status,Head,PanelHead,External,formatDate,shortSha,Empty}=window.AtlasUI;
const V=window.AtlasViews||(window.AtlasViews={});
V.Evidence=function Evidence({state,onRecord}){
 const {runs,events,checks}=state;
 return html`<div>
 <${Head} eyebrow="RUN JOURNAL / RELEASE AUDIT" title="Runs & evidence"
   subtitle="Every staging verification result is retained in the run ledger. Recording an outcome recalculates the release decision."
   actions=${html`<button className="btn primary" onClick=${()=>onRecord(null)}>＋ Record result</button>`}/>
 <div className="notice blue" style=${{marginBottom:'18px'}}><span>ⓘ</span><span>A verified real-auth result requires an authenticated browser/API method, HTTPS evidence, and the current main commit. Manual records are operator attestations, not independently signed traces.</span></div>
 <div className="panel table-wrap">
   <${PanelHead} title="Verification runs" subtitle=${runs.length+' recorded results · newest first'}/>
   <table className="data-table"><thead><tr><th>Check & outcome</th><th>Method</th><th>Commit / PR</th><th>Recorded</th><th>Evidence</th></tr></thead>
   <tbody>${runs.map(r=>{
     const c=checks.find(c=>c.id===r.check_id);
     return html`<tr key=${r.id}>
       <td><div className="cell-name">${c?.title||r.check_id}</div><div className="cell-desc">${r.check_id} · ${r.notes}</div>
         <div style=${{marginTop:'7px'}}><${Status} value=${r.status}/></div></td>
       <td>${r.method}<div className="fine">${r.environment}</div></td>
       <td><span className="mono">${shortSha(r.commit_sha)}</span><div className="fine">${r.pr_number?'PR #'+r.pr_number:'No PR'}</div></td>
       <td>${formatDate(r.recorded_at)}<div className="fine">${r.actor}</div></td>
       <td><${External} url=${r.evidence_url}>Open</${External}></td>
     </tr>`;
   })}</tbody></table>
   ${!runs.length?html`<${Empty} title="Real-auth test journal is empty" description="Use Record result after a staging run. SQL-role baselines are shown separately, not disguised as authenticated browser evidence." />`:null}
 </div>
 <div className="panel section-gap">
   <${PanelHead} title="Release activity" subtitle="Read-only GitHub merges, CI conclusions and verification records."/>
   <div className="timeline">${events.map(ev=>html`<div className="timeline-item" key=${ev.id}>
     <span className="timeline-icon">${ev.event_type==='merge'?'↗':ev.event_type==='ci'?'⌘':'✓'}</span>
     <div><h4>${ev.title}</h4><p>${formatDate(ev.occurred_at)} · ${ev.detail}</p>
       <${External} url=${ev.source_url} small>Source</${External}></div>
   </div>`)}
   ${!events.length?html`<${Empty} title="No recent activity yet" description="Sync GitHub to populate the release feed." />`:null}
   </div>
 </div>
 </div>`;
};
V.Releases=function Releases({state,onRefresh,refreshing}){
 const {github,summary}=state;
 const prs=[...(github.pull_requests||[])].sort((a,b)=>b.number-a.number);
 const runs=github.ci_runs||[];
 return html`<div>
 <${Head} eyebrow="BRANCH POLICY / RELEASE AUTOMATION" title="Release train"
   subtitle="Preserving the team flow: Vijay-Atlas → tests → PR → main. GitHub access is read-only."
   actions=${html`<button className="btn primary" onClick=${onRefresh} disabled=${refreshing}>↻ ${refreshing?'Refreshing…':'Sync GitHub'}</button>`}/>
 <div className="panel panel-pad">
   <div className="eyebrow">DEVELOPMENT LIFECYCLE</div>
   <div className="flow-line" style=${{marginTop:'17px'}}>
     ${['Vijay-Atlas','Vitest + PostgreSQL + Playwright','Pull request review','main'].map((name,i)=>html`<span key=${i} className="flow-node">${name}</span>${i<3?html`<span className="flow-arrow">→</span>`:null}`)}
   </div>
   <div className="callout-grid section-gap">
     <div className="commit-box"><div><div className="eyebrow">ACTIVE DEVELOPMENT</div>
       <div className="mono" style=${{fontSize:'13px',fontWeight:'800',marginTop:'7px'}}>${shortSha(github.dev_sha)}</div></div><span className="tag">Vijay-Atlas</span></div>
     <div className="commit-box"><div><div className="eyebrow">CURRENT MAIN COMMIT</div>
       <div className="mono" style=${{fontSize:'13px',fontWeight:'800',marginTop:'7px'}}>${shortSha(github.main_sha)}</div></div><span className="tag">main</span></div>
   </div>
   <div className="fine" style=${{marginTop:'15px'}}>Synced ${formatDate(github.last_synced_at)} · hourly GitHub refresh. ${github.last_error?'Error: '+github.last_error:''}</div>
 </div>
 <div className="section-gap">
   <div className="heading-row"><div><div className="eyebrow">COMMIT & PR NOTES</div><h2 className="panel-title" style=${{marginTop:'7px'}}>Pull requests</h2></div></div>
   <div className="pr-grid">${prs.slice(0,8).map(pr=>html`<div key=${pr.number} className="panel pr-card">
     <div style=${{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
       <span className="tag">PR #${pr.number}</span><${Status} value=${pr.state==='merged'?'verified':pr.state==='closed'?'failed':'unknown'}/></div>
     <h3 className="pr-title">${pr.title}</h3>
     <p className="pr-text">${pr.merged_at?'Merged '+formatDate(pr.merged_at):pr.state==='draft'?'Draft — needs review':'Pending review / merge'}.</p>
     <div className="commit-box"><span className="mono">${shortSha(pr.head_sha)}</span><${External} url=${pr.url}>View PR</${External}></div>
   </div>`)}
   ${!prs.length?html`<${Empty} title="No PR data yet" description="Refresh GitHub to load merged and open pull requests." />`:null}
   </div>
 </div>
 <div className="panel table-wrap section-gap">
   <${PanelHead} title="Recent CI runs" subtitle="A green CI result never substitutes for the authenticated acceptance matrix."/>
   <table className="data-table"><thead><tr><th>Workflow</th><th>Branch</th><th>Commit</th><th>Outcome</th><th>Evidence</th></tr></thead>
     <tbody>${runs.slice(0,10).map(r=>html`<tr key=${r.id}>
       <td><div className="cell-name">${r.name||'CI workflow'}</div><div className="fine">${formatDate(r.at)}</div></td>
       <td><span className="tag">${r.branch}</span></td><td className="mono">${shortSha(r.head_sha)}</td>
       <td><${Status} value=${r.status!=='completed'?'blocked':r.conclusion==='success'?'verified':r.conclusion==='failure'?'failed':'unknown'}/></td>
       <td><${External} url=${r.url}>Run</${External}></td></tr>`)}</tbody>
   </table>
 </div>
 <div className="notice section-gap"><span>!</span><div><strong>Current decision: ${summary.decision}.</strong> On a new merge, previously verified authenticated checks must be rerun against the new main SHA. Production remains untouched.</div></div>
 </div>`;
};
})();