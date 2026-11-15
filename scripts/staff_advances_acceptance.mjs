import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function runStaffAdvancesAcceptance({ client, withRoleContext, recordTest, orgAId, orgBId, ownerAId, ownerBId, salesAId }) {
  const staff = randomUUID();
  const newHire = randomUUID();
  const location = randomUUID();
  const small = randomUUID();
  const large = randomUUID();
  const directOnly = randomUUID();
  const january = '2026-01-01';
  const february = '2026-02-01';
  const march = '2026-03-01';
  const as = (userId, fn) => withRoleContext(client, { userId, role: userId ? 'authenticated' : 'anon' }, fn);
  const owner = fn => as(ownerAId, fn);
  const one = async (sql, params) => (await client.query(sql, params)).rows[0].result;
  const issue = (id, issued, amount, firstMonth, installment, employee = staff) => one(
    'SELECT public.record_staff_advance($1,$2,$3,$4,$5,$6,$7,\'cash\',\'Agreed staff advance\') AS result',
    [orgAId, employee, id, issued, amount, firstMonth, installment],
  );
  const repay = (advance, id, receivedOn, amount) => one(
    'SELECT public.record_staff_advance_repayment($1,$2,$3,$4,$5,$6,\'upi\',\'Direct repayment\') AS result',
    [orgAId, staff, advance, id, receivedOn, amount],
  );
  const preview = period => one('SELECT public.preview_staff_payday($1,$2,$3) AS result', [orgAId, staff, period]);
  const post = (id, period, snapshot, deductions, { wages = 1500000, other = 0, limit = null } = {}) => one(
    'SELECT public.post_staff_payday($1,$2,$3,$4,1500000,$5,$6,$7,\'bank\',$8,$9) AS result',
    [orgAId, staff, id, period, wages, other, limit, snapshot, JSON.stringify(deductions)],
  );
  const payRecord = id => client.query(
    'SELECT period::text,advance_deductions_paise,net_paise FROM public.staff_paydays WHERE id=$1', [id],
  ).then(result => result.rows[0]);
  const balance = id => client.query('SELECT balance_paise FROM public.staff_advance_balances WHERE id=$1', [id])
    .then(result => result.rows[0]?.balance_paise);
  async function check(id, title, fn) {
    try {
      await fn();
      recordTest(id, title, true);
    } catch (error) {
      recordTest(id, title, false, null, error);
    }
  }

  await owner(() => client.query("INSERT INTO public.staff_locations(id,organization_id,name) VALUES ($1,$2,'Advance test studio')", [location, orgAId]));
  await owner(() => client.query("SELECT public.add_staff_profile($1,$2,'Advance test staff','2025-01-01',ARRAY[$3]::uuid[])", [orgAId, staff, location]));
  await owner(() => client.query("SELECT public.add_staff_profile($1,$2,'Pre-joining advance staff','2026-01-12',ARRAY[$3]::uuid[])", [orgAId, newHire, location]));
  await owner(() => client.query(`INSERT INTO public.staff_pay_rates(organization_id,staff_id,joining_on,effective_on,basis,amount_paise)
    VALUES ($1,$2,'2025-01-01','2026-01-01','monthly',1500000)`, [orgAId, staff]));

  await check('ADVANCE-01', 'Same-day, monthly and pre-joining advance entries retain exact schedules and are private', async () => {
    await assert.rejects(as(salesAId, () => issue(small, '2026-01-15', 30000, january, 30000)), { code: '42501' });
    await assert.rejects(as(ownerBId, () => preview(january)), { code: '42501' });
    assert.equal(await owner(() => issue(small, '2026-01-15', 30000, january, 30000)), small);
    assert.equal(await owner(() => issue(small, '2026-01-15', 30000, january, 30000)), small);
    await assert.rejects(owner(() => issue(small, '2026-01-15', 50000, january, 50000)), { code: '23505' });
    await owner(() => issue(large, '2026-01-20', 1000000, february, 250000));
    await owner(() => issue(directOnly, '2026-01-20', 15000, null, 0));
    const preJoinId = randomUUID();
    await assert.rejects(owner(() => issue(preJoinId, '2026-01-04', 1000000, january, 250000, newHire)), { code: '22023' });
    assert.equal(await owner(() => issue(preJoinId, '2026-01-04', 1000000, february, 250000, newHire)), preJoinId);
    assert.equal(await as(salesAId, () => balance(small)), undefined);
    await assert.rejects(as(null, () => balance(small)), { code: '42501' });
  });

  await check('ADVANCE-02', 'A direct repayment reduces the next deduction and the posted balance is exact', async () => {
    const payment = randomUUID();
    await owner(() => repay(small, payment, '2026-01-18', 10000));
    await owner(() => repay(small, payment, '2026-01-18', 10000));
    await assert.rejects(owner(() => repay(small, randomUUID(), '2026-01-18', 20001)), { code: '23514' });
    const draft = await owner(() => preview(january));
    assert.equal(draft.rate.amount_paise, 1500000);
    assert.deepEqual(draft.lines.map(line => [line.id, line.scheduled_paise]), [[small, 20000]]);
    const payId = randomUUID();
    const parts = [{ id: small, amount_paise: 20000 }];
    const amounts = { other: 100000 };
    assert.equal(await owner(() => post(payId, january, draft.snapshot, parts, amounts)), payId);
    assert.equal(await owner(() => post(payId, january, draft.snapshot, parts, amounts)), payId);
    assert.deepEqual(await owner(() => payRecord(payId)), {
      period: january, advance_deductions_paise: '20000', net_paise: '1380000',
    });
    assert.equal(await owner(() => balance(small)), '0');
    await assert.rejects(owner(() => post(randomUUID(), january, draft.snapshot, parts, amounts)), { code: '23505' });
  });

  await check('ADVANCE-03', 'Owner can skip a month, catch up later, and cannot exceed current due or wage limits', async () => {
    const skipped = await owner(() => preview(february));
    const skipId = randomUUID();
    assert.deepEqual(skipped.lines.map(line => [line.id, line.scheduled_paise]), [[large, 250000]]);
    await owner(() => post(skipId, february, skipped.snapshot, []));
    assert.equal((await owner(() => payRecord(skipId))).net_paise, '1500000');
    const beforeRepayment = await owner(() => preview(march));
    assert.equal(beforeRepayment.lines[0].scheduled_paise, 250000);
    assert.equal(beforeRepayment.lines[0].catchup_paise, 500000);
    await owner(() => repay(large, randomUUID(), '2026-02-27', 50000));
    const payId = randomUUID();
    await assert.rejects(owner(() => post(payId, march, beforeRepayment.snapshot, [])), { code: '40001' });
    const adjusted = await owner(() => preview(march));
    assert.equal(adjusted.lines[0].catchup_paise, 450000);
    const parts = [{ id: large, amount_paise: 450000 }];
    await assert.rejects(owner(() => post(payId, march, adjusted.snapshot, parts, { wages: 800000, other: 100000 })), { code: '23514' });
    await assert.rejects(owner(() => post(payId, march, adjusted.snapshot, parts, { limit: 400000 })), { code: '23514' });
    await assert.rejects(owner(() => post(payId, march, adjusted.snapshot, [{ id: large, amount_paise: 450001 }])), { code: '23514' });
    assert.equal(await owner(() => payRecord(payId)), undefined);
    await owner(() => post(payId, march, adjusted.snapshot, parts, { other: 100000 }));
    assert.deepEqual(await owner(() => payRecord(payId)), {
      period: march, advance_deductions_paise: '450000', net_paise: '950000',
    });
    assert.equal(await owner(() => balance(large)), '500000');
    assert.equal(await owner(() => balance(directOnly)), '15000');
  });

  await check('ADVANCE-04', 'Membership gates apply to repayment, posting and pay history', async () => {
    await assert.rejects(as(salesAId, () => repay(large, randomUUID(), '2026-03-10', 10000)), { code: '42501' });
    await assert.rejects(as(ownerBId, () => post(randomUUID(), march, 'other', [])), { code: '42501' });
    await assert.rejects(owner(() => client.query("UPDATE public.staff_advances SET amount_paise=1 WHERE id=$1", [large])), { code: '42501' });
    const foreign = await as(ownerAId, () => one(
      "SELECT public.record_staff_advance($1,$2,$3,'2026-01-15',30000,'2026-01-01',30000,'cash','Other workspace') AS result",
      [orgBId, staff, randomUUID()],
    )).catch(error => error.code);
    assert.equal(foreign, '42501');
  });
}
