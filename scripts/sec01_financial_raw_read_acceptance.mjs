import crypto from 'node:crypto';

/**
 * SEC-01 contract: a direct SQL/PostgREST-style SELECT cannot bypass the
 * report-page role gate. Runs only in the disposable PostgreSQL test database.
 */
export async function runFinancialRawReadAcceptance({
  client, orgAId, ownerAId, ownerBId, withRoleContext, recordTest,
}) {
  // Reuse legitimate invoice/payment documents created by the operational RPC
  // acceptance tests. No direct inserts into immutable ledgers.
  const invoiceFixture = await client.query(
    `SELECT i.id, i.customer_id FROM public.invoices AS i
     JOIN public.invoice_items AS ii ON ii.invoice_id = i.id
     WHERE i.organization_id = $1::uuid ORDER BY i.created_at LIMIT 1`,
    [orgAId]
  );
  const paymentFixture = await client.query(
    `SELECT p.id FROM public.payments AS p
     JOIN public.payment_allocations AS pa ON pa.payment_id = p.id
     WHERE p.organization_id = $1::uuid ORDER BY p.created_at LIMIT 1`,
    [orgAId]
  );

  const invoiceId = invoiceFixture.rows[0]?.id;
  const customerId = invoiceFixture.rows[0]?.customer_id;
  const paymentId = paymentFixture.rows[0]?.id;
  if (!invoiceId || !paymentId) {
    recordTest('SEC-01-FIXTURE', 'SEC-01 requires legitimately issued invoice and allocated payment fixtures',
      false, `invoice=${Boolean(invoiceId)}, payment=${Boolean(paymentId)}`);
    return;
  }

  const cases = [
    { role: 'owner', allowed: true, userId: ownerAId },
    { role: 'admin', allowed: true },
    { role: 'accounts', allowed: true },
    { role: 'sales', allowed: false },
    { role: 'inventory', allowed: false },
    { role: 'viewer', allowed: false },
    { role: 'accounts', allowed: false, inactive: true },
    { role: 'owner from another organization', allowed: false, userId: ownerBId },
    { role: 'anonymous', allowed: false, sqlRole: 'anon', userId: null },
  ];

  for (const [index, tc] of cases.entries()) {
    const userId = tc.userId === undefined ? crypto.randomUUID() : tc.userId;
    if (tc.userId === undefined) {
      await client.query('INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2::text)',
        [userId, `sec01_${tc.role}_${index}_${userId.slice(0, 8)}@example.test`]);
      await client.query(
        'INSERT INTO public.memberships (organization_id, user_id, role, is_active) VALUES ($1::uuid, $2::uuid, $3::text, $4::boolean)',
        [orgAId, userId, tc.role, !tc.inactive]
      );
    }

    const results = {};
    let rpcInvoiceVisible = null;
    let error = null;
    try {
      await withRoleContext(client, { role: tc.sqlRole || 'authenticated', userId }, async () => {
        const targets = [
          ['invoices', 'SELECT COUNT(*)::int AS n FROM public.invoices WHERE organization_id = $1::uuid', [orgAId]],
          ['invoice_items', 'SELECT COUNT(*)::int AS n FROM public.invoice_items WHERE invoice_id = $1::uuid', [invoiceId]],
          ['payments', 'SELECT COUNT(*)::int AS n FROM public.payments WHERE organization_id = $1::uuid', [orgAId]],
          ['payment_allocations', 'SELECT COUNT(*)::int AS n FROM public.payment_allocations WHERE payment_id = $1::uuid', [paymentId]],
        ];
        for (const [table, sql, args] of targets) {
          const { rows } = await client.query(sql, args);
          results[table] = rows[0]?.n ?? 0;
        }
        // This RPC was SECURITY DEFINER in migration 036, so raw RLS
        // protections alone were insufficient to block direct calls.
        const rpcResult = await client.query(
          `SELECT public.get_eligible_payment_invoices(
              $1::uuid, $2::uuid, NULL::text, 25, 0, $3::uuid
            ) AS value`,
          [orgAId, customerId, invoiceId]
        );
        const summaryResult = await client.query(
          'SELECT public.get_payments_summary($1::uuid) AS value',
          [orgAId]
        );
        results.summary_payments = Number(summaryResult.rows[0]?.value?.payment_count ?? -1);
        const payload = rpcResult.rows[0]?.value;
        rpcInvoiceVisible = Array.isArray(payload?.data)
          && payload.data.some(item => item.id === invoiceId);
      });
    } catch (e) { error = e; }

    const entries = Object.values(results);
    // Anon may be blocked by table GRANT before RLS runs (SQLSTATE 42501).
    // A hard privilege denial is at least as strict as returning zero rows.
    const deniedBySqlPrivilege = !tc.allowed && error?.code === '42501'
      && entries.every(n => n === 0)
      && (tc.sqlRole === 'anon' || entries.length === 5);
    const passed = deniedBySqlPrivilege || (
      !error && entries.length === 5 &&
      (tc.allowed
        ? entries.every(n => n > 0) && rpcInvoiceVisible === true
        : entries.every(n => n === 0) && rpcInvoiceVisible === false)
    );

    recordTest(
      `SEC-01-DIRECT-${index}`,
      `Direct financial table reads for ${tc.role} are ${tc.allowed ? 'allowed within tenant' : 'denied'}`,
      passed, `counts=${JSON.stringify(results)}, rpcInvoiceVisible=${rpcInvoiceVisible}, error=${error?.message || 'none'}`, passed ? null : error
    );
  }

  // A legitimate non-financial workflow must still read product catalog data.
  const salesId = crypto.randomUUID();
  await client.query('INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2::text)',
    [salesId, `sec01_catalog_${salesId.slice(0, 8)}@example.test`]);
  await client.query(
    "INSERT INTO public.memberships (organization_id, user_id, role, is_active) VALUES ($1::uuid, $2::uuid, 'sales', true)",
    [orgAId, salesId]
  );
  let productCount = 0;
  await withRoleContext(client, { role: 'authenticated', userId: salesId }, async () => {
    const { rows } = await client.query(
      'SELECT COUNT(*)::int AS n FROM public.products WHERE organization_id = $1::uuid',
      [orgAId]
    );
    productCount = rows[0]?.n ?? 0;
  });
  recordTest('SEC-01-SALES-CATALOG', 'Sales can still read their organization product catalog',
    productCount > 0, `productCount=${productCount}`);
}
