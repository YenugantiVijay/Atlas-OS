import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function runStaffPaySetupAcceptance({
  client, withRoleContext, recordTest, orgAId, orgBId, ownerAId, ownerBId, salesAId,
}) {
  const studio = randomUUID();
  const stall = randomUUID();
  const foreignLocation = randomUUID();
  const worker = randomUUID();
  const invalidWorker = randomUUID();
  const as = (userId, fn) => withRoleContext(client, { userId, role: userId ? 'authenticated' : 'anon' }, fn);
  const addLocation = (id, org, name) => client.query(
    'INSERT INTO public.staff_locations (id, organization_id, name) VALUES ($1, $2, $3)',
    [id, org, name],
  );
  const addEmployee = (id, locations) => client.query(
    "SELECT public.add_staff_profile($1, $2, 'Employee One', DATE '2026-11-15', $3)",
    [orgAId, id, locations],
  );
  const addRate = (date, basis, paise) => client.query(`
    INSERT INTO public.staff_pay_rates(organization_id,staff_id,joining_on,effective_on,basis,amount_paise)
    VALUES ($1,$2,DATE '2026-11-15',$3,$4,$5)`, [orgAId, worker, date, basis, paise]);
  async function check(id, label, fn) {
    try {
      await fn();
      recordTest(id, label, true);
    } catch (error) {
      recordTest(id, label, false, null, error);
    }
  }

  await check('STAFF-01', 'Owner registers a studio employee, retries safely and assigns a stall', async () => {
    await as(ownerAId, () => addLocation(studio, orgAId, 'Print studio'));
    await as(ownerAId, () => addLocation(stall, orgAId, 'Ice cream stall'));
    await as(ownerAId, () => addEmployee(worker, [studio]));
    await as(ownerAId, () => addEmployee(worker, [studio]));
    const initial = await as(ownerAId, () => client.query(
      'SELECT location_id FROM public.staff_location_assignments WHERE staff_id=$1', [worker],
    ));
    assert.deepEqual(initial.rows, [{ location_id: studio }]);
    await as(ownerAId, () => client.query(`
      INSERT INTO public.staff_location_assignments (organization_id, staff_id, location_id)
      VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [orgAId, worker, stall]));
    const visible = await as(ownerAId, () => client.query(
      'SELECT location_id FROM public.staff_location_assignments WHERE staff_id=$1', [worker],
    ));
    assert.deepEqual(new Set(visible.rows.map(r => r.location_id)), new Set([studio, stall]));
  });

  await check('STAFF-02', 'Salary rates retain exact minor units, history and recording identity', async () => {
    await as(ownerAId, () => addRate('2026-11-15', 'monthly', 1500000));
    await as(ownerAId, () => addRate('2027-01-01', 'daily', 50025));
    const history = await as(ownerAId, () => client.query(
      'SELECT basis,amount_paise,recorded_by FROM public.staff_pay_rates WHERE staff_id=$1 ORDER BY effective_on', [worker],
    ));
    assert.deepEqual(history.rows, [
      { basis: 'monthly', amount_paise: '1500000', recorded_by: ownerAId },
      { basis: 'daily', amount_paise: '50025', recorded_by: ownerAId },
    ]);
    await assert.rejects(as(ownerAId, () => addRate('2026-11-14', 'hourly', 20000)), { code: '23514' });
    await assert.rejects(as(ownerAId, () => addRate('2027-01-01', 'hourly', 20000)), { code: '23505' });
    await assert.rejects(as(ownerAId, () => client.query(
      'UPDATE public.staff_pay_rates SET amount_paise=1 WHERE staff_id=$1', [worker],
    )), { code: '42501' });
  });

  await check('STAFF-03', 'Staff setup protects pay records and rolls back a profile with an out-of-tenant location', async () => {
    await as(ownerBId, () => addLocation(foreignLocation, orgBId, 'Independent business'));
    await assert.rejects(as(ownerAId, () => addEmployee(invalidWorker, [studio, foreignLocation])), { code: '22023' });
    const invalid = await client.query('SELECT id FROM public.staff_profiles WHERE id=$1', [invalidWorker]);
    assert.equal(invalid.rowCount, 0);
    for (const user of [salesAId, ownerBId]) {
      const pay = await as(user, () => client.query(
        'SELECT amount_paise FROM public.staff_pay_rates WHERE staff_id=$1', [worker],
      ));
      assert.equal(pay.rowCount, 0);
      await assert.rejects(as(user, () => addEmployee(randomUUID(), [studio])), { code: '42501' });
      await assert.rejects(as(user, () => addRate('2027-02-01', 'monthly', 1)), { code: '42501' });
    }
    await assert.rejects(as(null, () => client.query('SELECT * FROM public.staff_pay_rates')), { code: '42501' });
  });
}
