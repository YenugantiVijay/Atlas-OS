import { db, events } from 'hatchable';
export const access = 'admin';
export const methods = ['POST'];

const ALLOWED = new Set(['verified','failed','blocked','unknown']);
const METHODS = new Set(['authenticated-browser','authenticated-api','restricted-sql','schema-inspection','ci','manual-review']);
const HTTPS = /^https:\/\/[a-z0-9.-]+(?::\d+)?(?:[/?#]|$)/i;
export default async function(req,res) {
  const input = req.body || {};
  const checkId = String(input.check_id || '').slice(0,36);
  const status = String(input.status || '');
  const method = String(input.method || '');
  const environment = String(input.environment || 'staging');
  const commit = String(input.commit_sha || '').trim().slice(0,64);
  const evidence = String(input.evidence_url || '').trim().slice(0,1400);
  const notes = String(input.notes || '').trim().slice(0,4000);
  const actor = String(input.actor || req.member?.handle || 'release owner').trim().slice(0,80);
  const pr = input.pr_number ? Number(input.pr_number) : null;
  if(!ALLOWED.has(status) || !METHODS.has(method) || !checkId || notes.length < 12) {
    return res.status(400).json({error:'Choose an outcome and method; write at least 12 characters of factual evidence notes.'});
  }
  if(environment !== 'staging') return res.status(400).json({error:'Only staging acceptance is permitted. Production tests are excluded.'});
  if(evidence && (!HTTPS.test(evidence) || evidence.length > 1400)) {
    return res.status(400).json({error:'Evidence link must be a valid HTTPS URL.'});
  }
  if(commit && !/^[a-f0-9]{40}$/.test(commit)) return res.status(400).json({error:'Commit SHA must be exactly 40 hexadecimal characters.'});
  if(pr !== null && (!Number.isSafeInteger(pr) || pr <= 0 || pr > 100000)) return res.status(400).json({error:'Invalid PR number.'});
  const [cResult, gResult] = await Promise.all([
    db.query('SELECT * FROM acceptance_checks WHERE id=$1',[checkId]),
    db.query('SELECT main_sha FROM github_state WHERE id=1')
  ]);
  const check=cResult.rows[0], main=gResult.rows[0]?.main_sha || '';
  if(!check) return res.status(404).json({error:'Check not found'});
  if(status==='verified') {
    if(!evidence) return res.status(400).json({error:'Verification requires an HTTPS evidence link (test report, trace or signed record).'});
    if(check.requires_auth) {
      if(!['authenticated-browser','authenticated-api'].includes(method)) {
        return res.status(400).json({error:'Real-auth checks can only be verified using authenticated browser or authenticated API tests—not simulated SQL, CI, or Demo Mode.'});
      }
      if(!main || commit !== main) {
        return res.status(400).json({error:'Authenticated verification must name the current main commit. Refresh GitHub first.'});
      }
    }
  }
  const saved = await db.transaction([
    {sql:'INSERT INTO verification_runs (check_id,status,method,environment,commit_sha,pr_number,evidence_url,notes,actor) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, recorded_at',
     params:[checkId,status,method,environment,commit,pr,evidence,notes,actor]},
    {sql:'UPDATE acceptance_checks SET status=$1,evidence_method=$2,evidence_url=$3,evidence_notes=$4,environment=$5,tested_commit=$6,verified_at=CASE WHEN $1=\'verified\' THEN now() ELSE NULL END,last_updated=now(),is_baseline=false,pr_number=$7 WHERE id=$8',
     params:[status,method,evidence,notes,environment,commit,pr,checkId]}
  ]);
  const run=saved.results[0]?.rows?.[0];
  await db.query('INSERT INTO release_events(event_key,event_type,title,detail,source_url,commit_sha) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (event_key) DO NOTHING',
    ['test-'+run.id,'test',checkId+' · '+status,method+' / '+actor+' — '+notes.slice(0,240),evidence,commit]);
  try{await events.publish('atlas-acceptance','changed',{type:'verification',check_id:checkId});}catch{}
  res.json({ok:true,check_id:checkId,status,recorded_at:run.recorded_at,run_id:run.id});
}