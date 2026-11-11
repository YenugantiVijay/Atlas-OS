export const STATUSES = ['verified','failed','blocked','unknown'];

export function effectiveStatus(check, mainSha, now = Date.now()) {
  if (check.status !== 'verified') return check.status;
  // Any verified browser/API acceptance on an earlier build is stale after a new merge.
  if (check.requires_auth && (!check.tested_commit || !mainSha || check.tested_commit !== mainSha)) return 'unknown';
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
  const migOk = migrations.length === 48 && migrations.every(m => m.status === 'verified');
  const stage = decorated.find(c => c.id === 'STG-01');
  const mainCi = (gh?.ci_runs || []).find(r => r.head_sha === main && r.branch === 'main' &&
    r.status === 'completed' && r.conclusion === 'success');
  const ciGate = Boolean(mainCi);
  const good = unverified.length === 0 && migOk && stage?.effective_status === 'verified' && ciGate && Boolean(main);
  const counts = STATUSES.reduce((o,s) => {o[s] = decorated.filter(c => c.effective_status === s).length; return o;}, {});
  const reasons = [];
  if (!main) reasons.push('Latest main commit has not been synced');
  if (!ciGate) reasons.push('No passing main-branch CI attached to the current main commit');
  if (stage?.effective_status !== 'verified') reasons.push('Staging health verification is missing or older than 24h');
  if (!migOk) reasons.push('Not all migrations 001–048 are verified');
  if (unverified.length) reasons.push(unverified.length + ' critical acceptance checks are not verified on current main');
  return {
    decision: good ? 'GO' : 'NO-GO',
    completed: decorated.filter(c => c.effective_status === 'verified').length,
    total: decorated.length, counts,
    criticalVerified: critical.length - unverified.length,
    criticalTotal: critical.length, blockers: unverified.map(c=>c.id),
    reasons, migrationVerified: migrations.filter(m=>m.status==='verified').length,
    ciGate, mainSha: main, evaluatedAt: new Date().toISOString()
  };
}