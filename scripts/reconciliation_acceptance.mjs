import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {createProductFixture} from './product-test-fixture.mjs';
export async function runReconciliationAcceptance({client,withRoleContext,recordTest,orgAId,ownerAId,salesAId}){
 const org=await createProductFixture(client,orgAId,'ice_cream_stalls');const as=(u,fn)=>withRoleContext(client,{userId:u,role:'authenticated'},fn);const stock={site:'STALL A',sku:'VANILLA',batch:'',unit:'piece'};
 const save=(op)=>client.query('SELECT public.apply_industry_operation($1,$2,$3,$4)',[org,'ice-cream-stalls',randomUUID(),op]);
 const day=(await client.query("SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS day")).rows[0].day;
 const read=async(site=null)=>(await client.query('SELECT public.ice_reconciliation($1,$2,$3,$4) AS data',[org,'ice-cream-stalls',day,site])).rows[0].data;
 const test=async(id,name,fn)=>{try{await fn();recordTest(id,name,true);}catch(e){recordTest(id,name,false,null,e);}};
 await test('RECONCILE-01','Stock bridge and cash paise reconcile independently, including transfers, counts and UPI',()=>as(ownerAId,async()=>{
  await save({kind:'open',site:'STALL A',detail:'Staff A',amount_paise:1000});await save({...stock,kind:'receive',quantity:20});await save({...stock,kind:'sale',quantity:2,method:'cash',amount_paise:101});await save({...stock,kind:'sale',quantity:1,method:'upi',amount_paise:201});await save({...stock,kind:'transfer',destination:'STALL B',quantity:4,detail:'Evening replenishment'});await save({...stock,kind:'waste',quantity:2,detail:'Melted during service'});await save({...stock,kind:'count',quantity:10,expected_quantity:11,detail:'Physical closing stock'});await save({kind:'close_day',site:'STALL A',amount_paise:1100});
  const r=await read();const a=r.stock.find(s=>s.site==='STALL A');assert.equal(a.opening+a.received-a.sold_or_dispatched+a.restocked+a.transferred_in-a.transferred_out-a.written_off+a.count_adjustment,a.closing);assert.equal(a.closing,10);assert.equal(r.stock.find(s=>s.site==='STALL B').closing,4);assert.equal(r.cash[0].expected_paise,1101);assert.equal(r.cash[0].variance_paise,-1);assert.equal(r.cash[0].upi_sales_paise,201);
 }));
 await test('RECONCILE-02','Opening stock carries across dates and missing cash opening stays unknown',async()=>{
  await as(ownerAId,()=>save({...stock,site:'STALL C',kind:'receive',quantity:7}));await client.query("UPDATE atlas_private.ice_events SET day=$2::date-1 WHERE organization_id=$1 AND site='STALL C'",[org,day]);
  await as(ownerAId,async()=>{await save({...stock,site:'STALL C',kind:'sale',quantity:1,method:'cash',amount_paise:100});const r=await read('STALL C');assert.equal(r.stock[0].opening,7);assert.equal(r.stock[0].closing,6);assert.equal(r.cash[0].expected_paise,null);assert.equal(r.cash[0].variance_paise,null);});
 });
 await test('RECONCILE-03','Assigned staff cannot export other locations or aggregate their balances',async()=>{
  await as(ownerAId,()=>client.query('SELECT public.set_ice_location_access($1,$2,$3,$4,true)',[org,'ice-cream-stalls','STALL A',salesAId]));await as(salesAId,async()=>{const r=await read();assert.ok(r.stock.every(s=>s.site==='STALL A'));assert.ok(r.cash.every(s=>s.site==='STALL A'));await assert.rejects(()=>read('STALL B'),{code:'42501'});});
 });
 await test('RECONCILE-04','Recent own history remains available after more than fifty events at another stall',async()=>{
  await as(ownerAId,async()=>{await save({...stock,site:'BUSY STALL',kind:'receive',quantity:100});for(let i=0;i<60;i++)await save({...stock,site:'BUSY STALL',kind:'sale',quantity:1,method:'cash',amount_paise:1});});
  await as(salesAId,async()=>{const r=(await client.query('SELECT public.industry_workspace($1,$2) AS data',[org,'ice-cream-stalls'])).rows[0].data;assert.ok(r.events.length>0);assert.ok(r.events.every(e=>e.site==='STALL A'));});
 });
}
