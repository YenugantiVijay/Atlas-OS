import crypto from 'node:crypto';

/** Test bounded financial document search against authenticated SQL roles. */
export async function runB2FinancialSearchAcceptance({
  client, orgAId, ownerAId, ownerBId, withRoleContext, recordTest,
}) {
  const invoice = await client.query(
    'SELECT invoice_number FROM public.invoices WHERE organization_id = $1::uuid LIMIT 1', [orgAId]
  );
  const payment = await client.query(
    'SELECT payment_number FROM public.payments WHERE organization_id = $1::uuid LIMIT 1', [orgAId]
  );
  const invoiceNumber = invoice.rows[0]?.invoice_number;
  const paymentNumber = payment.rows[0]?.payment_number;
  if (!invoiceNumber || !paymentNumber) {
    recordTest('B2-SEARCH-FIXTURE', 'Financial search needs real invoice and receipt fixtures', false,
      `invoice=${Boolean(invoiceNumber)} payment=${Boolean(paymentNumber)}`);
    return;
  }

  let result;
  let error;
  try {
    await withRoleContext(client, { role: 'authenticated', userId: ownerAId }, async () => {
      const r = await client.query(
        'SELECT * FROM public.search_financial_documents($1::uuid, $2::text, 8)',
        [orgAId, invoiceNumber]
      );
      result = r.rows;
    });
  } catch (e) { error = e; }
  const valid = !error && Array.isArray(result) && result.length > 0 &&
    result.length <= 8 && result.every(x => x.record_type === 'invoice') &&
    result.some(x => x.document_number === invoiceNumber);
  recordTest('B2-SEARCH-INVOICE', 'Finance-only invoice number search returns bounded matching records',
    valid, `found=${result?.length || 0}, error=${error?.message || 'none'}`, valid ? null : error);

  let receiptResults = [];
  let receiptError = null;
  try {
    await withRoleContext(client, { role: 'authenticated', userId: ownerAId }, async () => {
      const r = await client.query(
        'SELECT * FROM public.search_financial_documents($1::uuid, $2::text, 8)',
        [orgAId, paymentNumber]
      );
      receiptResults = r.rows;
    });
  } catch (e) { receiptError = e; }
  const receiptOk = !receiptError && receiptResults.some(x =>
    x.record_type === 'payment' && x.document_number === paymentNumber);
  recordTest('B2-SEARCH-RECEIPT', 'Finance-only payment receipt lookup returns matching record',
    receiptOk, `found=${receiptResults.length}, error=${receiptError?.message || 'none'}`,
    receiptOk ? null : receiptError);

  const cases = [
    { label: 'sales', role: 'sales' },
    { label: 'inventory', role: 'inventory' },
    { label: 'viewer', role: 'viewer' },
    { label: 'cross-tenant', userId: ownerBId },
    { label: 'anon', userId: null, sqlRole: 'anon' },
  ];
  for (const tc of cases) {
    let userId = tc.userId;
    if (tc.role) {
      userId = crypto.randomUUID();
      await client.query('INSERT INTO auth.users (id,email) VALUES ($1::uuid,$2::text)',
        [userId, `b2_${tc.role}_${userId.slice(0,8)}@example.test`]);
      await client.query(
        'INSERT INTO public.memberships (organization_id,user_id,role,is_active) VALUES ($1::uuid,$2::uuid,$3::text,true)',
        [orgAId,userId,tc.role]
      );
    }
    let denied = false, failure = null;
    try {
      await withRoleContext(client, { role: tc.sqlRole || 'authenticated', userId }, async () => {
        await client.query(
          'SELECT * FROM public.search_financial_documents($1::uuid,$2::text,8)',
          [orgAId,invoiceNumber]
        );
      });
    } catch (e) { failure = e; denied = e.code === '42501'; }
    recordTest(`B2-SEARCH-DENY-${tc.label.toUpperCase()}`,
      `Financial document search denies ${tc.label}`,
      denied, `sqlstate=${failure?.code || 'none'}`, denied ? null : failure);
  }
}
