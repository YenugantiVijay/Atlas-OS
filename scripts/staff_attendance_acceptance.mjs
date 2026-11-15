import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function runStaffAttendanceAcceptance({
  client, withRoleContext, recordTest, orgAId, orgBId, ownerAId, ownerBId, salesAId,
}) {
  const employee = randomUUID();
  const studio = randomUUID();
  const stall = randomUUID();
  const outsideLocation = randomUUID();
  const joining = '2025-01-01';
  const monday = '2025-02-03';
  const tuesday = '2025-02-04';
  const as = (userId, fn) => withRoleContext(client, { userId, role: userId ? 'authenticated' : 'anon' }, fn);
  const grant = () => client.query(
    'INSERT INTO public.staff_attendance_managers (organization_id,user_id) VALUES ($1,$2)', [orgAId, salesAId],
  );
  const candidates = (orgId = orgAId) => client.query(
    'SELECT user_id, email, is_granted FROM public.staff_attendance_manager_candidates($1)', [orgId],
  );
  const record = (date, revision, status, location) => client.query(`
    INSERT INTO public.staff_attendance(organization_id, staff_id, joining_on, work_date, revision, status, location_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7)`, [orgAId, employee, joining, date, revision, status, location]);
  const latest = (date, orgId = orgAId) => client.query(`
    SELECT location_id, revision, status, recorded_by
    FROM public.staff_attendance_day($1,$2,ARRAY[$3]::uuid[])`, [orgId, date, employee]);
  const profileCount = () => client.query('SELECT id FROM public.staff_profiles WHERE id=$1', [employee]);

  await client.query(`INSERT INTO public.staff_locations(id, organization_id, name) VALUES
    ($1,$2,'Attendance studio'), ($3,$2,'Attendance stall'), ($4,$5,'Attendance other workspace')`,
  [studio, orgAId, stall, outsideLocation, orgBId]);
  await as(ownerAId, () => client.query("SELECT public.add_staff_profile($1,$2,'Attendance employee',$3,ARRAY[$4]::uuid[])", [
    orgAId, employee, joining, studio,
  ]));
  await as(ownerAId, () => client.query(`INSERT INTO public.staff_pay_rates
    (organization_id,staff_id,joining_on,effective_on,basis,amount_paise)
    VALUES ($1,$2,$3,$3,'monthly',2000000)`, [orgAId, employee, joining]));

  async function check(id, label, fn) {
    try {
      await fn();
      recordTest(id, label, true);
    } catch (error) {
      recordTest(id, label, false, null, error);
    }
  }

  await check('ATTEND-01', 'Owner delegates attendance to a team member without granting pay access', async () => {
    await assert.rejects(as(salesAId, grant), { code: '42501' });
    assert.equal((await as(salesAId, profileCount)).rowCount, 0);
    assert.equal((await as(ownerAId, candidates)).rows[0].user_id, salesAId);
    assert.equal((await as(ownerBId, candidates)).rowCount, 0);
    await as(ownerAId, grant);
    assert.equal((await as(ownerAId, candidates)).rows[0].is_granted, true);
    assert.equal((await as(salesAId, candidates)).rowCount, 0);
    assert.equal((await as(salesAId, profileCount)).rowCount, 1);
    assert.equal((await as(salesAId, () => client.query(
      'SELECT * FROM public.staff_pay_rates WHERE staff_id=$1', [employee],
    ))).rowCount, 0);
  });

  await check('ATTEND-02', 'Daily locations can rotate beyond permanent assignments and corrections preserve history', async () => {
    await as(salesAId, () => record(monday, 1, 'scheduled', studio));
    await as(ownerAId, () => record(monday, 2, 'present', stall));
    await as(salesAId, () => record(tuesday, 1, 'present', studio));
    assert.deepEqual((await as(ownerAId, () => latest(monday))).rows, [
      { location_id: stall, revision: 2, status: 'present', recorded_by: ownerAId },
    ]);
    assert.deepEqual((await as(salesAId, () => latest(tuesday))).rows, [
      { location_id: studio, revision: 1, status: 'present', recorded_by: salesAId },
    ]);
    const original = await as(ownerAId, () => client.query(`
      SELECT location_id, recorded_by FROM public.staff_attendance WHERE organization_id=$1
        AND staff_id=$2 AND work_date=$3 AND revision=1`, [orgAId, employee, monday]));
    assert.deepEqual(original.rows, [{ location_id: studio, recorded_by: salesAId }]);
    await assert.rejects(as(salesAId, () => record(monday, 2, 'absent', null)), { code: '40001' });
    await assert.rejects(as(ownerAId, () => record(monday, 4, 'absent', null)), { code: '40001' });
    await assert.rejects(as(ownerAId, () => client.query(
      'UPDATE public.staff_attendance SET status=\'leave\' WHERE staff_id=$1', [employee],
    )), { code: '42501' });
  });

  await check('ATTEND-03', 'Attendance rejects invalid dates and locations and accepts leave without a location', async () => {
    await assert.rejects(as(salesAId, () => record('2025-02-05', 1, 'present', outsideLocation)), { code: '23503' });
    await assert.rejects(as(ownerAId, () => record('2024-12-31', 1, 'present', studio)), { code: '23514' });
    await assert.rejects(as(ownerAId, () => record('2999-01-01', 1, 'present', studio)), { code: '23514' });
    await assert.rejects(as(ownerAId, () => record('2025-02-05', 1, 'half_day', null)), { code: '23514' });
    await as(salesAId, () => record('2025-02-05', 1, 'leave', null));
    await as(salesAId, () => record('2999-01-01', 1, 'scheduled', studio));
    assert.equal((await as(ownerAId, () => latest('2025-02-05'))).rows[0].location_id, null);
    assert.equal((await as(ownerAId, () => latest('2999-01-01'))).rows[0].status, 'scheduled');
  });

  await check('ATTEND-04', 'Revoking or deactivating a manager closes attendance access and other workspaces remain isolated', async () => {
    assert.equal((await as(ownerBId, () => latest(monday))).rowCount, 0);
    await assert.rejects(as(ownerBId, () => record('2025-02-06', 1, 'present', studio)), { code: '42501' });
    await assert.rejects(as(null, () => client.query('SELECT * FROM public.staff_attendance')), { code: '42501' });
    await client.query('UPDATE public.memberships SET is_active=false WHERE organization_id=$1 AND user_id=$2', [orgAId, salesAId]);
    try {
      assert.equal((await as(salesAId, () => latest(monday))).rowCount, 0);
      await assert.rejects(as(salesAId, () => record('2025-02-06', 1, 'present', studio)), { code: '42501' });
    } finally {
      await client.query('UPDATE public.memberships SET is_active=true WHERE organization_id=$1 AND user_id=$2', [orgAId, salesAId]);
    }
    const revoke = () => client.query('DELETE FROM public.staff_attendance_managers WHERE organization_id=$1 AND user_id=$2', [orgAId, salesAId]);
    assert.equal((await as(salesAId, revoke)).rowCount, 0);
    assert.equal((await as(ownerAId, revoke)).rowCount, 1);
    assert.equal((await as(salesAId, () => latest(monday))).rowCount, 0);
    assert.equal((await as(ownerAId, () => latest(monday))).rowCount, 1);
  });
}
