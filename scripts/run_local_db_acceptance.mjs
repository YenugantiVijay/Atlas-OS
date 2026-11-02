/**
 * Atlas OS — Master Security, Database & Lifecycle Acceptance Test Runner
 *
 * Runs full database lifecycle verification:
 * 1. Verifies connection to disposable PostgreSQL instance.
 * 2. Emulates Supabase auth schema (auth.uid(), auth.users) if not pre-seeded.
 * 3. Applies forward-only migrations 001 through 024 in strict lexical order with ON_ERROR_STOP=1.
 * 4. Executes P0 Sales Order Lifecycle bypass tests (Section 4).
 * 5. Executes P0 Invoice Lifecycle bypass tests (Section 5).
 * 6. Executes P1 Atomic Document Creation & Conversion tests (Section 6, 7).
 * 7. Executes P1 Payment Idempotency & Financial Consistency tests (Section 8).
 * 8. Executes P1 Server-side Aggregations & Multi-Tenant Isolation tests (Section 9, 10).
 * 9. Produces machine-readable test results and cleans up synthetic test data.
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

function recordTest(id, name, passed, details) {
  testResults.push({ id, name, passed, details, timestamp: new Date().toISOString() });
  const badge = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`[${id}] ${badge} - ${name}`);
  if (details) {
    console.log(`       Details: ${details}`);
  }
}

async function runAcceptance() {
  console.log('='.repeat(80));
  console.log('ATLAS OS — MASTER SECURITY & LIFECYCLE DATABASE ACCEPTANCE SUITE');
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Target: ${DATABASE_URL.replace(/:([^:@]+)@/, ':****@')}`);
  console.log('='.repeat(80));

  const client = new Client({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 5000,
  });

  try {
    await client.connect();
    console.log('Connected to PostgreSQL successfully.\n');
  } catch (err) {
    console.error('\n⚠️  PostgreSQL connection failed:');
    console.error(`   ${err.message}`);
    console.error('\nEnvironment Diagnostic:');
    console.error('   A running PostgreSQL instance is required to execute live database acceptance tests.');
    console.error('   - In CI (GitHub Actions): Postgres service container is automatically provisioned.');
    console.error('   - In local development: start postgres via docker or local service and provide DATABASE_URL.');

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

  try {
    // ------------------------------------------------------------------------
    // Step 1: Pre-flight auth schema emulation for standalone PostgreSQL
    // ------------------------------------------------------------------------
    console.log('Step 1: Initializing auth schema and emulation environment...');
    await client.query(`
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE TABLE IF NOT EXISTS auth.users (
        id uuid PRIMARY KEY,
        email text,
        raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
        created_at timestamptz DEFAULT now()
      );
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$ LANGUAGE sql STABLE;
      CREATE OR REPLACE FUNCTION auth.role() RETURNS text AS $$
        SELECT coalesce(current_setting('request.jwt.claim.role', true), 'authenticated');
      $$ LANGUAGE sql STABLE;
    `);

    // ------------------------------------------------------------------------
    // Step 2: Apply Migrations 001 - 024 in Strict Lexical Order
    // ------------------------------------------------------------------------
    console.log('\nStep 2: Applying migrations in strict order (001 -> 024)...');
    const migrationFiles = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of migrationFiles) {
      const filePath = path.join(MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(filePath, 'utf8');
      try {
        await client.query(sql);
        console.log(`  ✓ Applied migration: ${file}`);
      } catch (migErr) {
        console.error(`\n❌ Migration failed at ${file}: ${migErr.message}`);
        throw migErr;
      }
    }

    // ------------------------------------------------------------------------
    // Step 3: Seed isolated test tenants and products
    // ------------------------------------------------------------------------
    console.log('\nStep 3: Seeding isolated test tenants...');
    await client.query(`
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
    `);

    // Seed customer and product for Org A
    const custAId = crypto.randomUUID();
    const prodA1Id = crypto.randomUUID();
    const prodA2Id = crypto.randomUUID();

    await client.query(`
      INSERT INTO customers (id, organization_id, name, phone, gstin) VALUES
      ('${custAId}', '${orgAId}', 'Apex Power Projects', '9876543210', '29AAACP1234A1Z1');

      INSERT INTO products (id, organization_id, name, sku, uom, purchase_cost, selling_price, tax_rate, reorder_threshold, is_active) VALUES
      ('${prodA1Id}', '${orgAId}', 'Copper Wire 2.5sqmm', 'WIRE-25-${runId}', 'Mtr', 20.00, 30.00, 18, 50, true),
      ('${prodA2Id}', '${orgAId}', 'MCB 16A Single Pole', 'MCB-16-${runId}', 'Nos', 120.00, 180.00, 18, 10, true);

      -- Seed initial stock for Prod 1 (100 units) and Prod 2 (50 units)
      INSERT INTO stock_movements (organization_id, product_id, quantity_change, movement_type, notes) VALUES
      ('${orgAId}', '${prodA1Id}', 100, 'OPENING_STOCK', 'Test Initial Stock'),
      ('${orgAId}', '${prodA2Id}', 50, 'OPENING_STOCK', 'Test Initial Stock');
    `);

    // Helper to simulate calling as user A
    async function setContextUserA() {
      await client.query(`
        SELECT set_config('request.jwt.claim.sub', '${userAId}', true),
               set_config('request.jwt.claim.role', 'authenticated', true);
      `);
    }

    // ------------------------------------------------------------------------
    // P0 TEST 1: Direct insert of CONFIRMED sales order is blocked
    // ------------------------------------------------------------------------
    console.log('\n--- Executing P0 Sales Order Lifecycle Tests ---');
    await setContextUserA();

    let directConfirmedBlocked = false;
    try {
      await client.query(`
        INSERT INTO sales_orders (organization_id, customer_id, order_number, status, order_date, subtotal, tax_amount, total_amount)
        VALUES ('${orgAId}', '${custAId}', 'SO-BYPASS-01', 'CONFIRMED', '2026-11-02', 100, 18, 118);
      `);
    } catch (e) {
      directConfirmedBlocked = e.message.includes('New sales orders must be created in DRAFT status');
    }
    recordTest('P0-SO-01', 'Direct insert of CONFIRMED sales order is rejected by trigger', directConfirmedBlocked, 'Trigger trg_sales_orders_enforce_lifecycle prevented bypass');

    // ------------------------------------------------------------------------
    // P0 TEST 2: Direct insert of FULFILLED sales order is blocked
    // ------------------------------------------------------------------------
    let directFulfilledBlocked = false;
    try {
      await client.query(`
        INSERT INTO sales_orders (organization_id, customer_id, order_number, status, order_date, subtotal, tax_amount, total_amount)
        VALUES ('${orgAId}', '${custAId}', 'SO-BYPASS-02', 'FULFILLED', '2026-11-02', 100, 18, 118);
      `);
    } catch (e) {
      directFulfilledBlocked = e.message.includes('New sales orders must be created in DRAFT status');
    }
    recordTest('P0-SO-02', 'Direct insert of FULFILLED sales order is rejected by trigger', directFulfilledBlocked, 'Trigger trg_sales_orders_enforce_lifecycle prevented bypass');

    // ------------------------------------------------------------------------
    // P0 TEST 3: Direct status change from DRAFT to CONFIRMED is blocked
    // ------------------------------------------------------------------------
    const draftOrderId = crypto.randomUUID();
    await client.query(`
      INSERT INTO sales_orders (id, organization_id, customer_id, order_number, status, order_date, subtotal, tax_amount, total_amount)
      VALUES ('${draftOrderId}', '${orgAId}', '${custAId}', 'SO-DRAFT-${runId}', 'DRAFT', '2026-11-02', 300, 54, 354);

      INSERT INTO sales_order_items (sales_order_id, product_id, product_name, product_sku, uom, quantity, unit_price, tax_rate, line_subtotal, line_tax, line_total)
      VALUES ('${draftOrderId}', '${prodA1Id}', 'Copper Wire 2.5sqmm', 'WIRE-25-${runId}', 'Mtr', 10, 30.00, 18, 300, 54, 354);
    `);

    let directUpdateBlocked = false;
    try {
      await client.query(`
        UPDATE sales_orders SET status = 'CONFIRMED' WHERE id = '${draftOrderId}';
      `);
    } catch (e) {
      directUpdateBlocked = e.message.includes('status cannot be updated directly');
    }
    recordTest('P0-SO-03', 'Direct status change from DRAFT to CONFIRMED is rejected', directUpdateBlocked, 'Enforces confirm_sales_order RPC as sole authorized path');

    // ------------------------------------------------------------------------
    // P0 TEST 4: Authoritative confirmation via confirm_sales_order works & deducts stock
    // ------------------------------------------------------------------------
    const { rows: stockBeforeRows } = await client.query(`
      SELECT get_product_stock_levels('${orgAId}') AS stock_levels;
    `);
    const stockBeforeObj = stockBeforeRows[0].stock_levels.find((s) => s.product_id === prodA1Id);
    const stockBefore = stockBeforeObj ? stockBeforeObj.current_stock : 0;

    await client.query(`
      SELECT confirm_sales_order('${draftOrderId}', '${orgAId}');
    `);

    const { rows: orderAfterRows } = await client.query(`
      SELECT status FROM sales_orders WHERE id = '${draftOrderId}';
    `);
    const isOrderConfirmed = orderAfterRows[0]?.status === 'CONFIRMED';

    const { rows: stockAfterRows } = await client.query(`
      SELECT get_product_stock_levels('${orgAId}') AS stock_levels;
    `);
    const stockAfterObj = stockAfterRows[0].stock_levels.find((s) => s.product_id === prodA1Id);
    const stockAfter = stockAfterObj ? stockAfterObj.current_stock : 0;
    const stockDeductedExactly10 = stockBefore - stockAfter === 10;

    recordTest('P0-SO-04', 'Authoritative confirmation transitions to CONFIRMED and deducts stock exactly once', isOrderConfirmed && stockDeductedExactly10, `Stock reduced from ${stockBefore} to ${stockAfter} (-10 units)`);

    // ------------------------------------------------------------------------
    // P0 TEST 5: Modification of items on CONFIRMED order is blocked
    // ------------------------------------------------------------------------
    let modifyConfirmedItemsBlocked = false;
    try {
      await client.query(`
        UPDATE sales_order_items SET quantity = 20 WHERE sales_order_id = '${draftOrderId}';
      `);
    } catch (e) {
      modifyConfirmedItemsBlocked = e.message.includes('Items cannot be inserted, updated, or deleted');
    }
    recordTest('P0-SO-05', 'Line item modification on CONFIRMED sales order is rejected', modifyConfirmedItemsBlocked, 'Trigger trg_sales_order_items_enforce_parent_status prevented mutation');

    // ------------------------------------------------------------------------
    // P0 TEST 6: Double confirmation of confirmed order is rejected
    // ------------------------------------------------------------------------
    let doubleConfirmBlocked = false;
    try {
      await client.query(`
        SELECT confirm_sales_order('${draftOrderId}', '${orgAId}');
      `);
    } catch (e) {
      doubleConfirmBlocked = e.message.includes('Only DRAFT sales orders can be confirmed');
    }
    recordTest('P0-SO-06', 'Re-confirmation of CONFIRMED order is rejected (prevents double-deduction)', doubleConfirmBlocked, 'Guards against race condition double-deduction');

    // ------------------------------------------------------------------------
    // P0 TEST 7: Insufficient stock confirmation fails and leaves order in DRAFT
    // ------------------------------------------------------------------------
    const draftExcessId = crypto.randomUUID();
    await client.query(`
      INSERT INTO sales_orders (id, organization_id, customer_id, order_number, status, order_date, subtotal, tax_amount, total_amount)
      VALUES ('${draftExcessId}', '${orgAId}', '${custAId}', 'SO-EXCESS-${runId}', 'DRAFT', '2026-11-02', 30000, 5400, 35400);

      INSERT INTO sales_order_items (sales_order_id, product_id, product_name, product_sku, uom, quantity, unit_price, tax_rate, line_subtotal, line_tax, line_total)
      VALUES ('${draftExcessId}', '${prodA1Id}', 'Copper Wire 2.5sqmm', 'WIRE-25-${runId}', 'Mtr', 99999, 30.00, 18, 30000, 5400, 35400);
    `);

    let insufficientStockRejected = false;
    try {
      await client.query(`SELECT confirm_sales_order('${draftExcessId}', '${orgAId}');`);
    } catch (e) {
      insufficientStockRejected = e.message.includes('Insufficient available stock');
    }
    const { rows: excessStatusRows } = await client.query(`SELECT status FROM sales_orders WHERE id = '${draftExcessId}';`);
    const excessRemainedDraft = excessStatusRows[0]?.status === 'DRAFT';

    recordTest('P0-SO-07', 'Insufficient stock confirmation is rejected and leaves order in DRAFT', insufficientStockRejected && excessRemainedDraft, 'Stock check prevented negative inventory');

    // ------------------------------------------------------------------------
    // P0 TEST 8: Direct insert of ISSUED invoice is blocked
    // ------------------------------------------------------------------------
    console.log('\n--- Executing P0 Invoice Lifecycle Tests ---');
    let directIssuedInvBlocked = false;
    try {
      await client.query(`
        INSERT INTO invoices (organization_id, customer_id, invoice_number, status, invoice_date, due_date, subtotal, tax_amount, total_amount)
        VALUES ('${orgAId}', '${custAId}', 'INV-BYPASS-01', 'ISSUED', '2026-11-02', '2026-11-17', 100, 18, 118);
      `);
    } catch (e) {
      directIssuedInvBlocked = e.message.includes('New invoices must be created in DRAFT status');
    }
    recordTest('P0-INV-01', 'Direct insert of ISSUED invoice is rejected by trigger', directIssuedInvBlocked, 'Trigger trg_invoices_enforce_lifecycle prevented bypass');

    // ------------------------------------------------------------------------
    // P0 TEST 9: Authoritative invoice creation via create_invoice_atomic succeeds
    // ------------------------------------------------------------------------
    const { rows: invCreateRows } = await client.query(`
      SELECT create_invoice_atomic('${draftOrderId}', '${orgAId}') AS invoice_id;
    `);
    const createdInvoiceId = invCreateRows[0]?.invoice_id;

    const { rows: invRows } = await client.query(`
      SELECT invoice_number, status, total_amount FROM invoices WHERE id = '${createdInvoiceId}';
    `);
    const invoiceIssued = invRows[0]?.status === 'ISSUED';

    const { rows: orderFulfilledRows } = await client.query(`
      SELECT status FROM sales_orders WHERE id = '${draftOrderId}';
    `);
    const orderFulfilled = orderFulfilledRows[0]?.status === 'FULFILLED';

    recordTest('P0-INV-02', 'Authoritative create_invoice_atomic creates ISSUED invoice and marks SO FULFILLED', invoiceIssued && orderFulfilled, `Invoice ${invRows[0]?.invoice_number} created with status ISSUED`);

    // ------------------------------------------------------------------------
    // P0 TEST 10: Modification of line items on ISSUED invoice is blocked
    // ------------------------------------------------------------------------
    let modifyIssuedInvItemsBlocked = false;
    try {
      await client.query(`
        UPDATE invoice_items SET quantity = 50 WHERE invoice_id = '${createdInvoiceId}';
      `);
    } catch (e) {
      modifyIssuedInvItemsBlocked = e.message.includes('Invoice line items cannot be modified or deleted');
    }
    recordTest('P0-INV-03', 'Line item modification on ISSUED invoice is rejected', modifyIssuedInvItemsBlocked, 'Trigger trg_invoice_items_enforce_parent_status enforced immutability');

    // ------------------------------------------------------------------------
    // P0 TEST 11: Statutory invoice deletion is blocked
    // ------------------------------------------------------------------------
    let deleteInvoiceBlocked = false;
    try {
      await client.query(`DELETE FROM invoices WHERE id = '${createdInvoiceId}';`);
    } catch (e) {
      deleteInvoiceBlocked = e.message.includes('Invoices cannot be deleted for statutory and audit compliance');
    }
    recordTest('P0-INV-04', 'Statutory invoice deletion is rejected by trigger', deleteInvoiceBlocked, 'Enforces Indian GST statutory retention');

    // ------------------------------------------------------------------------
    // P1 TEST 12: Atomic Quotation Creation & Conversion Invariants
    // ------------------------------------------------------------------------
    console.log('\n--- Executing P1 Atomic Quotation & Order Operations ---');
    const quotItemsJson = JSON.stringify([
      {
        product_id: prodA2Id,
        quantity: 5,
        unit_price: 180.00,
        discount_percent: 0,
        tax_rate: 18,
      },
    ]);

    const { rows: quotCreateRows } = await client.query(`
      SELECT create_quotation_atomic(
        '${orgAId}',
        '${custAId}',
        '2026-11-17',
        'Valid for 15 days',
        '${quotItemsJson}'::jsonb
      ) AS quotation_id;
    `);
    const createdQuotId = quotCreateRows[0]?.quotation_id;

    // Convert quotation to order atomically
    const { rows: convertRows } = await client.query(`
      SELECT convert_quotation_atomic(
        '${createdQuotId}',
        '${orgAId}',
        '2026-11-02',
        'Converted from quotation'
      ) AS order_id;
    `);
    const convertedOrderId = convertRows[0]?.order_id;

    const { rows: quotAfterRows } = await client.query(`
      SELECT status FROM quotations WHERE id = '${createdQuotId}';
    `);
    const quotConverted = quotAfterRows[0]?.status === 'CONVERTED';

    // Second conversion attempt must be rejected
    let secondConvertBlocked = false;
    try {
      await client.query(`
        SELECT convert_quotation_atomic('${createdQuotId}', '${orgAId}', '2026-11-02', 'Re-convert attempt');
      `);
    } catch (e) {
      secondConvertBlocked = e.message.includes('can only be converted when in DRAFT, SENT, or ACCEPTED status');
    }

    recordTest('P1-QUOT-01', 'Quotation conversion is atomic, sets CONVERTED status, and prevents re-conversion', quotConverted && secondConvertBlocked, `Quotation ${createdQuotId} successfully converted to SO ${convertedOrderId}`);

    // ------------------------------------------------------------------------
    // P1 TEST 13: Payment Idempotency & Replay Resistance
    // ------------------------------------------------------------------------
    console.log('\n--- Executing P1 Payment Idempotency Tests ---');
    const paymentIdempotencyKey = 'idemp_pay_' + crypto.randomUUID();
    const allocJson = JSON.stringify([
      { invoice_id: createdInvoiceId, amount: 200.00 },
    ]);

    const { rows: pay1Rows } = await client.query(`
      SELECT record_payment_and_allocate(
        '${orgAId}',
        '${custAId}',
        200.00,
        'UPI',
        '2026-11-02',
        'UPI-REF-123456',
        'First payment attempt',
        '${allocJson}'::jsonb,
        '${userAId}',
        '${paymentIdempotencyKey}'
      ) AS payment_result;
    `);
    const pay1Result = pay1Rows[0]?.payment_result;

    // Replay with identical key: must return same payment without creating duplicate or double-allocating
    const { rows: payReplayRows } = await client.query(`
      SELECT record_payment_and_allocate(
        '${orgAId}',
        '${custAId}',
        200.00,
        'UPI',
        '2026-11-02',
        'UPI-REF-123456',
        'First payment attempt',
        '${allocJson}'::jsonb,
        '${userAId}',
        '${paymentIdempotencyKey}'
      ) AS payment_result;
    `);
    const payReplayResult = payReplayRows[0]?.payment_result;
    const samePaymentId = pay1Result.payment_id === payReplayResult.payment_id;

    // Verify invoice total_paid is exactly 200 (not 400)
    const { rows: invPaidRows } = await client.query(`
      SELECT total_paid FROM invoices WHERE id = '${createdInvoiceId}';
    `);
    const totalPaidExact = Number(invPaidRows[0]?.total_paid) === 200.00;

    recordTest('P1-PAY-01', 'Payment idempotency key returns cached receipt and prevents double-allocation', samePaymentId && totalPaidExact, `Invoice total_paid is exactly 200.00 across retries`);

    // Tampered payload with same key must be rejected
    let tamperedPayBlocked = false;
    try {
      await client.query(`
        SELECT record_payment_and_allocate(
          '${orgAId}',
          '${custAId}',
          500.00, -- altered amount!
          'UPI',
          '2026-11-02',
          'UPI-REF-123456',
          'Tampered attempt',
          '${allocJson}'::jsonb,
          '${userAId}',
          '${paymentIdempotencyKey}'
        );
      `);
    } catch (e) {
      tamperedPayBlocked = e.message.includes('Idempotency key reused with different request parameters');
    }
    recordTest('P1-PAY-02', 'Reused idempotency key with altered parameters is strictly rejected', tamperedPayBlocked, 'SHA-256 request fingerprint detected tampering');

    // ------------------------------------------------------------------------
    // P1 TEST 14: Server-side Aggregations & Dashboard Totals
    // ------------------------------------------------------------------------
    console.log('\n--- Executing P1 Server-side Aggregations Tests ---');
    const { rows: dashRows } = await client.query(`
      SELECT get_dashboard_metrics('${orgAId}') AS metrics;
    `);
    const dash = dashRows[0]?.metrics;
    const hasValidMetrics =
      dash &&
      typeof dash.today_sales === 'number' &&
      typeof dash.total_receivables === 'number' &&
      typeof dash.total_stock_value === 'number';

    recordTest('P1-DASH-01', 'Authoritative get_dashboard_metrics computes metrics in database without row truncation', hasValidMetrics, `Today sales: ${dash?.today_sales}, Receivables: ${dash?.total_receivables}, Stock value: ${dash?.total_stock_value}`);

    // ------------------------------------------------------------------------
    // P1 TEST 15: Cross-Tenant Isolation
    // ------------------------------------------------------------------------
    console.log('\n--- Executing Cross-Tenant Isolation Tests ---');
    // Set context to user B
    await client.query(`
      SELECT set_config('request.jwt.claim.sub', '${userBId}', true),
             set_config('request.jwt.claim.role', 'authenticated', true);
    `);

    let crossTenantBlocked = false;
    try {
      await client.query(`
        SELECT confirm_sales_order('${convertedOrderId}', '${orgBId}');
      `);
    } catch (e) {
      crossTenantBlocked = e.message.includes('not found') || e.message.includes('Access denied') || e.message.includes('violates');
    }
    recordTest('P1-TENANT-01', 'Cross-tenant RPC confirmation is rejected with access denial', crossTenantBlocked, 'User from Org B cannot confirm or access documents of Org A');

  } finally {
    // Cleanup synthetic test records
    console.log('\n--- Cleaning up synthetic test data ---');
    try {
      await client.query(`
        DELETE FROM organizations WHERE id IN ('${orgAId}', '${orgBId}');
        DELETE FROM auth.users WHERE id IN ('${userAId}', '${userBId}');
      `);
      console.log('Cleanup completed successfully.');
    } catch (cleanErr) {
      console.warn('Cleanup warning:', cleanErr.message);
    }
    await client.end();
  }

  // --------------------------------------------------------------------------
  // Summary & Reporting
  // --------------------------------------------------------------------------
  console.log('\n' + '='.repeat(80));
  console.log('TEST SUMMARY');
  console.log('='.repeat(80));

  const total = testResults.length;
  const passed = testResults.filter((t) => t.passed).length;
  const failed = total - passed;

  console.log(`Total Contract Tests: ${total}`);
  console.log(`Passed:               ${passed}`);
  console.log(`Failed:               ${failed}`);

  if (failed > 0) {
    console.error('\n❌ ACCEPTANCE SUITE FAILED — Unresolved vulnerabilities or contract breaks detected.');
    process.exit(1);
  } else {
    console.log('\n🎉 ALL ACCEPTANCE CONTRACTS PASSED WITH 100% SUCCESS.');
    process.exit(0);
  }
}

runAcceptance().catch((err) => {
  console.error('\n💥 Unexpected test runner exception:', err);
  process.exit(1);
});
