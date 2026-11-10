import crypto from 'node:crypto';

/** PR #44: real role/RLS PostgreSQL acceptance against disposable fixtures. */
export async function runB2OperationalSearchAcceptance({
  client, orgAId, orgBId, ownerAId, ownerBId, withRoleContext, recordTest,
}) {
  const supplierAId = crypto.randomUUID();
  const supplierBId = crypto.randomUUID();
  await client.query(
    `INSERT INTO public.suppliers (id,organization_id,name,company_name,phone)
     VALUES ($1::uuid,$3::uuid,'Search Supplier Alpha','Atlas Supplier Company','+91 99887-76655'),
            ($2::uuid,$4::uuid,'Other Tenant Supplier','Secret Other Firm','+91 99887-76655')`,
    [supplierAId, supplierBId, orgAId, orgBId],
  );
  await client.query(
    "UPDATE public.suppliers SET gstin = '29ZYXWV9876P1Z8' WHERE id = $1::uuid",
    [supplierAId],
  );
  const { rows: quotations } = await client.query(
    `SELECT q.id, q.quotation_number, c.name AS customer_name
     FROM public.quotations q JOIN public.customers c
       ON c.id=q.customer_id AND c.organization_id=q.organization_id
     WHERE q.organization_id=$1::uuid ORDER BY q.created_at DESC LIMIT 1`,
    [orgAId],
  );
  const { rows: orders } = await client.query(
    `SELECT so.id, so.order_number, c.name AS customer_name
     FROM public.sales_orders so JOIN public.customers c
       ON c.id=so.customer_id AND c.organization_id=so.organization_id
     WHERE so.organization_id=$1::uuid ORDER BY so.created_at DESC LIMIT 1`,
    [orgAId],
  );
  if (!quotations[0] || !orders[0]) {
    recordTest('B2-OPS-FIXTURES', 'Existing valid quotation and sales-order fixtures exist',
      false, `quotation=${!!quotations[0]}, order=${!!orders[0]}`);
    return;
  }

  const lookup = async (userId, role, term, org = orgAId, limit = 3) =>
    withRoleContext(client, { role, userId }, async () =>
      (await client.query(
        'SELECT * FROM public.search_operational_records($1::uuid,$2::text,$3::integer)',
        [org, term, limit],
      )).rows,
    );

  for (const tc of [
    { label: 'SUPPLIER-NAME', term: 'Search Supplier Alpha', kind: 'supplier', id: supplierAId },
    { label: 'SUPPLIER-COMPANY', term: 'Atlas Supplier Company', kind: 'supplier', id: supplierAId },
    { label: 'SUPPLIER-GSTIN', term: 'ZYXWV9876P', kind: 'supplier', id: supplierAId },
    { label: 'SUPPLIER-PHONE', term: '9988776655', kind: 'supplier', id: supplierAId },
    { label: 'SUPPLIER-PARTIAL-PHONE', term: '99887-76655', kind: 'supplier', id: supplierAId },
    { label: 'QUOTE-NUMBER', term: quotations[0].quotation_number, kind: 'quotation', id: quotations[0].id },
    { label: 'ORDER-NUMBER', term: orders[0].order_number, kind: 'sales_order', id: orders[0].id },
  ]) {
    let rows = [], error = null;
    try { rows = await lookup(ownerAId, 'authenticated', tc.term); } catch (e) { error = e; }
    const valid = !error && rows.some(r => r.record_type === tc.kind && r.record_id === tc.id) &&
      rows.length <= 9 && rows.every(r => Object.keys(r).sort().join(',') ===
        'contact_phone,display_name,record_id,record_type,reference') &&
      rows.every(r => r.record_id !== supplierBId);
    recordTest('B2-OPS-' + tc.label, 'Permission-scoped search: ' + tc.label,
      valid, `rows=${rows.length} error=${error?.message || 'none'}`, valid ? null : error);
  }

  for (const tc of [
    { label: 'QUOTE-CUSTOMER', name: quotations[0].customer_name, kind: 'quotation' },
    { label: 'ORDER-CUSTOMER', name: orders[0].customer_name, kind: 'sales_order' },
  ]) {
    let rows = [], error = null;
    try { rows = await lookup(ownerAId, 'authenticated', tc.name); } catch (e) { error = e; }
    const valid = !error && rows.some(r => r.record_type === tc.kind);
    recordTest('B2-OPS-' + tc.label, 'Customer-name search returns ' + tc.kind,
      valid, `rows=${rows.length} error=${error?.message || 'none'}`, valid ? null : error);
  }

  let bounded = [], wildcard = [], oneDigit = [], invalidError = null;
  try {
    bounded = await lookup(ownerAId, 'authenticated', '99887', orgAId, 1);
    wildcard = await lookup(ownerAId, 'authenticated', '%_');
    oneDigit = await lookup(ownerAId, 'authenticated', '99');
  } catch (e) { invalidError = e; }
  const boundedOk = !invalidError && bounded.filter(r=>r.record_type==='supplier').length <= 1 &&
    wildcard.length === 0 && oneDigit.filter(r=>r.record_type==='supplier').length === 0;
  recordTest('B2-OPS-BOUNDED', 'Per-family limit, literal SQL wildcard, minimum phone digits',
    boundedOk, `bounded=${bounded.length} wildcard=${wildcard.length} short=${oneDigit.length}`,
    boundedOk ? null : invalidError);

  for (const limit of [0, 6]) {
    let err = null;
    try { await lookup(ownerAId, 'authenticated', 'Search Supplier Alpha', orgAId, limit); }
    catch (e) { err = e; }
    recordTest('B2-OPS-INVALID-LIMIT-' + limit, 'Reject invalid limit',
      err?.code === '22023', `sqlstate=${err?.code || 'none'}`, err?.code === '22023' ? null : err);
  }

  const viewerId = crypto.randomUUID();
  const inactiveId = crypto.randomUUID();
  await client.query(
    `INSERT INTO auth.users (id,email) VALUES
     ($1::uuid,$3::text),($2::uuid,$4::text)`,
    [viewerId, inactiveId, `b2ops_viewer_${viewerId.slice(0,8)}@example.test`,
      `b2ops_inactive_${inactiveId.slice(0,8)}@example.test`],
  );
  await client.query(
    `INSERT INTO public.memberships (organization_id,user_id,role,is_active)
     VALUES ($1::uuid,$2::uuid,'viewer',true),($1::uuid,$3::uuid,'viewer',false)`,
    [orgAId, viewerId, inactiveId],
  );

  let viewerRows = [], viewerError = null;
  try { viewerRows = await lookup(viewerId, 'authenticated', 'Search Supplier Alpha'); }
  catch (e) { viewerError = e; }
  const viewerOk = !viewerError && viewerRows.some(r => r.record_id === supplierAId) &&
    viewerRows.every(r => !('total_amount' in r) && !('credit_limit' in r));
  recordTest('B2-OPS-VIEWER', 'Authorized read-only viewer receives only directory/document labels',
    viewerOk, `rows=${viewerRows.length} error=${viewerError?.message || 'none'}`,
    viewerOk ? null : viewerError);

  for (const tc of [
    { label: 'INACTIVE', id: inactiveId, role: 'authenticated' },
    { label: 'CROSS-TENANT', id: ownerBId, role: 'authenticated' },
    { label: 'ANON', id: null, role: 'anon' },
  ]) {
    let error = null;
    try { await lookup(tc.id, tc.role, 'Search Supplier Alpha'); } catch (e) { error = e; }
    recordTest('B2-OPS-DENY-' + tc.label, 'Reject ' + tc.label + ' caller',
      error?.code === '42501', `sqlstate=${error?.code || 'none'}`,
      error?.code === '42501' ? null : error);
  }
}
