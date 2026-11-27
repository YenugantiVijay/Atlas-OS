import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function runStaffClockAcceptance({ client, withRoleContext, recordTest, orgAId, orgBId, ownerAId, ownerBId, salesAId }) {
  const staffId = randomUUID();
  const locationId = randomUUID();
  const as = (userId, action) => withRoleContext(client, { userId, role: userId ? 'authenticated' : 'anon' }, action);
  const check = async (id, name, action) => {
    try { await action(); recordTest(id, name, true); }
    catch (error) { recordTest(id, name, false, null, error); }
  };
  const link = (org = orgAId, employee = staffId, member = salesAId) => client.query(
    'SELECT public.link_staff_employee($1,$2,$3,true)', [org, employee, member]);
  const act = (action, session = null, summary = null, org = orgAId) => client.query(
    'SELECT (public.staff_clock_action($1,$2,$3,$4,$5)).*', [org, action, session, locationId, summary]);
  const denied = async (action) => assert.rejects(action);
  await client.query('INSERT INTO public.staff_locations(id,organization_id,name) VALUES($1,$2,$3)', [locationId, orgAId, 'Clock test location']);
  await as(ownerAId, () => client.query("SELECT public.add_staff_profile($1,$2,'Clock employee','2020-01-01',ARRAY[$3]::uuid[])", [orgAId, staffId, locationId]));
  const originalRole = (await client.query('SELECT role FROM public.memberships WHERE organization_id=$1 AND user_id=$2', [orgAId,salesAId])).rows[0].role;
  await client.query("UPDATE public.memberships SET role='viewer' WHERE organization_id=$1 AND user_id=$2", [orgAId,salesAId]);
  try {
  await check('CLOCK-01', 'Employee cannot link their own account or enter another workspace', async () => {
    await as(salesAId, () => denied(() => link()));
    await as(ownerBId, () => denied(() => link()));
    await as(ownerAId, () => denied(() => link(orgBId)));
  });
  await as(ownerAId, () => link());
  await check('CLOCK-02', 'Employee reads their linked profile without acquiring pay-rate access', async () => {
    await as(salesAId, async () => {
      assert.equal((await client.query('SELECT id FROM public.staff_profiles WHERE id=$1', [staffId])).rowCount, 1);
      assert.equal((await client.query('SELECT * FROM public.staff_pay_rates WHERE staff_id=$1', [staffId])).rowCount, 0);
    });
  });
  let sessionId;
  await check('CLOCK-03', 'Server check-in is idempotent and uses the current IST date', async () => {
    await as(salesAId, async () => {
      const first = (await act('check_in')).rows[0]; sessionId = first.id;
      const second = (await act('check_in')).rows[0];
      assert.equal(first.id, second.id);
      const expected = (await client.query("SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS today")).rows[0].today;
      assert.equal(new Date(first.work_date).toLocaleDateString('en-CA'), expected);
    });
  });
  if (!sessionId) return;
  await check('CLOCK-04', 'Employee and owner cannot forge raw session timestamps or summaries', async () => {
    for (const user of [salesAId, ownerAId]) await as(user, async () => {
      await denied(() => client.query('UPDATE public.staff_clock_sessions SET checked_in_at=now() WHERE id=$1', [sessionId]));
      await denied(() => client.query('DELETE FROM public.staff_clock_sessions WHERE id=$1', [sessionId]));
    });
  });
  await check('CLOCK-05', 'Account relinking is blocked while a shift is open', async () => {
    await as(ownerAId, () => denied(() => link()));
  });
  await check('CLOCK-06', 'Cross-tenant reads and actions cannot access an employee shift', async () => {
    await as(ownerBId, async () => {
      assert.equal((await client.query('SELECT * FROM public.staff_clock_log WHERE id=$1', [sessionId])).rowCount, 0);
      await denied(() => act('check_out', sessionId, 'A valid report from another tenant', orgBId));
    });
    await as(null, () => denied(() => act('check_in')));
  });
  await check('CLOCK-07', 'Breaks count once and completed work minutes come from the server', async () => {
    await client.query("UPDATE public.staff_clock_sessions SET checked_in_at=clock_timestamp()-interval '2 hours' WHERE id=$1", [sessionId]);
    await as(salesAId, () => act('start_break', sessionId));
    await client.query("UPDATE public.staff_clock_sessions SET break_started_at=clock_timestamp()-interval '10 minutes' WHERE id=$1", [sessionId]);
    await as(salesAId, async () => {
      await act('end_break', sessionId);
      await act('end_break', sessionId);
      await denied(() => act('check_out', sessionId, 'short'));
      const summary = 'Completed receiving and reconciled supplier stock today.';
      await act('check_out', sessionId, summary);
      await act('check_out', sessionId, summary);
      const row = (await client.query('SELECT * FROM public.staff_clock_log WHERE id=$1', [sessionId])).rows[0];
      assert.equal(row.break_seconds, '600');
      assert.equal(row.worked_minutes, 110);
      assert.equal(row.work_summary, summary);
    });
  });
  await check('CLOCK-08', 'Monthly reports preserve totals and completed shifts do not reopen', async () => {
    await as(salesAId, async () => {
      const repeated = (await act('check_in')).rows[0];
      assert.equal(repeated.id, sessionId); assert.ok(repeated.checked_out_at);
      const summary = (await client.query("SELECT * FROM public.staff_clock_month_summary($1,(now() AT TIME ZONE 'Asia/Kolkata')::date,NULL)", [orgAId])).rows[0];
      assert.equal(Number(summary.recorded_shifts), 1); assert.equal(Number(summary.worked_minutes), 110);
    });
    await as(ownerAId, async () => {
      assert.equal((await client.query('SELECT * FROM public.staff_clock_log WHERE id=$1', [sessionId])).rowCount, 1);
      await client.query('SELECT public.link_staff_employee($1,$2,$3,false)', [orgAId, staffId, salesAId]);
    });
    await as(salesAId, () => denied(() => act('check_in')));
  });
  } finally {
    await client.query('UPDATE public.memberships SET role=$3 WHERE organization_id=$1 AND user_id=$2', [orgAId,salesAId,originalRole]);
  }
}
