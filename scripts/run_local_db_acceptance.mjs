/**
 * Atlas OS — Master Security, Database & Lifecycle Acceptance Test Runner
 *
 * Runs full database lifecycle verification:
 * 1. Connects as administrative superuser to disposable PostgreSQL instance.
 * 2. Bootstraps complete Supabase-compatible roles (anon, authenticated, service_role, authenticator),
 *    schemas (auth, extensions, public), privileges, and auth helper functions (auth.uid, auth.role, auth.jwt).
 * 3. Applies forward-only migrations 001 through 025 in strict lexical order with ON_ERROR_STOP=1.
 * 4. Seeds isolated multi-tenant test fixtures with genuine auth identities and roles.
 * 5. Executes P0/P1 security and lifecycle contracts under REAL RESTRICTED DATABASE ROLES (SET ROLE authenticated / anon).
 * 6. Tests lifecycle trust flags against spoofing attempts by authenticated database roles.
 * 7. Verifies authoritative RPC contracts (confirm_sales_order, create_invoice_atomic, convert_quotation_atomic, record_payment_and_allocate).
 * 8. Guarantees complete cleanup in all execution paths and exits non-zero on any failure.
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

  const adminClient = new Client({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 5000,
  });

  try {
    await adminClient.connect();
    console.log('Connected to PostgreSQL administrative endpoint successfully.\n');
  } catch (err) {
    console.error('\n⚠️  PostgreSQL connection failed:');
    console.error(`   ${err.message}`);
    console.error('\nEnvironment Diagnostic:');
    console.error('   A running PostgreSQL instance is required to execute live database acceptance tests.');
    console.error('   - In CI (GitHub Actions): Postgres service container is automatically provisioned.');
    console.error('   - In local development: start postgres and provide DATABASE_URL.');

    if (process.env.CI) {
      console.error('\n❌ Failing CI step because database connection is required.');
      process.exit(1);
    } else {
      console.warn('\n⚠️  Skipping database execution due to local environment without active postgres daemon.');
      process.exit(0);
    }
  }

  const runId = 'sec_' + crypto.randomBytes(4).toString('hex');
  const orgAId = crypto.randomUUID();
  const orgBId = crypto.randomUUID();
  const userAId = crypto.randomUUID();
  const userBId = crypto.randomUUID();
  const custAId = crypto.randomUUID();
  const prodA1Id = crypto.randomUUID();
  const prodA2Id = crypto.randomUUID();

  let cleanupSuccessful = false;

  try {
    // ------------------------------------------------------------------------
    // Step 1: Bootstrap Complete Supabase-Compatible Roles, Schemas & Auth
    // ------------------------------------------------------------------------
    console.log('Step 1: Bootstrapping Supabase-compatible roles, schemas and auth environment...');
    await adminClient.query(`
      -- 1. Create required Supabase roles if missing
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
          CREATE ROLE authenticator NOINHERIT LOGIN PASSWORD 'postgrespassword';
        END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_admin') THEN
          CREATE ROLE supabase_admin LOGIN SUPERUSER PASSWORD 'postgrespassword';
        END IF;
      END $$;

      -- 2. Configure role inheritance and memberships
      GRANT anon TO authenticator;
      GRANT authenticated TO authenticator;
      GRANT service_role TO authenticator;

      -- Grant authenticated and anon to postgres (allows superuser to SET ROLE authenticated/anon for testing)
      GRANT authenticated TO postgres;
      GRANT anon TO postgres;
      GRANT service_role TO postgres;

      -- 3. Create schemas
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE SCHEMA IF NOT EXISTS extensions;
      CREATE SCHEMA IF NOT EXISTS public;

      -- 4. Schema usage and standard permissions
      GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
      GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
      GRANT ALL ON SCHEMA public TO postgres, service_role;
      GRANT ALL ON SCHEMA auth TO postgres, service_role;

      -- 5. Default privileges for future tables and sequences
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, service_role, authenticated;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres, service_role, authenticated;

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
      GRANT ALL ON auth.users TO postgres, service_role;

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
    // Step 2: Apply Migrations 001 - 025 in Strict Lexical Order
    // ------------------------------------------------------------------------
    console.log('\nStep 2: Applying migrations sequentially (001 -> 025)...');
    const migrationFiles = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of migrationFiles) {
      const filePath = path.join(MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(filePath, 'utf8');
      try {
        await adminClient.query(sql);
        console.log(`  ✓ Applied migration: ${file}`);
      } catch (migErr) {
        console.error(`\n❌ Migration failed at ${file}: ${migErr.message}`);
        console.error(`   SQLSTATE: ${migErr.code}`);
        throw migErr;
      }
    }

    // Grant DML privileges on newly created public tables to authenticated role for RLS evaluation
    await adminClient.query(`
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
    `);

    // ------------------------------------------------------------------------
    // Step 3: Seed Isolated Multi-Tenant Test Fixtures
    // ------------------------------------------------------------------------
    console.log('\nStep 3: Seeding isolated test fixtures (Org A, Org B, User A, User B)...');
    await adminClient.query(`
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

      INSERT INTO organization_eligibility (organization_id, business_category, sells_electrical_products, status, declared_by) VALUES
      ('${orgAId}', 'electrical_retail', true, 'APPROVED', '${userAId}'),
      ('${orgBId}', 'electrical_retail', true, 'APPROVED', '${userBId}');

      INSERT INTO organization_subscriptions (organization_id, plan_code, status, current_period_end) VALUES
      ('${orgAId}', 'pro', 'active', now() + interval '30 days'),
      ('${orgBId}', 'pro', 'active', now() + interval '30 days');

      INSERT INTO customers (id, organization_id, name, phone, gstin) VALUES
      ('${custAId}', '${orgAId}', 'Apex Power Projects', '9876543210', '29AAACP1234A1Z1');

      INSERT INTO products (id, organization_id, name, sku, uom, purchase_cost, selling_price, tax_rate, reorder_threshold, is_active) VALUES
      ('${prodA1Id}', '${orgAId}', 'Copper Wire 2.5sqmm', 'WIRE-25-${runId}', 'Mtr', 20.00, 30.00, 18, 50, true),
      ('${prodA2Id}', '${orgAId}', 'MCB 16A Single Pole', 'MCB-16-${runId}', 'Nos', 120.00, 180.00, 18, 10, true);

      -- Initial opening stock for product 1 (100 units) and product 2 (50 units)
      INSERT INTO stock_movements (organization_id, product_id, quantity_change, movement_type, notes) VALUES
      ('${orgAId}', '${prodA1Id}', 100, 'OPENING_STOCK', 'Acceptance test opening stock'),
      ('${orgAId}', '${prodA2Id}', 50, 'OPENING_STOCK', 'Acceptance test opening stock');
    `);
    console.log('  ✓ Test fixtures successfully created under administrative privileges.\n');

    // ------------------------------------------------------------------------
    // Step 4: Security Assertions — Restricted Roles
    // ------------------------------------------------------------------------
    console.log('--- EXECUTING AUTHENTICATED SECURITY & LIFECYCLE TESTS ---\n');

    // TEST 1: Direct insert of CONFIRMED sales order under authenticated role is blocked
    await withRoleContext(adminClient, { role: 'authenticated', userId: userAId }, async () => {
      let blocked = false;
      let caughtErr = null;
      try {
        await adminClient.query(`
          INSERT INTO sales_orders (organization_id, customer_id, order_number, status, order_date, subtotal, tax_amount, total_amount)
          VALUES ('${orgAId}', '${custAId}', 'SO-BYPASS-01', 'CONFIRMED', '2026-11-02', 100, 18, 118);
        `);
      } catch (err) {
        caughtErr = err;
        // Blocked either by RLS check clause (status = 'DRAFT') or by trigger
        blocked = err.code === '42501' || err.code === '23514' || err.message.includes('prohibited') || err.message.includes('DRAFT');
      }
      recordTest(
        'P0-SO-01',
        'Direct insert of CONFIRMED sales order as authenticated role is rejected',
        blocked,
        `Enforced by RLS policy sales_orders_insert / trigger (SQLSTATE ${caughtErr?.code})`,
        blocked ? null : caughtErr
      );
    });

    // TEST 2: Direct insert of FULFILLED sales order under authenticated role is blocked
    await withRoleContext(adminClient, { role: 'authenticated', userId: userAId }, async () => {
      let blocked = false;
      let caughtErr = null;
      try {
        await adminClient.query(`
          INSERT INTO sales_orders (organization_id, customer_id, order_number, status, order_date, subtotal, tax_amount, total_amount)
          VALUES ('${orgAId}', '${custAId}', 'SO-BYPASS-02', 'FULFILLED', '2026-11-02', 100, 18, 118);
        `);
      } catch (err) {
        caughtErr = err;
        blocked = err.code === '42501' || err.code === '23514' || err.message.includes('prohibited') || err.message.includes('DRAFT');
      }
      recordTest(
        'P0-SO-02',
        'Direct insert of FULFILLED sales order as authenticated role is rejected',
        blocked,
        `Enforced by RLS policy sales_orders_insert / trigger (SQLSTATE ${caughtErr?.code})`,
        blocked ? null : caughtErr
      );
    });

    // Create a legitimate DRAFT order with items
    const draftOrderId = crypto.randomUUID();
    await withRoleContext(adminClient, { role: 'authenticated', userId: userAId }, async () => {
      await adminClient.query(`
        INSERT INTO sales_orders (id, organization_id, customer_id, order_number, status, order_date, subtotal, tax_amount, total_amount)
        VALUES ('${draftOrderId}', '${orgAId}', '${custAId}', 'SO-DRAFT-${runId}', 'DRAFT', '2026-11-02', 300, 54, 354);

        INSERT INTO sales_order_items (sales_order_id, product_id, product_name, product_sku, uom, quantity, unit_price, tax_rate, line_subtotal, line_tax, line_total)
        VALUES ('${draftOrderId}', '${prodA1Id}', 'Copper Wire 2.5sqmm', 'WIRE-25-${runId}', 'Mtr', 10, 30.00, 18, 300, 54, 354);
      `);
    });

    // TEST 3: Direct status change from DRAFT to CONFIRMED as authenticated role is blocked
    await withRoleContext(adminClient, { role: 'authenticated', userId: userAId }, async () => {
      let blocked = false;
      let caughtErr = null;
      try {
        await adminClient.query(`
          UPDATE sales_orders SET status = 'CONFIRMED' WHERE id = '${draftOrderId}';
        `);
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

    // TEST 4: Attempted GUC trust flag manipulation by authenticated role is rejected
    await withRoleContext(adminClient, { role: 'authenticated', userId: userAId }, async () => {
      let blocked = false;
      let caughtErr = null;
      try {
        // Attacker sets GUC in their own session and tries direct update
        await adminClient.query(`SELECT set_config('app.authoritative_order_transition', 'true', false);`);
        await adminClient.query(`UPDATE sales_orders SET status = 'CONFIRMED' WHERE id = '${draftOrderId}';`);
      } catch (err) {
        caughtErr = err;
        blocked = err.code === '42501' || err.code === '23514' || err.message.includes('prohibited');
      }
      recordTest(
        'P0-SO-04-GUC',
        'Attempted GUC spoofing (app.authoritative_order_transition) by authenticated role is rejected',
        blocked,
        `Migration 025 enforces trigger trust only within SECURITY DEFINER owner execution (SQLSTATE ${caughtErr?.code})`,
        blocked ? null : caughtErr
      );
    });

    // TEST 5: Authoritative confirmation via confirm_sales_order RPC succeeds & deducts stock
    let confirmedResult = null;
    let stockBefore = 0;
    let stockAfter = 0;

    await withRoleContext(adminClient, { role: 'authenticated', userId: userAId }, async () => {
      // Get stock before
      const { rows: stockB4 } = await adminClient.query(`SELECT get_product_stock_levels('${orgAId}'::uuid) AS res;`);
      const prod1B4 = stockB4[0].res.find((p) => p.product_id === prodA1Id);
      stockBefore = prod1B4 ? prod1B4.current_stock : 0;

      // Authoritative confirmation call
      const { rows: confRows } = await adminClient.query(`
        SELECT confirm_sales_order(
          p_order_id := '${draftOrderId}'::uuid,
          p_org_id := '${orgAId}'::uuid
        ) AS result;
      `);
      confirmedResult = confRows[0]?.result;

      // Get stock after
      const { rows: stockAft } = await adminClient.query(`SELECT get_product_stock_levels('${orgAId}'::uuid) AS res;`);
      const prod1Aft = stockAft[0].res.find((p) => p.product_id === prodA1Id);
      stockAfter = prod1Aft ? prod1Aft.current_stock : 0;
    });

    const isConfirmed = confirmedResult?.success === true && confirmedResult?.status === 'CONFIRMED';
    const exactly10Deducted = stockBefore - stockAfter === 10;
    recordTest(
      'P0-SO-05',
      'Authoritative confirm_sales_order RPC transitions to CONFIRMED and deducts stock exactly once',
      isConfirmed && exactly10Deducted,
      `Stock reduced from ${stockBefore} to ${stockAfter} (-10 Mtr)`,
      isConfirmed && exactly10Deducted ? null : new Error('Stock not deducted or status not confirmed')
    );

    // TEST 6: Modification of items on CONFIRMED order is blocked
    await withRoleContext(adminClient, { role: 'authenticated', userId: userAId }, async () => {
      let blocked = false;
      let caughtErr = null;
      try {
        await adminClient.query(`
          UPDATE sales_order_items SET quantity = 25 WHERE sales_order_id = '${draftOrderId}';
        `);
      } catch (err) {
        caughtErr = err;
        blocked = err.code === '42501' || err.code === '23514' || err.message.includes('Cannot') || err.message.includes('immutable');
      }
      recordTest(
        'P0-SO-06',
        'Line item mutation on CONFIRMED sales order is strictly rejected',
        blocked,
        `Enforced by trg_sales_order_items_enforce_parent_status (SQLSTATE ${caughtErr?.code})`,
        blocked ? null : caughtErr
      );
    });

    // TEST 7: Re-confirmation of already CONFIRMED order is rejected
    await withRoleContext(adminClient, { role: 'authenticated', userId: userAId }, async () => {
      let blocked = false;
      let caughtErr = null;
      try {
        await adminClient.query(`
          SELECT confirm_sales_order(
            p_order_id := '${draftOrderId}'::uuid,
            p_org_id := '${orgAId}'::uuid
          );
        `);
      } catch (err) {
        caughtErr = err;
        blocked = err.code === '23514' || err.message.includes('expected DRAFT') || err.message.includes('cannot be confirmed');
      }
      recordTest(
        'P0-SO-07',
        'Re-confirmation of CONFIRMED order is rejected (prevents double-deduction)',
        blocked,
        `confirm_sales_order rejects non-DRAFT order state (SQLSTATE ${caughtErr?.code})`,
        blocked ? null : caughtErr
      );
    });

    // TEST 8: Direct insert of ISSUED invoice is blocked
    await withRoleContext(adminClient, { role: 'authenticated', userId: userAId }, async () => {
      let blocked = false;
      let caughtErr = null;
      try {
        await adminClient.query(`
          INSERT INTO invoices (organization_id, customer_id, invoice_number, status, invoice_date, due_date, subtotal, tax_amount, total_amount)
          VALUES ('${orgAId}', '${custAId}', 'INV-BYPASS-01', 'ISSUED', '2026-11-02', '2026-11-17', 100, 18, 118);
        `);
      } catch (err) {
        caughtErr = err;
        blocked = err.code === '42501' || err.code === '23514' || err.message.includes('prohibited') || err.message.includes('DRAFT');
      }
      recordTest(
        'P0-INV-01',
        'Direct insert of ISSUED invoice as authenticated role is rejected',
        blocked,
        `Enforced by RLS invoices_insert / trigger (SQLSTATE ${caughtErr?.code})`,
        blocked ? null : caughtErr
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

    await withRoleContext(adminClient, { role: 'authenticated', userId: userAId }, async () => {
      const { rows: invCreateRows } = await adminClient.query(`
        SELECT create_invoice_atomic(
          p_org_id := '${orgAId}'::uuid,
          p_customer_id := '${custAId}'::uuid,
          p_items := '${invItemsJson}'::jsonb,
          p_invoice_date := '2026-11-02'::date,
          p_due_date := '2026-11-17'::date,
          p_status := 'ISSUED',
          p_notes := 'Invoice created from order',
          p_sales_order_id := '${draftOrderId}'::uuid,
          p_idempotency_key := '${crypto.randomUUID()}'::uuid
        ) AS result;
      `);
      const invObj = invCreateRows[0]?.result;
      createdInvoiceId = invObj?.id;
      invNumber = invObj?.invoice_number;
    });

    // Verify invoice status and sales order status
    let invoiceIssued = false;
    let orderFulfilled = false;
    await withRoleContext(adminClient, { role: 'authenticated', userId: userAId }, async () => {
      const { rows: iRows } = await adminClient.query(`SELECT status FROM invoices WHERE id = '${createdInvoiceId}';`);
      invoiceIssued = iRows[0]?.status === 'ISSUED';
      const { rows: soRows } = await adminClient.query(`SELECT status FROM sales_orders WHERE id = '${draftOrderId}';`);
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
    await withRoleContext(adminClient, { role: 'authenticated', userId: userAId }, async () => {
      let blocked = false;
      let caughtErr = null;
      try {
        await adminClient.query(`
          UPDATE invoice_items SET quantity = 50 WHERE invoice_id = '${createdInvoiceId}';
        `);
      } catch (err) {
        caughtErr = err;
        blocked = err.code === '42501' || err.code === '23514' || err.message.includes('Cannot') || err.message.includes('immutable');
      }
      recordTest(
        'P0-INV-03',
        'Line item modification on ISSUED invoice is strictly rejected',
        blocked,
        `Enforced by trg_invoice_items_enforce_parent_status (SQLSTATE ${caughtErr?.code})`,
        blocked ? null : caughtErr
      );
    });

    // TEST 11: Statutory invoice deletion is blocked
    await withRoleContext(adminClient, { role: 'authenticated', userId: userAId }, async () => {
      let blocked = false;
      let caughtErr = null;
      try {
        await adminClient.query(`DELETE FROM invoices WHERE id = '${createdInvoiceId}';`);
      } catch (err) {
        caughtErr = err;
        blocked = err.code === '42501' || err.code === '23514' || err.message.includes('prohibited');
      }
      recordTest(
        'P0-INV-04',
        'Statutory invoice deletion is strictly rejected',
        blocked,
        `Enforced by trg_invoices_enforce_lifecycle (SQLSTATE ${caughtErr?.code})`,
        blocked ? null : caughtErr
      );
    });

    // TEST 12: Atomic Quotation Creation & Conversion Invariants
    let createdQuotId = null;
    let convertedOrderId = null;
    const quotItemsJson = JSON.stringify([
      {
        product_id: prodA2Id,
        quantity: 5,
        unit_price: 180.00,
        discount_percent: 0,
        tax_rate: 18,
      },
    ]);

    await withRoleContext(adminClient, { role: 'authenticated', userId: userAId }, async () => {
      // 1. Create quotation atomically
      const { rows: qRows } = await adminClient.query(`
        SELECT create_quotation_atomic(
          p_org_id := '${orgAId}'::uuid,
          p_customer_id := '${custAId}'::uuid,
          p_valid_until := '2026-11-17'::date,
          p_items := '${quotItemsJson}'::jsonb,
          p_notes := 'Valid for 15 days',
          p_idempotency_key := '${crypto.randomUUID()}'::uuid
        ) AS result;
      `);
      createdQuotId = qRows[0]?.result?.id;

      // 2. Convert quotation to order atomically
      const { rows: cRows } = await adminClient.query(`
        SELECT convert_quotation_atomic(
          p_org_id := '${orgAId}'::uuid,
          p_quotation_id := '${createdQuotId}'::uuid,
          p_idempotency_key := '${crypto.randomUUID()}'::uuid
        ) AS result;
      `);
      convertedOrderId = cRows[0]?.result?.id;
    });

    let quotConverted = false;
    let duplicateConvertBlocked = false;
    let duplicateConvertErr = null;

    await withRoleContext(adminClient, { role: 'authenticated', userId: userAId }, async () => {
      const { rows: qStatus } = await adminClient.query(`SELECT status FROM quotations WHERE id = '${createdQuotId}';`);
      quotConverted = qStatus[0]?.status === 'CONVERTED';

      // 3. Second conversion attempt must be rejected
      try {
        await adminClient.query(`
          SELECT convert_quotation_atomic(
            p_org_id := '${orgAId}'::uuid,
            p_quotation_id := '${createdQuotId}'::uuid,
            p_idempotency_key := '${crypto.randomUUID()}'::uuid
          );
        `);
      } catch (err) {
        duplicateConvertErr = err;
        duplicateConvertBlocked = err.code === '23514' || err.message.includes('converted') || err.message.includes('CONVERTED');
      }
    });

    recordTest(
      'P1-QUOT-01',
      'Quotation conversion is atomic, transitions to CONVERTED, and rejects re-conversion',
      Boolean(createdQuotId && convertedOrderId && quotConverted && duplicateConvertBlocked),
      `Quotation ${createdQuotId} converted to SO ${convertedOrderId}; re-conversion rejected (SQLSTATE ${duplicateConvertErr?.code})`,
      createdQuotId && convertedOrderId && quotConverted && duplicateConvertBlocked ? null : duplicateConvertErr
    );

    // TEST 13: Payment Idempotency & Over-allocation Prevention
    const paymentIdempotencyKey = crypto.randomUUID();
    let pay1Result = null;
    let pay2Result = null;

    await withRoleContext(adminClient, { role: 'authenticated', userId: userAId }, async () => {
      // First attempt
      const { rows: p1 } = await adminClient.query(`
        SELECT record_payment_and_allocate(
          p_org_id := '${orgAId}'::uuid,
          p_customer_id := '${custAId}'::uuid,
          p_amount := 200.00::numeric,
          p_payment_method := 'UPI'::varchar,
          p_reference_no := 'UPI-123456'::varchar,
          p_payment_date := '2026-11-02'::date,
          p_notes := 'First attempt'::text,
          p_invoice_id := '${createdInvoiceId}'::uuid,
          p_allocated_amount := 200.00::numeric,
          p_idempotency_key := '${paymentIdempotencyKey}'::uuid
        ) AS result;
      `);
      pay1Result = p1[0]?.result;

      // Replay identical attempt
      const { rows: p2 } = await adminClient.query(`
        SELECT record_payment_and_allocate(
          p_org_id := '${orgAId}'::uuid,
          p_customer_id := '${custAId}'::uuid,
          p_amount := 200.00::numeric,
          p_payment_method := 'UPI'::varchar,
          p_reference_no := 'UPI-123456'::varchar,
          p_payment_date := '2026-11-02'::date,
          p_notes := 'First attempt'::text,
          p_invoice_id := '${createdInvoiceId}'::uuid,
          p_allocated_amount := 200.00::numeric,
          p_idempotency_key := '${paymentIdempotencyKey}'::uuid
        ) AS result;
      `);
      pay2Result = p2[0]?.result;
    });

    // Check invoice total_paid is exactly 200.00 (not 400.00)
    let totalPaidExact = false;
    await withRoleContext(adminClient, { role: 'authenticated', userId: userAId }, async () => {
      const { rows: invRows } = await adminClient.query(`SELECT total_paid FROM invoices WHERE id = '${createdInvoiceId}';`);
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
    await withRoleContext(adminClient, { role: 'authenticated', userId: userAId }, async () => {
      let tamperedBlocked = false;
      let tamperedErr = null;
      try {
        await adminClient.query(`
          SELECT record_payment_and_allocate(
            p_org_id := '${orgAId}'::uuid,
            p_customer_id := '${custAId}'::uuid,
            p_amount := 999.00::numeric, -- tampered amount!
            p_payment_method := 'UPI'::varchar,
            p_reference_no := 'UPI-123456'::varchar,
            p_payment_date := '2026-11-02'::date,
            p_notes := 'Tampered attempt'::text,
            p_invoice_id := '${createdInvoiceId}'::uuid,
            p_allocated_amount := 999.00::numeric,
            p_idempotency_key := '${paymentIdempotencyKey}'::uuid
          );
        `);
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

    // TEST 15: Cross-tenant isolation under authenticated User B
    await withRoleContext(adminClient, { role: 'authenticated', userId: userBId }, async () => {
      // User B attempts to access Org A's sales order via direct SELECT
      const { rows: bOrders } = await adminClient.query(`SELECT * FROM sales_orders WHERE id = '${convertedOrderId}';`);
      const cannotSeeOrgAOrder = bOrders.length === 0;

      // User B attempts to confirm Org A's order via RPC
      let rpcBlocked = false;
      let rpcErr = null;
      try {
        await adminClient.query(`
          SELECT confirm_sales_order(
            p_order_id := '${convertedOrderId}'::uuid,
            p_org_id := '${orgBId}'::uuid
          );
        `);
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
    await withRoleContext(adminClient, { role: 'anon', userId: null }, async () => {
      let anonBlocked = false;
      let anonErr = null;
      try {
        await adminClient.query(`SELECT * FROM sales_orders;`);
      } catch (err) {
        anonErr = err;
        anonBlocked = true;
      }
      // Or if query succeeds, RLS must return exactly 0 rows
      const { rows } = await adminClient.query(`SELECT count(*)::int AS count FROM sales_orders;`);
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

  } finally {
    // ------------------------------------------------------------------------
    // Step 5: Mandatory Cleanup Guaranteed in Finally Block
    // ------------------------------------------------------------------------
    console.log('\n--- Cleaning up synthetic test fixtures ---');
    try {
      await adminClient.query(`
        RESET ROLE;
        DELETE FROM organizations WHERE id IN ('${orgAId}', '${orgBId}');
        DELETE FROM auth.users WHERE id IN ('${userAId}', '${userBId}');
      `);
      cleanupSuccessful = true;
      console.log('  ✓ Cleanup completed successfully.');
    } catch (cleanErr) {
      console.warn('  ⚠️ Cleanup warning:', cleanErr.message);
    }
    await adminClient.end();
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
  console.log(`Cleanup Guaranteed:   ${cleanupSuccessful ? 'YES' : 'NO'}`);

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
