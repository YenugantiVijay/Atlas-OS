import { db, events } from 'hatchable';
export const access = 'admin';
export const methods = ['POST'];
const ALLOWED = new Set(['verified','failed','blocked','unknown']);
export default async function(req,res){
 const body=req.body||{};
 const version=Number(body.version), status=String(body.status||'');
 const evidence=String(body.evidence_url||'').trim().slice(0,1400);
 const notes=String(body.notes||'').trim().slice(0,1000);
 if(!Number.isInteger(version)||version<1||version>48||!ALLOWED.has(status)||notes.length<12){
   return res.status(400).json({error:'Choose a migration 001–048, status and factual notes (12+ characters).'});
 }
 if(status==='verified'&&!/^https:\/\//.test(evidence)) {
   return res.status(400).json({error:'Verified migrations require HTTPS evidence from staging.'});
 }
 if(evidence&&!/^https:\/\//.test(evidence)) {
   return res.status(400).json({error:'Evidence must be a HTTPS link.'});
 }
 await db.query('UPDATE atlas_migration_checks SET status=$1,verified_at=CASE WHEN $1=\'verified\' THEN now() ELSE NULL END,evidence_url=$2,observed_from=$3 WHERE version=$4',
    [status,evidence,'admin verification: '+notes,version]);
 await db.query('INSERT INTO release_events(event_type,title,detail,source_url) VALUES($1,$2,$3,$4)',
    ['migration','Migration '+String(version).padStart(3,'0')+' · '+status,notes,evidence]);
 try{await events.publish('atlas-acceptance','changed',{type:'migration',version});}catch{}
 res.json({ok:true,version,status});
}