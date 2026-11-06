import crypto from 'crypto';

/**
 * Phase B1.1: Restricted-role authorization contract.
 * Invoked by the disposable local PostgreSQL acceptance runner, not production.
 */
export async function runFinancialReportAccessAcceptance({
  client,
  orgAId,
  orgBId,
  ownerAId,
  ownerBId,
  withRoleContext,
  recordTest,
}) {
  const roleCases = [
    { role: 'admin', allowed: true, active: true },
    { role: 'accounts', allowed: true, active: true },
    { role: 'sales', allowed: false, active: true },
    { role: 'inventory', allowed: false, active: true },
    { role: 'viewer', allowed: false, active: true },
    { role: 'accounts', allowed: false, active: false },
  ];
  const cases = roleCases.map((c) => ({ ...c, userId: crypto.randomUUID() }));

  // Set up isolated membership fixtures with administrative database privileges.
  for (const [index, item] of cases.entries()) {
    await client.query(
      'INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2::text)',
      [item.userId, `financial_role_${index}_${item.userId.slice(0, 8)}@example.test`]
    );
    await client.query(
      'INSERT INTO public.memberships (organization_id, user_id, role, is_active) VALUES ($1::uuid, $2::uuid, $3::varchar, $4::boolean)',
      [orgAId, item.userId, item.role, item.active]
    );
  }

  const scenarios = [
    { id: 'P1-B1-AUTH-OWNER', role: 'owner', allowed: true, userId: ownerAId },
    ...cases.map((c, index) => ({
      id: `P1-B1-AUTH-${c.role.toUpperCase()}-${index}`,
      role: c.role,
      allowed: c.allowed,
      userId: c.userId,
    })),
    { id: 'P1-B1-AUTH-TENANT', role: 'cross-tenant owner', allowed: false, userId: ownerBId },
    { id: 'P1-B1-AUTH-ANON', role: 'anonymous', allowed: false, userId: null, dbRole: 'anon' },
  ];

  for (const scenario of scenarios) {
    let granted = false;
    let sqlState = null;
    let error = null;
    try {
      await withRoleContext(
        client,
        { role: scenario.dbRole || 'authenticated', userId: scenario.userId },
        async () => {
          const { rows } = await client.query(
            'SELECT public.assert_financial_report_access($1::uuid) AS allowed',
            [orgAId]
          );
          granted = rows[0]?.allowed === true;
        }
      );
    } catch (err) {
      error = err;
      sqlState = err.code || null;
    }

    const passed = scenario.allowed
      ? granted && error === null
      : !granted && sqlState === '42501';

    recordTest(
      scenario.id,
      `Financial report authorization: ${scenario.role} ${scenario.allowed ? 'is allowed' : 'is denied'}`,
      passed,
      `granted=${granted}, sqlstate=${sqlState || 'none'}`,
      passed ? null : error
    );
  }
}
