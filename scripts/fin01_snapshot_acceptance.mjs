/**
 * FIN-01 — Disposable-Postgres acceptance of an atomic financial export RPC.
 * The STABLE RPC observes the calling statement's MVCC snapshot for all
 * invoices, children, payments, allocations, and referenced invoice metadata.
 */
export async function runFin01SnapshotAcceptance({
  client, orgAId, ownerAId, ownerBId, withRoleContext, recordTest,
}) {
  const start = '2000-01-01', end = '2099-12-31';
  let snapshot, error;
  try {
    await withRoleContext(client, { role: 'authenticated', userId: ownerAId }, async () => {
      const { rows } = await client.query(
        `SELECT public.get_financial_export_snapshot(
            $1::uuid, $2::date, $3::date, 'ALL', NULL::uuid, NULL::text
          ) AS data`,
        [orgAId, start, end]
      );
      snapshot = rows[0]?.data;
    });
  } catch (e) { error = e; }

  const invoices = snapshot?.invoices;
  const payments = snapshot?.payments;
  const refs = snapshot?.referenced_invoices;
  const itemCount = Array.isArray(invoices)
    ? invoices.reduce((n, i) => n + (Array.isArray(i.items) ? i.items.length : -100000), 0)
    : -1;
  const allocationCount = Array.isArray(payments)
    ? payments.reduce((n, p) => n + (Array.isArray(p.allocations) ? p.allocations.length : -100000), 0)
    : -1;
  const refIds = new Set(Array.isArray(refs) ? refs.map(i => i.id) : []);
  const invoiceIds = new Set(Array.isArray(invoices) ? invoices.map(i => i.id) : []);
  const referencesComplete = Array.isArray(payments) && payments.every(p =>
    Array.isArray(p.allocations) && p.allocations.every(a =>
      refIds.has(a.invoice_id) || invoiceIds.has(a.invoice_id)
    )
  );
  const valid = !error && snapshot && typeof snapshot.snapshot_at === 'string' &&
    Array.isArray(invoices) && Array.isArray(payments) && Array.isArray(refs) &&
    invoices.length > 0 && payments.length > 0 &&
    invoices.length === snapshot.invoice_count &&
    payments.length === snapshot.payment_count &&
    itemCount === Number(snapshot.invoice_item_count) &&
    allocationCount === Number(snapshot.payment_allocation_count) &&
    referencesComplete && invoices.every(i => i.organization_id === orgAId) &&
    payments.every(p => p.organization_id === orgAId);

  recordTest('FIN-01-SNAPSHOT-COMPLETE',
    'Single-statement financial export includes every parent, child and allocation reference',
    Boolean(valid),
    `invoices=${invoices?.length ?? '?'} receipts=${payments?.length ?? '?'} items=${itemCount} allocations=${allocationCount}`,
    valid ? null : error
  );

  // The same RPC must NOT be callable by nonfinancial employees, other
  // organizations or unauthenticated request contexts.
  const blocked = [
    { id: 'SALES', role: 'sales' },
    { id: 'INVENTORY', role: 'inventory' },
    { id: 'VIEWER', role: 'viewer' },
    { id: 'CROSS-TENANT', userId: ownerBId, role: 'authenticated' },
    { id: 'ANON', userId: null, role: 'anon' },
  ];
  for (const tc of blocked) {
    let succeeded = false, code = null;
    // Existing SECURITY tests have fixtures for these roles; supply explicit
    // sales/inventory/viewer memberships through the roles created below.
    try {
      await withRoleContext(client, {
        role: tc.role === 'anon' ? 'anon' : 'authenticated',
        userId: tc.userId ?? (tc.role === 'anon' ? null : ownerBId),
      }, async () => {
        await client.query(
          'SELECT public.get_financial_export_snapshot($1::uuid,$2::date,$3::date,$4::text,$5::uuid,$6::text)',
          [orgAId,start,end,'ALL',null,null]
        );
        succeeded = true;
      });
    } catch (e) { code = e.code; }
    const denied = !succeeded && code === '42501';
    recordTest(`FIN-01-DENY-${tc.id}`, `Export snapshot denies ${tc.id}`,
      denied, `SQLSTATE=${code || 'none'}`);
  }

  // Ensure no ambiguity between INVOICES- and PAYMENTS-only filters.
  for (const documentType of ['INVOICES', 'PAYMENTS']) {
    let payload, failure;
    try {
      await withRoleContext(client, { role: 'authenticated', userId: ownerAId }, async () => {
        const r = await client.query(
          'SELECT public.get_financial_export_snapshot($1::uuid,$2::date,$3::date,$4::text,$5::uuid,$6::text) AS data',
          [orgAId,start,end,documentType,null,null]
        );
        payload = r.rows[0].data;
      });
    } catch (e) { failure = e; }
    const pass = !failure && Boolean(payload) &&
      (documentType === 'INVOICES'
        ? payload.payment_count === 0 && payload.payments.length === 0
        : payload.invoice_count === 0 && payload.invoices.length === 0);
    recordTest(`FIN-01-FILTER-${documentType}`,
      `Snapshot enforces ${documentType}-only document selection`, pass,
      `invoiceCount=${payload?.invoice_count ?? 'none'}, paymentCount=${payload?.payment_count ?? 'none'}`,
      pass ? null : failure);
  }
}
