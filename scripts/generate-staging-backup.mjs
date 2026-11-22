import { execFileSync } from 'node:child_process';
import { writeFileSync, statSync } from 'node:fs';

const SUPABASE_CLI = 'C:\\Users\\VIJAY\\AppData\\Local\\npm-cache\\_npx\\aa8e5c70f9d8d161\\node_modules\\@supabase\\cli-windows-x64\\bin\\supabase.exe';

function runSql(sql) {
  const stdout = execFileSync(SUPABASE_CLI, ['db', 'query', '--linked', sql], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  
  // Extract json between boundaries if present, or parse directly
  const jsonMatch = stdout.match(/\{[\s\S]*"rows"[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Failed to parse query output: ${stdout}`);
  }
  const parsed = JSON.parse(jsonMatch[0]);
  return parsed.rows || [];
}

function escapeSqlValue(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  if (typeof val === 'object') {
    return `'${JSON.stringify(val).replace(/'/g, "''")}'::jsonb`;
  }
  return `'${String(val).replace(/'/g, "''")}'`;
}

async function main() {
  console.log('Connecting to linked Supabase project bwswqnhlebbzdxumlkih via Management API...');

  const tablesToDump = [
    'supabase_migrations.schema_migrations',
    'public.organizations',
    'public.memberships',
    'public.suppliers',
    'public.products',
    'public.stock_movements',
    'public.customers',
    'public.invoices',
    'public.invoice_items',
    'public.payments',
    'public.payment_allocations',
    'public.sales_orders',
    'public.sales_order_items',
    'public.quotations',
    'public.quotation_items',
    'public.counter_shifts',
    'public.counter_shift_payments',
    'public.counter_cash_movements',
    'public.document_sequences',
    'public.goods_receipts',
    'public.audit_events',
  ];

  let sqlOutput = `-- ============================================================================\n`;
  sqlOutput += `-- ATLAS OS STAGING PRE-AAL2 BACKUP SNAPSHOT\n`;
  sqlOutput += `-- Project: bwswqnhlebbzdxumlkih (ATLAS-OS-Staging)\n`;
  sqlOutput += `-- Created At: ${new Date().toISOString()}\n`;
  sqlOutput += `-- Snapshot Type: Full Pre-AAL2 Migration (071-074) Checkpoint\n`;
  sqlOutput += `-- ============================================================================\n\n`;
  sqlOutput += `BEGIN;\n\n`;

  let totalRowsDumped = 0;

  for (const fullTableName of tablesToDump) {
    const [schema, table] = fullTableName.split('.');
    console.log(`Checking table ${fullTableName}...`);
    
    const countRows = runSql(`SELECT count(*)::int as count FROM ${fullTableName};`);
    const count = countRows[0]?.count || 0;
    
    if (count === 0) {
      sqlOutput += `-- Table ${fullTableName}: 0 rows\n\n`;
      continue;
    }

    console.log(`Dumping ${count} rows from ${fullTableName}...`);
    totalRowsDumped += count;

    const dataRows = runSql(`SELECT json_agg(t) as data FROM (SELECT * FROM ${fullTableName}) t;`);
    const items = dataRows[0]?.data || [];

    if (items.length > 0) {
      sqlOutput += `-- ----------------------------------------------------------------------------\n`;
      sqlOutput += `-- Data for ${fullTableName} (${items.length} records)\n`;
      sqlOutput += `-- ----------------------------------------------------------------------------\n`;

      const columns = Object.keys(items[0]);
      const colList = columns.map(c => `"${c}"`).join(', ');

      for (const row of items) {
        const valList = columns.map(c => escapeSqlValue(row[c])).join(', ');
        sqlOutput += `INSERT INTO ${fullTableName} (${colList}) VALUES (${valList}) ON CONFLICT DO NOTHING;\n`;
      }
      sqlOutput += `\n`;
    }
  }

  sqlOutput += `COMMIT;\n`;

  const outputPath = 'staging_backup_pre_aal2.sql';
  writeFileSync(outputPath, sqlOutput, 'utf8');

  const stats = statSync(outputPath);
  console.log(`\nSuccessfully created backup snapshot: ${outputPath}`);
  console.log(`Total tables dumped with records: ${totalRowsDumped} total rows`);
  console.log(`File size: ${stats.size} bytes (${(stats.size / 1024).toFixed(2)} KB)`);
}

main().catch((err) => {
  console.error('Backup generation failed:', err);
  process.exit(1);
});
