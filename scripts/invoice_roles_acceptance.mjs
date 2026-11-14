import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function runInvoiceRolesAcceptance({
  client, withRoleContext, recordTest, orgAId, orgBId, ownerAId, ownerBId, custAId, custBId, productAId, productBId, salesAId,
}) {
  const accountsId = randomUUID();
  const inventoryId = randomUUID();
  const viewerId = randomUUID();
  const adminId = randomUUID();
  const inactiveId = randomUUID();
  const invoiceKey = randomUUID();
  const lines = (productId) => JSON.stringify([{
    productId, quantity: 2, unitPrice: 30, taxRate: 18, discountPercent: 0,
  }]);
  const createInvoice = async (userId, status, key, org = orgAId, customer = custAId, product = productAId, order = null) =>
    withRoleContext(client, { userId, role: userId ? 'authenticated' : 'anon' }, async () =>
      (await client.query(`SELECT public.create_invoice_atomic(
        p_org_id := $1, p_customer_id := $2, p_items := $3, p_status := $4,
        p_idempotency_key := $5, p_sales_order_id := $6
      ) AS invoice`, [org, customer, lines(product), status, key, order])).rows[0].invoice);

  async function check(id, label, run) {
    try {
      await run();
      recordTest(id, label, true);
    } catch (error) {
      recordTest(id, label, false, null, error);
    }
  }

  // Keep fixtures independent of the rest of the database suite. Expected denials
  // are handled in an autocommit session by withRoleContext.
  const orgId = await withRoleContext(client, { userId: ownerAId }, async () => {
    const { rows } = await client.query(`SELECT public.create_organization_v2(
      p_name := 'Invoice Role Acceptance', p_pan := 'BCTPK4567L',
      p_business_category := 'general_retail', p_sells_electrical_products := false,
      p_product_lines := ARRAY['Test supplies'], p_idempotency_key := $1
    ) AS result`, [randomUUID()]);
    return rows[0].result.id;
  });
  const customerId = randomUUID();
  const productId = randomUUID();
  const members = [accountsId, inventoryId, viewerId, adminId, inactiveId];
  await client.query(`INSERT INTO auth.users (id,email)
    SELECT user_id, user_id::text || '@example.test' FROM unnest($1::uuid[]) AS user_id`, [members]);
  await client.query(`INSERT INTO public.memberships (organization_id,user_id,role,is_active)
    VALUES ($1,$2,'accounts',true),($1,$3,'inventory',true),($1,$4,'viewer',true),
           ($1,$5,'admin',true),($1,$6,'accounts',false),($1,$7,'sales',true)`,
  [orgId, ...members, salesAId]);
  await client.query(`INSERT INTO public.customers(id,organization_id,name) VALUES($1,$2,'Invoice Test Buyer')`, [customerId, orgId]);
  await client.query(`INSERT INTO public.products(id,organization_id,sku,name,category,uom,purchase_cost,selling_price,tax_rate)
    VALUES($1,$2,'INV-ROLE','Invoice Test Product','General','Nos',20,30,18)`, [productId, orgId]);
  await client.query(`INSERT INTO public.stock_movements(organization_id,product_id,quantity_change,movement_type)
    VALUES($1,$2,12,'OPENING_STOCK')`, [orgId, productId]);

  await check('INV-ROLE-01', 'Accounts drafts invoices and issues confirmed orders with idempotent replay', async () => {
    const draft = await createInvoice(accountsId, 'DRAFT', randomUUID(), orgId, customerId, productId);
    assert.equal(draft.status, 'DRAFT');
    const order = await withRoleContext(client, { userId: salesAId }, async () => {
      const { rows } = await client.query(`SELECT public.create_sales_order_atomic(
        p_org_id := $1, p_customer_id := $2, p_items := $3, p_idempotency_key := $4
      ) AS result`, [orgId, customerId, lines(productId), randomUUID()]);
      return rows[0].result;
    });
    await withRoleContext(client, { userId: salesAId }, () =>
      client.query('SELECT public.confirm_sales_order($1,$2)', [order.id, orgId]));

    const issued = await createInvoice(accountsId, 'ISSUED', invoiceKey, orgId, customerId, productId, order.id);
    const replay = await createInvoice(accountsId, 'ISSUED', invoiceKey, orgId, customerId, productId, order.id);
    assert.equal(issued.status, 'ISSUED');
    assert.equal(issued.total_amount, 70.8);
    assert.equal(replay.id, issued.id);
    assert.equal(replay.idempotent_replay, true);
    const { rows: [posted] } = await client.query(`SELECT
      (SELECT count(*)::int FROM public.invoices WHERE sales_order_id=$1) AS invoices,
      (SELECT status FROM public.sales_orders WHERE id=$1) AS order_status,
      (SELECT sum(quantity_change)::int FROM public.stock_movements WHERE organization_id=$2 AND product_id=$3) AS stock`,
    [order.id, orgId, productId]);
    assert.deepEqual(posted, { invoices: 1, order_status: 'FULFILLED', stock: 10 });
  });

  await check('INV-ROLE-02', 'Sales, inventory, viewer, inactive and anonymous callers cannot draft or issue invoices', async () => {
    for (const userId of [salesAId, inventoryId, viewerId, inactiveId, null]) {
      for (const status of ['DRAFT', 'ISSUED']) {
        await assert.rejects(createInvoice(userId, status, invoiceKey, orgId, customerId, productId), { code: '42501' });
      }
    }
  });

  await check('INV-ROLE-03', 'Invoice creation denies callers across organizations', async () => {
    await assert.rejects(createInvoice(accountsId, 'ISSUED', randomUUID(), orgBId, custBId, productBId), { code: '42501' });
    await assert.rejects(createInvoice(ownerBId, 'ISSUED', randomUUID(), orgAId, custAId, productAId), { code: '42501' });
  });

  await check('INV-ROLE-04', 'Owner and administrator retain invoice creation', async () => {
    for (const userId of [ownerAId, adminId]) {
      const invoice = await createInvoice(userId, 'ISSUED', randomUUID(), orgId, customerId, productId);
      assert.equal(invoice.status, 'ISSUED');
      assert.ok(invoice.invoice_number);
    }
  });
}
