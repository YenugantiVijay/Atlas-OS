import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {createProductFixture} from './product-test-fixture.mjs';
export async function runLocationAcceptance({client,withRoleContext,recordTest,orgAId,ownerAId,salesAId,ownerBId}){
 const org=await createProductFixture(client,orgAId,'ice_cream_stalls');const depot=await createProductFixture(client,orgAId,'ice_cream_distribution');
 await client.query("INSERT INTO public.memberships(organization_id,user_id,role,is_active) VALUES($1,$2,'sales',true)",[org,ownerBId]);
 const as=(user,fn)=>withRoleContext(client,{userId:user,role:user?'authenticated':'anon'},fn);
 const test=async(id,name,fn)=>{try{await fn();recordTest(id,name,true);}catch(e){recordTest(id,name,false,null,e);}};
 const read=async(workspace=org,tool='ice-cream-stalls')=>(await client.query('SELECT public.industry_workspace($1,$2) AS data',[workspace,tool])).rows[0].data;
 const grant=(site,user,active=true,workspace=org,tool='ice-cream-stalls')=>client.query('SELECT public.set_ice_location_access($1,$2,$3,$4,$5)',[workspace,tool,site,user,active]);
 const save=(command,workspace=org,tool='ice-cream-stalls')=>client.query('SELECT public.apply_industry_operation($1,$2,$3,$4)',[workspace,tool,randomUUID(),command]);
 const stock={sku:'VANILLA',batch:'',unit:'piece'};
 await test('LOCATION-01','Cashiers cannot see or operate any stall until explicitly assigned',async()=>{
  await as(ownerAId,async()=>{for(const [site,quantity,amount] of [['STALL A',10,10001],['STALL B',99,99999]]){await save({kind:'open',site,detail:'Test staff',amount_paise:1000});await save({...stock,kind:'receive',site,quantity});await save({...stock,kind:'sale',site,quantity:1,amount_paise:amount,method:'cash'});}});
  await as(salesAId,async()=>{const r=await read();assert.deepEqual(r.stock,[]);assert.deepEqual(r.tills,[]);assert.deepEqual(r.events,[]);assert.deepEqual(r.series,[]);await assert.rejects(()=>save({...stock,kind:'sale',site:'STALL A',quantity:1,amount_paise:100,method:'cash'}),{code:'42501'});});
 });
 await test('LOCATION-02','Assigned cashiers see only their own stock, cash, events and chart totals',async()=>{
  await as(ownerAId,async()=>{await grant(' stall a ',salesAId);await grant('STALL B',ownerBId);});
  await as(salesAId,async()=>{const r=await read();assert.deepEqual(r.assigned_locations,['STALL A']);assert.ok(r.stock.every(s=>s.site==='STALL A'));assert.equal(r.stock[0].quantity,9);assert.equal(r.tills[0].cash,10001);assert.ok(r.events.every(e=>e.site==='STALL A'));assert.equal(r.series[0].first,10);assert.equal(r.series[0].second,1);await save({...stock,kind:'sale',site:'STALL A',quantity:1,amount_paise:100,method:'cash'});await assert.rejects(()=>save({...stock,kind:'sale',site:'STALL B',quantity:1,amount_paise:100,method:'cash'}),{code:'42501'});});
  await as(ownerBId,async()=>{const r=await read();assert.ok(r.stock.every(s=>s.site==='STALL B'));assert.equal(r.tills[0].cash,99999);});
 });
 await test('LOCATION-03','Only authorities can grant access; raw tables and unscoped RPC bypasses are denied',async()=>{
  await as(salesAId,async()=>{await assert.rejects(()=>grant('STALL B',salesAId),{code:'42501'});await assert.rejects(()=>client.query('SELECT * FROM atlas_private.ice_location_members'),{code:'42501'});await assert.rejects(()=>client.query('SELECT atlas_private.industry_workspace_unscoped($1,$2)',[org,'ice-cream-stalls']),{code:'42501'});await assert.rejects(()=>client.query('SELECT atlas_private.apply_industry_operation_unscoped($1,$2,$3,$4)',[org,'ice-cream-stalls',randomUUID(),{kind:'receive',site:'STALL B',quantity:1}]),{code:'42501'});});
  await as(null,()=>assert.rejects(()=>read(),{code:'42501'}));
 });
 await test('LOCATION-04','Revocation immediately removes access while allowing safe recovery cancellation',async()=>{
  await as(ownerAId,()=>grant('STALL A',salesAId,false));
  await as(salesAId,async()=>{assert.deepEqual((await read()).stock,[]);await assert.rejects(()=>save({...stock,kind:'sale',site:'STALL A',quantity:1,amount_paise:100,method:'cash'}),{code:'42501'});const r=await client.query('SELECT public.resolve_industry_operation($1,$2,$3,$4) AS recorded',[org,'ice-cream-stalls',randomUUID(),{...stock,kind:'sale',site:'STALL A',quantity:1,amount_paise:100,method:'cash'}]);assert.equal(r.rows[0].recorded,false);});
 });
 await test('LOCATION-05','Depot orders are visible only to assigned origins while retaining complete shared fulfillment totals',async()=>{
  const expiry='2099-12-31';const item={sku:'VANILLA',batch:'LOT1',unit:'case'};
  await as(ownerAId,async()=>{
   for(const site of ['DEPOT A','DEPOT B']){await save({...item,kind:'receive',site,quantity:10,expiry},depot,'ice-cream-distribution');await save({...item,batch:'',kind:'promise',site,quantity:10,reference:site,detail:site+' customer'},depot,'ice-cream-distribution');}
   await save({...item,kind:'dispatch',site:'DEPOT B',quantity:3,reference:'DEPOT A'},depot,'ice-cream-distribution');await grant('DEPOT A',salesAId,true,depot,'ice-cream-distribution');
  });
  await as(salesAId,async()=>{const r=await read(depot,'ice-cream-distribution');assert.equal(r.orders.length,1);assert.equal(r.orders[0].reference,'DEPOT A');assert.equal(r.orders[0].dispatched,3);await assert.rejects(()=>save({...item,kind:'dispatch',site:'DEPOT A',quantity:1,reference:'DEPOT B'},depot,'ice-cream-distribution'),{code:'42501'});await assert.rejects(()=>save({...item,kind:'transfer',site:'DEPOT A',destination:'DEPOT B',quantity:1,detail:'Unauthorized depot transfer'},depot,'ice-cream-distribution'),{code:'42501'});});
 });
}
