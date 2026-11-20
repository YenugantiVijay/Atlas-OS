export async function runAal2SecurityAcceptance({
  client, orgAId, ownerAId, withRoleContext, recordTest,
}) {
  const { rows: hookRows } = await client.query(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_db_role_setting AS setting
      CROSS JOIN LATERAL unnest(setting.setconfig) AS cfg(setting)
      WHERE setting.setrole = 'authenticator'::regrole
        AND cfg.setting = 'pgrst.db_pre_request=public.require_workspace_aal2'
    ) AS configured
  `);
  recordTest(
    'MFA-01',
    'Authenticated Data API pre-request requires AAL2',
    hookRows[0]?.configured === true,
    'authenticator role uses the workspace AAL2 request guard'
  );

  let aal1Denied = false;
  try {
    await withRoleContext(client, { role: 'authenticated', userId: ownerAId, aal: 'aal1' }, async () => {
      await client.query('SELECT public.require_workspace_aal2()');
    });
  } catch (error) {
    aal1Denied = error.code === '42501';
  }
  recordTest(
    'MFA-02',
    'AAL1 authenticated RPC requests are rejected',
    aal1Denied,
    aal1Denied ? 'SQLSTATE 42501' : 'AAL1 request was not rejected'
  );

  await withRoleContext(client, { role: 'authenticated', userId: ownerAId, aal: 'aal2' }, async () => {
    await client.query('SELECT public.require_workspace_aal2()');
    const { rows } = await client.query(
      'SELECT count(*)::integer AS visible FROM public.memberships WHERE organization_id = $1 AND user_id = $2',
      [orgAId, ownerAId]
    );
    recordTest(
      'MFA-03',
      'AAL2 authenticated users retain organization access',
      rows[0]?.visible === 1,
      `Visible memberships: ${rows[0]?.visible ?? 'unknown'}`
    );

    const { rows: storageRows } = await client.query(
      "SELECT count(*)::integer AS visible FROM storage.objects WHERE bucket_id = 'mfa-test' AND name = 'mfa-test.txt'"
    );
    recordTest(
      'MFA-04',
      'AAL2 authenticated users retain storage access',
      storageRows[0]?.visible === 1,
      `Visible test objects: ${storageRows[0]?.visible ?? 'unknown'}`
    );
  });

  await withRoleContext(client, { role: 'authenticated', userId: ownerAId, aal: 'aal1' }, async () => {
    const { rows } = await client.query(
      'SELECT count(*)::integer AS visible FROM public.memberships WHERE organization_id = $1 AND user_id = $2',
      [orgAId, ownerAId]
    );
    recordTest(
      'MFA-05',
      'AAL1 authenticated users cannot read tenant tables',
      rows[0]?.visible === 0,
      `Visible memberships: ${rows[0]?.visible ?? 'unknown'}`
    );

    const { rows: storageRows } = await client.query(
      "SELECT count(*)::integer AS visible FROM storage.objects WHERE bucket_id = 'mfa-test' AND name = 'mfa-test.txt'"
    );
    recordTest(
      'MFA-06',
      'AAL1 authenticated users cannot read storage objects',
      storageRows[0]?.visible === 0,
      `Visible test objects: ${storageRows[0]?.visible ?? 'unknown'}`
    );

    let storageWriteDenied = false;
    try {
      await client.query(
        "INSERT INTO storage.objects (bucket_id, name) VALUES ('mfa-test', 'aal1-denied.txt')"
      );
    } catch (error) {
      storageWriteDenied = error.code === '42501';
    }
    recordTest(
      'MFA-07',
      'AAL1 authenticated users cannot write storage objects',
      storageWriteDenied,
      storageWriteDenied ? 'SQLSTATE 42501' : 'AAL1 storage write was not rejected'
    );
  });
}
