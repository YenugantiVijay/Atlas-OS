import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createProductFixture} from './product-test-fixture.mjs';
export async function runSchoolStaffAcceptance({client,withRoleContext,recordTest,orgAId,ownerAId,salesAId,ownerBId}) {
 const org=await createProductFixture(client,orgAId,'school');const other=await createProductFixture(client,orgAId,'school');
 const as=(userId,fn)=>withRoleContext(client,{userId,role:userId?'authenticated':'anon'},fn);
 const command=async(action,data,workspace=org)=>client.query('SELECT public.school_staff_command($1,$2,$3)',[workspace,action,data]);
 const read=async(area,workspace=org)=>(await client.query('SELECT public.school_staff_read($1,$2) AS data',[workspace,area])).rows[0].data;
 const test=async(id,label,fn)=>{try{await fn();recordTest(id,label,true);}catch(e){recordTest(id,label,false,null,e);}};
 const staff=randomUUID();const today=(await client.query("SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS day")).rows[0].day;
 const profile={staff_id:staff,school_id:'T-001',name:'Test Teacher',position:'teacher',joining_on:today,revision:0};
 await test('SCHOOL-STAFF-01','Authority registers permanent school IDs, default campus and auditable positions',async()=>{
  await as(ownerAId,async()=>{
   await command('register',profile);
   assert.equal((await read('directory')).rows[0].school_id,'T-001');
   await command('register',{...profile,position:'principal',revision:1});
   assert.equal((await read('directory')).rows[0].position,'principal');
   await assert.rejects(()=>command('register',{...profile,position:'teacher',revision:1}));
   await assert.rejects(()=>command('register',{...profile,school_id:'T-002',revision:2}));
  });
  assert.equal((await client.query('SELECT count(*)::int AS n FROM atlas_school.staff_identity_history WHERE organization_id=$1',[org])).rows[0].n,2);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM public.staff_location_assignments WHERE organization_id=$1 AND staff_id=$2',[org,staff])).rows[0].n,1);
 });
 await test('SCHOOL-STAFF-02','Duplicate IDs roll back, same IDs in separate schools succeed',async()=>{
  await as(ownerAId,async()=>{
   await assert.rejects(()=>command('register',{...profile,staff_id:randomUUID(),school_id:'t-001'}));
   await command('register',{...profile,staff_id:randomUUID()},other);
  });
  assert.equal((await client.query('SELECT count(*)::int AS n FROM public.staff_profiles WHERE organization_id=$1',[org])).rows[0].n,1);
 });
 await test('SCHOOL-STAFF-03','Only linked staff see own identity; titles grant no school or manager privileges',async()=>{
  await as(salesAId,async()=>{
   assert.equal((await read('directory')).rows.length,0);
   await assert.rejects(()=>command('register',profile));
  });
  await as(ownerAId,()=>client.query('SELECT public.link_staff_employee($1,$2,$3,true)',[org,staff,salesAId]));
  await as(salesAId,async()=>{
   assert.equal((await read('directory')).rows[0].school_id,'T-001');
   assert.equal((await read('directory')).can_register,false);
   assert.equal((await read('directory')).can_review,false);
   await assert.rejects(()=>client.query("SELECT public.school_read($1,'bootstrap','{}')",[org]));
   await assert.rejects(()=>client.query('SELECT * FROM atlas_school.staff_identity'));
  });
  await as(ownerBId,()=>assert.rejects(()=>read('directory')));
  await as(null,()=>assert.rejects(()=>read('directory')));
 });
 const leave=randomUUID();
 await test('SCHOOL-STAFF-04','Own leave is scoped, overlapping requests fail and self approval is forbidden',async()=>{
  await as(salesAId,async()=>{
   await command('request_leave',{id:leave,starts_on:today,ends_on:today,reason:'Medical appointment'});
   assert.equal((await read('leave')).rows[0].status,'pending');
   await assert.rejects(()=>command('request_leave',{id:randomUUID(),starts_on:today,ends_on:today,reason:'Overlapping request'}));
   await assert.rejects(()=>command('review_leave',{id:leave,status:'approved',note:'Self approval'}));
  });
  await as(ownerAId,()=>command('review_leave',{id:leave,status:'approved',note:'Approved by attendance authority'}));
  await as(salesAId,async()=>{
   assert.equal((await read('leave')).rows[0].status,'approved');
   await assert.rejects(()=>command('cancel_leave',{id:leave}));
  });
 });
 await test('SCHOOL-STAFF-05','Disabled staff cannot request leave or retain their private leave history',async()=>{
  await as(ownerAId,()=>client.query('SELECT public.link_staff_employee($1,$2,$3,false)',[org,staff,salesAId]));
  await as(salesAId,async()=>{
   assert.equal((await read('leave')).rows.length,0);
   await assert.rejects(()=>command('request_leave',{id:randomUUID(),starts_on:today,ends_on:today,reason:'Disabled request'}));
  });
 });
}
