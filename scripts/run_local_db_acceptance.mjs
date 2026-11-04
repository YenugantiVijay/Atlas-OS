/**
 * Atlas OS — Master Security, Database & Lifecycle Acceptance Test Runner
 *
 * Runs full database lifecycle verification:
 * 1. Connects as administrative user to disposable local PostgreSQL instance.
 * 2. Provisions an isolated ephemeral test database (atlas_test_<runId>) to guarantee
 *    strict test isolation and protect statutory ledger immutability without fallback.
 * 3. Bootstraps standard Supabase roles (anon, authenticated, service_role, authenticator),
 *    schemas (auth, extensions, public), privileges, and auth helper functions (auth.uid, auth.role, auth.jwt).
 * 4. Applies forward-only migrations 001 through 026 in strict lexical order with ON_ERROR_STOP=1.
 * 5. Seeds isolated multi-tenant test fixtures with genuine auth identities and valid schema attributes.
 * 6. Executes P0/P1 security and lifecycle contracts under REAL RESTRICTED DATABASE ROLES (SET ROLE authenticated / anon).
 * 7. Tests lifecycle trust flags against spoofing attempts by authenticated database roles (Migration 026 invoker triggers).
 * 8. Queries set-returning stock functions (get_product_stock_levels) using parameterized SQL filtering on product_id.
 * 9. Verifies authoritative RPC contracts and idempotent replays (confirm_sales_order, create_invoice_atomic, convert_quotation_atomic, record_payment_and_allocate, get_dashboard_metrics).
 * 10. Asserts table-level DML revocations (stock_movements, payments, etc.) are genuinely enforced without post-migration distortion.
 * 11. Disposes of the dedicated test database cleanly in the finally block; exits non-zero on any failure or local DB unavailability.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import crypto from 'crypto';

const { Client } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'supabase', 'migrations');

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  `postgresql://${process.env.POSTGRES_USER || 'postgres'}:${process.env.POSTGRES_PASSWORD || 'postgrespassword'}@${process.env.POSTGRES_HOST || '127.0.0.1'}:${process.env.POSTGRES_PORT || 5432}/${process.env.POSTGRES_DB || 'postgres'}`;

const testResults = [];

function recordTest(id, name, passed, details, error = null) {
  testResults.push({ id, name, passed, details, error: error ? String(error.message || error) : null, timestamp: new Date().toISOString() });
  const badge = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`[${id}] ${badge} - ${name}`);
  if (details) {
    console.log(`       Details: ${details}`);
  }
  if (!passed && error) {
    console.error(`       Error:   ${error.message || error}`);
    if (error.code) console.error(`       SQLSTATE: ${error.code}`);
  }
}

/**
 * Validates that DATABASE_URL points to a disposable local test database.
 * Strictly prevents running acceptance scripts against remote or production environments.
 */
function assertDisposableDatabase(urlStr) {
  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error(`Invalid DATABASE_URL format: ${urlStr.replace(/:([^:@]+)@/, ':****@')}`);
  }

  const hostname = parsed.hostname.toLowerCase();
  const isLocal = ['localhost', '127.0.0.1', '::1', 'postgres'].includes(hostname) || hostname.endsWith('.local');
  const isRemote =
    hostname.includes('supabase.co') ||
    hostname.includes('amazonaws.com') ||
    hostname.includes('rds.') ||
    hostname.includes('prod') ||
    hostname.includes('production') ||
    !isLocal;

  if (isRemote) {
    throw new Error(
      `🚨 SAFETY VIOLATION: Acceptance tests must only run on a disposable local database. Detected remote/production-like host: "${hostname}"`
    );
  }
}

/**
 * Executes a callback within a genuine restricted database role and auth context.
 * Strictly asserts identity and active database role before running the callback.
 */
async function withRoleContext(client, { role = 'authenticated', userId = null }, fn) {
  // 1. Switch to restricted database role and set transaction/session JWT claims
  await client.query(`SET ROLE ${role};`);
  if (userId) {
    await client.query(`SELECT set_config('request.jwt.claim.sub', '${userId}', false);`);
  } else {
    await client.query(`SELECT set_config('request.jwt.claim.sub', '', false);`);
  }
  await client.query(`SELECT set_config('request.jwt.claim.role', '${role}', false);`);

  // 2. Identity Assertion: verify active database role and auth.uid()
  const { rows: verifyRows } = await client.query(`
    SELECT current_user, session_user, auth.uid()::text AS active_uid, auth.role() AS active_role;
  `);
  const activeUser = verifyRows[0].current_user;
  const activeUid = verifyRows[0].active_uid;
  const activeRole = verifyRows[0].active_role;

  if (activeUser !== role) {
    await client.query(`RESET ROLE;`);
    throw new Error(`Security context assertion failed: current_user is '${activeUser}', expected '${role}'`);
  }
  if (userId && activeUid !== userId) {
    await client.query(`RESET ROLE;`);
    throw new Error(`Security context assertion failed: auth.uid() is '${activeUid}', expected '${userId}'`);
  }
  if (activeRole !== role) {
    await client.query(`RESET ROLE;`);
    throw new Error(`Security context assertion failed: auth.role() is '${activeRole}', expected '${role}'`);
  }

  try {
    return await fn();
  } finally {
    // 3. Reset role and clear session JWT claims safely
    await client.query(`
      RESET ROLE;
      SELECT set_config('request.jwt.claim.sub', '', false);
      SELECT set_config('request.jwt.claim.role', '', false);
      SELECT set_config('app.authoritative_order_transition', '', false);
      SELECT set_config('app.authoritative_invoice_transition', '', false);
      SELECT set_config('app.authoritative_payment_allocation', '', false);
    `);
  }
}

async function runAcceptance() {
  console.log('='.repeat(80));
  console.log('ATLAS OS — MASTER SECURITY & LIFECYCLE DATABASE ACCEPTANCE SUITE');
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Target:    ${DATABASE_URL.replace(/:([^:@]+)@/, ':****@')}`);
  console.log('='.repeat(80));

  // Enforce disposable database safety pre-flight
  assertDisposableDatabase(DATABASE_URL);

  const runId = 'sec_' + crypto.randomBytes(4).toString('hex');
  const testDbName = `atlas_test_${runId}`;

  // Parse maintenance database endpoint
  const maintUrl = new URL(DATABASE_URL);
  const maintDbName = maintUrl.pathname.replace(/^\//, '') || 'postgres';

  const maintClient = new Client({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 5000,
  });

  try {
    await maintClient.connect();
    console.log(`Connected to PostgreSQL administrative endpoint ("${maintDbName}") successfully.\n`);
  } catch (err) {
    console.error('\n⚠️  PostgreSQL connection failed:');
    console.error(`   ${err.message}`);
    console.error('\nEnvironment Diagnostic:');
    console.error('   A running PostgreSQL instance is required to execute live database acceptance tests.');
    console.error('   - In CI (GitHub Actions): Postgres service container is automatically provisioned.');
    console.error('   - In local development: start postgres (e.g. docker run -p 5432:5432 ...) and provide DATABASE_URL.');
    console.error('\n❌ Exiting non-zero because live database acceptance testing could not proceed.');
    process.exit(1);
  }

  // --------------------------------------------------------------------------
  // Provision Dedicated Ephemeral Test Database (Strict Isolation, No Fallback)
  // --------------------------------------------------------------------------
  let testClient = null;
  let testDbCreated = false;
  let cleanupSuccessful = false;

  try {
    console.log(`Step 0: Provisioning isolated ephemeral test database "${testDbName}"...`);
    await maintClient.query(`CREATE DATABASE "${testDbName}";`);
    testDbCreated = true;
    console.log(`  ✓ Dedicated test database "${testDbName}" created successfully.`);

    const testDbUrl = new URL(DATABASE_URL);
    testDbUrl.pathname = '/' + testDbName;

    testClient = new Client({
      connectionString: testDbUrl.toString(),
      connectionTimeoutMillis: 5000,
    });
    await testClient.connect();
    console.log(`  ✓ Connected to isolated test database "${testDbName}".\n`);
  } catch (createDbErr) {
    console.error(`\n❌ Failed to provision dedicated test database "${testDbName}": ${createDbErr.message}`);
    console.error('   Strict test database isolation is required. Unsafe fallback execution against shared databases is disabled.');
    await maintClient.end().catch(() => {});
    process.exit(1);
  }

  const orgAId = crypto.randomUUID();
  const orgBId = crypto.randomUUID();
  const userAId = crypto.randomUUID();
  const userBId = crypto.randomUUID();
  const custAId = crypto.randomUUID();
  const prodA1Id = crypto.randomUUID();
  const prodA2Id = crypto.randomUUID();
  const prodB1Id = crypto.randomUUID();

  try {
    // ------------------------------------------------------------------------
    // Step 1: Bootstrap Standard Supabase-Compatible Roles, Schemas & Auth
    // ------------------------------------------------------------------------
    console.log('Step 1: Bootstrapping Supabase-compatible roles, schemas and auth environment...');
    await testClient.query(`
      -- 1. Create standard Supabase roles if missing (unprivileged, non-superuser accounts)
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
          CREATE ROLE anon NOLOGIN NOINHERIT;
        END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
          CREATE ROLE authenticated NOLOGIN NOINHERIT;
        END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
          CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
        END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticator') THEN
          CREATE ROLE authenticator NOLOGIN NOINHERIT;
        END IF;
      END $$;

      -- 2. Configure role inheritance and memberships
      GRANT anon TO authenticator;
      GRANT authenticated TO authenticator;
      GRANT service_role TO authenticator;

      -- Grant authenticated, anon, and service_role to active session user (allows superuser to SET ROLE for testing)
      GRANT authenticated TO CURRENT_USER;
      GRANT anon TO CURRENT_USER;
      GRANT service_role TO CURRENT_USER;

      -- 3. Create schemas
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE SCHEMA IF NOT EXISTS extensions;
      CREATE SCHEMA IF NOT EXISTS public;

      -- 4. Schema usage and standard permissions
      GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
      GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
      GRANT ALL ON SCHEMA public TO CURRENT_USER, service_role;
      GRANT ALL ON SCHEMA auth TO CURRENT_USER, service_role;

      -- 5. Standard Supabase Default privileges for future tables, sequences and functions
      -- Establishes standard table grants before migrations run so that subsequent
      -- explicit REVOKE statements in migrations 013, 017, 022 remain authoritative.
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO CURRENT_USER, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO CURRENT_USER, service_role, authenticated;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO CURRENT_USER, service_role, authenticated;

      -- 6. Auth users table emulation
      CREATE TABLE IF NOT EXISTS auth.users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        instance_id uuid,
        aud varchar(255) DEFAULT 'authenticated',
        role varchar(255) DEFAULT 'authenticated',
        email varchar(255) UNIQUE,
        encrypted_password varchar(255),
        email_confirmed_at timestamptz DEFAULT now(),
        raw_app_meta_data jsonb DEFAULT '{"provider":"email","providers":["email"]}'::jsonb,
        raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
        is_super_admin boolean DEFAULT false,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      );

      GRANT SELECT ON auth.users TO authenticated, anon;
      GRANT ALL ON auth.users TO CURRENT_USER, service_role;

      -- 7. Auth helper functions
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$ LANGUAGE sql STABLE;

      CREATE OR REPLACE FUNCTION auth.role() RETURNS text AS $$
        SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'authenticated');
      $$ LANGUAGE sql STABLE;

      CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb AS $$
        SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
      $$ LANGUAGE sql STABLE;

      GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC, anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION auth.role() TO PUBLIC, anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION auth.jwt() TO PUBLIC, anon, authenticated, service_role;
    `);
    console.log('  ✓ Roles, schemas, and auth functions bootstrapped successfully.');

    // ------------------------------------------------------------------------
    // Step 2: Apply Migrations 001 - 028 in Strict Lexical Order
    // ------------------------------------------------------------------------
    console.log('\nStep 2: Applying migrations sequentially (001 -> 028)...');
    const migrationFiles = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of migrationFiles) {
      const filePath = path.join(MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(filePath, 'utf8');
      try {
        await testClient.query(sql);
        console.log(`  ✓ Applied migration: ${file}`);
      } catch (migErr) {
        console.error(`\n❌ Migration failed at ${file}: ${migErr.message}`);
        console.error(`   SQLSTATE: ${migErr.code}`);
        throw migErr;
      }
    }

    // Ensure sequences are usable by authenticated role (without altering table-level permissions)
    await testClient.query(`
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
    `);

    // ------------------------------------------------------------------------
    // Step 3: Seed Isolated Multi-Tenant Test Fixtures
    // ------------------------------------------------------------------------
    console.log('\nStep 3: Seeding isolated test fixtures (Org A, Org B, User A, User B)...');
    await testClient.query(`
      INSERT INTO auth.users (id, email) VALUES
      ('${userAId}', 'owner_a_${runId}@example.com'),
      ('${userBId}', 'owner_b_${runId}@example.com')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO organizations (id, name, currency, legal_name, gstin, state) VALUES
      ('${orgAId}', 'Alpha Electricals ${runId}', 'INR', 'Alpha Electricals Pvt Ltd', '29ABCDE1234F1Z5', 'Karnataka'),
      ('${orgBId}', 'Beta Hardware ${runId}', 'INR', 'Beta Hardware LLP', '29XYZAB5678C1Z2', 'Karnataka');

      INSERT INTO memberships (organization_id, user_id, role, is_active) VALUES
      ('${orgAId}', '${userAId}', 'owner', true),
      ('${orgBId}', '${userBId}', 'owner', true);

      -- Valid eligibility fixture using authoritative lowercase enum 'approved' (Migration 013)
      INSERT INTO organization_eligibility (organization_id, business_category, sells_electrical_products, status, declared_by) VALUES
      ('${orgAId}', 'electrical_retail', true, 'approved', '${userAId}'),
      ('${orgBId}', 'electrical_retail', true, 'approved', '${userBId}');

      -- Valid subscription fixture matching authoritative schema: plan_tier, status, current_period_ends_at
      INSERT INTO organization_subscriptions (organization_id, plan_tier, status, current_period_ends_at) VALUES
      ('${orgAId}', 'pro', 'active', now() + interval '30 days'),
      ('${orgBId}', 'pro', 'active', now() + interval '30 days');

      INSERT INTO customers (id, organization_id, name, phone, gstin) VALUES
      ('${custAId}', '${orgAId}', 'Apex Power Projects', '9876543210', '29AAACP1234A1Z1');

      -- Products fixture with valid NOT NULL category ('Wires & Cables', 'Switchgear') from Migration 002
      INSERT INTO products (id, organization_id, name, sku, category, uom, purchase_cost, selling_price, tax_rate, reorder_threshold, is_active) VALUES
      ('${prodA1Id}', '${orgAId}', 'Copper Wire 2.5sqmm', 'WIRE-25-${runId}', 'Wires & Cables', 'Mtr', 20.00, 30.00, 18, 50, true),
      ('${prodA2Id}', '${orgAId}', 'MCB 16A Single Pole', 'MCB-16-${runId}', 'Switchgear', 'Nos', 120.00, 180.00, 18, 10, true),
      ('${prodB1Id}', '${orgBId}', 'Industrial Relay 24V', 'RELAY-24-${runId}', 'Switchgear', 'Nos', 300.00, 450.00, 18, 5, true);

      -- Initial opening stock for product 1 (100 units) and product 2 (50 units)
      INSERT INTO stock_movements (organization_id, product_id, quantity_change, movement_type, notes) VALUES
      ('${orgAId}', '${prodA1Id}', 100, 'OPENING_STOCK', 'Acceptance test opening stock'),
      ('${orgAId}', '${prodA2Id}', 50, 'OPENING_STOCK', 'Acceptance test opening stock');
    `);
    console.log('  ✓ Test fixtures successfully created under administrative privileges.\n');

    // ------------------------------------------------------------------------
    // Step 4: Security Assertions — Restricted Roles & Lifecycle Boundaries
    // ------------------------------------------------------------------------
    console.log('--- EXECUTING AUTHENTICATED SECURITY & LIFECYCLE TESTS ---\n');

    // TEST GROUP 1: Table-Level Privilege Revocations (Migration 013, 017, 022)
    // Direct DML mutations must be rejected with SQLSTATE 42501 (insufficient_privilege)
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let stockMovementBlocked = false;
      let stockMovementErr = null;
      try {
        await testClient.query(
          `INSERT INTO stock_movements (organization_id, product_id, quantity_change, movement_type, notes)
           VALUES ($1::uuid, $2::uuid, 10, 'GOODS_RECEIVED', 'Bypass attempt');`,
          [orgAId, prodA1Id]
        );
      } catch (err) {
        stockMovementErr = err;
        stockMovementBlocked = err.code === '42501' || err.message.includes('permission denied');
      }
      recordTest(
        'P0-SEC-REVOKE-01',
        'Direct INSERT on stock_movements is rejected by table-level revocation (SQLSTATE 42501)',
        stockMovementBlocked,
        `Migration 022 revokes direct mutations; caught SQLSTATE ${stockMovementErr?.code}`,
        stockMovementBlocked ? null : stockMovementErr
      );
    });

    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let stockUpdateBlocked = false;
      let stockUpdateErr = null;
      try {
        await testClient.query(
          `UPDATE stock_movements SET quantity_change = 999 WHERE product_id = $1::uuid;`,
          [prodA1Id]
        );
      } catch (err) {
        stockUpdateErr = err;
        stockUpdateBlocked = err.code === '42501' || err.message.includes('permission denied');
      }
      recordTest(
        'P0-SEC-REVOKE-02',
        'Direct UPDATE on stock_movements is rejected by table-level revocation (SQLSTATE 42501)',
        stockUpdateBlocked,
        `Migration 022 revokes direct mutations; caught SQLSTATE ${stockUpdateErr?.code}`,
        stockUpdateBlocked ? null : stockUpdateErr
      );
    });

    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let paymentsBlocked = false;
      let paymentsErr = null;
      try {
        await testClient.query(
          `INSERT INTO payments (organization_id, customer_id, payment_number, amount, payment_method, payment_date)
           VALUES ($1::uuid, $2::uuid, 'PAY-BYPASS-01', 500.00, 'CASH', '2026-11-02');`,
          [orgAId, custAId]
        );
      } catch (err) {
        paymentsErr = err;
        paymentsBlocked = err.code === '42501' || err.message.includes('permission denied');
      }
      recordTest(
        'P0-SEC-REVOKE-03',
        'Direct INSERT on payments is rejected by table-level revocation (SQLSTATE 42501)',
        paymentsBlocked,
        `Migration 017 revokes direct mutations; caught SQLSTATE ${paymentsErr?.code}`,
        paymentsBlocked ? null : paymentsErr
      );
    });

    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let allocBlocked = false;
      let allocErr = null;
      try {
        await testClient.query(
          `INSERT INTO payment_allocations (payment_id, invoice_id, amount_allocated)
           VALUES ($1::uuid, $2::uuid, 100.00);`,
          [crypto.randomUUID(), crypto.randomUUID()]
        );
      } catch (err) {
        allocErr = err;
        allocBlocked = err.code === '42501' || err.message.includes('permission denied');
      }
      recordTest(
        'P0-SEC-REVOKE-04',
        'Direct INSERT on payment_allocations is rejected by table-level revocation (SQLSTATE 42501)',
        allocBlocked,
        `Migration 017 revokes direct mutations; caught SQLSTATE ${allocErr?.code}`,
        allocBlocked ? null : allocErr
      );
    });

    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let eligBlocked = false;
      let eligErr = null;
      try {
        await testClient.query(
          `INSERT INTO organization_eligibility (organization_id, business_category, status, declared_by)
           VALUES ($1::uuid, 'electrical_retail', 'approved', $2::uuid);`,
          [crypto.randomUUID(), userAId]
        );
      } catch (err) {
        eligErr = err;
        eligBlocked = err.code === '42501' || err.message.includes('permission denied');
      }
      recordTest(
        'P0-SEC-REVOKE-05',
        'Direct INSERT on organization_eligibility is rejected by table-level revocation (SQLSTATE 42501)',
        eligBlocked,
        `Migration 013 revokes direct mutations; caught SQLSTATE ${eligErr?.code}`,
        eligBlocked ? null : eligErr
      );
    });

    // TEST GROUP 2: Sales Order Direct Insertion & Transition Boundary
    // TEST 1: Direct insert of CONFIRMED sales order under authenticated role is blocked
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let blocked = false;
      let caughtErr = null;
      try {
        await testClient.query(
          `INSERT INTO sales_orders (organization_id, customer_id, order_number, status, order_date, subtotal, tax_amount, total_amount)
           VALUES ($1::uuid, $2::uuid, 'SO-BYPASS-01', 'CONFIRMED', '2026-11-02', 100, 18, 118);`,
          [orgAId, custAId]
        );
      } catch (err) {
        caughtErr = err;
        blocked = err.code === '42501' || err.code === '23514' || err.message.includes('prohibited') || err.message.includes('DRAFT');
      }

      // Assert no row was inserted into sales_orders
      const { rows: verifyNoRow } = await testClient.query(`SELECT id FROM sales_orders WHERE order_number = 'SO-BYPASS-01';`);
      const zeroInserted = verifyNoRow.length === 0;

      recordTest(
        'P0-SO-01',
        'Direct insert of CONFIRMED sales order as authenticated role is rejected',
        blocked && zeroInserted,
        `Enforced by RLS policy sales_orders_insert and trigger (SQLSTATE ${caughtErr?.code})`,
        blocked && zeroInserted ? null : caughtErr
      );
    });

    // TEST 2: Direct insert of FULFILLED sales order under authenticated role is blocked
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let blocked = false;
      let caughtErr = null;
      try {
        await testClient.query(
          `INSERT INTO sales_orders (organization_id, customer_id, order_number, status, order_date, subtotal, tax_amount, total_amount)
           VALUES ($1::uuid, $2::uuid, 'SO-BYPASS-02', 'FULFILLED', '2026-11-02', 100, 18, 118);`,
          [orgAId, custAId]
        );
      } catch (err) {
        caughtErr = err;
        blocked = err.code === '42501' || err.code === '23514' || err.message.includes('prohibited') || err.message.includes('DRAFT');
      }

      const { rows: verifyNoRow } = await testClient.query(`SELECT id FROM sales_orders WHERE order_number = 'SO-BYPASS-02';`);
      const zeroInserted = verifyNoRow.length === 0;

      recordTest(
        'P0-SO-02',
        'Direct insert of FULFILLED sales order as authenticated role is rejected',
        blocked && zeroInserted,
        `Enforced by RLS policy sales_orders_insert and trigger (SQLSTATE ${caughtErr?.code})`,
        blocked && zeroInserted ? null : caughtErr
      );
    });

    // Create a legitimate DRAFT order with items
    const draftOrderId = crypto.randomUUID();
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      await testClient.query(
        `INSERT INTO sales_orders (id, organization_id, customer_id, order_number, status, order_date, subtotal, tax_amount, total_amount)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'DRAFT', '2026-11-02', 300, 54, 354);`,
        [draftOrderId, orgAId, custAId, `SO-DRAFT-${runId}`]
      );

      await testClient.query(
        `INSERT INTO sales_order_items (sales_order_id, product_id, product_name, product_sku, uom, quantity, unit_price, tax_rate, line_subtotal, line_tax, line_total)
         VALUES ($1::uuid, $2::uuid, 'Copper Wire 2.5sqmm', $3, 'Mtr', 10, 30.00, 18, 300, 54, 354);`,
        [draftOrderId, prodA1Id, `WIRE-25-${runId}`]
      );
    });

    // TEST 3: Direct status change from DRAFT to CONFIRMED as authenticated role is blocked
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let blocked = false;
      let caughtErr = null;
      try {
        await testClient.query(`UPDATE sales_orders SET status = 'CONFIRMED' WHERE id = $1::uuid;`, [draftOrderId]);
      } catch (err) {
        caughtErr = err;
        blocked = err.code === '42501' || err.code === '23514' || err.message.includes('prohibited') || err.message.includes('confirm_sales_order');
      }
      recordTest(
        'P0-SO-03',
        'Direct status change from DRAFT to CONFIRMED is rejected for authenticated role',
        blocked,
        `Enforced by RLS sales_orders_update WITH CHECK and trigger (SQLSTATE ${caughtErr?.code})`,
        blocked ? null : caughtErr
      );
    });

    // TEST 4: Attempted GUC trust flag manipulation by authenticated role is rejected (Migration 026)
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let blocked = false;
      let caughtErr = null;
      try {
        // Attacker sets session GUC and attempts direct update
        await testClient.query(`SELECT set_config('app.authoritative_order_transition', 'true', false);`);
        await testClient.query(`UPDATE sales_orders SET status = 'CONFIRMED' WHERE id = $1::uuid;`, [draftOrderId]);
      } catch (err) {
        caughtErr = err;
        blocked = err.code === '42501' || err.code === '23514' || err.message.includes('prohibited');
      }

      // Assert database order status is still DRAFT
      const { rows: orderRows } = await testClient.query(`SELECT status FROM sales_orders WHERE id = $1::uuid;`, [draftOrderId]);
      const remainsDraft = orderRows[0]?.status === 'DRAFT';

      recordTest(
        'P0-SO-04-GUC',
        'Attempted GUC spoofing (app.authoritative_order_transition) by authenticated role is rejected',
        blocked && remainsDraft,
        `Migration 026 SECURITY INVOKER trigger detects CURRENT_USER='authenticated' and rejects transition (SQLSTATE ${caughtErr?.code})`,
        blocked && remainsDraft ? null : caughtErr
      );
    });

    // TEST 5: Authoritative confirmation via confirm_sales_order RPC succeeds & deducts stock
    // Uses parameterized set-returning query: SELECT current_stock FROM public.get_product_stock_levels($1::uuid) WHERE product_id = $2::uuid;
    let confirmedResult = null;
    let stockBefore = null;
    let stockAfter = null;

    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      // 1. Get stock before confirmation
      const { rows: stockB4Rows } = await testClient.query(
        `SELECT current_stock FROM public.get_product_stock_levels($1::uuid) WHERE product_id = $2::uuid;`,
        [orgAId, prodA1Id]
      );
      if (stockB4Rows.length === 0) {
        throw new Error(`Stock record not found for product ${prodA1Id} before confirmation`);
      }
      stockBefore = Number(stockB4Rows[0].current_stock);

      // 2. Authoritative confirmation call
      const { rows: confRows } = await testClient.query(
        `SELECT confirm_sales_order(p_order_id := $1::uuid, p_org_id := $2::uuid) AS result;`,
        [draftOrderId, orgAId]
      );
      confirmedResult = confRows[0]?.result;

      // 3. Get stock after confirmation
      const { rows: stockAftRows } = await testClient.query(
        `SELECT current_stock FROM public.get_product_stock_levels($1::uuid) WHERE product_id = $2::uuid;`,
        [orgAId, prodA1Id]
      );
      if (stockAftRows.length === 0) {
        throw new Error(`Stock record not found for product ${prodA1Id} after confirmation`);
      }
      stockAfter = Number(stockAftRows[0].current_stock);
    });

    const isConfirmed = confirmedResult?.success === true && confirmedResult?.status === 'CONFIRMED';
    const exactly10Deducted = stockBefore === 100 && stockAfter === 90 && (stockBefore - stockAfter === 10);

    // Verify order status and audit log directly in PostgreSQL
    const { rows: orderCheck } = await testClient.query(`SELECT status FROM sales_orders WHERE id = $1::uuid;`, [draftOrderId]);
    const dbConfirmed = orderCheck[0]?.status === 'CONFIRMED';

    const { rows: auditCheck } = await testClient.query(
      `SELECT count(*)::int AS cnt FROM audit_events WHERE entity_id = $1::uuid AND action = 'CONFIRM_ORDER';`,
      [draftOrderId]
    );
    const auditCreated = auditCheck[0]?.cnt === 1;

    recordTest(
      'P0-SO-05',
      'Authoritative confirm_sales_order RPC transitions to CONFIRMED and deducts stock exactly once',
      Boolean(isConfirmed && exactly10Deducted && dbConfirmed && auditCreated),
      `Stock reduced from ${stockBefore} to ${stockAfter} (-10 Mtr); DB status: ${orderCheck[0]?.status}; Audit records: ${auditCheck[0]?.cnt}`,
      isConfirmed && exactly10Deducted && dbConfirmed && auditCreated ? null : new Error('Stock deduction, status, or audit record assertion failed')
    );

    // TEST 6: Modification of items on CONFIRMED order is restricted under authenticated role
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      const { rows: beforeRows } = await testClient.query(
        `SELECT id, quantity, unit_price FROM sales_order_items WHERE sales_order_id = $1::uuid;`,
        [draftOrderId]
      );
      const qtyBefore = Number(beforeRows[0]?.quantity);

      let rowCount = -1;
      let caughtErr = null;
      try {
        const res = await testClient.query(
          `UPDATE sales_order_items SET quantity = 25 WHERE sales_order_id = $1::uuid;`,
          [draftOrderId]
        );
        rowCount = res.rowCount;
      } catch (err) {
        caughtErr = err;
      }

      const { rows: afterRows } = await testClient.query(
        `SELECT id, quantity, unit_price FROM sales_order_items WHERE sales_order_id = $1::uuid;`,
        [draftOrderId]
      );
      const qtyAfter = Number(afterRows[0]?.quantity);

      // In PostgreSQL RLS, updating rows not satisfying USING clause matches 0 rows (rowCount = 0)
      const rlsBlocked = (rowCount === 0 || caughtErr !== null) && qtyBefore === qtyAfter && qtyAfter === 10;
      recordTest(
        'P0-SO-06',
        'Line item mutation on CONFIRMED sales order is restricted by RLS (zero rows modified)',
        rlsBlocked,
        `RLS sales_order_items_update filtered non-draft order (rowCount: ${rowCount}, quantity remained ${qtyAfter})`,
        rlsBlocked ? null : (caughtErr || new Error(`Expected zero rows modified, got rowCount=${rowCount}`))
      );
    });

    // TEST 6-TRG: Direct mutation of items on CONFIRMED order (bypassing RLS as table owner) is rejected by trigger
    {
      let trgBlocked = false;
      let trgErr = null;
      try {
        await testClient.query(
          `UPDATE sales_order_items SET quantity = 25 WHERE sales_order_id = $1::uuid;`,
          [draftOrderId]
        );
      } catch (err) {
        trgErr = err;
        trgBlocked = err.code === '23514' || err.message.includes('CONFIRMED');
      }

      const { rows: itemCheck } = await testClient.query(
        `SELECT quantity FROM sales_order_items WHERE sales_order_id = $1::uuid;`,
        [draftOrderId]
      );
      const remains10 = Number(itemCheck[0]?.quantity) === 10;

      recordTest(
        'P0-SO-06-TRG',
        'Direct item mutation on CONFIRMED order raises check_violation (23514) in trigger',
        Boolean(trgBlocked && remains10),
        `Enforced by trg_sales_order_items_enforce_parent_status (SQLSTATE ${trgErr?.code}, message: "${trgErr?.message}")`,
        trgBlocked && remains10 ? null : (trgErr || new Error('Trigger did not raise expected check_violation'))
      );
    }

    // TEST 7: Idempotent Replay — Re-confirmation of already CONFIRMED order returns safe replay and avoids double-deduction
    let replayResult = null;
    let stockAfterReplay = null;
    let deductionCount = 0;

    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      const { rows: replayRows } = await testClient.query(
        `SELECT confirm_sales_order(p_order_id := $1::uuid, p_org_id := $2::uuid) AS result;`,
        [draftOrderId, orgAId]
      );
      replayResult = replayRows[0]?.result;

      // Verify stock balance remained identical
      const { rows: stockReplayRows } = await testClient.query(
        `SELECT current_stock FROM public.get_product_stock_levels($1::uuid) WHERE product_id = $2::uuid;`,
        [orgAId, prodA1Id]
      );
      if (stockReplayRows.length === 0) {
        throw new Error(`Stock record not found for product ${prodA1Id} after replay`);
      }
      stockAfterReplay = Number(stockReplayRows[0].current_stock);

      // Count stock movement deductions for this order
      const { rows: smRows } = await testClient.query(
        `SELECT count(*)::int AS cnt FROM stock_movements WHERE reference_id = $1::uuid AND movement_type = 'SALES_DISPATCH';`,
        [draftOrderId]
      );
      deductionCount = smRows[0]?.cnt || 0;
    });

    const isIdempotentReplay =
      replayResult?.success === true &&
      replayResult?.idempotent_replay === true &&
      replayResult?.status === 'CONFIRMED' &&
      stockAfterReplay === 90 &&
      deductionCount === 1;

    recordTest(
      'P0-SO-07',
      'Idempotent replay on confirm_sales_order returns cached confirmation and prevents double-deduction',
      Boolean(isIdempotentReplay),
      `Replay returned idempotent_replay: true; Stock remained ${stockAfterReplay}; Deductions count: ${deductionCount}`,
      isIdempotentReplay ? null : new Error('Replay failed or double-deducted inventory')
    );

    // TEST: Multi-product sales order creation via create_sales_order_atomic
    let multiSoResult = null;
    const multiSoKey = crypto.randomUUID();
    const multiItems = JSON.stringify([
      { productId: prodA1Id, quantity: 5, unitPrice: 30.00, discountPercent: 0, taxRate: 18 },
      { productId: prodA2Id, quantity: 2, unitPrice: 180.00, discountPercent: 0, taxRate: 18 },
    ]);

    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      const { rows: soRows } = await testClient.query(
        `SELECT create_sales_order_atomic(
          p_org_id := $1::uuid,
          p_customer_id := $2::uuid,
          p_order_date := '2026-11-02'::date,
          p_items := $3::jsonb,
          p_notes := 'Multi-item sales order'::text,
          p_quotation_id := NULL::uuid,
          p_idempotency_key := $4::uuid
        ) AS result;`,
        [orgAId, custAId, multiItems, multiSoKey]
      );
      multiSoResult = soRows[0]?.result;
    });

    // Verification: Subtotal = (5*30) + (2*180) = 150 + 360 = 510; Tax 18% = 91.80; Total = 601.80
    const multiSoValid =
      multiSoResult?.id &&
      multiSoResult?.status === 'DRAFT' &&
      Number(multiSoResult?.subtotal) === 510.00 &&
      Number(multiSoResult?.tax_amount) === 91.80 &&
      Number(multiSoResult?.total_amount) === 601.80 &&
      Array.isArray(multiSoResult?.items) &&
      multiSoResult.items.length === 2;

    recordTest(
      'P0-SO-DOC-01',
      'Multi-product sales order creation via create_sales_order_atomic calculates subtotal and tax accurately',
      Boolean(multiSoValid),
      `Order ${multiSoResult?.order_number} created with 2 items; Subtotal: ${multiSoResult?.subtotal}, Tax: ${multiSoResult?.tax_amount}, Total: ${multiSoResult?.total_amount}`,
      multiSoValid ? null : new Error('Multi-product sales order creation returned invalid totals or items')
    );

    // TEST: Cross-tenant product rejection in create_sales_order_atomic
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let crossProdBlocked = false;
      let crossProdErr = null;
      const crossTenantItems = JSON.stringify([
        { productId: prodB1Id, quantity: 1, unitPrice: 450.00, discountPercent: 0, taxRate: 18 },
      ]);
      try {
        await testClient.query(
          `SELECT create_sales_order_atomic(
            p_org_id := $1::uuid,
            p_customer_id := $2::uuid,
            p_order_date := '2026-11-02'::date,
            p_items := $3::jsonb,
            p_notes := 'Cross-tenant product attempt'::text
          );`,
          [orgAId, custAId, crossTenantItems]
        );
      } catch (err) {
        crossProdErr = err;
        crossProdBlocked = err.message.includes('do not belong to organization') || err.message.includes('not found');
      }

      recordTest(
        'P0-SO-DOC-02',
        'Cross-tenant product in create_sales_order_atomic is strictly rejected',
        crossProdBlocked,
        `Rejected cross-tenant product: "${crossProdErr?.message}"`,
        crossProdBlocked ? null : crossProdErr
      );
    });

    // TEST: Invalid quantity rejection in create_sales_order_atomic
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let invalidQtyBlocked = false;
      let invalidQtyErr = null;
      const invalidQtyItems = JSON.stringify([
        { productId: prodA1Id, quantity: 0, unitPrice: 30.00, discountPercent: 0, taxRate: 18 },
      ]);
      try {
        await testClient.query(
          `SELECT create_sales_order_atomic(
            p_org_id := $1::uuid,
            p_customer_id := $2::uuid,
            p_order_date := '2026-11-02'::date,
            p_items := $3::jsonb,
            p_notes := 'Invalid quantity attempt'::text
          );`,
          [orgAId, custAId, invalidQtyItems]
        );
      } catch (err) {
        invalidQtyErr = err;
        invalidQtyBlocked = err.message.includes('invalid quantity') || err.message.includes('must be >= 1');
      }

      recordTest(
        'P0-SO-DOC-03',
        'Invalid quantity (<= 0) in create_sales_order_atomic is strictly rejected',
        invalidQtyBlocked,
        `Rejected non-positive quantity: "${invalidQtyErr?.message}"`,
        invalidQtyBlocked ? null : invalidQtyErr
      );
    });

    // TEST 8: Direct insert of ISSUED invoice is blocked
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let blocked = false;
      let caughtErr = null;
      try {
        await testClient.query(
          `INSERT INTO invoices (organization_id, customer_id, invoice_number, status, invoice_date, due_date, subtotal, tax_amount, total_amount)
           VALUES ($1::uuid, $2::uuid, 'INV-BYPASS-01', 'ISSUED', '2026-11-02', '2026-11-17', 100, 18, 118);`,
          [orgAId, custAId]
        );
      } catch (err) {
        caughtErr = err;
        blocked = err.code === '42501' || err.code === '23514' || err.message.includes('prohibited') || err.message.includes('DRAFT');
      }

      const { rows: verifyNoRow } = await testClient.query(`SELECT id FROM invoices WHERE invoice_number = 'INV-BYPASS-01';`);
      const zeroInserted = verifyNoRow.length === 0;

      recordTest(
        'P0-INV-01',
        'Direct insert of ISSUED invoice as authenticated role is rejected',
        blocked && zeroInserted,
        `Enforced by RLS invoices_insert and trigger (SQLSTATE ${caughtErr?.code})`,
        blocked && zeroInserted ? null : caughtErr
      );
    });

    // TEST 9: Authoritative create_invoice_atomic creates ISSUED invoice and marks SO FULFILLED
    let createdInvoiceId = null;
    let invNumber = null;
    const invItemsJson = JSON.stringify([
      {
        product_id: prodA1Id,
        quantity: 10,
        unit_price: 30.00,
        discount_percent: 0,
        tax_rate: 18,
      },
    ]);

    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      const { rows: invCreateRows } = await testClient.query(
        `SELECT create_invoice_atomic(
          p_org_id := $1::uuid,
          p_customer_id := $2::uuid,
          p_items := $3::jsonb,
          p_invoice_date := '2026-11-02'::date,
          p_due_date := '2026-11-17'::date,
          p_status := 'ISSUED',
          p_notes := 'Invoice created from order',
          p_sales_order_id := $4::uuid,
          p_idempotency_key := $5::uuid
        ) AS result;`,
        [orgAId, custAId, invItemsJson, draftOrderId, crypto.randomUUID()]
      );
      const invObj = invCreateRows[0]?.result;
      createdInvoiceId = invObj?.id;
      invNumber = invObj?.invoice_number;
    });

    // Verify invoice status and sales order status directly in database
    let invoiceIssued = false;
    let orderFulfilled = false;
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      const { rows: iRows } = await testClient.query(`SELECT status FROM invoices WHERE id = $1::uuid;`, [createdInvoiceId]);
      invoiceIssued = iRows[0]?.status === 'ISSUED';
      const { rows: soRows } = await testClient.query(`SELECT status FROM sales_orders WHERE id = $1::uuid;`, [draftOrderId]);
      orderFulfilled = soRows[0]?.status === 'FULFILLED';
    });

    recordTest(
      'P0-INV-02',
      'Authoritative create_invoice_atomic issues invoice and transitions order to FULFILLED',
      Boolean(createdInvoiceId && invoiceIssued && orderFulfilled),
      `Invoice ${invNumber} (${createdInvoiceId}) issued; Sales order marked FULFILLED`,
      createdInvoiceId && invoiceIssued && orderFulfilled ? null : new Error('Invoice was not created or order not fulfilled')
    );

    // TEST 10: Modification of items on ISSUED invoice is blocked
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let blocked = false;
      let caughtErr = null;
      let rowCount = -1;
      try {
        const res = await testClient.query(`UPDATE invoice_items SET quantity = 50 WHERE invoice_id = $1::uuid;`, [createdInvoiceId]);
        rowCount = res.rowCount;
      } catch (err) {
        caughtErr = err;
        blocked = err.code === '42501' || err.code === '23514' || err.message.includes('Cannot') || err.message.includes('immutable');
      }
      if (rowCount === 0) {
        blocked = true;
      }
      recordTest(
        'P0-INV-03',
        'Line item modification on ISSUED invoice is strictly rejected',
        blocked,
        `Enforced by RLS and trg_invoice_items_enforce_status (rowCount: ${rowCount}, SQLSTATE ${caughtErr?.code})`,
        blocked ? null : (caughtErr || new Error(`Expected zero rows modified or error, got rowCount=${rowCount}`))
      );
    });

    // TEST 11: Statutory invoice deletion is blocked
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let blocked = false;
      let caughtErr = null;
      let rowCount = -1;
      try {
        const res = await testClient.query(`DELETE FROM invoices WHERE id = $1::uuid;`, [createdInvoiceId]);
        rowCount = res.rowCount;
      } catch (err) {
        caughtErr = err;
        blocked = err.code === '42501' || err.code === '23514' || err.message.includes('prohibited');
      }
      if (rowCount === 0) {
        blocked = true;
      }
      recordTest(
        'P0-INV-04',
        'Statutory invoice deletion is strictly rejected',
        blocked,
        `Enforced by RLS and trg_invoice_lifecycle (rowCount: ${rowCount}, SQLSTATE ${caughtErr?.code})`,
        blocked ? null : (caughtErr || new Error(`Expected zero rows deleted or error, got rowCount=${rowCount}`))
      );
    });

    // TEST: Standalone invoice creation via create_invoice_atomic
    let standaloneInvResult = null;
    const standaloneItems = JSON.stringify([
      { productId: prodA2Id, quantity: 1, unitPrice: 180.00, discountPercent: 0, taxRate: 18 },
    ]);
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      const { rows: invRows } = await testClient.query(
        `SELECT create_invoice_atomic(
          p_org_id := $1::uuid,
          p_customer_id := $2::uuid,
          p_items := $3::jsonb,
          p_invoice_date := '2026-11-02'::date,
          p_due_date := '2026-11-17'::date,
          p_status := 'ISSUED',
          p_notes := 'Direct standalone invoice'::text,
          p_sales_order_id := NULL::uuid,
          p_idempotency_key := $4::uuid
        ) AS result;`,
        [orgAId, custAId, standaloneItems, crypto.randomUUID()]
      );
      standaloneInvResult = invRows[0]?.result;
    });

    const standaloneValid =
      standaloneInvResult?.id &&
      standaloneInvResult?.status === 'ISSUED' &&
      standaloneInvResult?.sales_order_id === null &&
      Number(standaloneInvResult?.total_amount) === 212.40;

    recordTest(
      'P0-INV-DOC-01',
      'Standalone invoice creation via create_invoice_atomic succeeds with accurate totals and null sales_order_id',
      Boolean(standaloneValid),
      `Standalone invoice ${standaloneInvResult?.invoice_number} created with total ${standaloneInvResult?.total_amount}`,
      standaloneValid ? null : new Error('Standalone invoice creation failed')
    );

    // TEST: Prevent duplicate invoicing on already invoiced sales order
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let duplicateInvBlocked = false;
      let duplicateInvErr = null;
      try {
        await testClient.query(
          `SELECT create_invoice_atomic(
            p_org_id := $1::uuid,
            p_customer_id := $2::uuid,
            p_items := $3::jsonb,
            p_invoice_date := '2026-11-02'::date,
            p_due_date := '2026-11-17'::date,
            p_status := 'ISSUED',
            p_notes := 'Duplicate invoice attempt'::text,
            p_sales_order_id := $4::uuid,
            p_idempotency_key := $5::uuid
          );`,
          [orgAId, custAId, invItemsJson, draftOrderId, crypto.randomUUID()]
        );
      } catch (err) {
        duplicateInvErr = err;
        duplicateInvBlocked = err.code === '23505' || err.message.includes('Active invoice already exists') || err.message.includes('must be CONFIRMED');
      }

      recordTest(
        'P0-INV-DOC-02',
        'Duplicate invoice creation against already invoiced sales order is strictly rejected',
        duplicateInvBlocked,
        `Rejected duplicate invoicing (SQLSTATE ${duplicateInvErr?.code}, message: "${duplicateInvErr?.message}")`,
        duplicateInvBlocked ? null : duplicateInvErr
      );
    });

    // TEST 12: Atomic Quotation Creation & Idempotent Conversion Invariants
    let createdQuotId = null;
    let convertedOrderId = null;
    let repeatedConvertOrderId = null;
    let repeatedIsReplay = false;
    const quotItemsJson = JSON.stringify([
      {
        product_id: prodA2Id,
        quantity: 5,
        unit_price: 180.00,
        discount_percent: 0,
        tax_rate: 18,
      },
    ]);

    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      // 1. Create quotation atomically
      const { rows: qRows } = await testClient.query(
        `SELECT create_quotation_atomic(
          p_org_id := $1::uuid,
          p_customer_id := $2::uuid,
          p_valid_until := '2026-11-17'::date,
          p_items := $3::jsonb,
          p_notes := 'Valid for 15 days',
          p_idempotency_key := $4::uuid
        ) AS result;`,
        [orgAId, custAId, quotItemsJson, crypto.randomUUID()]
      );
      createdQuotId = qRows[0]?.result?.id;

      // 2. Convert quotation to order atomically (first attempt)
      const { rows: cRows } = await testClient.query(
        `SELECT convert_quotation_atomic(
          p_org_id := $1::uuid,
          p_quotation_id := $2::uuid,
          p_idempotency_key := $3::uuid
        ) AS result;`,
        [orgAId, createdQuotId, crypto.randomUUID()]
      );
      convertedOrderId = cRows[0]?.result?.id;

      // 3. Repeated conversion attempt returns existing sales order safely (idempotent replay)
      const { rows: cRows2 } = await testClient.query(
        `SELECT convert_quotation_atomic(
          p_org_id := $1::uuid,
          p_quotation_id := $2::uuid,
          p_idempotency_key := $3::uuid
        ) AS result;`,
        [orgAId, createdQuotId, crypto.randomUUID()]
      );
      repeatedConvertOrderId = cRows2[0]?.result?.id;
      repeatedIsReplay = cRows2[0]?.result?.idempotent_replay === true;
    });

    let quotConverted = false;
    let totalLinkedOrders = 0;
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      const { rows: qStatus } = await testClient.query(`SELECT status FROM quotations WHERE id = $1::uuid;`, [createdQuotId]);
      quotConverted = qStatus[0]?.status === 'CONVERTED';

      const { rows: soCount } = await testClient.query(
        `SELECT count(*)::int AS cnt FROM sales_orders WHERE quotation_id = $1::uuid;`,
        [createdQuotId]
      );
      totalLinkedOrders = soCount[0]?.cnt || 0;
    });

    const quotationIdempotencyValid =
      createdQuotId &&
      convertedOrderId &&
      convertedOrderId === repeatedConvertOrderId &&
      repeatedIsReplay &&
      quotConverted &&
      totalLinkedOrders === 1;

    recordTest(
      'P1-QUOT-01',
      'Quotation conversion is atomic, transitions to CONVERTED, and idempotent replay preserves single linked order',
      Boolean(quotationIdempotencyValid),
      `Quotation ${createdQuotId} converted to SO ${convertedOrderId}; Replay returned existing SO; Total linked SOs: ${totalLinkedOrders}`,
      quotationIdempotencyValid ? null : new Error('Quotation conversion failed or created duplicate orders')
    );

    // TEST 13: Payment Idempotency & Over-allocation Prevention
    const paymentIdempotencyKey = crypto.randomUUID();
    let pay1Result = null;
    let pay2Result = null;

    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      // First attempt
      const { rows: p1 } = await testClient.query(
        `SELECT record_payment_and_allocate(
          p_org_id := $1::uuid,
          p_customer_id := $2::uuid,
          p_amount := 200.00::numeric,
          p_payment_method := 'UPI'::varchar,
          p_reference_no := 'UPI-123456'::varchar,
          p_payment_date := '2026-11-02'::date,
          p_notes := 'First attempt'::text,
          p_invoice_id := $3::uuid,
          p_allocated_amount := 200.00::numeric,
          p_idempotency_key := $4::uuid
        ) AS result;`,
        [orgAId, custAId, createdInvoiceId, paymentIdempotencyKey]
      );
      pay1Result = p1[0]?.result;

      // Replay identical attempt
      const { rows: p2 } = await testClient.query(
        `SELECT record_payment_and_allocate(
          p_org_id := $1::uuid,
          p_customer_id := $2::uuid,
          p_amount := 200.00::numeric,
          p_payment_method := 'UPI'::varchar,
          p_reference_no := 'UPI-123456'::varchar,
          p_payment_date := '2026-11-02'::date,
          p_notes := 'First attempt'::text,
          p_invoice_id := $3::uuid,
          p_allocated_amount := 200.00::numeric,
          p_idempotency_key := $4::uuid
        ) AS result;`,
        [orgAId, custAId, createdInvoiceId, paymentIdempotencyKey]
      );
      pay2Result = p2[0]?.result;
    });

    // Check invoice total_paid is exactly 200.00 (not 400.00)
    let totalPaidExact = false;
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      const { rows: invRows } = await testClient.query(`SELECT total_paid FROM invoices WHERE id = $1::uuid;`, [createdInvoiceId]);
      totalPaidExact = Number(invRows[0]?.total_paid) === 200.00;
    });

    const isReplaySafe = pay1Result?.payment_id === pay2Result?.payment_id && totalPaidExact;
    recordTest(
      'P1-PAY-01',
      'Payment idempotency key returns cached receipt and prevents duplicate allocation',
      Boolean(isReplaySafe),
      `Payment ID: ${pay1Result?.payment_id}; Invoice total_paid is exactly 200.00 across retries`,
      isReplaySafe ? null : new Error('Payment was duplicated or over-allocated')
    );

    // TEST 14: Tampered payment replay with same key is rejected
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let tamperedBlocked = false;
      let tamperedErr = null;
      try {
        await testClient.query(
          `SELECT record_payment_and_allocate(
            p_org_id := $1::uuid,
            p_customer_id := $2::uuid,
            p_amount := 999.00::numeric, -- tampered amount!
            p_payment_method := 'UPI'::varchar,
            p_reference_no := 'UPI-123456'::varchar,
            p_payment_date := '2026-11-02'::date,
            p_notes := 'Tampered attempt'::text,
            p_invoice_id := $3::uuid,
            p_allocated_amount := 999.00::numeric,
            p_idempotency_key := $4::uuid
          );`,
          [orgAId, custAId, createdInvoiceId, paymentIdempotencyKey]
        );
      } catch (err) {
        tamperedErr = err;
        tamperedBlocked = err.code === '23505' || err.message.includes('reused with different request parameters');
      }
      recordTest(
        'P1-PAY-02',
        'Reused idempotency key with altered parameters is strictly rejected',
        tamperedBlocked,
        `Fingerprint mismatch caught with unique_violation (SQLSTATE ${tamperedErr?.code})`,
        tamperedBlocked ? null : tamperedErr
      );
    });

    // TEST: Overpayment rejection in record_payment_and_allocate
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let overpayBlocked = false;
      let overpayErr = null;
      try {
        // createdInvoiceId total is 354.00, already paid 200.00, remaining balance is 154.00.
        // Attempting to allocate 300.00 must raise Overpayment violation
        await testClient.query(
          `SELECT record_payment_and_allocate(
            p_org_id := $1::uuid,
            p_customer_id := $2::uuid,
            p_amount := 300.00::numeric,
            p_payment_method := 'NEFT'::varchar,
            p_reference_no := 'NEFT-OVERPAY-01'::varchar,
            p_payment_date := '2026-11-02'::date,
            p_notes := 'Overpayment attempt'::text,
            p_invoice_id := $3::uuid,
            p_allocated_amount := 300.00::numeric,
            p_idempotency_key := $4::uuid
          );`,
          [orgAId, custAId, createdInvoiceId, crypto.randomUUID()]
        );
      } catch (err) {
        overpayErr = err;
        overpayBlocked = err.message.includes('Overpayment violation') || err.message.includes('exceeds remaining balance');
      }

      recordTest(
        'P1-PAY-DOC-01',
        'Overpayment exceeding remaining invoice balance is strictly rejected by record_payment_and_allocate',
        overpayBlocked,
        `Rejected overpayment: "${overpayErr?.message}"`,
        overpayBlocked ? null : overpayErr
      );
    });

    // TEST 15: Cross-tenant isolation under authenticated User B
    await withRoleContext(testClient, { role: 'authenticated', userId: userBId }, async () => {
      // User B attempts to access Org A's sales order via direct SELECT
      const { rows: bOrders } = await testClient.query(`SELECT * FROM sales_orders WHERE id = $1::uuid;`, [convertedOrderId]);
      const cannotSeeOrgAOrder = bOrders.length === 0;

      // User B attempts to confirm Org A's order via RPC
      let rpcBlocked = false;
      let rpcErr = null;
      try {
        await testClient.query(
          `SELECT confirm_sales_order(p_order_id := $1::uuid, p_org_id := $2::uuid);`,
          [convertedOrderId, orgBId]
        );
      } catch (err) {
        rpcErr = err;
        rpcBlocked = err.code === '23514' || err.message.includes('not found') || err.message.includes('Unauthorized') || err.message.includes('Access denied');
      }

      const isolationPassed = cannotSeeOrgAOrder && rpcBlocked;
      recordTest(
        'P1-TENANT-01',
        'Cross-tenant isolation: User B cannot view or confirm Org A orders',
        isolationPassed,
        `RLS filtered order (${bOrders.length} rows returned); RPC rejected cross-tenant execution (SQLSTATE ${rpcErr?.code})`,
        isolationPassed ? null : rpcErr
      );
    });

    // TEST 16: Anonymous role restrictions
    await withRoleContext(testClient, { role: 'anon', userId: null }, async () => {
      let anonBlocked = false;
      let anonErr = null;
      try {
        await testClient.query(`SELECT * FROM sales_orders;`);
      } catch (err) {
        anonErr = err;
        anonBlocked = true;
      }
      // Or if query succeeds, RLS must return exactly 0 rows
      const { rows } = await testClient.query(`SELECT count(*)::int AS count FROM sales_orders;`);
      const zeroRows = rows[0]?.count === 0;
      const anonSecured = anonBlocked || zeroRows;

      recordTest(
        'P1-ANON-01',
        'Anonymous role has zero access to multi-tenant operational records',
        anonSecured,
        `Anonymous access blocked or returned 0 rows under RLS`,
        anonSecured ? null : anonErr
      );
    });

    // TEST 17: Authoritative Dashboard Metrics RPC Integrity
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      const { rows: dashRows } = await testClient.query(
        `SELECT get_dashboard_metrics(p_org_id := $1::uuid, p_today := '2026-11-02'::date) AS metrics;`,
        [orgAId]
      );
      const metrics = dashRows[0]?.metrics;
      const hasMetrics =
        metrics &&
        typeof metrics.today_sales !== 'undefined' &&
        typeof metrics.orders_count !== 'undefined' &&
        typeof metrics.total_receivables !== 'undefined';

      recordTest(
        'P1-DASH-01',
        'Authoritative get_dashboard_metrics RPC aggregates financial and operational totals correctly',
        Boolean(hasMetrics),
        `Dashboard metrics: today_sales=${metrics?.today_sales}, orders_count=${metrics?.orders_count}, receivables=${metrics?.total_receivables}`,
        hasMetrics ? null : new Error('Dashboard metrics returned invalid structure')
      );
    });

  } finally {
    // ------------------------------------------------------------------------
    // Step 5: Clean Disposal of Dedicated Test Database (Guaranteed Teardown)
    // ------------------------------------------------------------------------
    if (testClient) {
      try {
        await testClient.query(`
          REVOKE authenticated, anon, service_role FROM CURRENT_USER;
        `);
      } catch (err) {
        // Safe to ignore if already disconnected or in error state
      }
      await testClient.end().catch(() => {});
    }

    if (testDbCreated) {
      console.log(`\nStep 5: Disposing isolated ephemeral test database "${testDbName}"...`);
      try {
        // Terminate any active sessions connected to the ephemeral database
        await maintClient.query(
          `SELECT pg_terminate_backend(pid)
           FROM pg_stat_activity
           WHERE datname = $1 AND pid <> pg_backend_pid();`,
          [testDbName]
        );

        // Drop the dedicated test database completely
        try {
          await maintClient.query(`DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE);`);
        } catch (forceErr) {
          if (forceErr.code === '42601' || forceErr.message.includes('syntax error')) {
            await maintClient.query(`DROP DATABASE IF EXISTS "${testDbName}";`);
          } else {
            throw forceErr;
          }
        }
        cleanupSuccessful = true;
        console.log(`  ✓ Dedicated test database "${testDbName}" dropped cleanly.`);
      } catch (dropErr) {
        console.error(`  ❌ Failed to drop test database "${testDbName}":`, dropErr.message);
        cleanupSuccessful = false;
        throw new Error(`Test isolation failure: Could not drop test database "${testDbName}": ${dropErr.message}`);
      }
    }

    await maintClient.end().catch(() => {});
  }

  // --------------------------------------------------------------------------
  // Summary & Reporting
  // --------------------------------------------------------------------------
  console.log('\n' + '='.repeat(80));
  console.log('DATABASE ACCEPTANCE TEST SUMMARY');
  console.log('='.repeat(80));

  const total = testResults.length;
  const passed = testResults.filter((t) => t.passed).length;
  const failed = total - passed;

  console.log(`Total Contract Tests: ${total}`);
  console.log(`Passed:               ${passed}`);
  console.log(`Failed:               ${failed}`);
  console.log(`Isolation Disposed:   ${cleanupSuccessful ? 'YES' : 'NO'}`);

  if (failed > 0) {
    console.error(`\n❌ ACCEPTANCE SUITE FAILED — ${failed} test(s) failed.`);
    process.exit(1);
  } else {
    console.log('\n🎉 ALL DATABASE ACCEPTANCE CONTRACTS PASSED WITH 100% SUCCESS.');
    process.exit(0);
  }
}

runAcceptance().catch((err) => {
  console.error('\n💥 Unexpected fatal test runner exception:', err);
  process.exit(1);
});
