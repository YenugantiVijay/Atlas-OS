import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function runEcommercePlatformAdminAcceptance({ client, withRoleContext, recordTest }) {
  const [owner, reviewer, outsider, sales] = Array.from({ length: 4 }, () => randomUUID());
  const [customer, product] = [randomUUID(), randomUUID()];
  const asUser = (userId, operation) => withRoleContext(client, { userId, role: userId ? 'authenticated' : 'anon' }, operation);
  const check = async (id, name, verify) => {
    try {
      await verify();
      recordTest(id, name, true);
    } catch (error) {
      recordTest(id, name, false, null, error);
    }
  };
  const setupWorkspace = async (name, lines, userId = owner) => asUser(userId, async () => {
    const { rows } = await client.query(`SELECT public.create_organization_v2(
      p_name := $1, p_pan := 'BCTPK4567L', p_business_category := 'ecommerce',
      p_sells_electrical_products := false, p_product_lines := $2, p_idempotency_key := $3
    ) AS org`, [name, lines, randomUUID()]);
    return rows[0].org;
  });

  await client.query(`INSERT INTO auth.users (id,email)
    SELECT id, id::text || '@example.test' FROM unnest($1::uuid[]) id`, [[owner, reviewer, outsider, sales]]);
  const shop = await setupWorkspace('E-commerce Acceptance Shop', ['Home accessories']);
  const pending = await setupWorkspace('E-commerce Review Queue', []);
  const secondShop = await setupWorkspace('Separate Online Shop', ['Home accessories'], outsider);

  await check('PLATFORM-01', 'Online setup gets an eligible trial and ordinary roles cannot access the platform directory', async () => {
    assert.equal(shop.eligibility_status, 'approved');
    assert.equal(shop.trial_initialized, true);
    assert.equal(pending.eligibility_status, 'review_required');
    for (const caller of [owner, outsider, null]) {
      await assert.rejects(asUser(caller, () => client.query(
        "SELECT * FROM public.platform_workspace_page('all', '', 0)")), { code: '42501' });
    }
  });

  await client.query('INSERT INTO public.platform_reviewers(user_id) VALUES ($1)', [reviewer]);
  await check('PLATFORM-02', 'Active reviewers can see the limited directory and record an audited decision with stale-decision protection', async () => {
    const { rows: [entry] } = await asUser(reviewer, () => client.query(
      "SELECT *, declaration_updated_at::text AS version FROM public.platform_workspace_page('review_required', 'E-commerce Review Queue', 0)"));
    assert.equal(entry.id, pending.id);
    assert.equal(entry.business_category, 'ecommerce');
    assert.equal(entry.identity_present, true);
    for (const field of ['gstin', 'pan', 'email', 'phone', 'customer_id']) assert.equal(field in entry, false);
    const decide = userId => asUser(userId, () => client.query(
      "SELECT public.platform_review_workspace($1, $2, 'approved', 'Verified the business details')",
      [entry.id, entry.version]));
    await assert.rejects(decide(owner), { code: '42501' });
    await decide(reviewer);
    await assert.rejects(decide(reviewer), { code: '40001' });
    const { rows: [audit] } = await client.query(`SELECT count(*)::int AS count FROM public.eligibility_audit_logs
      WHERE organization_id = $1 AND actor_id = $2 AND action_type = 'MANUAL_REVIEW_DECISION'`, [pending.id, reviewer]);
    assert.equal(audit.count, 1);
    await client.query('UPDATE public.platform_reviewers SET is_active=false WHERE user_id=$1', [reviewer]);
    await assert.rejects(asUser(reviewer, () => client.query(
      "SELECT * FROM public.platform_workspace_page('all', '', 0)")), { code: '42501' });
  });

  await client.query("INSERT INTO public.memberships(organization_id,user_id,role) VALUES($1,$2,'sales')", [shop.id, sales]);
  await client.query("INSERT INTO public.customers(id,organization_id,name) VALUES($1,$2,'Online Buyer')", [customer, shop.id]);
  await client.query(`INSERT INTO public.products(id,organization_id,sku,name,category,uom,purchase_cost,selling_price,tax_rate)
    VALUES($1,$2,'WEB-TEST','Desk organiser','General','Nos',20,30,18)`, [product, shop.id]);
  await client.query(`INSERT INTO public.stock_movements(organization_id,product_id,quantity_change,movement_type)
    VALUES($1,$2,12,'OPENING_STOCK')`, [shop.id, product]);
  const makeOrder = async (actor, channel, reference, key) => asUser(actor, async () => {
    const items = JSON.stringify([{ productId: product, quantity: 2, unitPrice: 30, taxRate: 18, discountPercent: 0 }]);
    const { rows: [result] } = await client.query(`SELECT public.create_online_sales_order(
      $1, $2, CURRENT_DATE, $3, 'Test delivery', $4, $5, $6) AS order`, [shop.id, customer, items, key, channel, reference]);
    return result.order;
  });
  const key = randomUUID();
  let order;
  await check('ECOM-01', 'Online order creation is atomic, tenant scoped, and unique per channel and reference', async () => {
    order = await makeOrder(sales, 'storefront', ' WEB-1042 ', key);
    assert.equal(order.online_reference, 'WEB-1042');
    assert.equal((await makeOrder(sales, 'storefront', 'WEB-1042', key)).id, order.id);
    await assert.rejects(makeOrder(sales, 'storefront', 'DIFFERENT', key), { code: '22023' });
    await assert.rejects(makeOrder(sales, 'storefront', 'web-1042', randomUUID()), { code: '23505' });
    await assert.rejects(makeOrder(outsider, 'storefront', 'WEB-9999', randomUUID()), { code: '42501' });
    const marketplace = await makeOrder(sales, 'marketplace', 'WEB-1042', randomUUID());
    assert.notEqual(marketplace.id, order.id);
    const { rows: [result] } = await client.query(
      'SELECT count(*)::int AS count FROM public.sales_orders WHERE organization_id=$1', [shop.id]);
    assert.equal(result.count, 2);
  });

  await check('ECOM-02', 'Dispatch needs confirmation, stays tenant scoped and preserves stock and invoicing', async () => {
    assert.ok(order?.id);
    const save = async (actor, orgId, carrier, tracking, expected = null) => asUser(actor, async () => {
      const { rows: [result] } = await client.query('SELECT public.record_online_dispatch($1,$2,$3,$4,$5) AS dispatch',
        [orgId, order.id, carrier, tracking, expected]);
      return result.dispatch;
    });
    await assert.rejects(save(sales, shop.id, 'Courier', 'AWB-001'), { code: '22023' });
    await asUser(sales, () => client.query('SELECT public.confirm_sales_order($1,$2)', [order.id, shop.id]));
    await assert.rejects(save(outsider, shop.id, 'Other', 'BAD'), { code: '42501' });
    await assert.rejects(save(outsider, secondShop.id, 'Other', 'BAD'), { code: '22023' });
    const dispatch = await save(sales, shop.id, 'Courier', 'AWB-001');
    assert.deepEqual(await save(sales, shop.id, 'Courier', 'AWB-001'), dispatch);
    await assert.rejects(save(sales, shop.id, 'Courier', 'AWB-002'), { code: '40001' });
    await save(sales, shop.id, 'Courier', 'AWB-002', dispatch.recordedAt);
    const { rows: [{ invoice }] } = await asUser(owner, () => client.query(`SELECT public.create_invoice_atomic(
      p_org_id := $1, p_customer_id := $2, p_items := $3, p_status := 'ISSUED',
      p_idempotency_key := $4, p_sales_order_id := $5) AS invoice`, [
      shop.id, customer, JSON.stringify([{ productId: product, quantity: 2, unitPrice: 30, taxRate: 18, discountPercent: 0 }]),
      randomUUID(), order.id,
    ]));
    assert.equal(invoice.total_amount, 70.8);
    const { rows: [result] } = await client.query(`SELECT
      (SELECT sum(quantity_change)::int FROM public.stock_movements WHERE organization_id=$1 AND product_id=$2) AS stock,
      (SELECT status FROM public.sales_orders WHERE id=$3) AS status,
      (SELECT dispatch_tracking FROM public.sales_orders WHERE id=$3) AS tracking,
      (SELECT count(*)::int FROM public.audit_events WHERE organization_id=$1 AND entity_id=$3
        AND action='ONLINE_ORDER_DISPATCH_RECORDED') AS dispatches`, [shop.id, product, order.id]);
    assert.deepEqual(result, { stock: 10, status: 'FULFILLED', tracking: 'AWB-002', dispatches: 2 });
  });
}
