import { events } from 'hatchable';
export const access = 'member';
export const methods = ['GET'];
export default async function(req,res) {
  res.json(await events.grant(['atlas-acceptance']));
}