import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createProductFixture} from './product-test-fixture.mjs';
export async function runTimetableAcceptance({client,withRoleContext,recordTest,orgAId,ownerAId,salesAId,ownerBId}) {
 const org=await createProductFixture(client,orgAId,'school');const staff=randomUUID(),otherStaff=randomUUID();
 const as=(userId,fn)=>withRoleContext(client,{userId,role:userId?'authenticated':'anon'},fn);
 const test=async(id,label,fn)=>{try{await fn();recordTest(id,label,true);}catch(e){recordTest(id,label,false,null,e);}};
 const today=(await client.query("SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS day")).rows[0].day;
 const tomorrow=new Date(Date.parse(today)+86400000).toISOString().slice(0,10);
 const entry={day:1,start:540,end:585,activity:'teaching',class:'5',section:'A',subject:'Science',room:'3'};
 const id=randomUUID(),next=randomUUID();const original='UEsDBAoAAA==';
 const publish=(version=id,expected=null,effective=today,entries=[entry],person=staff)=>client.query('SELECT public.school_timetable_publish($1,$2,$3,$4,$5,$6,$7,$8)',[org,person,version,expected,effective,JSON.stringify(entries),'Timetable.xlsx',original]);
 const read=async(person=staff,date=today,version=null,download=false)=>(await client.query('SELECT public.school_timetable_read($1,$2,$3,$4,1,$5) AS data',[org,person,date,version,download])).rows[0].data;
 await as(ownerAId,async()=>{
  for(const [person,card] of [[staff,'SCI-001'],[otherStaff,'MATH-002']])await client.query("SELECT public.school_staff_command($1,'register',$2)",[org,{staff_id:person,school_id:card,name:card,position:'teacher',joining_on:today,revision:0}]);
  await client.query('SELECT public.link_staff_employee($1,$2,$3,true)',[org,staff,salesAId]);
 });
 await test('TIMETABLE-01','Only school authority publishes; staff read their own timetable without academic roles',async()=>{
  await as(salesAId,()=>assert.rejects(()=>publish()));await as(ownerAId,()=>publish());
  await as(salesAId,async()=>{const r=await read(null);assert.equal(r.current.id,id);assert.equal(r.can_publish,false);assert.equal(r.current.original_base64,null);await assert.rejects(()=>read(otherStaff));await assert.rejects(()=>client.query('SELECT * FROM atlas_school.staff_timetables'));});
  await as(ownerBId,()=>assert.rejects(()=>read()));await as(null,()=>assert.rejects(()=>read()));
 });
 await test('TIMETABLE-02','Future schedules preserve currently effective versions and original downloads',async()=>{
  await as(ownerAId,()=>publish(next,id,tomorrow,[{...entry,subject:'Mathematics'}]));
  await as(salesAId,async()=>{assert.equal((await read()).current.id,id);assert.equal((await read(staff,tomorrow)).current.id,next);const old=await read(staff,tomorrow,id,true);assert.equal(old.current.original_base64,original);assert.equal(old.history.length,2);});
 });
 await test('TIMETABLE-03','Publish retries are idempotent and stale replacements cannot overwrite newer schedules',async()=>{
  await as(ownerAId,async()=>{await publish(next,id,tomorrow,[{...entry,subject:'Mathematics'}]);await assert.rejects(()=>publish(randomUUID(),id));assert.equal((await read()).history.length,2);});
 });
 await test('TIMETABLE-04','Database rejects overlaps, invalid fields, incomplete lessons and cross-school staff',async()=>{
  await as(ownerAId,async()=>{
   for(const rows of [[entry,{...entry,start:560}],[{...entry,start:600,end:500}],[{...entry,subject:''}],[{...entry,room:{html:'bad'}}],[{...entry,activity:'unknown'}]])await assert.rejects(()=>publish(randomUUID(),next,today,rows));
   await assert.rejects(()=>publish(randomUUID(),null,today,[entry],randomUUID()));
  });
 });
 await test('TIMETABLE-05','Disabled staff links lose access to schedules and original files',async()=>{
  await as(ownerAId,()=>client.query('SELECT public.link_staff_employee($1,$2,$3,false)',[org,staff,salesAId]));
  await as(salesAId,()=>assert.rejects(()=>read(staff,today,id,true)));
 });
}
