import { syncGitHub } from 'lib/github.js';
export const access = 'admin';
export const methods = ['POST'];
export default async function(req,res) {
  const output = await syncGitHub(false);
  res.status(output.ok ? 200 : 502).json(output);
}