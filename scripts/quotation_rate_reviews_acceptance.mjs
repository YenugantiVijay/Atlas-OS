import { randomUUID } from 'node:crypto';

export async function runQuotationRateReviewsAcceptance({
  client, withRoleContext, recordTest, orgAId, orgBId, ownerAId, ownerBId,
}) {
  const { rows: [fixture] } = await client.query(`
    SELECT h.supplier_id, h.product_id, h.product_uom, h.product_name, h.product_sku,
      (SELECT id FROM public.customers WHERE organization_id = $1 LIMIT 1) AS customer_id,
      (SELECT user_id FROM public.memberships WHERE organization_id = $1 AND role = 'sales' LIMIT 1) AS sales_id
    FROM public.supplier_price_history h
    WHERE h.organization_id = $1 AND h.product_sku = 'GRN56-A'
    LIMIT 1
  `, [orgAId]);
  if (!fixture?.customer_id || !fixture.sales_id) throw new Error('Missing quotation rate review fixtures');

  const as = (userId, fn) => withRoleContext(client, { role: 'authenticated', userId }, fn);
  const recordRate = async (cost) => {
    const id = randomUUID();
    await as(ownerAId, () => client.query(`
      SELECT public.record_supplier_price_quote($1,$2,$3,$4,$5,current_date,'Acceptance rate notice')
    `, [orgAId, id, fixture.supplier_id, fixture.product_id, cost]));
    return id;
  };

  await recordRate(1200);
  const { rows: [{ quotation }] } = await as(ownerAId, () => client.query(`
    SELECT public.create_quotation_atomic($1,$2,current_date+15,$3::jsonb,NULL,$4) AS quotation
  `, [orgAId, fixture.customer_id, JSON.stringify([{
    productId: fixture.product_id, productName: fixture.product_name,
    productSku: fixture.product_sku, uom: fixture.product_uom, quantity: 2,
    unitPrice: 2000, discountPercent: 25, taxRate: 18,
  }]), randomUUID()]));
  const rateId = await recordRate(1380);
  const list = (userId, orgId, quotationId, supplierRateId) =>
    as(userId, async () => (await client.query(
      'SELECT * FROM public.list_quotation_rate_impacts($1,$2,$3,0)',
      [orgId, quotationId, supplierRateId],
    )).rows);

  const [impact] = await list(ownerAId, orgAId, null, rateId);
  recordTest('QUOTE-RATE-01', 'Rate increase finds open quotation and estimates margin after line discounts and before GST',
    impact?.quotation_id === quotation.id && Number(impact.previous_cost) === 1200 &&
    Number(impact.current_cost) === 1380 && Number(impact.previous_margin) === 20 &&
    Number(impact.current_margin) === 8, JSON.stringify(impact));

  const [salesImpact] = await list(fixture.sales_id, orgAId, quotation.id, null);
  const sensitive = ['supplier_name', 'previous_cost', 'current_cost', 'previous_margin', 'current_margin'];
  recordTest('QUOTE-RATE-02', 'Sales sees the affected line without supplier identity, costs or margins',
    salesImpact?.item_id === impact?.item_id && sensitive.every((field) => salesImpact[field] === null),
    JSON.stringify(salesImpact));

  const codeOf = async (fn) => {
    try { await fn(); } catch (error) { return error.code; }
    return null;
  };
  const salesRateCode = await codeOf(() => list(fixture.sales_id, orgAId, null, rateId));
  const foreignOrgCode = await codeOf(() => list(ownerBId, orgAId, quotation.id, null));
  const foreignRows = await list(ownerBId, orgBId, quotation.id, null);
  recordTest('QUOTE-RATE-03', 'Rate lookup preserves tenant and purchase-rate boundaries',
    salesRateCode === '42501' && foreignOrgCode === '42501' && foreignRows.length === 0,
    JSON.stringify({ salesRateCode, foreignOrgCode, foreignCount: foreignRows.length }));

  const save = (userId, status) => as(userId, async () => (await client.query(
    'SELECT public.save_quotation_rate_review($1,$2,$3,$4,$5) AS status',
    [orgAId, quotation.id, impact.item_id, rateId, status],
  )).rows[0].status);
  const denied = await codeOf(() => save(fixture.sales_id, 'REVIEWED'));
  const requested = await save(fixture.sales_id, 'REQUESTED');
  const duplicate = await save(fixture.sales_id, 'REQUESTED');
  const reviewed = await save(ownerAId, 'REVIEWED');
  const lateRequest = await save(fixture.sales_id, 'REQUESTED');
  const { rows: [{ count }] } = await client.query(`
    SELECT count(*)::integer FROM public.audit_events
    WHERE entity_id = $1 AND action IN ('QUOTATION_RATE_REQUESTED', 'QUOTATION_RATE_REVIEWED')
  `, [quotation.id]);
  recordTest('QUOTE-RATE-04', 'Sales requests and an owner reviews once, with both actions audited',
    denied === '42501' && requested === 'REQUESTED' && duplicate === 'REQUESTED' &&
    reviewed === 'REVIEWED' && lateRequest === 'REVIEWED' && count === 2,
    JSON.stringify({ denied, requested, duplicate, reviewed, lateRequest, count }));

  const repeatedRateId = await recordRate(1380);
  const [unchangedImpact] = await list(ownerAId, orgAId, quotation.id, null);
  const latestRateId = await recordRate(1400);
  const [newImpact] = await list(ownerAId, orgAId, quotation.id, null);
  const oldRows = await list(ownerAId, orgAId, null, rateId);
  recordTest('QUOTE-RATE-05', 'Repeated costs preserve the review and a later increase opens a fresh review',
    repeatedRateId !== rateId && unchangedImpact?.rate_id === rateId &&
    unchangedImpact?.review_status === 'REVIEWED' && newImpact?.rate_id === latestRateId &&
    newImpact?.review_status === 'OPEN' && oldRows.length === 0,
    JSON.stringify({ unchangedImpact, newImpact, oldCount: oldRows.length }));

  const { rows: [savedQuote] } = await client.query(
    'SELECT subtotal, discount_amount, total_amount FROM public.quotations WHERE id=$1',
    [quotation.id],
  );
  recordTest('QUOTE-RATE-06', 'Review never edits customer quotation totals',
    Number(savedQuote.subtotal) === 4000 && Number(savedQuote.discount_amount) === 1000 &&
    Number(savedQuote.total_amount) === 3540, JSON.stringify(savedQuote));
}
