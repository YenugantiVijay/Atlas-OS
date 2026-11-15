import { randomUUID } from 'node:crypto';

export async function runPurchaseOrdersAcceptance({
  client, connectPeer, withRoleContext, recordTest, orgAId, orgBId, ownerAId, ownerBId, foreignProductId,
}) {
  const supplierId = randomUUID();
  const foreignSupplierId = randomUUID();
  const productId = randomUUID();
  const inventoryUserId = randomUUID();
  const { rows: [sales] } = await client.query(
    "SELECT user_id FROM public.memberships WHERE organization_id=$1 AND role='sales' LIMIT 1", [orgAId],
  );
  if (!sales) throw new Error('Missing purchase order sales-role fixture');
  await client.query('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [inventoryUserId, inventoryUserId + '@example.test']);
  await client.query("INSERT INTO public.memberships (organization_id, user_id, role) VALUES ($1,$2,'inventory')", [orgAId, inventoryUserId]);
  await client.query(`INSERT INTO public.suppliers (id, organization_id, name, company_name)
    VALUES ($1,$2,'Supplier contact','PO Test Supplier'),($3,$4,'Other workspace supplier',NULL)`,
  [supplierId, orgAId, foreignSupplierId, orgBId]);
  await client.query(`INSERT INTO public.products (id, organization_id, sku, name, category, uom, purchase_cost, selling_price)
    VALUES ($1,$2,'PO-TEST','PO Test Switch','Test','Nos',12,24)`, [productId, orgAId]);

  const line = { productId, uom: 'Nos', quantity: 100, unitCost: 13.25 };
  const id = randomUUID();
  const secondId = randomUUID();
  const as = (userId, fn, db = client) => withRoleContext(db, { role: 'authenticated', userId }, fn);
  const read = async (db, sql, values) => (await db.query(sql, values)).rows[0]?.result;
  const save = (userId, orderId, changes = {}, db = client) => as(userId, () => read(db,
    'SELECT public.save_purchase_order_draft($1,$2,$3,$4,$5,$6,$7::jsonb) AS result',
    [orgAId, orderId, changes.revision ?? null, changes.supplierId ?? supplierId, '2026-12-01',
      changes.notes ?? '  Confirm rate by phone  ', JSON.stringify(changes.lines ?? [line])],
  ), db);
  const order = (userId, orderId, revision, db = client) => as(userId, () => read(db,
    'SELECT public.mark_purchase_order_ordered($1,$2,$3) AS result', [orgAId, orderId, revision],
  ), db);
  const codeOf = async (action) => {
    try { await action(); return null; }
    catch (error) { return error.code; }
  };

  const draft = await save(inventoryUserId, id, { lines: [{ ...line, productName: 'Untrusted name', sku: 'Untrusted SKU' }] });
  const draftReplay = await save(inventoryUserId, id);
  const { rows: [draftEffects] } = await client.query(`SELECT
    (SELECT count(*)::int FROM atlas_private.purchase_order_counters WHERE organization_id=$1) AS counters,
    (SELECT count(*)::int FROM public.audit_events WHERE entity_id=$2) AS events`, [orgAId, id]);
  recordTest('PURCHASE-01', 'Inventory saves one unnumbered draft with server product and supplier snapshots',
    draft?.id === id && draft.status === 'DRAFT' && draft.revision === 1 && draft.order_number === null &&
    draft.supplier_name === 'PO Test Supplier' && draft.notes === 'Confirm rate by phone' &&
    draft.lines[0]?.productName === 'PO Test Switch' && draft.lines[0]?.sku === 'PO-TEST' &&
    draft.lines[0]?.unitCost === 13.25 && draftReplay?.revision === 1 &&
    draftEffects.counters === 0 && draftEffects.events === 0,
    JSON.stringify({ status: draft?.status, revision: draft?.revision, draftEffects }));

  const invalid = [];
  for (const changes of [
    { lines: { productId } }, { lines: [] }, { lines: [line, line] },
    { lines: [{ ...line, quantity: 1.5 }] }, { lines: [{ ...line, quantity: 1_000_001 }] },
    { lines: [{ ...line, unitCost: 12.001 }] }, { lines: [{ ...line, uom: 'Case' }] },
    { lines: [{ ...line, productId: foreignProductId }] }, { supplierId: foreignSupplierId },
  ]) invalid.push(await codeOf(() => save(inventoryUserId, randomUUID(), changes)));
  recordTest('PURCHASE-02', 'Invalid quantities, prices, units and foreign catalog records are rejected',
    invalid.every((code) => code === '22023'), JSON.stringify(invalid));

  const denied = [];
  for (const userId of [ownerBId, sales.user_id]) {
    const visible = await as(userId, () => client.query('SELECT id FROM public.purchase_orders WHERE id=$1', [id]));
    denied.push({ readCount: visible.rowCount, save: await codeOf(() => save(userId, id)), order: await codeOf(() => order(userId, id, 1)) });
  }
  const { rows: [grants] } = await client.query(`SELECT
    has_table_privilege('authenticated','public.purchase_orders','INSERT,UPDATE,DELETE') AS direct_write,
    has_table_privilege('authenticated','atlas_private.purchase_order_counters','SELECT,INSERT,UPDATE,DELETE') AS counter_access,
    has_function_privilege('anon','public.save_purchase_order_draft(uuid,uuid,integer,uuid,date,text,jsonb)','EXECUTE') AS anon_save,
    has_function_privilege('anon','public.mark_purchase_order_ordered(uuid,uuid,integer)','EXECUTE') AS anon_order`);
  recordTest('PURCHASE-03', 'Only the owning workspace and permitted roles can see or act on orders',
    denied.every((attempt) => attempt.readCount === 0 && attempt.save === '42501' && attempt.order === '42501') &&
    Object.values(grants).every((value) => !value), JSON.stringify({ denied, grants }));

  const edited = await save(ownerAId, id, { revision: 1, notes: 'Approved rate' });
  const editReplay = await save(ownerAId, id, { revision: 1, notes: 'Approved rate' });
  const staleSave = await codeOf(() => save(inventoryUserId, id, { revision: 1, notes: 'Stale change' }));
  const staleOrder = await codeOf(() => order(inventoryUserId, id, 1));
  recordTest('PURCHASE-04', 'Revision checks prevent a stale editor from replacing or ordering a newer draft',
    edited?.revision === 2 && editReplay?.revision === 2 && staleSave === '40001' && staleOrder === '40001',
    JSON.stringify({ revision: edited?.revision, staleSave, staleOrder }));

  await client.query("UPDATE public.products SET uom='Case' WHERE id=$1", [productId]);
  const changedUnit = await codeOf(() => order(inventoryUserId, id, 2));
  await client.query("UPDATE public.products SET uom='Nos' WHERE id=$1", [productId]);
  await client.query('UPDATE public.suppliers SET is_active=false WHERE id=$1', [supplierId]);
  const inactiveSupplier = await codeOf(() => order(inventoryUserId, id, 2));
  await client.query('UPDATE public.suppliers SET is_active=true WHERE id=$1', [supplierId]);
  const { rows: [stillDraft] } = await client.query(`SELECT status, order_number,
    (SELECT count(*)::int FROM atlas_private.purchase_order_counters WHERE organization_id=$2) AS counters
    FROM public.purchase_orders WHERE id=$1`, [id, orgAId]);
  recordTest('PURCHASE-05', 'Finalization checks current supplier availability and product units before numbering',
    changedUnit === '22023' && inactiveSupplier === '22023' && stillDraft?.status === 'DRAFT' &&
    stillDraft.order_number === null && stillDraft.counters === 0,
    JSON.stringify({ changedUnit, inactiveSupplier, stillDraft }));

  await save(inventoryUserId, secondId);
  const peer = await connectPeer();
  let ordered, replay, second;
  try {
    const attempts = await Promise.allSettled([
      order(inventoryUserId, id, 2),
      order(inventoryUserId, id, 2, peer),
    ]);
    [ordered, replay] = attempts.map((attempt) => {
      if (attempt.status === 'rejected') throw attempt.reason;
      return attempt.value;
    });
    second = await order(inventoryUserId, secondId, 1);
  } finally {
    await peer.end();
  }
  const afterOrder = await codeOf(() => save(ownerAId, id, { revision: 3, notes: 'Edit issued order' }));
  const { rows: [effects] } = await client.query(`SELECT
    (SELECT max(last_value)::int FROM atlas_private.purchase_order_counters WHERE organization_id=$1) AS counter,
    (SELECT count(*)::int FROM public.audit_events WHERE entity_id=$2 AND action='ISSUE_PURCHASE_ORDER' AND actor_id=$4) AS audits,
    (SELECT count(*)::int FROM public.stock_movements WHERE organization_id=$1 AND product_id=$3) AS stock,
    (SELECT count(*)::int FROM public.supplier_price_history WHERE organization_id=$1 AND product_id=$3) AS price_history,
    (SELECT purchase_cost::text FROM public.products WHERE id=$3) AS master_cost`, [orgAId, id, productId, inventoryUserId]);
  recordTest('PURCHASE-06', 'Concurrent retries return the same PO number and the next order takes the next number',
    ordered?.status === 'ORDERED' && /^PO-\d{4}-0001$/.test(ordered.order_number) &&
    ordered.order_number === replay?.order_number && ordered.revision === 3 && second?.order_number === ordered.order_number.replace(/0001$/, '0002') &&
    effects.counter === 2 && effects.audits === 1 && afterOrder === '23514',
    JSON.stringify({ number: ordered?.order_number, replay: replay?.order_number, next: second?.order_number, afterOrder, effects }));
  recordTest('PURCHASE-07', 'Numbering an order preserves the stock ledger, supplier rates and product master cost',
    effects.stock === 0 && effects.price_history === 0 && Number(effects.master_cost) === 12, JSON.stringify(effects));
}
