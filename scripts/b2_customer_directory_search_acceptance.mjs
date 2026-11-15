import crypto from 'node:crypto';

/** B2 #43: exercise actual RLS/invoker behavior in disposable PostgreSQL. */
export async function runB2CustomerDirectorySearchAcceptance({
  client, orgAId, orgBId, ownerAId, ownerBId, withRoleContext, recordTest,
}) {
  const idA = crypto.randomUUID();
  const idB = crypto.randomUUID();
  const idOther = crypto.randomUUID();
  await client.query(
    `INSERT INTO public.customers (id, organization_id, name, company_name, phone)
     VALUES ($1::uuid,$4::uuid,'Ravi Electricals','Ravi Traders','+91 98765-43210'),
            ($2::uuid,$4::uuid,'Secondary Wire Supply','Numbered Supply','98765 99999'),
            ($3::uuid,$5::uuid,'Other Tenant Customer','Private Firm','+91 98765-43210')`,
    [idA, idB, idOther, orgAId, orgBId],
  );

  // PR #54: GSTIN matching on the already-minimal directory contract; the
  // identifier itself is not returned to callers.
  await client.query(
    "UPDATE public.customers SET gstin = '29ABCDE1234F1Z5' WHERE id = $1::uuid",
    [idA],
  );

  const lookup = async (userId, sqlRole, query, requestedOrg = orgAId, limit = 3) => {
    return withRoleContext(client, { role: sqlRole, userId }, async () =>
      (await client.query(
        'SELECT * FROM public.search_customer_directory($1::uuid, $2::text, $3::integer)',
        [requestedOrg, query, limit],
      )).rows,
    );
  };

  for (const term of ['9876543210', '98765-43210', '98765 43210', '+91 98765', '43210']) {
    let rows = [], failure = null;
    try { rows = await lookup(ownerAId, 'authenticated', term); } catch (e) { failure = e; }
    const valid = !failure && rows.some(r => r.id === idA) &&
      rows.every(r => r.id !== idOther) && rows.length <= 3 &&
      rows.every(r => Object.keys(r).sort().join(',') === 'company_name,id,name,phone');
    recordTest('B2-PHONE-' + term.replace(/[^0-9A-Za-z]/g, '_'),
      'Phone search normalizes stored and typed punctuation: ' + term,
      valid, `rows=${rows.length} error=${failure?.message || 'none'}`, valid ? null : failure);
  }

  let nameRows = [], companyRows = [], shortRows = [], limitedRows = [];
  let matchError = null;
  try {
    nameRows = await lookup(ownerAId, 'authenticated', 'Ravi Electricals');
    companyRows = await lookup(ownerAId, 'authenticated', 'Ravi Traders');
    shortRows = await lookup(ownerAId, 'authenticated', '91');
    limitedRows = await lookup(ownerAId, 'authenticated', '98765', orgAId, 1);
  } catch (e) { matchError = e; }
  const matchOk = !matchError && nameRows.some(r => r.id === idA) &&
    companyRows.some(r => r.id === idA) && shortRows.length === 0 &&
    limitedRows.length === 1 && limitedRows[0].id !== idOther;
  recordTest('B2-PHONE-BOUNDS', 'Names, companies, min 3 phone digits and limit are enforced',
    matchOk, `name=${nameRows.length} company=${companyRows.length} twoDigits=${shortRows.length} limit=${limitedRows.length}`,
    matchOk ? null : matchError);

  let gstinRows = [], gstinError = null;
  try { gstinRows = await lookup(ownerAId, 'authenticated', 'ABCDE1234F'); }
  catch (e) { gstinError = e; }
  const gstinOk = !gstinError && gstinRows.some(r => r.id === idA) &&
    gstinRows.every(r => r.id !== idOther && !('gstin' in r) &&
      !('credit_limit' in r) && !('current_receivable' in r));
  recordTest('PR54-CUSTOMER-GSTIN',
    'Customer GSTIN substrings match without revealing GSTIN or financial data',
    gstinOk, `rows=${gstinRows.length} error=${gstinError?.message || 'none'}`,
    gstinOk ? null : gstinError);

  let invalidError = null;
  try { await lookup(ownerAId, 'authenticated', '98765', orgAId, 21); } catch (e) { invalidError = e; }
  recordTest('B2-PHONE-INVALID-LIMIT', 'Reject an unbounded client-supplied limit',
    invalidError?.code === '22023', `sqlstate=${invalidError?.code || 'none'}`,
    invalidError?.code === '22023' ? null : invalidError);

  const salesId = crypto.randomUUID();
  const inactiveId = crypto.randomUUID();
  await client.query(
    'INSERT INTO auth.users (id,email) VALUES ($1::uuid,$3::text),($2::uuid,$4::text)',
    [salesId, inactiveId, `b2_search_sales_${salesId.slice(0,8)}@example.test`,
      `b2_search_inactive_${inactiveId.slice(0,8)}@example.test`]
  );
  await client.query(
    "INSERT INTO public.memberships (organization_id,user_id,role,is_active) VALUES ($1,$2,'sales',true),($1,$3,'sales',false)",
    [orgAId, salesId, inactiveId],
  );

  let salesRows = [], salesError = null;
  try { salesRows = await lookup(salesId, 'authenticated', '98765'); } catch (e) { salesError = e; }
  recordTest('B2-PHONE-SALES-ACCESS', 'Active operational staff can find directory entries without balances',
    !salesError && salesRows.some(r => r.id === idA) &&
    salesRows.every(r => !('credit_limit' in r) && !('current_receivable' in r)),
    `rows=${salesRows.length} error=${salesError?.message || 'none'}`, salesError);

  const deniedCases = [
    { label: 'inactive', userId: inactiveId, role: 'authenticated' },
    { label: 'cross-tenant', userId: ownerBId, role: 'authenticated' },
    { label: 'anonymous', userId: null, role: 'anon' },
  ];
  for (const tc of deniedCases) {
    let failure = null;
    try { await lookup(tc.userId, tc.role, '98765'); } catch (e) { failure = e; }
    const denied = failure?.code === '42501';
    recordTest('B2-PHONE-DENY-' + tc.label.toUpperCase(),
      'Directory search denies ' + tc.label, denied,
      `sqlstate=${failure?.code || 'none'}`, denied ? null : failure);
  }
}
