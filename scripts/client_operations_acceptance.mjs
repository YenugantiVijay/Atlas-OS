import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createProductFixture} from './product-test-fixture.mjs';
export async function runClientOperationsAcceptance({client,withRoleContext,recordTest,orgAId,ownerAId,salesAId}) {
 const stalls=await createProductFixture(client,orgAId,'ice_cream_stalls');const depot=await createProductFixture(client,orgAId,'ice_cream_distribution');const school=await createProductFixture(client,orgAId,'school');
 const as=(user,fn)=>withRoleContext(client,{userId:user,role:'authenticated'},fn);
 const test=async(id,title,fn)=>{try{await fn();recordTest(id,title,true);}catch(e){recordTest(id,title,false,null,e);}};
 const ice=(org,tool,command,id=randomUUID())=>client.query('SELECT public.apply_industry_operation($1,$2,$3,$4)',[org,tool,id,command]);
 const readIce=async(org,tool)=>(await client.query('SELECT public.industry_workspace($1,$2) AS data',[org,tool])).rows[0].data;
 const command=async(action,data)=>(await client.query('SELECT public.school_command($1,$2,$3,$4) AS data',[school,action,data,randomUUID()])).rows[0].data;
 const readSchool=async(area,filter={})=>(await client.query('SELECT public.school_read($1,$2,$3) AS data',[school,area,filter])).rows[0].data;
 const day=(await client.query("SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS day")).rows[0].day;const year=day.slice(0,4);
 const stock={sku:'VANILLA',batch:'',unit:'piece'};
 await test('CLIENT-STALL-01','Eight stalls reconcile cash separately; atomic transfers and reasoned wastage preserve total stock',()=>as(ownerAId,async()=>{
  for(let i=1;i<=8;i++){
   const site='STALL '+i;await ice(stalls,'ice-cream-stalls',{kind:'open',site,detail:'Staff '+i,amount_paise:10000+i});
   await ice(stalls,'ice-cream-stalls',{...stock,kind:'receive',site,quantity:100});
   await ice(stalls,'ice-cream-stalls',{...stock,kind:'sale',site,quantity:10,method:'cash',amount_paise:10001});
   await ice(stalls,'ice-cream-stalls',{...stock,kind:'sale',site,quantity:5,method:'upi',amount_paise:5001});
   await ice(stalls,'ice-cream-stalls',{...stock,kind:'waste',site,quantity:2,detail:'Melted during service'});
  }
  const id=randomUUID();const transfer={...stock,kind:'transfer',site:'STALL 1',destination:'STALL 2',quantity:5,detail:'Evening stock replenishment'};await ice(stalls,'ice-cream-stalls',transfer,id);await ice(stalls,'ice-cream-stalls',transfer,id);
  const r=await readIce(stalls,'ice-cream-stalls');assert.equal(r.stock.reduce((n,s)=>n+s.quantity,0),8*83);assert.equal(r.stock.find(s=>s.site==='STALL 1').quantity,78);assert.equal(r.stock.find(s=>s.site==='STALL 2').quantity,88);
  for(const till of r.tills){assert.equal(till.cash,10001);assert.equal(till.upi,5001);await ice(stalls,'ice-cream-stalls',{kind:'close_day',site:till.site,amount_paise:till.opening+till.cash});}
  const closed=await readIce(stalls,'ice-cream-stalls');assert.ok(closed.tills.every(t=>t.counted===t.opening+t.cash));
  await assert.rejects(()=>ice(stalls,'ice-cream-stalls',{...transfer,site:'STALL 3',destination:'STALL 4'}));
 }));
 await test('CLIENT-STALL-02','Stale counts cannot erase receipts and adjustments require an audit reason',()=>as(ownerAId,async()=>{
  const entry={...stock,site:'COUNT TEST'};await ice(stalls,'ice-cream-stalls',{...entry,kind:'receive',quantity:10});await ice(stalls,'ice-cream-stalls',{...entry,kind:'receive',quantity:5});
  await assert.rejects(()=>ice(stalls,'ice-cream-stalls',{...entry,kind:'count',quantity:8,expected_quantity:10,detail:'Physical stock count'}),/Stock changed/i);
  await assert.rejects(()=>ice(stalls,'ice-cream-stalls',{...entry,kind:'count',quantity:13,expected_quantity:15}),/reason/i);
  await ice(stalls,'ice-cream-stalls',{...entry,kind:'count',quantity:13,expected_quantity:15,detail:'Physical stock count'});
  assert.equal((await readIce(stalls,'ice-cream-stalls')).stock.find(s=>s.site==='COUNT TEST').quantity,13);
 }));
 await test('CLIENT-DIST-01','Distribution launch lifecycle validates freezer batch expiry, split deliveries, returns and write-offs',()=>as(ownerAId,async()=>{
  const expiry=year+'-12-31';const entry={site:'FREEZER A',sku:'VANILLA',batch:'LOT1',unit:'case'};
  await ice(depot,'ice-cream-distribution',{...entry,kind:'receive',quantity:100,expiry});
  await assert.rejects(()=>ice(depot,'ice-cream-distribution',{...entry,site:'FREEZER B',kind:'receive',quantity:10,expiry:String(Number(year)+1)+'-12-31'}),/expiry must match/i);
  await ice(depot,'ice-cream-distribution',{...entry,kind:'transfer',destination:'FREEZER B',quantity:40,detail:'Rebalance cold storage'});
  await ice(depot,'ice-cream-distribution',{...entry,batch:'',kind:'promise',reference:'ORDER1',detail:'Retail outlet',quantity:100});
  await ice(depot,'ice-cream-distribution',{...entry,kind:'dispatch',reference:'ORDER1',quantity:50});await ice(depot,'ice-cream-distribution',{...entry,site:'FREEZER B',kind:'dispatch',reference:'ORDER1',quantity:30});
  await ice(depot,'ice-cream-distribution',{...entry,site:'FREEZER B',kind:'return',reference:'ORDER1',quantity:5,detail:'Restock',amount_paise:500});
  await ice(depot,'ice-cream-distribution',{...entry,kind:'return',reference:'ORDER1',quantity:3,detail:'Damaged',amount_paise:300});
  const r=await readIce(depot,'ice-cream-distribution');assert.equal(r.stock.reduce((n,s)=>n+s.quantity,0),25);assert.equal(r.orders[0].promised-r.orders[0].dispatched,20);
  await assert.rejects(()=>ice(depot,'ice-cream-distribution',{...entry,kind:'waste',quantity:11,detail:'Damaged cold-chain stock'}));
 }));
 await test('CLIENT-DIST-02','Expired inventory can be written off but cannot be transferred or dispatched',async()=>{
  await client.query("UPDATE atlas_private.ice_events SET expiry=$2::date-1 WHERE organization_id=$1 AND expiry IS NOT NULL",[depot,day]);
  await as(ownerAId,async()=>{const entry={site:'FREEZER B',sku:'VANILLA',batch:'LOT1',unit:'case'};
   await assert.rejects(()=>ice(depot,'ice-cream-distribution',{...entry,kind:'transfer',destination:'FREEZER C',quantity:1,detail:'Attempt expired transfer'}));
   await assert.rejects(()=>ice(depot,'ice-cream-distribution',{...entry,kind:'dispatch',reference:'ORDER1',quantity:1}));
   await ice(depot,'ice-cream-distribution',{...entry,kind:'waste',quantity:15,detail:'Expired batch disposal'});
   assert.equal((await readIce(depot,'ice-cream-distribution')).stock.reduce((n,s)=>n+s.quantity,0),10);
  });
  await as(salesAId,()=>assert.rejects(()=>ice(depot,'ice-cream-distribution',{site:'FREEZER A',sku:'VANILLA',batch:'LOT1',unit:'case',kind:'waste',quantity:1,detail:'Unauthorized stock disposal'})));
 });
 await test('CLIENT-RECOVERY-01','Recovery confirms posted requests or permanently cancels unsaved ones without later stock movement',()=>as(ownerAId,async()=>{
  const id=randomUUID();const op={...stock,site:'RECOVERY',kind:'receive',quantity:10};const resolve=async()=> (await client.query('SELECT public.resolve_industry_operation($1,$2,$3,$4) AS recorded',[stalls,'ice-cream-stalls',id,op])).rows[0].recorded;
  assert.equal(await resolve(),false);await assert.rejects(()=>ice(stalls,'ice-cream-stalls',op,id),/cancelled/i);assert.equal(await resolve(),false);
  const saved=randomUUID();await ice(stalls,'ice-cream-stalls',op,saved);assert.equal((await client.query('SELECT public.resolve_industry_operation($1,$2,$3,$4) AS recorded',[stalls,'ice-cream-stalls',saved,op])).rows[0].recorded,true);
 }));
 await test('CLIENT-SCHOOL-01','A synthetic 1000-student school reconciles issued fees, exact tax, collections and teacher class boundaries',()=>as(ownerAId,async()=>{
  await command('settings',{name:'Scale Test School',address:'School Road',phone:'9000000000',receipt_prefix:'LOAD'});
  const y=(await command('year',{name:'Scale year',starts_on:year+'-01-01',ends_on:year+'-12-31'})).id;const category=(await command('fee_category',{name:'Configured test fee'})).id;let firstClass;const enrolments=[];
  for(let c=0;c<20;c++){
   const classroom=(await command('class',{year_id:y,name:'Class '+(c+1),section:'A'})).id;if(!firstClass)firstClass=classroom;
   const rows=Array.from({length:50},(_,i)=>({class_id:classroom,admission_no:`LOAD-${c}-${i}`,name:`Student ${c} ${i}`,dob:'2015-01-01',guardian_name:'Guardian',guardian_phone:'9000000000',joining_on:year+'-01-01'}));
   const saved=await command('students_import',{rows});enrolments.push(...saved.map(r=>r.enrolment_id));
   const schedule=(await command('fee_schedule',{class_id:classroom,category_id:category,label:'Test instalment',due_on:day,amount_paise:10001,tax_basis_points:1800,tax_note:'Synthetic calculation fixture, not tax advice'})).id;
   await command('issue_fees',{schedule_id:schedule});await command('issue_fees',{schedule_id:schedule});
  }
  for(const enrolment of enrolments.slice(0,100))await command('payment',{enrolment_id:enrolment,amount_paise:11801,paid_on:day,method:'cash'});
  const report=await readSchool('fee_summary',{year_id:y,export:true});assert.equal(report.count,1000);assert.equal(report.rows.length,1000);assert.equal(report.totals.charged_paise,11801000);assert.equal(report.totals.paid_paise,1180100);assert.equal(report.totals.balance_paise,10620900);
  const collections=await readSchool('collections',{from:day,to:day});assert.equal(collections.totals.net_paise,1180100);
  await command('role',{user_id:salesAId,role:'teacher',class_ids:[firstClass]});
 }));
 await test('CLIENT-SCHOOL-02','Teacher cannot escape the assigned class or read school finance under load',()=>as(salesAId,async()=>{
  const students=await readSchool('students',{export:true});assert.equal(students.count,50);assert.equal(students.rows.length,50);await assert.rejects(()=>readSchool('fee_summary',{}));
 }));
}
