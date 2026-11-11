import { db } from 'hatchable';
import { readiness } from 'lib/readiness.js';

export const access = 'member';
export const methods = ['GET'];
const decode = v => typeof v === 'string' ? JSON.parse(v) : v;
export default async function(req,res) {
  const [checks, migrations, runs, events, release] = await Promise.all([
    db.query('SELECT * FROM acceptance_checks ORDER BY sort_order, id'),
    db.query('SELECT * FROM atlas_migration_checks ORDER BY version'),
    db.query('SELECT * FROM verification_runs ORDER BY recorded_at DESC LIMIT 120'),
    db.query('SELECT * FROM release_events ORDER BY occurred_at DESC, id DESC LIMIT 40'),
    db.query('SELECT * FROM github_state WHERE id=1')
  ]);
  const github = release.rows[0] || { repo:'YenugantiVijay/Atlas-OS',main_sha:'',dev_sha:'',pull_requests:[],ci_runs:[],last_error:'',last_synced_at:null };
  github.pull_requests = decode(github.pull_requests || []);
  github.ci_runs = decode(github.ci_runs || []);
  const checked = checks.rows.map(c => ({...c, next_steps:decode(c.next_steps||[])}));
  const summary = readiness(checked, migrations.rows, github);
  const decorated = checked.map(c => ({
    ...c, effective_status: c.status === 'verified' && c.requires_auth &&
      (!c.tested_commit || !github.main_sha || c.tested_commit !== github.main_sha)
      ? 'unknown' : c.id === 'STG-01' && c.status === 'verified' &&
        (!c.verified_at || Date.now() - new Date(c.verified_at).getTime() > 86400000)
        ? 'unknown' : c.status
  }));
  res.json({
    checks:decorated,
    migrations:migrations.rows,
    runs:runs.rows,
    events:events.rows,
    github,
    summary,
    policy: {
      productionReadOnly:true,
      excluded:'200-entry Demo Mode test',
      branchFlow:['Vijay-Atlas','Test / CI','Pull request','main'],
      requiredAuthMethods:['authenticated-browser','authenticated-api'],
      githubSync:'Hourly read-only public API + on-demand refresh',
      stagingAutomation:'Manual attestation until approved Supabase read-only monitor exists'
    }
  });
}