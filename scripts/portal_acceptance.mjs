import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createProductFixture } from './product-test-fixture.mjs';
export async function runPortalAcceptance({client,withRoleContext,recordTest,orgAId,ownerAId,salesAId,ownerBId}){
 const school=await createProductFixture(client,orgAId,'school');
 const shop=await createProductFixture(client,orgAId,'general_retail');
 const as=(user,fn)=>withRoleContext(client,{userId:user,role:user?'authenticated':'anon'},fn);
 const check=async(id,name,fn)=>{try{await fn();recordTest(id,name,true);}catch(error){recordTest(id,name,false,null,error);}};
 const rpc=async(sql,args=[])=>(await client.query(sql,args)).rows[0]?.result;
 const command=(action,data)=>rpc('SELECT public.school_command($1,$2,$3,$4) result',[school,action,data,randomUUID()]);
 const access=(org,product,portal)=>rpc('SELECT public.atlas_portal_access($1,$2,$3) result',[org,product,portal]);
 const today=(await client.query("SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS business_day")).rows[0].business_day;
 const year=today.slice(0,4); let classId,studentId,otherStudent;
 await client.query("UPDATE public.memberships SET role='viewer' WHERE organization_id=$1 AND user_id=$2",[school,salesAId]);
 await check('PORTAL-01','Workspace product is pinned and cannot be changed through owner declarations or raw writes',async()=>{
  await as(ownerAId,async()=>{
   assert.equal((await access(school,'school','school_admin')).allowed,true);
   assert.equal((await access(school,'electronics','owner')).allowed,false);
   await assert.rejects(()=>client.query("SELECT public.self_declare_organization_eligibility($1,'electronics_trade',false,ARRAY['Parts'])",[school]),{code:'22023'});
   await assert.rejects(()=>client.query("UPDATE atlas_private.workspace_products SET product='electronics' WHERE organization_id=$1",[school]),{code:'42501'});
   const list=await client.query("SELECT organization_id FROM public.atlas_product_workspaces('school')");assert.ok(list.rows.some(row=>row.organization_id===school));assert.ok(!list.rows.some(row=>row.organization_id===shop));
  });
 });
 await check('PORTAL-02','URL/header changes cannot authorize another product and omitted headers do not unlock school or specialty RPCs',async()=>{
  await as(ownerAId,async()=>{
   await client.query("SELECT set_config('request.headers',$1,false)",[JSON.stringify({'x-atlas-product':'school'})]);
   try{assert.equal(await rpc('SELECT public.can_read_organization_data($1) result',[shop]),false);assert.equal(await rpc('SELECT public.can_write_organization_operations($1) result',[shop]),false);}finally{await client.query("SELECT set_config('request.headers','{}',false)");}
   await assert.rejects(()=>rpc("SELECT public.school_read($1,'bootstrap','{}') result",[shop]),{code:'42501'});
   await assert.rejects(()=>rpc("SELECT public.industry_workspace($1,'ice-cream-stalls') result",[shop]),{code:'42501'});
  });
 });
 await as(ownerAId,async()=>{
  await command('settings',{name:'Portal Acceptance School'});
  const id=(await command('year',{name:'Portal Year',starts_on:year+'-01-01',ends_on:year+'-12-31'})).id;
  classId=(await command('class',{year_id:id,name:'Class 5',section:'A'})).id;
  for(const [number,name] of [['ONE','Linked Student'],['TWO','Unlinked Student']]){
   const rows=await command('student',{class_id:classId,admission_no:number,name,guardian_name:'Guardian',guardian_phone:'9000000000',joining_on:today});
   if(number==='ONE')studentId=rows[0].student_id;else otherStudent=rows[0].student_id;
  }
 });
 await check('PORTAL-03','Parent links require the school owner, active membership and a student in the same school',async()=>{
  await as(salesAId,()=>assert.rejects(()=>client.query("SELECT public.school_link_portal($1,$2,$3,'parent',true)",[school,salesAId,studentId]),{code:'42501'}));
  await as(ownerAId,async()=>{
   await assert.rejects(()=>client.query("SELECT public.school_link_portal($1,$2,$3,'parent',true)",[school,ownerBId,studentId]),{code:'22023'});
   await assert.rejects(()=>client.query("SELECT public.school_link_portal($1,$2,$3,'parent',true)",[school,salesAId,randomUUID()]),{code:'23503'});
   await client.query("SELECT public.school_link_portal($1,$2,$3,'parent',true)",[school,salesAId,studentId]);
  });
 });
 await check('PORTAL-04','Parents see only linked student records and cannot access school administration or ERP ledgers',async()=>{
  await as(salesAId,async()=>{
   const portal=await access(school,'school','parent');assert.equal(portal.allowed,true);assert.equal(portal.portals.includes('school_admin'),false);
   const rows=await rpc("SELECT public.school_my_records($1,'parent') result",[school]); assert.equal(rows.length,1);assert.equal(rows[0].id,studentId);assert.notEqual(rows[0].id,otherStudent);assert.equal(rows[0].enrolments[0].class,'Class 5');
   await assert.rejects(()=>rpc("SELECT public.school_my_records($1,'student') result",[school]),{code:'42501'});
   await assert.rejects(()=>rpc("SELECT public.school_read($1,'students','{}') result",[school]),{code:'42501'});
   const raw=await client.query('SELECT * FROM public.products WHERE organization_id=$1',[school]);assert.equal(raw.rows.length,0);
  });
  await as(ownerAId,()=>assert.rejects(()=>client.query("INSERT INTO public.customers(organization_id,name) VALUES($1,'Should not exist')",[school]),{code:'42501'}));
 });
 await check('PORTAL-05','Revoking a family link immediately removes access and one parent link does not authorize the student portal',async()=>{
  await as(ownerAId,()=>client.query("SELECT public.school_link_portal($1,$2,$3,'parent',false)",[school,salesAId,studentId]));
  await as(salesAId,async()=>{assert.equal((await access(school,'school','parent')).allowed,false);await assert.rejects(()=>rpc("SELECT public.school_my_records($1,'parent') result",[school]),{code:'42501'});});
  await as(ownerAId,()=>client.query("SELECT public.school_link_portal($1,$2,$3,'student',true)",[school,salesAId,studentId]));
  await as(salesAId,async()=>{assert.equal((await access(school,'school','student')).allowed,true);assert.equal((await access(school,'school','parent')).allowed,false);
   const parents=await client.query("SELECT organization_id FROM public.atlas_product_workspaces('school','parent')");assert.ok(!parents.rows.some(row=>row.organization_id===school));
   const students=await client.query("SELECT organization_id FROM public.atlas_product_workspaces('school','student')");assert.ok(students.rows.some(row=>row.organization_id===school));
  });
 });
 await check('PORTAL-06','Teacher and accounts portals are granted from school roles, not URL parameters',async()=>{
  await as(ownerAId,()=>command('role',{user_id:salesAId,role:'teacher',class_ids:[classId]}));
  await as(salesAId,async()=>{assert.equal((await access(school,'school','teacher')).allowed,true);assert.equal((await access(school,'school','school_accounts')).allowed,false);});
  await as(ownerAId,()=>command('role',{user_id:salesAId,role:'accountant'}));
  await as(salesAId,async()=>{assert.equal((await access(school,'school','school_accounts')).allowed,true);assert.equal((await access(school,'school','teacher')).allowed,false);});
 });
 await check('PORTAL-08','Attendance-only employees cannot use the ERP workspace or raw business tables, while owners retain access',async()=>{
  const staff=randomUUID(), location=randomUUID();
  await client.query("UPDATE public.memberships SET role='viewer' WHERE organization_id=$1 AND user_id=$2",[shop,salesAId]);
  await client.query("INSERT INTO public.staff_locations(id,organization_id,name) VALUES($1,$2,'Portal staff location')",[location,shop]);
  await as(ownerAId,async()=>{
   await client.query("SELECT public.add_staff_profile($1,$2,'Portal Employee','2020-01-01',ARRAY[$3]::uuid[])",[shop,staff,location]);
   await client.query('SELECT public.link_staff_employee($1,$2,$3,true)',[shop,staff,salesAId]);
   await client.query("INSERT INTO public.customers(organization_id,name) VALUES($1,'Private business customer')",[shop]);
   assert.equal((await client.query('SELECT * FROM public.customers WHERE organization_id=$1',[shop])).rowCount,1);
  });
  await as(salesAId,async()=>{
   assert.equal((await access(shop,'small-business','employee')).allowed,true);
   assert.equal((await access(shop,'small-business','workspace')).allowed,false);
   assert.equal((await access(shop,'small-business','owner')).allowed,false);
   assert.equal((await client.query('SELECT * FROM public.customers WHERE organization_id=$1',[shop])).rowCount,0);
   assert.equal((await client.query('SELECT * FROM public.staff_profiles WHERE id=$1',[staff])).rowCount,1);
  });
  await as(ownerAId,()=>assert.rejects(()=>client.query('SELECT public.get_dashboard_metrics($1)',[school]),{code:'42501'}));
 });
 await check('PORTAL-09','Inactive membership blocks linked records and new public endpoints remain invoker-only and unavailable to anonymous users',async()=>{
  await client.query('UPDATE public.memberships SET is_active=false WHERE organization_id=$1 AND user_id=$2',[school,salesAId]);
  await as(salesAId,()=>assert.rejects(()=>rpc("SELECT public.school_my_records($1,'student') result",[school]),{code:'42501'}));
  await as(ownerAId,async()=>{
   await client.query("SELECT public.school_link_portal($1,$2,$3,'student',false)",[school,salesAId,studentId]);
   await client.query("SELECT public.school_link_portal($1,$2,$3,'parent',true)",[school,ownerAId,studentId]);
  });
  const endpoints=await client.query("SELECT p.proname,p.prosecdef,has_function_privilege('anon',p.oid,'EXECUTE') AS anonymous FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=ANY($1)",[['atlas_portal_access','atlas_product_workspaces','school_link_portal','school_my_records','school_portal_links','workspace_has_product']]);
  assert.equal(endpoints.rowCount,6);assert.ok(endpoints.rows.every(row=>!row.prosecdef&&!row.anonymous));
 });
 await check('PORTAL-10','Expired subscriptions still allow access revocation but cannot grant new family access',async()=>{
  await client.query("UPDATE public.organization_subscriptions SET status='expired' WHERE organization_id=$1",[school]);
  await as(ownerAId,async()=>{
   await client.query("SELECT public.school_link_portal($1,$2,$3,'parent',false)",[school,ownerAId,studentId]);
   await assert.rejects(()=>client.query("SELECT public.school_link_portal($1,$2,$3,'parent',true)",[school,ownerAId,studentId]),{code:'42501'});
   assert.equal((await access(school,'school','parent')).allowed,false);
  });
  await client.query("UPDATE public.organization_subscriptions SET status='active' WHERE organization_id=$1",[school]);
  await as(ownerAId,()=>client.query("SELECT public.school_link_portal($1,$2,$3,'parent',true)",[school,ownerAId,studentId]));
 });
 await check('PORTAL-11','Disabling or relinking employee attendance never promotes an attendance-only viewer into ERP access',async()=>{
  const account=(await client.query('SELECT staff_id FROM public.staff_employee_accounts WHERE organization_id=$1 AND user_id=$2',[shop,salesAId])).rows[0];
  await as(ownerAId,()=>client.query('SELECT public.link_staff_employee($1,$2,$3,false)',[shop,account.staff_id,salesAId]));
  await as(salesAId,async()=>{assert.equal((await access(shop,'small-business','employee')).allowed,false);assert.equal((await access(shop,'small-business','workspace')).allowed,false);assert.equal((await client.query('SELECT * FROM public.customers WHERE organization_id=$1',[shop])).rowCount,0);});
  await as(ownerAId,()=>client.query('SELECT public.link_staff_employee($1,$2,$3,true)',[shop,account.staff_id,ownerAId]));
  await as(salesAId,async()=>{assert.equal((await access(shop,'small-business','workspace')).allowed,false);assert.equal((await client.query('SELECT * FROM public.customers WHERE organization_id=$1',[shop])).rowCount,0);});
 });
 await check('PORTAL-07','Anonymous users and other workspace owners cannot enumerate family portal links or records',async()=>{
  for(const user of [null,ownerBId])await as(user,async()=>{await assert.rejects(()=>rpc("SELECT public.school_my_records($1,'student') result",[school]),{code:'42501'});await assert.rejects(()=>rpc('SELECT public.school_portal_links($1,$2) result',[school,studentId]),{code:'42501'});});
 });
}
