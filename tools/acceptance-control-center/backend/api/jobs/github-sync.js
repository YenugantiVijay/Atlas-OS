import { syncGitHub } from 'lib/github.js';
export const access = 'scheduler';
export const methods = ['POST'];
export default async function(req,res) {
  if(req.headers['x-hatchable-trigger'] !== 'cron') return res.status(403).json({error:'Scheduler only'});
  const output=await syncGitHub(false);
  res.status(output.ok ? 200 : 502).json(output);
}