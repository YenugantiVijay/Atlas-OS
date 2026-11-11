import { definitions } from './checks.mjs';

export const STATUSES = ['verified','failed','blocked','unknown'];

export function effectiveStatus(check, mainSha, now = Date.now()) {
  if (check.status !== 'verified') return check.status;
  // Any verified browser/API acceptance on an earlier build is stale after a new merge.
  if (check.requires_auth && (!check.tested_commit || !mainSha || check.tested_commit !== mainSha || !['authenticated-browser','authenticated-api'].includes(check.evidence_method))) return 'unknown';
  // Staging heartbeat is evidence from a point in time, not a permanent certificate.
  if (check.id === 'STG-01' && (!check.verified_at ||
      (now - new Date(check.verified_at).getTime()) > 24*60*60*1000)) return 'unknown';
  return 'verified';
}
export function readiness(checks, migrations, gh) {
  const main = gh?.main_sha || '';
  const decorated = checks.map(c => ({
    ...c, effective_status: effectiveStatus(c, main),
    stale: c.status === 'verified' && effectiveStatus(c, main) !== 'verified'
  }));
  const critical = decorated.filter(c => c.priority === 'critical');
  const unverified = critical.filter(c => c.effective_status !== 'verified');
  const versionIds = new Set(migrations.map(m => Number(m.version)));
  const migOk = migrations.length === 48 &&
    versionIds.size === 48 &&
    [...versionIds].every(v => Number.isInteger(v) && v >= 1 && v <= 48) &&
    migrations.every(m => m.status === 'verified');
  const stage = decorated.find(c => c.id === 'STG-01');
  // Latest current-main run is authoritative, including a newer pending/failing run.
  const mainRuns = (gh?.ci_runs || [])
    .filter(r => r.head_sha === main && r.branch === 'main' && r.name === 'ATLAS OS CI')
    .sort((a,b) => String(b.at || '').localeCompare(String(a.at || '')));
  const latestMainCi = mainRuns[0];
  const ciGate = latestMainCi?.status === 'completed' && latestMainCi.conclusion === 'success';
  const requiredIds = definitions.map(d => d[0]);
  const missingRequired = requiredIds.filter(id => !critical.some(c => c.id === id));
  const good = missingRequired.length === 0 && unverified.length === 0 && migOk &&
    stage?.effective_status === 'verified' && ciGate && Boolean(main);
  const counts = STATUSES.reduce((o,s) => {o[s] = decorated.filter(c => c.effective_status === s).length; return o;}, {});
  const reasons = [];
  if (!main) reasons.push('Latest main commit has not been synced');
  if (!ciGate) reasons.push('No passing main-branch CI attached to the current main commit');
  if (stage?.effective_status !== 'verified') reasons.push('Staging health verification is missing or older than 24h');
  if (!migOk) reasons.push('Not all unique migrations 001–048 are verified');
  if (missingRequired.length) reasons.push('Required checks missing: ' + missingRequired.join(', '));
  if (unverified.length) reasons.push(unverified.length + ' critical acceptance checks are not verified on current main');
  return {
    decision: good ? 'GO' : 'NO-GO',
    completed: decorated.filter(c => c.effective_status === 'verified').length,
    total: decorated.length, counts,
    criticalVerified: critical.length - unverified.length,
    criticalTotal: critical.length, blockers: [...missingRequired, ...unverified.map(c=>c.id)],
    reasons, migrationVerified: migrations.filter(m=>m.status==='verified').length,
    ciGate, mainSha: main, evaluatedAt: new Date().toISOString()
  };
}
export function validateRecord(entry, check, main) {
 const status=String(entry.status||''), method=String(entry.method||'');
 const notes=String(entry.notes||'').trim(), url=String(entry.evidence_url||'').trim(),commit=String(entry.commit_sha||'').trim();
 if(!STATUSES.includes(status))throw new Error('Invalid acceptance status.');
 if(!['authenticated-browser','authenticated-api','restricted-sql','schema-inspection','ci','manual-review'].includes(method))throw new Error('Invalid test method.');
 if(String(entry.environment||'')!=='staging')throw new Error('Production evidence writes are prohibited.');
 if(notes.length<12||notes.length>4000)throw new Error('Provide 12–4000 characters describing actual observation.');
 if(url && (!/^https:\/\//i.test(url)||url.length>1400))throw new Error('Evidence link must be HTTPS.');
 if(commit && !/^[0-9a-f]{40}$/i.test(commit))throw new Error('Commit SHA must be 40 hexadecimal characters.');
 if(status==='verified') {
  if(!url)throw new Error('Verification needs linked HTTPS evidence.');
  if(check.requires_auth && (!['authenticated-browser','authenticated-api'].includes(method)||!main||commit!==main))
   throw new Error('Real-auth verification requires an authenticated-browser/API run on the exact current main commit.');
 }
 return {status,method,notes,evidence_url:url,commit_sha:commit,environment:'staging',actor:String(entry.actor||'release owner').slice(0,80),pr_number:Number(entry.pr_number)||null};
}
