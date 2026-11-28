import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {createProductFixture} from './product-test-fixture.mjs';
export async function runInvoiceReviewAcceptance({client,withRoleContext,recordTest,orgAId,ownerAId,salesAId,ownerBId}){
 const org=await createProductFixture(client,orgAId,'ice_cream_distribution');const as=(user,fn)=>withRoleContext(client,{userId:user,role:user?'authenticated':'anon'},fn);const day=(await client.query("SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS day")).rows[0].day;
 const first=randomUUID(),odd=randomUUID();const item={site:'DEPOT A',sku:'VANILLA',batch:'LOT1',unit:'case'};const op=(data,id=randomUUID())=>client.query('SELECT public.apply_industry_operation($1,$2,$3,$4)',[org,'ice-cream-distribution',id,data]);
 const read=async()=>(await client.query('SELECT public.ice_invoice_review_read($1,$2,$2) AS data',[org,day])).rows[0].data;
 const save=async(id,data,key=randomUUID())=>(await client.query('SELECT public.save_ice_invoice_review($1,$2,$3,$4) AS data',[org,id,key,data])).rows[0].data;
 const input={revision:0,billing_name:'Test retail customer',billing_address:'',unit_price_paise:3333,tax_basis_points:1800,supply:'state',tax_note:'',status:'draft'};
 const test=async(id,name,fn)=>{try{await fn();recordTest(id,name,true);}catch(e){recordTest(id,name,false,null,e);}};
 await test('INVOICE-REVIEW-01','Saved dispatches automatically enter review with quantity and customer, without invented prices',()=>as(ownerAId,async()=>{
  await op({...item,kind:'receive',quantity:10,expiry:'2099-12-31'});await op({...item,batch:'',kind:'promise',quantity:10,reference:'ORDER1',detail:'Test retail customer'});await op({...item,kind:'dispatch',quantity:3,reference:'ORDER1'},first);await op({...item,kind:'dispatch',quantity:1,reference:'ORDER1'},odd);
  const r=await read();assert.equal(r.count,2);assert.ok(r.rows.every(row=>row.status==='needs_details'&&row.amounts===null&&row.unit_price_paise===null));assert.equal(r.rows.find(row=>row.id===first).quantity,3);assert.equal(r.rows[0].customer,'Test retail customer');
 }));
 await test('INVOICE-REVIEW-02','Review math is exact and repeat saves do not duplicate stock or create issued invoices',()=>as(ownerAId,async()=>{
  const key=randomUUID();const firstSave=await save(first,input,key);assert.equal(firstSave.amounts.base_paise,9999);assert.equal(firstSave.amounts.tax_paise,1800);assert.equal(firstSave.amounts.total_paise,11799);assert.equal(firstSave.amounts.cgst_paise,900);assert.equal(firstSave.amounts.sgst_paise,900);assert.deepEqual(await save(first,input,key),firstSave);
  await assert.rejects(()=>save(first,{...input,unit_price_paise:3334},key),{code:'23505'});await assert.rejects(()=>save(first,input),{code:'40001'});await assert.rejects(()=>save(first,{...input,revision:1,quantity:99}),{code:'22023'});
  const counts=await client.query('SELECT count(*)::int AS invoices FROM public.invoices WHERE organization_id=$1',[org]);assert.equal(counts.rows[0].invoices,0);const stock=(await client.query('SELECT public.industry_workspace($1,$2) AS data',[org,'ice-cream-distribution'])).rows[0].data;assert.equal(stock.stock.reduce((sum,row)=>sum+row.quantity,0),6);
 }));
 await test('INVOICE-REVIEW-03','Odd tax paise split exactly and reviewed drafts require explicit billing and tax notes',()=>as(ownerAId,async()=>{
  const r=await save(odd,{...input,unit_price_paise:5,tax_basis_points:1000});assert.equal(r.amounts.tax_paise,1);assert.equal(r.amounts.cgst_paise,0);assert.equal(r.amounts.sgst_paise,1);assert.equal(r.amounts.total_paise,6);
  await assert.rejects(()=>save(first,{...input,revision:1,status:'reviewed'}),{code:'23514'});await save(first,{...input,revision:1,status:'reviewed',billing_address:'Customer billing address',tax_note:'Configured treatment checked by accounts'});assert.equal((await read()).rows.find(row=>row.id===first).status,'reviewed');
  await assert.rejects(()=>save(odd,{...input,revision:1,supply:'none'}),{code:'22023'});await assert.rejects(()=>save(odd,{...input,revision:1,unit_price_paise:null}),{code:'22023'});
 }));
 await test('INVOICE-REVIEW-04','Accounts staff need assigned dispatch and order locations; sales and outsiders cannot review',async()=>{
  await as(salesAId,()=>assert.rejects(()=>read(),{code:'42501'}));await as(ownerBId,()=>assert.rejects(()=>read(),{code:'42501'}));await as(null,()=>assert.rejects(()=>read(),{code:'42501'}));
  await client.query("INSERT INTO public.memberships(organization_id,user_id,role,is_active) VALUES($1,$2,'accounts',true)",[org,ownerBId]);await as(ownerBId,async()=>{assert.equal((await read()).count,0);await assert.rejects(()=>save(odd,{...input,revision:1}),{code:'42501'});await assert.rejects(()=>client.query('SELECT * FROM atlas_private.ice_invoice_reviews'),{code:'42501'});});
  await as(ownerAId,()=>client.query('SELECT public.set_ice_location_access($1,$2,$3,$4,true)',[org,'ice-cream-distribution','DEPOT A',ownerBId]));await as(ownerBId,async()=>{assert.equal((await read()).count,2);const r=await save(odd,{...input,revision:1,unit_price_paise:5,tax_basis_points:1000,supply:'interstate'});assert.equal(r.amounts.igst_paise,1);assert.equal(r.amounts.cgst_paise,0);});
 });
}
