import pg from 'pg';
import { pathToFileURL } from 'node:url';

const STAGING_REF = 'bwswqnhlebbzdxumlkih';

export function assertStagingConnection(raw) {
  if (!raw) throw new Error('STAGING_DATABASE_URL must be configured.');
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error('Invalid STAGING_DATABASE_URL.'); }
  if (!['postgresql:', 'postgres:'].includes(parsed.protocol)) {
    throw new Error('STAGING_DATABASE_URL must use PostgreSQL.');
  }
  // Both direct and Supabase pooler credentials identify the hosted project.
  // Never allow an arbitrary host, production project or local database here.
  const direct = parsed.hostname === `db.${STAGING_REF}.supabase.co`;
  const pooler = parsed.hostname.endsWith('.pooler.supabase.com')
    && parsed.username === `postgres.${STAGING_REF}`;
  if (!direct && !pooler) throw new Error('Refusing to connect: URL is not ATLAS-OS-Staging.');
  return parsed;
}

const statements = {
  migration_state: `
    SELECT count(*)::integer AS missing_count FROM (
      VALUES ('20261118115324'), ('20261119092000'),
             ('20261119113000'), ('20261120120000')
    ) expected(version)
    WHERE NOT EXISTS (
      SELECT 1 FROM supabase_migrations.schema_migrations m
      WHERE m.version = expected.version
    )`,
  invoice_allocation: `
    WITH allocations AS (
      SELECT invoice_id, sum(amount_allocated) AS amount
      FROM public.payment_allocations GROUP BY invoice_id
    )
    SELECT count(*)::integer AS sample_count,
           count(*) FILTER (WHERE abs(i.total_paid - coalesce(a.amount, 0)) > 0.01
                             OR i.total_paid > i.total_amount + 0.01
                             OR i.total_amount < 0)::integer AS violations
    FROM public.invoices i LEFT JOIN allocations a ON a.invoice_id = i.id`,
  payment_allocation: `
    WITH allocations AS (
      SELECT payment_id, sum(amount_allocated) AS amount
      FROM public.payment_allocations GROUP BY payment_id
    )
    SELECT count(*)::integer AS sample_count,
           count(*) FILTER (WHERE coalesce(a.amount,0) > p.amount + 0.01
                             OR p.amount <= 0)::integer AS violations
    FROM public.payments p LEFT JOIN allocations a ON a.payment_id = p.id`,
  allocation_tenants: `
    SELECT count(*)::integer AS sample_count,
           count(*) FILTER (WHERE i.id IS NULL OR p.id IS NULL
              OR i.organization_id IS DISTINCT FROM p.organization_id)::integer AS violations
    FROM public.payment_allocations a
    LEFT JOIN public.invoices i ON i.id = a.invoice_id
    LEFT JOIN public.payments p ON p.id = a.payment_id`,
  stock_ledger: `
    WITH balances AS (
      SELECT organization_id,product_id,sum(quantity_change) AS quantity
      FROM public.stock_movements GROUP BY organization_id,product_id
    )
    SELECT count(*)::integer AS sample_count,
           count(*) FILTER (WHERE quantity < 0
                 OR p.id IS NULL OR p.organization_id IS DISTINCT FROM b.organization_id)::integer AS violations
    FROM balances b LEFT JOIN public.products p ON p.id = b.product_id`,
  quarantine: `
    SELECT count(*)::integer AS sample_count,
           count(*) FILTER (WHERE quarantine_quantity < 0
                    OR counted_quantity < 0)::integer AS violations
    FROM public.stock_count_approvals`,
};

export async function checkStagingIntegrity(query) {
  const checks = [];
  for (const [name, sql] of Object.entries(statements)) {
    const result = await query(sql);
    const row = result.rows?.[0];
    if (!row) throw new Error(`No result for ${name}`);
    if (name === 'migration_state') {
      const missing = Number(row.missing_count);
      checks.push({ name, status: missing === 0 ? 'pass' : 'blocked', missing });
      continue;
    }
    const samples = Number(row.sample_count);
    const violations = Number(row.violations);
    if (![samples, violations].every(Number.isSafeInteger) || samples < 0 || violations < 0) {
      throw new Error(`Invalid count for ${name}`);
    }
    checks.push({
      name, samples, violations,
      status: violations ? 'fail' : samples ? 'pass' : 'blocked',
    });
  }
  return {
    checks,
    status: checks.some(c => c.status === 'fail') ? 'fail'
      : checks.some(c => c.status === 'blocked') ? 'blocked' : 'pass',
  };
}

async function main() {
  assertStagingConnection(process.env.STAGING_DATABASE_URL);
  const client = new pg.Client({ connectionString: process.env.STAGING_DATABASE_URL, ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 12000 });
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const result = await checkStagingIntegrity(sql => client.query(sql));
    await client.query('ROLLBACK');
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.status === 'pass' ? 0 : result.status === 'blocked' ? 2 : 1;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    // Never print connection strings or SQL provider responses containing credentials.
    console.error('Staging integrity check failed; inspect staging connectivity and schema privately.');
    process.exitCode = 1;
  });
}
