import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function runIndustryReceiptsAcceptance({ client, withRoleContext, recordTest }) {
  const ownerId = randomUUID();
  const outsiderId = randomUUID();
  const salesId = randomUUID();
  const accountsId = randomUUID();
  const reviewerId = randomUUID();
  const customerId = randomUUID();
  const asUser = (userId, test) => withRoleContext(client, { userId }, test);
  const check = async (id, name, test) => {
    try {
      await test();
      recordTest(id, name, true);
    } catch (error) {
      recordTest(id, name, false, null, error);
    }
  };
  const createOrg = async (name, category, lines, userId = ownerId) => asUser(userId, async () => {
    const { rows } = await client.query(`SELECT public.create_organization_v2(
      p_name := $1, p_pan := 'BCTPK4567L', p_business_category := $2,
      p_sells_electrical_products := false, p_product_lines := $3,
      p_idempotency_key := $4
    ) AS org`, [name, category, lines, randomUUID()]);
    return rows[0].org;
  });

  await client.query(`INSERT INTO auth.users (id, email) VALUES
    ($1, 'receipt-owner@example.test'), ($2, 'receipt-outsider@example.test'), ($3, 'receipt-sales@example.test'),
    ($4, 'receipt-accounts@example.test'), ($5, 'trade-reviewer@example.test')`,
  [ownerId, outsiderId, salesId, accountsId, reviewerId]);

  const agri = await createOrg('Agri Input Merchant', 'agricultural_inputs', ['Fertilizers']);
  const shop = await createOrg('General Shop', 'general_retail', ['Stationery'], outsiderId);
  await check('TRADE-01', 'Agri-input and general retail signup activate the existing trial', async () => {
    for (const org of [agri, shop]) {
      assert.equal(org.eligibility_status, 'approved');
      assert.equal(org.trial_initialized, true);
      assert.equal(org.sells_electrical_products, false);
    }
  });
  await check('TRADE-02', 'General trade still requires identity and a product declaration', async () => {
    const incomplete = await createOrg('Incomplete General Wholesaler', 'general_wholesale', []);
    assert.equal(incomplete.eligibility_status, 'review_required');
    assert.equal(incomplete.trial_initialized, false);
    const electrical = await createOrg('Incorrect Electrical Declaration', 'electrical_retail', ['Wires']);
    assert.equal(electrical.eligibility_status, 'rejected');
    await asUser(ownerId, () => assert.rejects(client.query(`SELECT public.create_organization_v2(
      p_name := 'Unverified Shop', p_business_category := 'general_retail',
      p_sells_electrical_products := false, p_product_lines := ARRAY['General Merchandise']
    )`), /ERR_PAN_REQUIRED/));
  });
  await check('TRADE-03', 'Platform reviewers can approve a non-electrical agri-input declaration', async () => {
    const pending = await createOrg('Agri Input Review', 'agricultural_inputs', []);
    assert.equal(pending.eligibility_status, 'review_required');
    await client.query('INSERT INTO public.platform_reviewers (user_id) VALUES ($1)', [reviewerId]);
    await asUser(reviewerId, async () => {
      const { rows } = await client.query(`SELECT public.review_organization_eligibility(
        $1, 'approved', NULL, 'Verified the declaration with the merchant.'
      ) AS decision`, [pending.id]);
      assert.equal(rows[0].decision.status, 'approved');
    });
  });
  if (!agri.id || !shop.id || agri.eligibility_status !== 'approved') return;

  await client.query(`INSERT INTO public.memberships (organization_id, user_id, role, is_active)
    VALUES ($1, $2, 'sales', true), ($1, $3, 'accounts', true)`, [agri.id, salesId, accountsId]);
  await client.query(`INSERT INTO public.customers (id, organization_id, name, company_name, is_active)
    VALUES ($1, $2, 'Test Buyer', 'Grower Supply', true)`, [customerId, agri.id]);
  const { rows: [{ day, previous_day: previousDay }] } = await client.query(`SELECT
    current_date::text AS day, (current_date - 1)::text AS previous_day`);
  const record = async (amount, method, date, key) => {
    const { rows } = await client.query(`SELECT public.record_payment_and_allocate(
      $1, $2, $3, $4, 'RECEIPT-TEST', $5, NULL, NULL, NULL, $6
    ) AS payment`, [agri.id, customerId, amount, method, date, key]);
    return rows[0].payment;
  };
  const cash = await asUser(ownerId, async () => {
    const key = randomUUID();
    const first = await record('100.10', 'CASH', day, key);
    const replay = await record('100.10', 'CASH', day, key);
    assert.equal(replay.payment_id, first.payment_id);
    await record('0.20', 'CASH', day, randomUUID());
    await record('50.00', 'UPI', day, randomUUID());
    await record('120.00', 'CASH', previousDay, randomUUID());
    return first;
  });
  const receipt = async (orgId = agri.id) => {
    const { rows } = await client.query('SELECT public.get_payment_receipt_print_data($1, $2) AS receipt', [orgId, cash.payment_id]);
    return rows[0].receipt;
  };
  const totals = () => client.query('SELECT * FROM public.get_daily_payment_receipt_totals($1, $2)', [agri.id, day]);

  await check('RECEIPT-01', 'Recorded receipt uses trusted payment and organization branding', async () => {
    await asUser(ownerId, async () => {
      const { rowCount } = await client.query(`UPDATE public.organizations SET
        receipt_template = 'compact', receipt_message = 'Thank you for shopping.',
        logo_url = 'https://example.test/logo.png' WHERE id = $1`, [agri.id]);
      assert.equal(rowCount, 1);
      const print = await receipt();
      assert.equal(print.number, cash.payment_number);
      assert.equal(print.amount, 100.1);
      assert.equal(print.customer, 'Grower Supply');
      assert.equal(print.template, 'compact');
      assert.equal(print.message, 'Thank you for shopping.');
      assert.equal(print.logoUrl, 'https://example.test/logo.png');
      assert.equal(print.counterCopyAllowed, false);
      await assert.rejects(client.query('UPDATE public.organizations SET receipt_message = repeat(\'x\', 161) WHERE id = $1', [agri.id]), { code: '23514' });
    });
  });

  await check('RECEIPT-02', 'Edition controls double copies and totals count each recorded payment once', async () => {
    for (const [plan, daysRemaining, expected] of [
      ['starter', 1, false], ['professional', 1, true], ['enterprise_network', 1, true], ['professional', -1, false],
    ]) {
      await client.query(`UPDATE public.organization_subscriptions SET
        plan_tier = $2, status = 'active', current_period_starts_at = now() - interval '7 days',
        current_period_ends_at = now() + make_interval(days => $3), grace_period_ends_at = NULL
        WHERE organization_id = $1`, [agri.id, plan, daysRemaining]);
      assert.equal((await asUser(ownerId, receipt)).counterCopyAllowed, expected, plan);
    }
    assert.equal((await asUser(accountsId, receipt)).number, cash.payment_number);
    const { rows } = await asUser(accountsId, totals);
    assert.deepEqual(rows, [
      { payment_method: 'CASH', receipt_count: '2', total: '100.30' },
      { payment_method: 'UPI', receipt_count: '1', total: '50.00' },
    ]);
  });

  await check('RECEIPT-03', 'Receipt and totals reject sales staff, anonymous callers, and other organizations', async () => {
    for (const userId of [salesId, outsiderId]) {
      await asUser(userId, async () => {
        await assert.rejects(receipt(), { code: '42501' });
        await assert.rejects(totals(), { code: '42501' });
      });
    }
    await asUser(outsiderId, () => assert.rejects(receipt(shop.id), { code: '22023' }));
    await withRoleContext(client, { role: 'anon' }, () => assert.rejects(receipt(), { code: '42501' }));
    await asUser(ownerId, () => assert.rejects(client.query(`UPDATE public.organization_subscriptions
      SET plan_tier = 'enterprise_network' WHERE organization_id = $1`, [agri.id]), { code: '42501' }));
  });
}
