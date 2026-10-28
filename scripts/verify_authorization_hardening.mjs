/**
 * Atlas OS — Staging Authorization Hardening & NULL-Role Verification Suite
 * 
 * Verifies all 5 authorization boundary categories against remote Supabase:
 * 1. Unauthenticated callers (anon)
 * 2. Authenticated users without organization membership (NULL role in target org)
 * 3. Viewers attempting privileged actions
 * 4. Cross-tenant isolation (User from Org A accessing Org B)
 * 5. Valid authorized roles (owner, admin, sales, accounts) - testing allowed vs denied
 * 
 * SAFETY NOTICE:
 * - This script must NOT be run against production.
 * - Requires explicit test environment variables (no hardcoded fallback).
 * - Requires CONFIRM_STAGING_EXECUTION=true to execute.
 * - Verifies that every database operation succeeds or fails as expected.
 * - Tracks all cleanup operations and verifies that cleanup actually succeeds.
 */

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// ----------------------------------------------------------------------------
// 1. ENVIRONMENT CONFIGURATION & SAFETY GUARDS
// ----------------------------------------------------------------------------

const SUPABASE_URL = process.env.TEST_SUPABASE_URL || process.env.SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.TEST_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !PUBLISHABLE_KEY || !SERVICE_KEY) {
  console.error('\n❌ CONFIGURATION ERROR: Missing required environment variables.');
  console.error('All of the following must be explicitly supplied (no hardcoded fallbacks are permitted):');
  console.error('  - TEST_SUPABASE_URL (or SUPABASE_URL)');
  console.error('  - TEST_SUPABASE_ANON_KEY (or SUPABASE_ANON_KEY)');
  console.error('  - TEST_SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_ROLE_KEY)\n');
  process.exit(1);
}

// Guard against accidental execution against production
const isProductionTarget = SUPABASE_URL.includes('hrxjgbupjtikokqxjzbh') || SUPABASE_URL.includes('prod');
const isStagingConfirmed = process.env.CONFIRM_STAGING_EXECUTION === 'true';

if (isProductionTarget || !isStagingConfirmed) {
  console.error('\n🛑 SAFETY GUARD TRIGGERED: Refusing execution.');
  if (isProductionTarget) {
    console.error('Target URL is identified as the production or linked project (hrxjgbupjtikokqxjzbh).');
    console.error('Automated synthetic test user creation on production is prohibited.');
  }
  if (!isStagingConfirmed) {
    console.error('Execution requires CONFIRM_STAGING_EXECUTION=true to be explicitly set in your environment.');
  }
  console.error('Aborting without creating any users or modifying database state.\n');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const clientAnon = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const results = [];
function recordResult(id, category, name, pass, details) {
  results.push({ id, category, name, pass, details });
  const icon = pass ? '✅ PASS' : '❌ FAIL';
  console.log(`[${id}] ${icon} - [${category}] ${name}`);
  if (details) console.log(`      Details: ${details}`);
}

function assertNoError(res, operationName) {
  if (res && res.error) {
    throw new Error(`[${operationName}] Failed: ${res.error.message} (Code: ${res.error.code || 'unknown'})`);
  }
  return res.data;
}

async function createAuthenticatedClient(email, password) {
  const client = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Auth sign-in failed for ${email}: ${error.message}`);
  return { client, session: data.session, user: data.user };
}

async function main() {
  const runId = 'stg_auth_' + Math.random().toString(36).substring(2, 8);
  console.log(`\n======================================================================`);
  console.log(`  Atlas OS Authorization & NULL-Role Verification Suite [${runId}]`);
  console.log(`  Target Instance: ${SUPABASE_URL}`);
  console.log(`======================================================================\n`);

  const cleanup = {
    users: [],
    orgs: [],
    products: [],
    customers: [],
    salesOrders: [],
    salesOrderItems: [],
    invoices: [],
    payments: [],
    stockMovements: [],
  };

  try {
    // ------------------------------------------------------------------------
    // SETUP: Provision isolated test organizations & synthetic users
    // ------------------------------------------------------------------------
    const orgAId = crypto.randomUUID();
    const orgBId = crypto.randomUUID();
    cleanup.orgs.push(orgAId, orgBId);

    console.log('1. Provisioning synthetic organizations...');
    assertNoError(await admin.from('organizations').insert([
      { id: orgAId, name: `Synthetic Org A ${runId}`, currency: 'INR' },
      { id: orgBId, name: `Synthetic Org B ${runId}`, currency: 'INR' },
    ]), 'Insert Organizations');

    const testPassword = 'Synthetic_P@ssword_' + crypto.randomBytes(6).toString('hex') + '!';

    console.log('2. Provisioning synthetic users...');
    // User A_Owner (Owner of Org A)
    const emailA_Owner = `owner_a_${runId}@atlas-audit.test`;
    const uA_Owner = assertNoError(await admin.auth.admin.createUser({
      email: emailA_Owner, password: testPassword, email_confirm: true,
    }), 'Create User A_Owner');
    cleanup.users.push(uA_Owner.user.id);

    // User A_Sales (Sales in Org A)
    const emailA_Sales = `sales_a_${runId}@atlas-audit.test`;
    const uA_Sales = assertNoError(await admin.auth.admin.createUser({
      email: emailA_Sales, password: testPassword, email_confirm: true,
    }), 'Create User A_Sales');
    cleanup.users.push(uA_Sales.user.id);

    // User A_Accounts (Accounts in Org A)
    const emailA_Accounts = `accounts_a_${runId}@atlas-audit.test`;
    const uA_Accounts = assertNoError(await admin.auth.admin.createUser({
      email: emailA_Accounts, password: testPassword, email_confirm: true,
    }), 'Create User A_Accounts');
    cleanup.users.push(uA_Accounts.user.id);

    // User A_Viewer (Viewer in Org A)
    const emailA_Viewer = `viewer_a_${runId}@atlas-audit.test`;
    const uA_Viewer = assertNoError(await admin.auth.admin.createUser({
      email: emailA_Viewer, password: testPassword, email_confirm: true,
    }), 'Create User A_Viewer');
    cleanup.users.push(uA_Viewer.user.id);

    // User B_Owner (Owner of Org B)
    const emailB_Owner = `owner_b_${runId}@atlas-audit.test`;
    const uB_Owner = assertNoError(await admin.auth.admin.createUser({
      email: emailB_Owner, password: testPassword, email_confirm: true,
    }), 'Create User B_Owner');
    cleanup.users.push(uB_Owner.user.id);

    // User C_NoOrg (Authenticated user with NO organization memberships)
    const emailC_NoOrg = `no_org_${runId}@atlas-audit.test`;
    const uC_NoOrg = assertNoError(await admin.auth.admin.createUser({
      email: emailC_NoOrg, password: testPassword, email_confirm: true,
    }), 'Create User C_NoOrg');
    cleanup.users.push(uC_NoOrg.user.id);

    console.log('3. Assigning memberships...');
    assertNoError(await admin.from('memberships').insert([
      { organization_id: orgAId, user_id: uA_Owner.user.id, role: 'owner', is_active: true },
      { organization_id: orgAId, user_id: uA_Sales.user.id, role: 'sales', is_active: true },
      { organization_id: orgAId, user_id: uA_Accounts.user.id, role: 'accounts', is_active: true },
      { organization_id: orgAId, user_id: uA_Viewer.user.id, role: 'viewer', is_active: true },
      { organization_id: orgBId, user_id: uB_Owner.user.id, role: 'owner', is_active: true },
    ]), 'Insert Memberships');

    console.log('4. Authenticating clients...');
    const clientA_Owner = (await createAuthenticatedClient(emailA_Owner, testPassword)).client;
    const clientA_Sales = (await createAuthenticatedClient(emailA_Sales, testPassword)).client;
    const clientA_Accounts = (await createAuthenticatedClient(emailA_Accounts, testPassword)).client;
    const clientA_Viewer = (await createAuthenticatedClient(emailA_Viewer, testPassword)).client;
    const clientB_Owner = (await createAuthenticatedClient(emailB_Owner, testPassword)).client;
    const clientC_NoOrg = (await createAuthenticatedClient(emailC_NoOrg, testPassword)).client;

    console.log('5. Provisioning sample records in Org A and Org B...');
    // Seed product in Org A
    const prodAId = crypto.randomUUID();
    cleanup.products.push(prodAId);
    assertNoError(await admin.from('products').insert({
      id: prodAId, organization_id: orgAId, sku: `SKU-A-${runId}`, name: 'Product A',
      purchase_cost: 100, selling_price: 150, tax_rate: 18, reorder_threshold: 10, is_active: true,
    }), 'Insert Product A');

    // Seed stock movement (initial stock: 100)
    const smAId = crypto.randomUUID();
    cleanup.stockMovements.push(smAId);
    assertNoError(await admin.from('stock_movements').insert({
      id: smAId, organization_id: orgAId, product_id: prodAId, quantity_change: 100,
      movement_type: 'GOODS_RECEIVED', notes: 'Initial seed stock',
    }), 'Insert Stock A');

    // Seed customer in Org A
    const custAId = crypto.randomUUID();
    cleanup.customers.push(custAId);
    assertNoError(await admin.from('customers').insert({
      id: custAId, organization_id: orgAId, name: 'Customer A', phone: '9000000001',
      credit_limit: 50000, credit_days: 30, is_active: true,
    }), 'Insert Customer A');

    // Seed order in Org A
    const soAId = crypto.randomUUID();
    cleanup.salesOrders.push(soAId);
    assertNoError(await admin.from('sales_orders').insert({
      id: soAId, organization_id: orgAId, customer_id: custAId, order_number: `SO-A-${runId}`,
      status: 'DRAFT', order_date: '2026-10-27', subtotal: 1500, tax_amount: 270, total_amount: 1770,
    }), 'Insert Sales Order A');

    const soItemAId = crypto.randomUUID();
    cleanup.salesOrderItems.push(soItemAId);
    assertNoError(await admin.from('sales_order_items').insert({
      id: soItemAId, sales_order_id: soAId, product_id: prodAId, product_name: 'Product A',
      product_sku: `SKU-A-${runId}`, quantity: 10, unit_price: 150, line_subtotal: 1500, line_tax: 270, line_total: 1770,
    }), 'Insert Sales Order Item A');

    // Seed invoice in Org A
    const invAId = crypto.randomUUID();
    cleanup.invoices.push(invAId);
    assertNoError(await admin.from('invoices').insert({
      id: invAId, organization_id: orgAId, customer_id: custAId, invoice_number: `INV-A-${runId}`,
      status: 'ISSUED', invoice_date: '2026-10-27', due_date: '2026-11-27', subtotal: 1500,
      tax_amount: 270, total_amount: 1770, total_paid: 0,
    }), 'Insert Invoice A');

    // Seed product and order in Org B
    const prodBId = crypto.randomUUID();
    cleanup.products.push(prodBId);
    assertNoError(await admin.from('products').insert({
      id: prodBId, organization_id: orgBId, sku: `SKU-B-${runId}`, name: 'Product B',
      purchase_cost: 200, selling_price: 300, tax_rate: 18, reorder_threshold: 5, is_active: true,
    }), 'Insert Product B');

    const custBId = crypto.randomUUID();
    cleanup.customers.push(custBId);
    assertNoError(await admin.from('customers').insert({
      id: custBId, organization_id: orgBId, name: 'Customer B', phone: '9000000002',
      credit_limit: 100000, credit_days: 30, is_active: true,
    }), 'Insert Customer B');

    const soBId = crypto.randomUUID();
    cleanup.salesOrders.push(soBId);
    assertNoError(await admin.from('sales_orders').insert({
      id: soBId, organization_id: orgBId, customer_id: custBId, order_number: `SO-B-${runId}`,
      status: 'DRAFT', order_date: '2026-10-27', subtotal: 300, tax_amount: 54, total_amount: 354,
    }), 'Insert Sales Order B');

    console.log('\n--- Executing Regression Test Scenarios ---\n');

    // ========================================================================
    // CATEGORY 1: Unauthenticated Callers (anon)
    // ========================================================================
    const { error: anonConfirmErr } = await clientAnon.rpc('confirm_sales_order', {
      p_order_id: soAId, p_org_id: orgAId,
    });
    recordResult('R01', 'Unauthenticated', 'confirm_sales_order rejected for anon',
      Boolean(anonConfirmErr), `Error: ${anonConfirmErr?.message}`);

    const { error: anonPayErr } = await clientAnon.rpc('record_payment_and_allocate', {
      p_org_id: orgAId, p_customer_id: custAId, p_amount: 500, p_payment_method: 'CASH',
      p_reference_no: null, p_payment_date: '2026-10-27', p_notes: null, p_invoice_id: null, p_allocated_amount: null,
    });
    recordResult('R02', 'Unauthenticated', 'record_payment_and_allocate rejected for anon',
      Boolean(anonPayErr), `Error: ${anonPayErr?.message}`);

    const { error: anonStockErr } = await clientAnon.rpc('get_product_stock', {
      p_product_id: prodAId, p_org_id: orgAId,
    });
    recordResult('R03', 'Unauthenticated', 'get_product_stock rejected for anon',
      Boolean(anonStockErr), `Error: ${anonStockErr?.message}`);

    // ========================================================================
    // CATEGORY 2: Authenticated User Without Organization Membership (NULL Role)
    // ========================================================================
    const { error: noOrgConfirmErr } = await clientC_NoOrg.rpc('confirm_sales_order', {
      p_order_id: soAId, p_org_id: orgAId,
    });
    const noOrgConfirmBlocked = Boolean(noOrgConfirmErr) &&
      (noOrgConfirmErr.message.includes('no active membership') || noOrgConfirmErr.message.includes('Unauthorized'));
    recordResult('R04', 'No-Membership', 'User with NO membership rejected by confirm_sales_order',
      noOrgConfirmBlocked, `Message: ${noOrgConfirmErr?.message}`);

    const { error: noOrgPayErr } = await clientC_NoOrg.rpc('record_payment_and_allocate', {
      p_org_id: orgAId, p_customer_id: custAId, p_amount: 500, p_payment_method: 'CASH',
      p_reference_no: null, p_payment_date: '2026-10-27', p_notes: null, p_invoice_id: null, p_allocated_amount: null,
    });
    const noOrgPayBlocked = Boolean(noOrgPayErr) &&
      (noOrgPayErr.message.includes('no active membership') || noOrgPayErr.message.includes('Unauthorized'));
    recordResult('R05', 'No-Membership', 'User with NO membership rejected by record_payment_and_allocate (NULL-role fix)',
      noOrgPayBlocked, `Message: ${noOrgPayErr?.message}`);

    const { error: noOrgStockErr } = await clientC_NoOrg.rpc('get_product_stock', {
      p_product_id: prodAId, p_org_id: orgAId,
    });
    recordResult('R06', 'No-Membership', 'User with NO membership rejected by get_product_stock',
      Boolean(noOrgStockErr), `Message: ${noOrgStockErr?.message}`);

    // ========================================================================
    // CATEGORY 3: Viewers Attempting Privileged Actions
    // ========================================================================
    const { error: viewerConfirmErr } = await clientA_Viewer.rpc('confirm_sales_order', {
      p_order_id: soAId, p_org_id: orgAId,
    });
    const viewerConfirmBlocked = Boolean(viewerConfirmErr) &&
      viewerConfirmErr.message.includes('insufficient role');
    recordResult('R07', 'Viewer Denial', 'Viewer confirming sales order rejected with insufficient role',
      viewerConfirmBlocked, `Message: ${viewerConfirmErr?.message}`);

    const { error: viewerPayErr } = await clientA_Viewer.rpc('record_payment_and_allocate', {
      p_org_id: orgAId, p_customer_id: custAId, p_amount: 500, p_payment_method: 'CASH',
      p_reference_no: null, p_payment_date: '2026-10-27', p_notes: null, p_invoice_id: null, p_allocated_amount: null,
    });
    const viewerPayBlocked = Boolean(viewerPayErr) &&
      viewerPayErr.message.includes('insufficient role');
    recordResult('R08', 'Viewer Denial', 'Viewer recording payment rejected with insufficient role',
      viewerPayBlocked, `Message: ${viewerPayErr?.message}`);

    const { data: viewerStock, error: viewerStockErr } = await clientA_Viewer.rpc('get_product_stock', {
      p_product_id: prodAId, p_org_id: orgAId,
    });
    recordResult('R09', 'Viewer Allowed', 'Viewer permitted to read product stock in own organization',
      viewerStock === 100 && !viewerStockErr, `Stock: ${viewerStock}`);

    // ========================================================================
    // CATEGORY 4: Cross-Tenant Isolation (User from Org A accessing Org B)
    // ========================================================================
    const { error: crossOrgConfirmErr } = await clientA_Owner.rpc('confirm_sales_order', {
      p_order_id: soBId, p_org_id: orgBId,
    });
    const crossConfirmBlocked = Boolean(crossOrgConfirmErr) &&
      (crossOrgConfirmErr.message.includes('no active membership') || crossOrgConfirmErr.message.includes('insufficient role'));
    recordResult('R10', 'Cross-Tenant', 'User from Org A confirming Order B with Org B ID rejected',
      crossConfirmBlocked, `Message: ${crossOrgConfirmErr?.message}`);

    const { error: crossOrgPayErr } = await clientA_Owner.rpc('record_payment_and_allocate', {
      p_org_id: orgBId, p_customer_id: custBId, p_amount: 200, p_payment_method: 'CASH',
      p_reference_no: null, p_payment_date: '2026-10-27', p_notes: null, p_invoice_id: null, p_allocated_amount: null,
    });
    const crossPayBlocked = Boolean(crossOrgPayErr) &&
      (crossOrgPayErr.message.includes('no active membership') || crossOrgPayErr.message.includes('insufficient role'));
    recordResult('R11', 'Cross-Tenant', 'User from Org A recording payment in Org B rejected (NULL-role cross-tenant fix)',
      crossPayBlocked, `Message: ${crossOrgPayErr?.message}`);

    const { error: crossOrgStockErr } = await clientA_Owner.rpc('get_product_stock', {
      p_product_id: prodBId, p_org_id: orgBId,
    });
    recordResult('R12', 'Cross-Tenant', 'User from Org A querying stock in Org B rejected',
      Boolean(crossOrgStockErr), `Message: ${crossOrgStockErr?.message}`);

    const { error: crossOrgOrderMismatchErr } = await clientA_Owner.rpc('confirm_sales_order', {
      p_order_id: soBId, p_org_id: orgAId,
    });
    recordResult('R13', 'Cross-Tenant', 'User from Org A confirming Order B passing Org A ID rejected (record not found)',
      Boolean(crossOrgOrderMismatchErr) && crossOrgOrderMismatchErr.message.includes('not found in organization'),
      `Message: ${crossOrgOrderMismatchErr?.message}`);

    // ========================================================================
    // CATEGORY 5: Valid Authorized Roles (Allowed & Negative Cross-Role Cases)
    // ========================================================================
    // 5.1 Sales role confirming order in Org A -> Allowed
    const { data: salesConfirmData, error: salesConfirmErr } = await clientA_Sales.rpc('confirm_sales_order', {
      p_order_id: soAId, p_org_id: orgAId,
    });
    recordResult('R14', 'Authorized Role', 'Sales user confirming order in own organization succeeds',
      salesConfirmData?.success === true && !salesConfirmErr,
      `Status: ${salesConfirmData?.status || salesConfirmErr?.message}`);

    // Verify stock decremented by 10 (now 90)
    const { data: stockAfter } = await clientA_Sales.rpc('get_product_stock', {
      p_product_id: prodAId, p_org_id: orgAId,
    });
    recordResult('R15', 'Authorized Role', 'Stock decremented accurately from 100 to 90 upon order confirmation',
      stockAfter === 90, `Stock: ${stockAfter}`);

    // 5.2 Accounts user attempting to confirm order -> Denied (only sales, admin, owner)
    const soA2Id = crypto.randomUUID();
    cleanup.salesOrders.push(soA2Id);
    assertNoError(await admin.from('sales_orders').insert({
      id: soA2Id, organization_id: orgAId, customer_id: custAId, order_number: `SO-A2-${runId}`,
      status: 'DRAFT', order_date: '2026-10-27', subtotal: 300, tax_amount: 54, total_amount: 354,
    }), 'Insert Sales Order A2');

    const { error: accountsConfirmErr } = await clientA_Accounts.rpc('confirm_sales_order', {
      p_order_id: soA2Id, p_org_id: orgAId,
    });
    recordResult('R16', 'Role Boundary', 'Accounts user attempting to confirm order rejected with insufficient role',
      Boolean(accountsConfirmErr) && accountsConfirmErr.message.includes('insufficient role (accounts)'),
      `Message: ${accountsConfirmErr?.message}`);

    // 5.3 Sales user attempting to record payment -> Denied (only accounts, admin, owner)
    const { error: salesPayErr } = await clientA_Sales.rpc('record_payment_and_allocate', {
      p_org_id: orgAId, p_customer_id: custAId, p_amount: 250, p_payment_method: 'UPI',
      p_reference_no: null, p_payment_date: '2026-10-27', p_notes: null, p_invoice_id: null, p_allocated_amount: null,
    });
    recordResult('R17', 'Role Boundary', 'Sales user attempting to record payment rejected with insufficient role',
      Boolean(salesPayErr) && salesPayErr.message.includes('insufficient role (sales)'),
      `Message: ${salesPayErr?.message}`);

    // 5.4 Accounts user recording payment and allocating to invoice -> Allowed
    const { data: accountsPayData, error: accountsPayErr } = await clientA_Accounts.rpc('record_payment_and_allocate', {
      p_org_id: orgAId, p_customer_id: custAId, p_amount: 770, p_payment_method: 'NEFT',
      p_reference_no: 'UTR-TEST-001', p_payment_date: '2026-10-27', p_notes: 'Valid accounts payment',
      p_invoice_id: invAId, p_allocated_amount: 770,
    });
    recordResult('R18', 'Authorized Role', 'Accounts user recording payment and allocating to invoice succeeds',
      accountsPayData?.success === true && !accountsPayErr,
      `Payment ID: ${accountsPayData?.payment_id || accountsPayErr?.message}`);

    // 5.5 Owner recording payment -> Allowed
    const { data: ownerPayData, error: ownerPayErr } = await clientA_Owner.rpc('record_payment_and_allocate', {
      p_org_id: orgAId, p_customer_id: custAId, p_amount: 1000, p_payment_method: 'CASH',
      p_reference_no: null, p_payment_date: '2026-10-27', p_notes: 'Owner final payment',
      p_invoice_id: invAId, p_allocated_amount: 1000,
    });
    recordResult('R19', 'Authorized Role', 'Owner recording payment and closing invoice balance succeeds',
      ownerPayData?.success === true && !ownerPayErr,
      `Payment ID: ${ownerPayData?.payment_id || ownerPayErr?.message}`);

    // Verify invoice is now PAID
    const { data: invFinal, error: invFinalErr } = await clientA_Owner.from('invoices').select('status, total_paid').eq('id', invAId).single();
    assertNoError({ data: invFinal, error: invFinalErr }, 'Fetch Final Invoice');
    recordResult('R20', 'State Transition', 'Invoice status transitioned to PAID with balance fully settled (1770/1770)',
      invFinal?.status === 'PAID' && Number(invFinal?.total_paid) === 1770,
      `Status: ${invFinal?.status}, Total Paid: ${invFinal?.total_paid}`);

    console.log('\n======================================================================');
    const passed = results.filter((r) => r.pass).length;
    console.log(`  VERIFICATION RESULTS: ${passed}/${results.length} PASSED`);
    console.log('======================================================================\n');

  } catch (err) {
    console.error('Fatal Verification Error:', err);
  } finally {
    console.log('=== Safely Cleaning Up Synthetic Test Records ===');
    let cleanupFailed = false;
    const cleanupErrors = [];

    async function safeDelete(promise, label) {
      try {
        const res = await promise;
        if (res && res.error) {
          cleanupFailed = true;
          cleanupErrors.push(`${label}: ${res.error.message}`);
        }
      } catch (err) {
        cleanupFailed = true;
        cleanupErrors.push(`${label}: ${err.message}`);
      }
    }

    try {
      if (cleanup.orgs.length > 0) {
        await safeDelete(admin.from('audit_events').delete().in('organization_id', cleanup.orgs), 'Delete Audit Events');
        await safeDelete(admin.from('stock_movements').delete().in('organization_id', cleanup.orgs), 'Delete Stock Movements');
        await safeDelete(admin.from('payment_allocations').delete().filter('payment_id', 'in',
          `(SELECT id FROM payments WHERE organization_id IN ('${cleanup.orgs.join("','")}'))`), 'Delete Payment Allocations');
        await safeDelete(admin.from('payments').delete().in('organization_id', cleanup.orgs), 'Delete Payments');
        await safeDelete(admin.from('sales_order_items').delete().in('sales_order_id', cleanup.salesOrders), 'Delete Order Items');
        await safeDelete(admin.from('sales_orders').delete().in('organization_id', cleanup.orgs), 'Delete Sales Orders');
        await safeDelete(admin.from('invoices').delete().in('organization_id', cleanup.orgs), 'Delete Invoices');
        await safeDelete(admin.from('products').delete().in('organization_id', cleanup.orgs), 'Delete Products');
        await safeDelete(admin.from('customers').delete().in('organization_id', cleanup.orgs), 'Delete Customers');
        await safeDelete(admin.from('memberships').delete().in('organization_id', cleanup.orgs), 'Delete Memberships');
        await safeDelete(admin.from('organizations').delete().in('id', cleanup.orgs), 'Delete Organizations');
      }
      for (const uid of cleanup.users) {
        const delUserRes = await admin.auth.admin.deleteUser(uid);
        if (delUserRes.error) {
          cleanupFailed = true;
          cleanupErrors.push(`Delete User ${uid}: ${delUserRes.error.message}`);
        }
      }

      if (cleanupFailed) {
        console.error('❌ CLEANUP WARNING / FAILURE: Errors occurred while removing synthetic records:');
        for (const e of cleanupErrors) {
          console.error(`   - ${e}`);
        }
      } else {
        console.log('✅ Cleanup completed cleanly: All synthetic test records and users deleted.');
      }
    } catch (cleanupFatalErr) {
      console.error('Fatal cleanup exception:', cleanupFatalErr.message);
    }
  }
}

main();
