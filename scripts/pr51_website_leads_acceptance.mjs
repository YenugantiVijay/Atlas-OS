import crypto from 'node:crypto';

/**
 * PR #51: disposable PostgreSQL acceptance for anonymous lead throttling.
 * No genuine visitor PII is inserted and no remote database is contacted.
 */
export async function runWebsiteLeadRateAcceptance({ client, withRoleContext, recordTest }) {
  const hash = crypto.createHash('sha256').update('pr51:fixture').digest('hex');
  const rpc = 'SELECT public.consume_website_lead_rate_limit($1::text) AS allowed';

  const { rows: perms } = await client.query(`
    SELECT
      has_function_privilege('anon','public.consume_website_lead_rate_limit(text)'::regprocedure,'EXECUTE') AS anon_rpc,
      has_function_privilege('authenticated','public.consume_website_lead_rate_limit(text)'::regprocedure,'EXECUTE') AS member_rpc,
      has_function_privilege('service_role','public.consume_website_lead_rate_limit(text)'::regprocedure,'EXECUTE') AS service_rpc,
      has_table_privilege('anon','public.website_lead_rate_limits','SELECT') AS anon_table,
      has_table_privilege('authenticated','public.website_lead_rate_limits','INSERT') AS member_table
  `);
  recordTest('WEB-51-01', 'Only service_role may call public lead limiter or access counters',
    !perms[0].anon_rpc && !perms[0].member_rpc && perms[0].service_rpc &&
    !perms[0].anon_table && !perms[0].member_table, JSON.stringify(perms[0]));

  for (const role of ['anon','authenticated']) {
    let error = null;
    try {
      await withRoleContext(client, { role }, () => client.query(rpc, [hash]));
    } catch (e) { error = e; }
    recordTest('WEB-51-02-' + role, role + ' cannot consume privileged lead limit',
      error?.code === '42501', 'sqlstate=' + (error?.code || 'none'),
      error?.code === '42501' ? null : error || new Error('RPC was reachable'));
  }

  const observed = [];
  await withRoleContext(client, { role: 'service_role' }, async () => {
    for (let i = 0; i < 6; i++) {
      const { rows } = await client.query(rpc, [hash]);
      observed.push(rows[0]?.allowed);
    }
  });
  recordTest('WEB-51-03', 'Server-side counter allows five and rejects sixth request',
    JSON.stringify(observed) === JSON.stringify([true,true,true,true,true,false]),
    JSON.stringify(observed));

  let invalidErr = null;
  try {
    await withRoleContext(client, { role: 'service_role' }, () =>
      client.query(rpc, ['raw@example.com']));
  } catch (e) { invalidErr = e; }
  recordTest('WEB-51-04', 'Unhashed contact identifier is rejected at database boundary',
    invalidErr?.code === '22023', 'sqlstate=' + (invalidErr?.code || 'none'),
    invalidErr?.code === '22023' ? null : invalidErr || new Error('Plaintext identifier accepted'));

  const { rows: stored } = await client.query(
    'SELECT subject_hash, attempts FROM public.website_lead_rate_limits WHERE subject_hash = $1',
    [hash]
  );
  recordTest('WEB-51-05', 'Rate limiter stores only hash and bounded count',
    stored.length === 1 && stored[0].subject_hash === hash && stored[0].attempts === 5,
    JSON.stringify(stored));
}
