(function(){
  'use strict';
  const e=window.React.createElement, html=window.htm.bind(e);
  const pretty={verified:'Verified',failed:'Failed',blocked:'Blocked',unknown:'Unknown'};
  function Status({value='unknown',large=false}){const s=pretty[value]?value:'unknown';return html`<span className=${'status '+s+(large?' large':'')}><i className="point"></i>${pretty[s]}</span>`;}
  function Head({eyebrow,title,subtitle,actions}){
    return html`<div className="heading-row"><div><div className="eyebrow">${eyebrow}</div><h1 className="page-title">${title}</h1><p className="page-subtitle">${subtitle}</p></div>${actions||null}</div>`;
  }
  function PanelHead({title,subtitle,right}){return html`<div className="panel-header"><div><h3 className="panel-title">${title}</h3>${subtitle?html`<div className="panel-subtitle">${subtitle}</div>`:null}</div>${right||null}</div>`;}
  function External({url,children,small=false}){const safe=typeof url==='string'&&/^https:\/\//i.test(url);return safe?
    html`<a className=${'link'+(small?' fine':'')} href=${url} target="_blank" rel="noopener noreferrer">${children||'Open evidence'} ↗</a>`:
    html`<span className="muted fine">No evidence link</span>`;}
  function formatDate(input){if(!input)return 'Not yet recorded';try{return new Date(input).toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});}catch{return String(input)}}
  function shortSha(s){return typeof s==='string'&&s.length>8?s.slice(0,8):'—'}
  function EvidenceSteps({steps}){if(!Array.isArray(steps)||!steps.length)return html`<p className="muted">No verification procedure supplied.</p>`;return html`<ol className="steps-list">${steps.map((step,i)=>html`<li key=${i}><span className="step-dot">${i+1}</span><span>${step}</span></li>`)}</ol>`;}
  function Empty({title,description}){return html`<div className="empty"><strong>${title}</strong>${description}</div>`;}
  function CheckButton({check,onRecord,small=false}){return html`<button className=${'btn '+(small?'sm':'')} onClick=${()=>onRecord(check)}>＋ ${small?'Record':'Record test run'}</button>`;}
  window.AtlasUI={html,e,Status,Head,PanelHead,External,formatDate,shortSha,EvidenceSteps,Empty,CheckButton};
})();