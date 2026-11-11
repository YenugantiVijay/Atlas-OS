import { db, events } from 'hatchable';

const REPO = 'YenugantiVijay/Atlas-OS';
const API = 'https://api.github.com/repos/' + REPO;
const HEADERS = {
  'Accept': 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'Atlas-OS-Acceptance-Control-Center'
};
async function github(path) {
  const response = await fetch(API + path, { headers: HEADERS });
  if (!response.ok) throw new Error('GitHub HTTP ' + response.status + ' (' + path.split('?')[0] + ')');
  return await response.json();
}
function prSummary(p) {
  return {
    number: p.number,
    title: p.title,
    state: p.merged_at ? 'merged' : p.draft ? 'draft' : p.state,
    url: p.html_url,
    merged_at: p.merged_at || null,
    head_sha: p.head?.sha || '',
    base_sha: p.base?.sha || '',
    updated_at: p.updated_at || '',
  };
}
function runSummary(r) {
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    conclusion: r.conclusion,
    head_sha: r.head_sha,
    branch: r.head_branch,
    url: r.html_url,
    at: r.updated_at || r.created_at
  };
}
export async function syncGitHub(force = false) {
  const previous = (await db.query('SELECT * FROM github_state WHERE id = 1')).rows[0];
  if (!force && previous?.last_synced_at) {
    const elapsed = Date.now() - new Date(previous.last_synced_at).getTime();
    if (elapsed < 60000) return { ok: true, skipped: true, reason: 'Recently synchronized' };
  }
  try {
    // Public repository: read-only anonymous GitHub API; no repository token or production credentials.
    const [main, dev, important57, important58, recent, workflows] = await Promise.all([
      github('/branches/main'),
      github('/branches/Vijay-Atlas'),
      github('/pulls/57'),
      github('/pulls/58'),
      github('/pulls?state=all&sort=updated&direction=desc&per_page=12'),
      github('/actions/runs?per_page=15')
    ]);
    const seen = new Set();
    const prs = [important57, important58, ...recent]
      .filter(p => { if (seen.has(p.number)) return false; seen.add(p.number); return true; })
      .map(prSummary)
      .sort((a,b) => b.number - a.number)
      .slice(0,12);
    const ci = (workflows.workflow_runs || []).map(runSummary).slice(0,12);
    const mainSha = main.commit?.sha || '';
    const devSha = dev.commit?.sha || '';
    await db.query(
      'INSERT INTO github_state (id,main_sha,dev_sha,pull_requests,ci_runs,last_synced_at,last_error,updated_at) VALUES (1,$1,$2,$3::jsonb,$4::jsonb,now(),\'\',now()) ON CONFLICT (id) DO UPDATE SET main_sha = excluded.main_sha,dev_sha = excluded.dev_sha,pull_requests = excluded.pull_requests,ci_runs = excluded.ci_runs,last_synced_at = now(),last_error = \'\',updated_at = now()',
      [mainSha, devSha, JSON.stringify(prs), JSON.stringify(ci)]
    );
    for (const p of prs.filter(p => p.merged_at)) {
      await db.query(
        'INSERT INTO release_events(event_key,event_type,title,detail,source_url,commit_sha,occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (event_key) DO NOTHING',
        ['merge-' + p.number + '-' + p.merged_at, 'merge', 'PR #' + p.number + ' merged into main',
         p.title, p.url, p.head_sha, p.merged_at]
      );
    }
    for (const run of ci.filter(r => r.status === 'completed')) {
      await db.query(
        'INSERT INTO release_events(event_key,event_type,title,detail,source_url,commit_sha,occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (event_key) DO NOTHING',
        ['ci-' + run.id, 'ci', 'CI run #' + run.id + ': ' + String(run.conclusion || 'unknown'),
         run.branch + ' · ' + run.name, run.url, run.head_sha, run.at]
      );
    }
    try { await events.publish('atlas-acceptance', 'changed', { type:'github', sha:mainSha }); } catch { /* UI may refetch next visit */ }
    return { ok:true, main_sha:mainSha, dev_sha:devSha, prs:prs.length, runs:ci.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'GitHub sync could not complete';
    await db.query('INSERT INTO github_state(id,last_error,updated_at) VALUES(1,$1,now()) ON CONFLICT (id) DO UPDATE SET last_error=$1,updated_at=now()', [message]);
    return { ok:false, error:message };
  }
}