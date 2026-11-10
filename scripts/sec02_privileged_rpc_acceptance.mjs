/**
 * PR #50 / SEC-02: Test actual PostgreSQL roles on the disposable master CI DB.
 * This intentionally runs only through the master test runner, which enforces
 * local, isolated ephemeral databases; never run these writes on live Supabase.
 */
export async function runSec02PrivilegedRpcAcceptance({
  client, orgAId, orgBId, ownerAId, ownerBId, withRoleContext, recordTest,
}) {
  const year = new Date().getFullYear();
  const numberSql = "SELECT public.allocate_document_number($1::uuid, $2::varchar, $3::integer) AS number";

  async function expectDenied(testId, name, role, userId, sql, args = []) {
    let denied = false;
    let err = null;
    try {
      await withRoleContext(client, { role, userId }, async () => {
        await client.query(sql, args);
      });
    } catch (error) {
      err = error;
      denied = error.code === '42501';
    }
    recordTest(testId, name, denied,
      denied ? 'SQLSTATE 42501: rejected by PostgreSQL authority' : 'Call was not rejected as expected',
      denied ? null : err || new Error('Unauthorized SQL request succeeded'));
  }

  // Confirm grants, including the previously exposed cross-tenant diagnostic.
  const { rows: grants } = await client.query(`
    SELECT
      has_function_privilege('authenticated', 'public.inspect_audit_privacy_compliance()'::regprocedure, 'EXECUTE') AS user_diagnostic,
      has_function_privilege('anon', 'public.inspect_audit_privacy_compliance()'::regprocedure, 'EXECUTE') AS anon_diagnostic,
      has_function_privilege('service_role', 'public.inspect_audit_privacy_compliance()'::regprocedure, 'EXECUTE') AS service_diagnostic,
      has_function_privilege('anon', 'public.allocate_document_number(uuid, character varying, integer)'::regprocedure, 'EXECUTE') AS anon_numbering,
      has_function_privilege('authenticated', 'public.allocate_document_number(uuid, character varying, integer)'::regprocedure, 'EXECUTE') AS user_numbering
  `);
  recordTest('SEC-02-01', 'Privileged diagnostic is service-only, numbering remains authenticated-only',
    !grants[0].user_diagnostic && !grants[0].anon_diagnostic &&
    grants[0].service_diagnostic && !grants[0].anon_numbering && grants[0].user_numbering,
    JSON.stringify(grants[0]));

  // No caller, even a normal owner, can inspect global compliance counts.
  await expectDenied('SEC-02-02', 'Org owner cannot call global audit compliance diagnostic',
    'authenticated', ownerAId, 'SELECT * FROM public.inspect_audit_privacy_compliance()');
  await expectDenied('SEC-02-03', 'Anonymous caller cannot invoke privileged diagnostic',
    'anon', null, 'SELECT * FROM public.inspect_audit_privacy_compliance()');
  await withRoleContext(client, { role: 'service_role' }, async () => {
    const { rows } = await client.query('SELECT * FROM public.inspect_audit_privacy_compliance()');
    recordTest('SEC-02-04', 'Service role retains functional diagnostic access',
      rows.length === 1 && Number(rows[0].total_audit_events) >= 0,
      'Diagnostic returned aggregate metadata without an organization-member grant');
  });

  // Normal owner must retain ability to reserve a quotation number, while
  // cross-organization requests fail closed.
  await withRoleContext(client, { role: 'authenticated', userId: ownerAId }, async () => {
    const { rows } = await client.query(numberSql, [orgAId, 'QUOTATION', year]);
    recordTest('SEC-02-05', 'Owner can reserve a quotation number through legacy RPC',
      typeof rows[0]?.number === 'string' && rows[0].number.startsWith(`QT-${year}-`),
      'Owner compatibility preserved');
  });
  await expectDenied('SEC-02-06', 'Owner A cannot reserve Org B numbers',
    'authenticated', ownerAId, numberSql, [orgBId, 'SALES_ORDER', year]);
  await expectDenied('SEC-02-07', 'Anonymous caller cannot reserve numbers',
    'anon', null, numberSql, [orgAId, 'SALES_ORDER', year]);

  // Exercise all role boundaries, then restore fixture role even on failure.
  try {
    for (const role of ['viewer', 'inventory', 'sales', 'accounts']) {
      await client.query(
        'UPDATE public.memberships SET role = $1 WHERE organization_id = $2 AND user_id = $3',
        [role, orgAId, ownerAId]
      );
      if (role === 'viewer' || role === 'inventory') {
        await expectDenied(`SEC-02-08-${role}`,
          `${role} cannot reserve sales-order numbers`,
          'authenticated', ownerAId, numberSql, [orgAId, 'SALES_ORDER', year]);
        await expectDenied(`SEC-02-09-${role}`,
          `${role} cannot reserve invoice numbers`,
          'authenticated', ownerAId, numberSql, [orgAId, 'INVOICE', year]);
      } else if (role === 'sales') {
        await withRoleContext(client, { role: 'authenticated', userId: ownerAId }, async () => {
          const { rows } = await client.query(numberSql, [orgAId, 'SALES_ORDER', year]);
          recordTest('SEC-02-10', 'Sales can reserve permitted sales-order numbers',
            rows[0]?.number?.startsWith(`SO-${year}-`), 'Existing sales workflow preserved');
        });
        await expectDenied('SEC-02-11', 'Sales cannot reserve statutory invoice numbers',
          'authenticated', ownerAId, numberSql, [orgAId, 'INVOICE', year]);
      } else if (role === 'accounts') {
        await withRoleContext(client, { role: 'authenticated', userId: ownerAId }, async () => {
          const { rows } = await client.query(numberSql, [orgAId, 'INVOICE', year]);
          recordTest('SEC-02-12', 'Accounts can reserve authorized invoice numbers',
            typeof rows[0]?.number === 'string' && rows[0].number.length > 0,
            'Existing accounts workflow preserved');
        });
        await expectDenied('SEC-02-13', 'Accounts cannot reserve sales-order numbers',
          'authenticated', ownerAId, numberSql, [orgAId, 'SALES_ORDER', year]);
      }
    }
  } finally {
    await client.query(
      'UPDATE public.memberships SET role = $1 WHERE organization_id = $2 AND user_id = $3',
      ['owner', orgAId, ownerAId]
    );
  }

  await expectDenied('SEC-02-14', 'Owner cannot directly reserve payment receipt numbers',
    'authenticated', ownerAId, numberSql, [orgAId, 'RECEIPT', year]);

  const { rows: paths } = await client.query(`
    SELECT p.proname, p.proconfig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('mask_pan', 'mask_gstin', 'prevent_audit_log_mutation')
  `);
  const allPinned = paths.length === 3 && paths.every((row) =>
    Array.isArray(row.proconfig) &&
    row.proconfig.some((entry) => entry.startsWith('search_path=pg_catalog, pg_temp'))
  );
  recordTest('SEC-02-15', 'Three flagged functions have fixed pg_catalog search paths',
    allPinned, 'Verified pg_proc.proconfig on fresh installed database');

  const { rows: redacted } = await client.query(
    "SELECT public.mask_pan('ABCDE1234F') AS pan, public.mask_gstin('29ABCDE1234F1Z5') AS gstin"
  );
  recordTest('SEC-02-16', 'PAN and GSTIN masking still functions after search-path hardening',
    redacted[0]?.pan === 'XXXXX1234F' &&
    typeof redacted[0]?.gstin === 'string' &&
    !redacted[0].gstin.includes('ABCDE1234F'),
    'Sensitive input values are not exposed by masking helpers');

  // Existing owner B remains untouched; future tests should still operate.
  const { rows: memberships } = await client.query(
    'SELECT role FROM public.memberships WHERE organization_id = $1 AND user_id = $2',
    [orgBId, ownerBId]
  );
  recordTest('SEC-02-17', 'Cross-tenant fixture retains original role after SEC-02 test',
    memberships[0]?.role === 'owner', 'Org B not mutated');
}
