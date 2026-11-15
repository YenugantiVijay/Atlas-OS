import { randomUUID } from 'node:crypto';

export async function runLedgerReconciliationAcceptance({
  client, withRoleContext, recordTest, orgAId, orgBId, ownerAId, ownerBId, custAId, productAId, salesAId,
}) {
  const today = '2026-11-14';
  const read = async (userId, orgId, type, role = 'authenticated') => withRoleContext(client, { role, userId }, async () => {
    const statement = type === 'stock'
      ? 'SELECT public.get_stock_ledger_summary($1) AS result'
      : 'SELECT public.get_financial_reconciliation($1,$2) AS result';
    return (await client.query(statement, type === 'stock' ? [orgId] : [orgId, today])).rows[0].result;
  });
  const denied = async (...args) => {
    try { await read(...args); } catch (error) { return error.code === '42501'; }
    return false;
  };

  const stock = await read(ownerAId, orgAId, 'stock');
  const salesStock = await read(salesAId, orgAId, 'stock');
  const { rows: [dashboard] } = await withRoleContext(client, { role: 'authenticated', userId: ownerAId }, () =>
    client.query('SELECT public.get_dashboard_metrics($1,$2) AS result', [orgAId, today]));
  recordTest('LEDGER-01', 'Recorded stock uses movement-backed values and protects costs by role',
    stock.catalogCostValue > 0 && stock.catalogCostValue === dashboard.result.total_stock_value &&
    stock.lowStockCount === dashboard.result.low_stock_items_count &&
    salesStock.catalogCostValue === null && salesStock.lowStockCount === stock.lowStockCount &&
    await denied(ownerBId, orgAId, 'stock') && await denied(null, orgAId, 'stock', 'anon'),
    JSON.stringify({ stock, salesStock }));

  const clean = await read(ownerAId, orgAId, 'finance');
  recordTest('LEDGER-02', 'Empty ledgers are explicit and finance requires an authorized member',
    clean.invoiceCount === 0 && clean.receiptCount === 0 && clean.discrepancyCount === 0 &&
    clean.totalInvoiced === 0 && Array.isArray(clean.discrepancies) &&
    await denied(salesAId, orgAId, 'finance') && await denied(ownerBId, orgAId, 'finance') &&
    await denied(null, orgAId, 'finance', 'anon'),
    JSON.stringify(clean));

  const paid = randomUUID();
  const unpaid = randomUUID();
  const draft = randomUUID();
  const receipt = randomUUID();
  const advance = randomUUID();
  const bulkReceipt = randomUUID();

  await client.query('BEGIN');
  try {
    await client.query("SELECT set_config('app.authoritative_invoice_transition', 'true', true)");
    // Fixtures represent an imported ledger whose total paid matches total allocations.
    await client.query(`
      INSERT INTO public.invoices
        (id, organization_id, customer_id, invoice_number, status, invoice_date, due_date, total_amount, total_paid)
      VALUES
        ($1,$4,$5,'LEDGER-PAID','PARTIALLY_PAID','2026-11-01','2026-11-05',100,25),
        ($2,$4,$5,'LEDGER-OPEN','ISSUED','2026-11-01','2026-11-14',100,0),
        ($3,$4,$5,'LEDGER-DRAFT','DRAFT','2026-11-01','2026-11-05',200,0)
    `, [paid, unpaid, draft, orgAId, custAId]);
    await client.query(`
      INSERT INTO public.payments (id, organization_id, customer_id, payment_number, amount, payment_method)
      VALUES ($1,$3,$4,'LEDGER-RECEIPT',25,'CASH'), ($2,$3,$4,'LEDGER-ADVANCE',10,'CASH')
    `, [receipt, advance, orgAId, custAId]);
    await client.query('INSERT INTO public.payment_allocations (payment_id, invoice_id, amount_allocated) VALUES ($1,$2,25)', [receipt, unpaid]);

    const result = await read(ownerAId, orgAId, 'finance');
    recordTest('LEDGER-03', 'Equal aggregate totals do not hide two mismatched invoices',
      result.invoiceCount === 2 && result.discrepancyCount === 2 && result.varianceAmount === 50 &&
      result.totalPaid === 25 && result.totalAllocated === 25 && result.unallocatedPayments === 10 &&
      result.receiptIssueCount === 0 && result.overdueCount === 1 && result.overdueTotal === 100 &&
      result.discrepancies.some((row) => row.invoiceId === paid && row.allocated === 0) &&
      result.discrepancies.some((row) => row.invoiceId === unpaid && row.allocated === 25) &&
      (await read(ownerBId, orgBId, 'finance')).invoiceCount === 0,
      JSON.stringify(result));

    await client.query("SELECT set_config('app.authoritative_invoice_transition', 'true', true)");
    await client.query(`
      INSERT INTO public.invoices
        (organization_id, customer_id, invoice_number, status, invoice_date, due_date, total_amount, total_paid)
      SELECT $1,$2,'LEDGER-BULK-' || sequence,'ISSUED','2026-11-01','2026-11-05',1,0
      FROM generate_series(1, 1001) AS sequence
    `, [orgAId, custAId]);
    await client.query(`
      INSERT INTO public.payments (id, organization_id, customer_id, payment_number, amount, payment_method)
      VALUES ($1,$2,$3,'LEDGER-INVALID',1,'CASH')
    `, [bulkReceipt, orgAId, custAId]);
    // Invalid allocation to a draft is only seeded in the disposable database.
    await client.query('INSERT INTO public.payment_allocations (payment_id, invoice_id, amount_allocated) VALUES ($1,$2,1)', [bulkReceipt, draft]);

    const bulk = await read(ownerAId, orgAId, 'finance');
    recordTest('LEDGER-04', 'Snapshot counts beyond API limit and bounds details with an explicit invalid-receipt count',
      bulk.invoiceCount === 1003 && bulk.overdueCount === 1002 && bulk.overdue.length === 25 &&
      bulk.overdueTotal === 1101 && bulk.receiptIssueCount === 1,
      JSON.stringify({ count: bulk.invoiceCount, overdue: bulk.overdueCount, receipts: bulk.receiptIssueCount }));
  } finally {
    await client.query('ROLLBACK');
  }

  const { rows: [ledger] } = await withRoleContext(client, { role: 'authenticated', userId: ownerAId }, () =>
    client.query('SELECT * FROM public.get_page_product_stock_levels($1,ARRAY[$2::uuid])', [orgAId, productAId]));
  recordTest('LEDGER-05', 'Catalog reads the same stock movement authority', Number(ledger.current_stock) === 100, JSON.stringify(ledger));
}
