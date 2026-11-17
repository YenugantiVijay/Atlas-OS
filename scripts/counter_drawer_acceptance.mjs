import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function runCounterDrawerAcceptance({ client, withRoleContext, recordTest, ownerAId, ownerBId, salesAId }) {
  const org = randomUUID();
  const product = randomUUID();
  const customer = randomUUID();
  const receiver = randomUUID();
  const supplier = randomUUID();
  const receipt = randomUUID();
  const as = (userId, fn) => withRoleContext(client, { userId, role: userId ? 'authenticated' : 'anon' }, fn);
  const asOwner = fn => as(ownerAId, fn);
  const one = async (sql, args) => (await client.query(sql, args)).rows[0].result;
  const checkout = (shift, request, tender = 'CASH', quantity = 1, unitPrice = 100) => one(
    'SELECT public.complete_counter_checkout($1,$2,$3,$4,$5,$6,NULL) AS result',
    [org, shift, request, customer, JSON.stringify([{ productId: product, quantity, unitPrice, discountPercent: 0, taxRate: 18 }]), tender],
  );
  const open = (cash, key = randomUUID()) => one('SELECT public.open_counter_shift($1,$2,$3) AS result', [org, cash, key]);
  const close = (shift, cash) => one('SELECT public.close_counter_shift($1,$2,$3) AS result', [org, shift, cash]);
  const receipts = shift => client.query('SELECT id, amount FROM public.get_counter_shift_receipts($1,$2)', [org, shift]);
  const move = (shift, key, direction, amount) => client.query(
    'SELECT public.record_counter_cash_movement($1,$2,$3,$4,$5,$6)', [org, shift, key, direction, amount, 'Counted drawer adjustment'],
  );
  const counts = () => client.query(`SELECT
    (SELECT count(*)::int FROM public.sales_orders WHERE organization_id=$1) AS orders,
    (SELECT count(*)::int FROM public.invoices WHERE organization_id=$1) AS invoices,
    (SELECT count(*)::int FROM public.payments WHERE organization_id=$1) AS payments,
    (SELECT sum(quantity_change)::int FROM public.stock_movements WHERE organization_id=$1 AND product_id=$2) AS stock`,
  [org, product]).then(result => result.rows[0]);

  await client.query("INSERT INTO public.organizations(id,name) VALUES ($1,'Drawer acceptance business')", [org]);
  await client.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [receiver, receiver + '@example.test']);
  await client.query(`INSERT INTO public.memberships(organization_id,user_id,role)
    VALUES ($1,$2,'owner'),($1,$3,'sales'),($1,$4,'inventory')`, [org, ownerAId, salesAId, receiver]);
  await client.query(`INSERT INTO public.organization_eligibility(organization_id,business_category,sells_electrical_products,status,declared_by)
    VALUES ($1,'general_retail',false,'approved',$2)`, [org, ownerAId]);
  await client.query('INSERT INTO public.organization_subscriptions(organization_id) VALUES ($1)', [org]);
  await client.query("INSERT INTO public.customers(id,organization_id,name) VALUES ($1,$2,'Counter customer')", [customer, org]);
  await client.query(`INSERT INTO public.products(id,organization_id,name,sku,category,uom,purchase_cost,selling_price,tax_rate,is_active)
    VALUES ($1,$2,'Counter product','DRAWER-TEST','General','Nos',50,100,18,true)`, [product, org]);
  await client.query("INSERT INTO public.suppliers(id,organization_id,name) VALUES ($1,$2,'Counter supplier')", [supplier, org]);
  const shift = (await as(salesAId, () => open(500))).id;
  const unrelated = (await client.query(`INSERT INTO public.payments(organization_id,payment_number,customer_id,amount,payment_method)
    VALUES ($1,'SYNTHETIC-WHOLESALE',$2,350,'CASH') RETURNING id`, [org, customer])).rows[0].id;
  const cashRequest = randomUUID();
  let completed;

  async function check(id, name, fn) {
    try {
      await fn();
      recordTest(id, name, true);
    } catch (error) {
      recordTest(id, name, false, null, error);
    }
  }

  await check('DAY-01', 'Inventory staff receive the stock that will be sold and reconciled at the counter', async () => {
    assert.equal((await counts()).stock, null);
    const items = JSON.stringify([{ productId: product, packageCounts: [4, 4], looseUnits: 2, unitCost: 50 }]);
    const draft = await as(receiver, () => one(`SELECT public.save_goods_receipt_draft(
      $1,$2,$3,'PILOT-RECEIVING',CURRENT_DATE,'Delivery for counter checkout',$4) AS result`, [org, receipt, supplier, items]));
    assert.equal(draft.status, 'DRAFT');
    assert.equal((await counts()).stock, null);
    const post = () => one('SELECT public.post_goods_receipt($1,$2) AS result', [org, receipt]);
    const posted = await as(receiver, post);
    assert.equal(posted.status, 'POSTED');
    assert.equal((await as(receiver, post)).idempotent_replay, true);
    assert.equal((await counts()).stock, 10);
  });

  await check('DRAWER-01', 'Drawer receipt reads exclude separate business payments and manual links are closed', async () => {
    assert.equal((await as(salesAId, () => receipts(shift))).rowCount, 0);
    await assert.rejects(as(ownerBId, () => receipts(shift)), { code: '42501' });
    await assert.rejects(as(null, () => receipts(shift)), { code: '42501' });
    await assert.rejects(asOwner(() => client.query(
      'SELECT public.link_counter_shift_payment($1,$2,$3)', [org, shift, unrelated],
    )), { code: '42501' });
    await assert.rejects(as(salesAId, () => checkout(shift, randomUUID())), { code: '42501' });
  });

  await check('DRAWER-02', 'Atomic checkout settles exact payment and retries with one receipt, invoice and stock deduction', async () => {
    completed = await asOwner(() => checkout(shift, cashRequest));
    assert.equal(completed.state, 'COMPLETED', JSON.stringify(completed));
    assert.deepEqual(await asOwner(() => checkout(shift, cashRequest)), completed);
    await assert.rejects(asOwner(() => checkout(shift, cashRequest, 'UPI')), { code: '23505' });
    assert.deepEqual(await counts(), { orders: 1, invoices: 1, payments: 2, stock: 9 });
    assert.deepEqual((await as(salesAId, () => receipts(shift))).rows, [{ id: completed.receiptId, amount: '118.00' }]);
    const invoice = await client.query('SELECT total_amount,total_paid,status FROM public.invoices WHERE id=$1', [completed.invoiceId]);
    assert.deepEqual(invoice.rows, [{ total_amount: '118.00', total_paid: '118.00', status: 'PAID' }]);
  });

  await check('DRAWER-03', 'A rejected checkout rolls back the order and stock and replays the original rejection', async () => {
    const before = await counts();
    const key = randomUUID();
    // A zero-total sale reaches payment validation after order and invoice writes.
    const outcome = await asOwner(() => checkout(shift, key, 'CASH', 1, 0));
    assert.equal(outcome.state, 'REJECTED', JSON.stringify(outcome));
    assert.match(outcome.message, /positive|zero|greater than|amount/i);
    assert.deepEqual(await counts(), before);
    assert.deepEqual(await asOwner(() => checkout(shift, key, 'CASH', 1, 0)), outcome);
  });

  await check('DRAWER-04', 'Closing counts this drawer’s cash receipts and movements to the paise and excludes UPI', async () => {
    const electronic = await asOwner(() => checkout(shift, randomUUID(), 'UPI'));
    assert.equal(electronic.state, 'COMPLETED', JSON.stringify(electronic));
    const cashIn = randomUUID();
    await as(salesAId, () => move(shift, cashIn, 'IN', 10.15));
    await as(salesAId, () => move(shift, cashIn, 'IN', 10.15));
    await assert.rejects(as(salesAId, () => move(shift, cashIn, 'IN', 10.25)), { code: '23505' });
    await as(salesAId, () => move(shift, randomUUID(), 'OUT', 20.25));
    const closed = await as(salesAId, () => close(shift, 607.90));
    assert.equal(closed.expected_cash, 607.90);
    assert.equal(closed.variance, 0);
    assert.deepEqual(await counts(), { orders: 2, invoices: 2, payments: 3, stock: 8 });
    assert.equal((await as(salesAId, () => receipts(shift))).rowCount, 2);
    assert.deepEqual(await asOwner(() => checkout(shift, cashRequest)), completed);
    const rejected = await asOwner(() => checkout(shift, randomUUID()));
    assert.equal(rejected.state, 'REJECTED');
    await assert.rejects(as(salesAId, () => move(shift, randomUUID(), 'OUT', 1)), { code: '23514' });
  });

  await check('DRAWER-05', 'A Sales user cannot access or close someone else’s drawer, including closed-shift retries', async () => {
    const other = (await asOwner(() => open(400))).id;
    const closed = await asOwner(() => close(other, 400));
    assert.equal(closed.variance, 0);
    await assert.rejects(as(salesAId, () => receipts(other)), { code: '42501' });
    await assert.rejects(as(salesAId, () => close(other, 400)), { code: '42501' });
    await assert.rejects(as(salesAId, () => move(other, randomUUID(), 'IN', 1)), { code: '42501' });
  });
}
