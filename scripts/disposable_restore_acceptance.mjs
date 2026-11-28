import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const measuredTables = [
  'atlas_private.ice_invoice_reviews','atlas_private.ice_invoice_review_operations',
  'atlas_private.ice_location_members','atlas_private.ice_location_access_history',
  'atlas_private.industry_cancellations',
  'atlas_private.ice_events','atlas_private.industry_operations',
  'atlas_school.staff_identity','atlas_school.staff_identity_history','atlas_school.staff_leave','atlas_school.staff_timetables',
  'public.staff_clock_sessions',
  'atlas_private.staff_portal_members',
  'atlas_private.workspace_products', 'atlas_school.portal_links',
  'atlas_school.settings', 'atlas_school.years', 'atlas_school.classes',
  'atlas_school.students', 'atlas_school.enrolments', 'atlas_school.attendance',
  'atlas_school.charges', 'atlas_school.receipts', 'atlas_school.allocations',
  'atlas_school.concessions', 'atlas_school.refunds', 'atlas_school.refund_allocations',
  'atlas_school.operations', 'atlas_school.audit',
  'public.goods_receipts',
  'public.stock_movements',
  'public.sales_orders',
  'public.invoices',
  'public.payments',
  'public.counter_shifts',
  'public.counter_shift_payments',
  'atlas_private.counter_checkout_requests',
  'atlas_private.client_support_tickets',
  'atlas_private.atlas_plan_purchases',
  'atlas_private.owner_console_accounts',
  'atlas_private.owner_console_events',
];

async function snapshot(client) {
  const { rows } = await client.query(measuredTables.map(table =>
    `SELECT '${table}' AS table_name, count(*)::int AS records,
      md5(string_agg(to_jsonb(t)::text, chr(10) ORDER BY to_jsonb(t)::text)) AS checksum FROM ${table} t`
  ).join(' UNION ALL ') + ' ORDER BY table_name');
  return rows;
}

function postgresEnv(connection) {
  return {
    ...process.env,
    PGHOST: connection.hostname,
    PGHOSTADDR: '',
    PGPORT: connection.port || '5432',
    PGUSER: decodeURIComponent(connection.username),
    PGPASSWORD: decodeURIComponent(connection.password),
    PGDATABASE: connection.pathname.slice(1),
  };
}

export async function runDisposableRestoreAcceptance({ client, maintenance, sourceUrl, Client, withRoleContext }) {
  const source = new URL(sourceUrl);
  const sourceName = source.pathname.slice(1);
  assert(['localhost', '127.0.0.1'].includes(source.hostname), 'Restore drill requires a loopback PostgreSQL server.');
  assert(/^atlas_test_sec_[a-f0-9]{8}$/.test(sourceName), 'Restore drill requires an isolated acceptance database.');

  const destination = new URL(source);
  const restoredName = sourceName.replace('atlas_test_', 'atlas_restore_');
  destination.pathname = '/' + restoredName;
  const before = await snapshot(client);
  for (const table of before) assert(table.records > 0, `Missing fixture data in ${table.table_name}`);

  const folder = await mkdtemp(join(tmpdir(), 'atlas-disposable-restore-'));
  const archive = join(folder, 'acceptance.dump');
  const restored = new Client({ connectionString: destination.toString() });
  let created = false;
  let connected = false;
  const started = performance.now();
  try {
    await run('pg_dump', ['--no-password', '--format=custom', '--file', archive], {
      env: postgresEnv(source), timeout: 60_000,
    });
    await maintenance.query(`CREATE DATABASE "${restoredName}" TEMPLATE template0`);
    created = true;
    await run('pg_restore', ['--no-password', '--exit-on-error', '--single-transaction', '--dbname', restoredName, archive], {
      env: postgresEnv(destination), timeout: 60_000,
    });
    await restored.connect();
    connected = true;
    assert.deepEqual(await snapshot(restored), before, 'Restored operational data differs from the source.');

    const { rows: [{ user_id: owner }] } = await restored.query('SELECT user_id FROM atlas_private.owner_console_accounts WHERE slot=1');
    const overview = () => restored.query("SELECT public.owner_console_request('overview','{}') AS overview");
    await assert.rejects(withRoleContext(restored, { role: 'anon' }, overview), { code: '42501' });
    await withRoleContext(restored, { userId: owner, aal: 'aal1' }, async () => {
      await assert.rejects(overview(), { code: '42501' });
      await restored.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: owner, aal: 'aal2' })]);
      try {
        assert.equal((await overview()).rows[0].overview.months.length, 6);
      } finally {
        await restored.query("SELECT set_config('request.jwt.claims','',false)");
      }
    });
    return `${before.length} tables matched by count and content; owner MFA enforced after restore. Elapsed: ${Math.round(performance.now() - started)} ms.`;
  } finally {
    try {
      try {
        if (connected) await restored.end();
      } finally {
        if (created) await maintenance.query(`DROP DATABASE "${restoredName}" WITH (FORCE)`);
      }
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }
}
