import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function runSchoolAcceptance({ client, withRoleContext, recordTest, orgAId, orgBId, ownerAId, ownerBId, salesAId }) {
  const as = (userId, fn) => withRoleContext(client, { userId, role: userId ? 'authenticated' : 'anon' }, fn);
  const command = async (action, data, key = randomUUID(), org = orgAId) => (await client.query('SELECT public.school_command($1,$2,$3,$4) AS result', [org,action,data,key])).rows[0].result;
  const read = async (area, filter = {}, org = orgAId) => (await client.query('SELECT public.school_read($1,$2,$3) AS result', [org,area,filter])).rows[0].result;
  const test = async (id, label, fn) => { try { await fn(); recordTest(id,label,true); } catch (error) { recordTest(id,label,false,null,error); } };
  let year, classroom, otherClass, student, enrolment, schedule, charge, receipt, concession, refund;
  const today = (await client.query("SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS day")).rows[0].day;
  const yearNumber = today.slice(0,4);
  await test('SCHOOL-01','Owner creates a school, year, terms and classes; staff cannot self-grant school roles',async()=>{
    await as(ownerAId,async()=>{
      await command('settings',{name:'Acceptance School',address:'School Road',phone:'9000000000',receipt_prefix:'SCH'});
      year=(await command('year',{name:'Test academic year',starts_on:yearNumber+'-01-01',ends_on:yearNumber+'-12-31'})).id;
      await command('term',{year_id:year,name:'Term One',starts_on:yearNumber+'-01-01',ends_on:yearNumber+'-06-30'});
      classroom=(await command('class',{year_id:year,name:'Class 5',section:'A'})).id;
      otherClass=(await command('class',{year_id:year,name:'Class 5',section:'B'})).id;
      await assert.rejects(()=>command('term',{year_id:year,name:'Invalid term',starts_on:'2000-01-01',ends_on:'2000-01-31'}));
    });
    await as(salesAId,async()=>{
      await assert.rejects(()=>read('bootstrap'));
      await assert.rejects(()=>command('role',{user_id:salesAId,role:'principal'}));
    });
  });
  if(!classroom) return;
  const studentData = {class_id:classroom,admission_no:'SCH-001',name:'Asha Student',dob:'2015-01-01',guardian_name:'Guardian',guardian_phone:'9000000000',joining_on:yearNumber+'-01-01'};
  await test('SCHOOL-02','Student import is atomic and duplicate admission IDs do not create partial records',async()=>{
    await as(ownerAId,async()=>{
      const result=await command('student',studentData); student=result[0].student_id; enrolment=result[0].enrolment_id;
      await assert.rejects(()=>command('students_import',{rows:[{...studentData,admission_no:'SCH-002'},studentData]}));
      assert.equal((await read('students',{year_id:year})).count,1);
      await command('student',{...studentData,class_id:otherClass,admission_no:'SCH-003',name:'Other Class Student'});
    });
  });
  await test('SCHOOL-03','Admissions follow review and approval before atomic admission and enrolment',async()=>{
    await as(ownerAId,async()=>{
      let application=await command('admission',{applicant:'New Applicant',guardian_name:'Guardian Two',phone:'9111111111',desired_class:'Class 5'});
      await assert.rejects(()=>command('admit',{id:application.id,revision:1,class_id:classroom,admission_no:'SCH-004',joining_on:today}));
      for(const status of ['application','review','approved']) application=await command('admission_stage',{id:application.id,revision:application.revision,status});
      await command('admit',{id:application.id,revision:application.revision,class_id:classroom,admission_no:'SCH-004',joining_on:today});
      assert.equal((await read('admissions')).rows[0].status,'admitted');
    });
  });
  await test('SCHOOL-04','Assigned teachers read only their class and cannot access school finances',async()=>{
    await as(ownerAId,()=>command('role',{user_id:salesAId,role:'teacher',class_ids:[classroom]}));
    await as(salesAId,async()=>{
      const roster=await read('students',{year_id:year}); assert.equal(roster.count,2); assert.ok(roster.rows.every(row=>row.class_id===classroom));
      await assert.rejects(()=>read('fee_summary',{year_id:year}));
      await assert.rejects(()=>read('attendance',{class_id:otherClass,from:today}));
      await assert.rejects(()=>command('settings',{name:'Unauthorized'}));
    });
  });
  await test('SCHOOL-05','Student attendance has explicit statuses, revision conflicts and correction reasons',async()=>{
    await as(salesAId,async()=>{
      assert.equal((await read('attendance',{class_id:classroom,from:today})).rows.find(row=>row.enrolment_id===enrolment).status,null);
      await command('attendance',{class_id:classroom,day:today,rows:[{enrolment_id:enrolment,revision:0,status:'present'}]});
      await assert.rejects(()=>command('attendance',{class_id:classroom,day:today,rows:[{enrolment_id:enrolment,revision:0,status:'absent',reason:'Late update'}]}));
      await assert.rejects(()=>command('attendance',{class_id:classroom,day:today,rows:[{enrolment_id:enrolment,revision:1,status:'late'}]}));
      await command('attendance',{class_id:classroom,day:today,rows:[{enrolment_id:enrolment,revision:1,status:'late',reason:'Arrived after registration'}]});
      assert.equal((await read('attendance_history',{class_id:classroom,enrolment_id:enrolment,from:today})).count,2);
      const monthly=await read('attendance_report',{class_id:classroom,from:yearNumber+'-01-01',to:yearNumber+'-12-31'});
      assert.equal(monthly.rows.find(row=>row.enrolment_id===enrolment).late,1);
    });
  });
  await test('SCHOOL-06','School fees snapshot tax and issue once per student and schedule',async()=>{
    await as(ownerAId,async()=>{
      const category=(await command('fee_category',{name:'Tuition'})).id;
      schedule=(await command('fee_schedule',{class_id:classroom,category_id:category,label:'Term tuition',due_on:today,amount_paise:100000,tax_basis_points:0,tax_note:'Configured school fee treatment for test'})).id;
      await command('issue_fees',{schedule_id:schedule}); await command('issue_fees',{schedule_id:schedule});
      const charges=await read('charges',{enrolment_id:enrolment}); assert.equal(charges.count,1); charge=charges.rows[0].id;
      assert.equal(charges.rows[0].balance_paise,100000);
    });
  });
  await test('SCHOOL-07','Payment retries return the same receipt and overpayment is rejected',async()=>{
    await as(ownerAId,async()=>{
      const key=randomUUID(); const data={enrolment_id:enrolment,paid_on:today,amount_paise:40000,method:'upi',reference:'TEST-UPI-001'};
      receipt=(await command('payment',data,key)).receipt_id;
      assert.equal((await command('payment',data,key)).receipt_id,receipt);
      await assert.rejects(()=>command('payment',{...data,amount_paise:90000}));
      await assert.rejects(()=>command('payment',{...data,amount_paise:41000},key));
      assert.equal((await read('charges',{enrolment_id:enrolment})).rows[0].balance_paise,60000);
      const printed=await read('receipt',{receipt_id:receipt}); assert.equal(printed.student_snapshot.name,'Asha Student'); assert.equal(printed.allocations[0].amount_paise,40000);
    });
  });
  await test('SCHOOL-08','Accountants request concessions but principal approval rechecks current unpaid fees',async()=>{
    await as(ownerAId,()=>command('role',{user_id:salesAId,role:'accountant'}));
    await as(salesAId,async()=>{
      concession=(await command('concession_request',{charge_id:charge,amount_paise:10000,reason:'Approved scholarship request'})).id;
      await assert.rejects(()=>command('concession_review',{id:concession,decision:'approved'}));
    });
    await as(ownerAId,()=>command('concession_review',{id:concession,decision:'approved'}));
    await as(salesAId,async()=>{ assert.equal((await read('charges',{enrolment_id:enrolment})).rows[0].balance_paise,50000); });
  });
  await test('SCHOOL-09','Approved refunds preserve receipts, restore dues and reconcile net collections',async()=>{
    await as(salesAId,async()=>{
      refund=(await command('refund_request',{receipt_id:receipt,amount_paise:10000,kind:'refund',reason:'Partial collection correction',method:'bank',reference:'REFUND-001',refunded_on:today})).id;
      await assert.rejects(()=>command('refund_review',{id:refund,decision:'approved'}));
    });
    await as(ownerAId,async()=>{
      await command('refund_review',{id:refund,decision:'approved'});
      assert.equal((await read('charges',{enrolment_id:enrolment})).rows[0].balance_paise,60000);
      assert.equal((await read('collections',{from:today,to:today})).totals.net_paise,30000);
      assert.equal((await read('receipt',{receipt_id:receipt})).adjustments[0].amount_paise,10000);
    });
  });
  await test('SCHOOL-11','Configured fee tax rounds once to paise and exports contain every matching student',async()=>{
    await as(ownerAId,async()=>{
      const category=(await command('fee_category',{name:'Optional test category'})).id;
      const taxed=(await command('fee_schedule',{class_id:classroom,category_id:category,label:'Rounding test',due_on:today,amount_paise:103,tax_basis_points:1800,tax_note:'Explicit test configuration, not an automatic GST determination'})).id;
      await command('issue_fees',{schedule_id:taxed});
      const fee=(await read('charges',{enrolment_id:enrolment})).rows.find(row=>row.schedule_id===taxed);
      assert.equal(fee.tax_paise,19); assert.equal(fee.total_paise,122);
      const all=await read('fee_summary',{year_id:year,limit:1,export:true});
      assert.equal(all.rows.length,all.count); assert.ok(all.count>1);
      const page=await read('fee_summary',{year_id:year,limit:1}); assert.equal(page.rows.length,1);
      assert.deepEqual(page.totals,all.totals);
      assert.deepEqual(await read('import_duplicates',{admission_nos:['SCH-001','NO-MATCH']}),['SCH-001']);
      const month=await read('attendance_report',{class_id:classroom,from:today,to:today,limit:1,export:true}); assert.equal(month.rows.length,month.count);
    });
  });
  await test('SCHOOL-12','Contact corrections and next-year enrolment preserve receipt snapshots and historical attendance',async()=>{
    await as(ownerAId,async()=>{
      const profile=(await read('students',{search:'SCH-001'})).rows[0];
      await command('student_update',{id:student,revision:profile.revision,name:'Asha Updated',guardian_name:'Guardian Updated',guardian_phone:'9222222222',reason:'Guardian requested contact correction'});
      await assert.rejects(()=>command('student_update',{id:student,revision:profile.revision,name:'Stale edit',guardian_name:'Guardian',guardian_phone:'9222222222',reason:'Stale revision'}));
      assert.equal((await read('receipt',{receipt_id:receipt})).student_snapshot.name,'Asha Student');
      const next=String(Number(yearNumber)+1); const nextYear=(await command('year',{name:'Next academic year',starts_on:next+'-01-01',ends_on:next+'-12-31'})).id;
      const nextClass=(await command('class',{year_id:nextYear,name:'Class 6',section:'A'})).id;
      await command('enrol',{student_id:student,class_id:nextClass});
      assert.equal((await read('students',{year_id:nextYear})).count,1);
      assert.equal((await read('attendance_history',{class_id:classroom,enrolment_id:enrolment,from:today})).count,2);
      await assert.rejects(()=>command('student',{...studentData,class_id:randomUUID(),admission_no:'NO-CLASS'}));
    });
  });
  await test('SCHOOL-13','Repeated refund approvals cannot exceed retained receipt value and reversal restores the exact remainder',async()=>{
    await as(ownerAId,async()=>{
      await assert.rejects(()=>command('refund_request',{receipt_id:receipt,amount_paise:1,kind:'refund',reason:'Invalid date before collection',method:'cash',refunded_on:'2000-01-01'}));
      const pending=(await command('refund_request',{receipt_id:receipt,amount_paise:30000,kind:'reversal',reason:'Reverse remaining recorded collection',method:'cash',refunded_on:today})).id;
      const competing=(await command('refund_request',{receipt_id:receipt,amount_paise:30000,kind:'refund',reason:'Competing request must fail approval',method:'cash',refunded_on:today})).id;
      await command('refund_review',{id:pending,decision:'approved'});
      await assert.rejects(()=>command('refund_review',{id:competing,decision:'approved'}));
      assert.equal((await read('collections',{from:today,to:today})).totals.net_paise,0);
      assert.equal((await read('charges',{enrolment_id:enrolment})).rows.reduce((sum,row)=>sum+row.balance_paise,0),90122);
      assert.equal((await read('receipt',{receipt_id:receipt})).amount_paise,40000);
    });
  });
  await test('SCHOOL-10','School operations deny raw writes, cross-workspace reads and revoked school roles',async()=>{
    await as(ownerBId,async()=>{
      await assert.rejects(()=>read('receipt',{receipt_id:receipt},orgAId));
      await assert.rejects(()=>command('issue_fees',{schedule_id:schedule},randomUUID(),orgAId));
    });
    await as(salesAId,async()=>{ await assert.rejects(()=>client.query('SELECT * FROM atlas_school.receipts')); await assert.rejects(()=>client.query('DELETE FROM atlas_school.students')); });
    await as(ownerAId,()=>command('role',{user_id:salesAId,role:'remove'}));
    await as(salesAId,()=>assert.rejects(()=>read('bootstrap')));
    await as(null,()=>assert.rejects(()=>read('bootstrap')));
  });
}
