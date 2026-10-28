import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://hrxjgbupjtikokqxjzbh.supabase.co';
const PUBLISHABLE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const clientAnon = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const results = [];
function recordResult(id, name, pass, details, method = 'Remote Supabase REST/RPC') {
  results.push({ id, name, pass, details, method });
  const icon = pass ? '✅ PASS' : '❌ FAIL';
  console.log(`[${id}] ${icon} - ${name} (${details})`);
}

async function main() {
  const runId = 't_' + Math.random().toString(36).substring(2, 8);
  console.log(`=== Starting Atlas OS Remote Security Verification [Run: ${runId}] ===`);

  // Track created entities for 100% safe cleanup
  const cleanupIds = {
    users: [],
    orgs: [],
    customers: [],
    products: [],
    suppliers: [],
    quotations: [],
    salesOrders: [],
    invoices: [],
    payments: [],
    paymentAllocations: [],
    stockMovements: [],
    auditEvents: [],
  };

  try {
    // ------------------------------------------------------------------------
    // SETUP: Create isolated test tenants & users
    // ------------------------------------------------------------------------
    const orgAId = crypto.randomUUID();
    const orgBId = crypto.randomUUID();
    cleanupIds.orgs.push(orgAId, orgBId);

    // Create organizations via admin
    const { error: orgErr } = await admin.from('organizations').insert([
      { id: orgAId, name: `Synthetic Org A ${runId}`, currency: 'INR' },
      { id: orgBId, name: `Synthetic Org B ${runId}`, currency: 'INR' },
    ]);
    if (orgErr) throw new Error('Failed to create test organizations: ' + orgErr.message);

    // Create synthetic auth users
    const userPass = 'Synthetic_Passw0rd_' + crypto.randomBytes(6).toString('hex') + '!';
    
    // User A: Owner of Org A
    const emailA = `user_a_${runId}@atlas-audit.test`;
    const { data: uA, error: uAErr } = await admin.auth.admin.createUser({
      email: emailA,
      password: userPass,
      email_confirm: true,
    });
    if (uAErr) throw new Error('Failed to create User A: ' + uAErr.message);
    const userAId = uA.user.id;
    cleanupIds.users.push(userAId);

    // User B: Owner of Org B
    const emailB = `user_b_${runId}@atlas-audit.test`;
    const { data: uB, error: uBErr } = await admin.auth.admin.createUser({
      email: emailB,
      password: userPass,
      email_confirm: true,
    });
    if (uBErr) throw new Error('Failed to create User B: ' + uBErr.message);
    const userBId = uB.user.id;
    cleanupIds.users.push(userBId);

    // User A2: Viewer in Org A
    const emailA2 = `user_a2_${runId}@atlas-audit.test`;
    const { data: uA2, error: uA2Err } = await admin.auth.admin.createUser({
      email: emailA2,
      password: userPass,
      email_confirm: true,
    });
    if (uA2Err) throw new Error('Failed to create User A2: ' + uA2Err.message);
    const userA2Id = uA2.user.id;
    cleanupIds.users.push(userA2Id);

    // Assign memberships
    const { error: memErr } = await admin.from('memberships').insert([
      { organization_id: orgAId, user_id: userAId, role: 'owner', is_active: true },
      { organization_id: orgBId, user_id: userBId, role: 'owner', is_active: true },
      { organization_id: orgAId, user_id: userA2Id, role: 'viewer', is_active: true },
    ]);
    if (memErr) throw new Error('Failed to create test memberships: ' + memErr.message);

    // Authenticate client sessions
    const clientA = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: loginAErr } = await clientA.auth.signInWithPassword({ email: emailA, password: userPass });
    if (loginAErr) throw new Error('User A login failed: ' + loginAErr.message);

    const clientB = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: loginBErr } = await clientB.auth.signInWithPassword({ email: emailB, password: userPass });
    if (loginBErr) throw new Error('User B login failed: ' + loginBErr.message);

    const clientA2 = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: loginA2Err } = await clientA2.auth.signInWithPassword({ email: emailA2, password: userPass });
    if (loginA2Err) throw new Error('User A2 login failed: ' + loginA2Err.message);

    console.log('Test clients authenticated successfully. Seeding test records via authenticated REST...');

    // ------------------------------------------------------------------------
    // SEED TEST DATA VIA AUTHENTICATED REST
    // ------------------------------------------------------------------------
    // Org A entities
    const custAId = crypto.randomUUID();
    const prodAId = crypto.randomUUID();
    const suppAId = crypto.randomUUID();
    const quotAId = crypto.randomUUID();
    const soAId = crypto.randomUUID();
    const invAId = crypto.randomUUID();
    const payAId = crypto.randomUUID();

    cleanupIds.customers.push(custAId);
    cleanupIds.products.push(prodAId);
    cleanupIds.suppliers.push(suppAId);
    cleanupIds.quotations.push(quotAId);
    cleanupIds.salesOrders.push(soAId);
    cleanupIds.invoices.push(invAId);
    cleanupIds.payments.push(payAId);

    const { error: insCustA } = await clientA.from('customers').insert({ id: custAId, organization_id: orgAId, name: `Cust A ${runId}` });
    if (insCustA) throw new Error('Insert Cust A failed: ' + insCustA.message);

    const { error: insProdA } = await clientA.from('products').insert({
      id: prodAId, organization_id: orgAId, sku: `SKU-A-${runId}`, name: 'Product A', category: 'General', selling_price: 100, purchase_cost: 60
    });
    if (insProdA) throw new Error('Insert Prod A failed: ' + insProdA.message);

    const { error: insSuppA } = await clientA.from('suppliers').insert({ id: suppAId, organization_id: orgAId, name: `Supp A ${runId}` });
    if (insSuppA) throw new Error('Insert Supp A failed: ' + insSuppA.message);

    const { error: insQuotA } = await clientA.from('quotations').insert({
      id: quotAId, organization_id: orgAId, quotation_number: `QT-A-${runId}`, customer_id: custAId, valid_until: '2027-01-01', total_amount: 1000
    });
    if (insQuotA) throw new Error('Insert Quot A failed: ' + insQuotA.message);

    const { error: insQuotItemA } = await clientA.from('quotation_items').insert({
      quotation_id: quotAId, product_id: prodAId, product_name: 'Product A', product_sku: `SKU-A-${runId}`, quantity: 10, unit_price: 100, line_total: 1000
    });
    if (insQuotItemA) throw new Error('Insert Quot Item A failed: ' + insQuotItemA.message);

    const { error: insSoA } = await clientA.from('sales_orders').insert({
      id: soAId, organization_id: orgAId, order_number: `SO-A-${runId}`, customer_id: custAId, total_amount: 1000, status: 'DRAFT'
    });
    if (insSoA) throw new Error('Insert SO A failed: ' + insSoA.message);

    const { error: insSoItemA } = await clientA.from('sales_order_items').insert({
      sales_order_id: soAId, product_id: prodAId, product_name: 'Product A', product_sku: `SKU-A-${runId}`, quantity: 10, unit_price: 100, line_total: 1000
    });
    if (insSoItemA) throw new Error('Insert SO Item A failed: ' + insSoItemA.message);

    const { error: insInvA } = await clientA.from('invoices').insert({
      id: invAId, organization_id: orgAId, invoice_number: `INV-A-${runId}`, customer_id: custAId, due_date: '2027-01-01', total_amount: 1000, status: 'ISSUED'
    });
    if (insInvA) throw new Error('Insert Inv A failed: ' + insInvA.message);

    const { error: insPayA } = await clientA.from('payments').insert({
      id: payAId, organization_id: orgAId, payment_number: `PAY-A-${runId}`, customer_id: custAId, amount: 500, payment_method: 'UPI'
    });
    if (insPayA) throw new Error('Insert Pay A failed: ' + insPayA.message);

    // Org B entities
    const custBId = crypto.randomUUID();
    const prodBId = crypto.randomUUID();
    const suppBId = crypto.randomUUID();
    const soBId = crypto.randomUUID();
    const invBId = crypto.randomUUID();

    cleanupIds.customers.push(custBId);
    cleanupIds.products.push(prodBId);
    cleanupIds.suppliers.push(suppBId);
    cleanupIds.salesOrders.push(soBId);
    cleanupIds.invoices.push(invBId);

    const { error: insCustB } = await clientB.from('customers').insert({ id: custBId, organization_id: orgBId, name: `Cust B ${runId}` });
    if (insCustB) throw new Error('Insert Cust B failed: ' + insCustB.message);

    const { error: insProdB } = await clientB.from('products').insert({
      id: prodBId, organization_id: orgBId, sku: `SKU-B-${runId}`, name: 'Product B', category: 'General', selling_price: 200, purchase_cost: 120
    });
    if (insProdB) throw new Error('Insert Prod B failed: ' + insProdB.message);

    const { error: insSuppB } = await clientB.from('suppliers').insert({ id: suppBId, organization_id: orgBId, name: `Supp B ${runId}` });
    if (insSuppB) throw new Error('Insert Supp B failed: ' + insSuppB.message);

    const { error: insSoB } = await clientB.from('sales_orders').insert({
      id: soBId, organization_id: orgBId, order_number: `SO-B-${runId}`, customer_id: custBId, total_amount: 2000, status: 'DRAFT'
    });
    if (insSoB) throw new Error('Insert SO B failed: ' + insSoB.message);

    const { error: insSoItemB } = await clientB.from('sales_order_items').insert({
      sales_order_id: soBId, product_id: prodBId, product_name: 'Product B', product_sku: `SKU-B-${runId}`, quantity: 5, unit_price: 200, line_total: 1000
    });
    if (insSoItemB) throw new Error('Insert SO Item B failed: ' + insSoItemB.message);

    const { error: insInvB } = await clientB.from('invoices').insert({
      id: invBId, organization_id: orgBId, invoice_number: `INV-B-${runId}`, customer_id: custBId, due_date: '2027-01-01', total_amount: 2000, status: 'ISSUED'
    });
    if (insInvB) throw new Error('Insert Inv B failed: ' + insInvB.message);

    console.log('Seed records created. Beginning security control tests...');

    // ------------------------------------------------------------------------
    // TEST 1: Cross-Tenant Read Isolation (SELECT)
    // ------------------------------------------------------------------------
    const { data: selProdsA } = await clientA.from('products').select('id, name, organization_id');
    const hasOrgBProd = selProdsA?.some(p => p.organization_id === orgBId || p.id === prodBId);
    const hasOrgAProd = selProdsA?.some(p => p.organization_id === orgAId && p.id === prodAId);
    recordResult('T01', 'Cross-Tenant Read: User A cannot see Org B products', !hasOrgBProd && hasOrgAProd, `Org A saw ${selProdsA?.length} product(s), 0 from Org B`);

    const { data: selCustsA } = await clientA.from('customers').select('id, organization_id');
    const hasOrgBCust = selCustsA?.some(c => c.organization_id === orgBId || c.id === custBId);
    recordResult('T02', 'Cross-Tenant Read: User A cannot see Org B customers', !hasOrgBCust, `Org A saw ${selCustsA?.length} customer(s), 0 from Org B`);

    const { data: selOrdersA } = await clientA.from('sales_orders').select('id, organization_id');
    const hasOrgBOrder = selOrdersA?.some(o => o.organization_id === orgBId || o.id === soBId);
    recordResult('T03', 'Cross-Tenant Read: User A cannot see Org B sales orders', !hasOrgBOrder, `Org A saw ${selOrdersA?.length} order(s), 0 from Org B`);

    const { data: selInvsA } = await clientA.from('invoices').select('id, organization_id');
    const hasOrgBInv = selInvsA?.some(i => i.organization_id === orgBId || i.id === invBId);
    recordResult('T04', 'Cross-Tenant Read: User A cannot see Org B invoices', !hasOrgBInv, `Org A saw ${selInvsA?.length} invoice(s), 0 from Org B`);

    const { data: selProdBDirect } = await clientA.from('products').select('*').eq('id', prodBId);
    recordResult('T05', 'Cross-Tenant Direct Read: User A querying Product B by ID returns empty', selProdBDirect?.length === 0, `Returned ${selProdBDirect?.length} rows`);

    const { data: selProdADirect } = await clientB.from('products').select('*').eq('id', prodAId);
    recordResult('T06', 'Cross-Tenant Direct Read: User B querying Product A by ID returns empty', selProdADirect?.length === 0, `Returned ${selProdADirect?.length} rows`);

    // ------------------------------------------------------------------------
    // TEST 2: Cross-Tenant Insert Prevention (INSERT)
    // ------------------------------------------------------------------------
    const maliciousProdId = crypto.randomUUID();
    const { error: insMalProd } = await clientA.from('products').insert({
      id: maliciousProdId,
      organization_id: orgBId, // Malicious cross-tenant injection
      sku: `SKU-MAL-${runId}`,
      name: 'Malicious Product',
      category: 'Attack',
    });
    recordResult('T07', 'Cross-Tenant Insert: User A inserting into Org B products rejected', Boolean(insMalProd), `Error: ${insMalProd?.code || insMalProd?.message}`);

    const maliciousOrderId = crypto.randomUUID();
    const { error: insMalOrder } = await clientA.from('sales_orders').insert({
      id: maliciousOrderId,
      organization_id: orgBId,
      order_number: `SO-MAL-${runId}`,
      customer_id: custBId,
      total_amount: 500,
    });
    recordResult('T08', 'Cross-Tenant Insert: User A inserting into Org B sales orders rejected', Boolean(insMalOrder), `Error: ${insMalOrder?.code || insMalOrder?.message}`);

    const maliciousCustId = crypto.randomUUID();
    const { error: insMalCust } = await clientA.from('customers').insert({
      id: maliciousCustId,
      organization_id: orgBId,
      name: 'Malicious Customer',
    });
    recordResult('T09', 'Cross-Tenant Insert: User A inserting into Org B customers rejected', Boolean(insMalCust), `Error: ${insMalCust?.code || insMalCust?.message}`);

    // ------------------------------------------------------------------------
    // TEST 3: Cross-Tenant Update Prevention (UPDATE)
    // ------------------------------------------------------------------------
    const { data: updProdB } = await clientA.from('products')
      .update({ selling_price: 9999 })
      .eq('id', prodBId)
      .select();
    const prodBModified = updProdB && updProdB.length > 0;
    recordResult('T10', 'Cross-Tenant Update: User A updating Product B affects 0 rows', !prodBModified, `Rows updated: ${updProdB?.length || 0}`);

    const { data: updOrderB } = await clientA.from('sales_orders')
      .update({ status: 'CONFIRMED' })
      .eq('id', soBId)
      .select();
    recordResult('T11', 'Cross-Tenant Update: User A updating Order B affects 0 rows', (!updOrderB || updOrderB.length === 0), `Rows updated: ${updOrderB?.length || 0}`);

    // ------------------------------------------------------------------------
    // TEST 4: Cross-Tenant Delete Prevention (DELETE)
    // ------------------------------------------------------------------------
    const { data: delProdB } = await clientA.from('products')
      .delete()
      .eq('id', prodBId)
      .select();
    recordResult('T12', 'Cross-Tenant Delete: User A deleting Product B affects 0 rows', (!delProdB || delProdB.length === 0), `Rows deleted: ${delProdB?.length || 0}`);

    // Verify Product B still exists intact in Org B
    const { data: verifyProdB } = await clientB.from('products').select('id, selling_price').eq('id', prodBId);
    recordResult('T13', 'Integrity: Product B remains intact after User A delete/update attacks', verifyProdB?.length === 1 && verifyProdB[0].selling_price === 200, `Product B count: ${verifyProdB?.length}, price: ${verifyProdB?.[0]?.selling_price}`);

    // ------------------------------------------------------------------------
    // TEST 5: Role Escalation Prevention
    // ------------------------------------------------------------------------
    // User A2 is a viewer. Attempt self-escalation to owner.
    const { data: escData, error: escErr } = await clientA2.from('memberships')
      .update({ role: 'owner' })
      .eq('user_id', userA2Id)
      .select();
    const escalated = escData && escData.length > 0;
    recordResult('T14', 'Role Escalation: Viewer self-escalating to owner rejected', !escalated, `Rows updated: ${escData?.length || 0}, error: ${escErr?.message || 'none'}`);

    // Viewer attempting to insert product
    const { error: viewerInsProdErr } = await clientA2.from('products').insert({
      id: crypto.randomUUID(),
      organization_id: orgAId,
      sku: `SKU-VIEWER-${runId}`,
      name: 'Viewer Product',
      category: 'Test',
    });
    recordResult('T15', 'RBAC Enforcement: Viewer inserting product rejected by policy', Boolean(viewerInsProdErr), `Error: ${viewerInsProdErr?.code || viewerInsProdErr?.message}`);

    // ------------------------------------------------------------------------
    // TEST 6: Unauthenticated Access Prevention (anon)
    // ------------------------------------------------------------------------
    const { data: anonProds } = await clientAnon.from('products').select('*');
    recordResult('T16', 'Unauthenticated Read: anon selecting products returns 0 rows', (!anonProds || anonProds.length === 0), `Rows returned: ${anonProds?.length || 0}`);

    const { data: anonOrgs } = await clientAnon.from('organizations').select('*');
    recordResult('T17', 'Unauthenticated Read: anon selecting organizations returns 0 rows', (!anonOrgs || anonOrgs.length === 0), `Rows returned: ${anonOrgs?.length || 0}`);

    const { error: anonInsErr } = await clientAnon.from('products').insert({
      id: crypto.randomUUID(),
      organization_id: orgAId,
      sku: `SKU-ANON-${runId}`,
      name: 'Anon Product',
      category: 'Test',
    });
    recordResult('T18', 'Unauthenticated Write: anon inserting product rejected', Boolean(anonInsErr), `Error: ${anonInsErr?.code || anonInsErr?.message}`);

    // Unauthenticated RPC calls
    const { error: anonRpcStock } = await clientAnon.rpc('get_product_stock', { p_product_id: prodAId, p_org_id: orgAId });
    recordResult('T19', 'Unauthenticated RPC: anon calling get_product_stock rejected', Boolean(anonRpcStock), `Error: ${anonRpcStock?.message}`);

    const { error: anonRpcConfirm } = await clientAnon.rpc('confirm_sales_order', { p_order_id: soAId, p_org_id: orgAId });
    recordResult('T20', 'Unauthenticated RPC: anon calling confirm_sales_order rejected', Boolean(anonRpcConfirm), `Error: ${anonRpcConfirm?.message}`);

    const { error: anonRpcPay } = await clientAnon.rpc('record_payment_and_allocate', {
      p_org_id: orgAId, p_customer_id: custAId, p_amount: 100, p_payment_method: 'CASH', p_reference_no: null,
      p_payment_date: '2026-10-27', p_notes: null, p_invoice_id: invAId, p_allocated_amount: 100
    });
    recordResult('T21', 'Unauthenticated RPC: anon calling record_payment_and_allocate rejected', Boolean(anonRpcPay), `Error: ${anonRpcPay?.message}`);

    // ------------------------------------------------------------------------
    // TEST 7: Cross-Tenant RPC Execution Protection
    // ------------------------------------------------------------------------
    // User A attempts to confirm User B's order using Org B ID
    const { error: rpcCrossOrgB } = await clientA.rpc('confirm_sales_order', { p_order_id: soBId, p_org_id: orgBId });
    recordResult('T22', 'Cross-Tenant RPC: User A confirming Order B with Org B rejected (unauthorized role)', Boolean(rpcCrossOrgB), `Error: ${rpcCrossOrgB?.message}`);

    // User A attempts to confirm User B's order passing Org A ID
    const { error: rpcCrossOrgA } = await clientA.rpc('confirm_sales_order', { p_order_id: soBId, p_org_id: orgAId });
    recordResult('T23', 'Cross-Tenant RPC: User A confirming Order B with Org A rejected (order not in org)', Boolean(rpcCrossOrgA), `Error: ${rpcCrossOrgA?.message}`);

    // User A attempts to query stock of User B's product
    const { error: rpcStockCross } = await clientA.rpc('get_product_stock', { p_product_id: prodBId, p_org_id: orgBId });
    recordResult('T24', 'Cross-Tenant RPC: User A querying stock in Org B rejected', Boolean(rpcStockCross), `Error: ${rpcStockCross?.message}`);

    // ------------------------------------------------------------------------
    // TEST 8: Immediate Access Loss on Membership Deactivation
    // ------------------------------------------------------------------------
    // Verify User A2 initially sees products in Org A
    const { data: viewerBefore } = await clientA2.from('products').select('id');
    const viewerSawBefore = viewerBefore?.length > 0;

    // Deactivate User A2 membership
    await admin.from('memberships').update({ is_active: false }).eq('user_id', userA2Id);

    // User A2 immediately re-queries products
    const { data: viewerAfter } = await clientA2.from('products').select('id');
    recordResult('T25', 'User Deactivation: User A2 loses all access immediately upon deactivation', viewerSawBefore && viewerAfter?.length === 0, `Before: ${viewerBefore?.length} rows, After: ${viewerAfter?.length || 0} rows`);

    // ------------------------------------------------------------------------
    // TEST 9: Cross-Tenant Relational Triggers
    // ------------------------------------------------------------------------
    // Attempt adding Product B (Org B) into Quotation A (Org A)
    const { error: crossQuotErr } = await clientA.from('quotation_items').insert({
      quotation_id: quotAId,
      product_id: prodBId, // Cross-tenant!
      product_name: 'Product B',
      product_sku: `SKU-B-${runId}`,
      quantity: 1,
      unit_price: 200,
    });
    recordResult('T26', 'Integrity Trigger: Cross-tenant quotation item rejected by trg_check_quotation_item_org', Boolean(crossQuotErr) && crossQuotErr.message.includes('Cross-tenant violation'), `Message: ${crossQuotErr?.message}`);

    // Attempt allocating Payment A (Org A) to Invoice B (Org B)
    const { error: crossAllocErr } = await clientA.from('payment_allocations').insert({
      payment_id: payAId,
      invoice_id: invBId, // Cross-tenant!
      amount_allocated: 100,
    });
    recordResult('T27', 'Integrity Trigger: Cross-tenant payment allocation rejected by trg_check_payment_allocation_org', Boolean(crossAllocErr) && crossAllocErr.message.includes('Cross-tenant violation'), `Message: ${crossAllocErr?.message}`);

    // ------------------------------------------------------------------------
    // TEST 10: Transactional Function Integrity (confirm_sales_order)
    // ------------------------------------------------------------------------
    // Stock is currently 0. Confirmation should fail with insufficient stock.
    const { error: noStockErr } = await clientA.rpc('confirm_sales_order', { p_order_id: soAId, p_org_id: orgAId });
    recordResult('T28', 'Stock Integrity: Confirming order with 0 stock rejected', Boolean(noStockErr) && noStockErr.message.includes('Insufficient stock'), `Message: ${noStockErr?.message}`);

    // Add 100 units of initial stock via stock_movements (using valid constraint type 'GOODS_RECEIVED')
    const smId = crypto.randomUUID();
    cleanupIds.stockMovements.push(smId);
    const { error: smInsertErr } = await clientA.from('stock_movements').insert({
      id: smId,
      organization_id: orgAId,
      product_id: prodAId,
      quantity_change: 100,
      movement_type: 'GOODS_RECEIVED',
      notes: 'Initial stock for verification',
    });
    if (smInsertErr) throw new Error('Failed to insert initial stock: ' + smInsertErr.message);

    // Check available stock via RPC
    const { data: stockBefore } = await clientA.rpc('get_product_stock', { p_product_id: prodAId, p_org_id: orgAId });
    recordResult('T29', 'Stock Ledger: Initial stock accurately calculated (100 units)', stockBefore === 100, `Stock: ${stockBefore}`);

    // Confirm sales order (quantity: 10)
    const { data: confirmRes, error: confirmErr } = await clientA.rpc('confirm_sales_order', { p_order_id: soAId, p_org_id: orgAId });
    recordResult('T30', 'Transactional Order Confirmation: Order A confirmed successfully', confirmRes?.success === true && !confirmErr, `Status: ${confirmRes?.status || confirmErr?.message}`);

    // Verify stock balance deducted by 10 (now 90)
    const { data: stockAfter } = await clientA.rpc('get_product_stock', { p_product_id: prodAId, p_org_id: orgAId });
    recordResult('T31', 'Stock Ledger: Stock automatically decremented from 100 to 90', stockAfter === 90, `Stock after deduction: ${stockAfter}`);

    // Re-confirming an already confirmed order must fail
    const { error: doubleConfirmErr } = await clientA.rpc('confirm_sales_order', { p_order_id: soAId, p_org_id: orgAId });
    recordResult('T32', 'Idempotency: Re-confirming already confirmed order rejected', Boolean(doubleConfirmErr) && doubleConfirmErr.message.includes('expected DRAFT'), `Message: ${doubleConfirmErr?.message}`);

    // ------------------------------------------------------------------------
    // TEST 11: Transactional Function Integrity (record_payment_and_allocate)
    // ------------------------------------------------------------------------
    // Negative payment amount
    const { error: negPayErr } = await clientA.rpc('record_payment_and_allocate', {
      p_org_id: orgAId, p_customer_id: custAId, p_amount: -500, p_payment_method: 'CASH', p_reference_no: null,
      p_payment_date: '2026-10-27', p_notes: null, p_invoice_id: invAId, p_allocated_amount: -500
    });
    recordResult('T33', 'Financial Boundary: Negative payment amount rejected', Boolean(negPayErr) && negPayErr.message.includes('greater than zero'), `Message: ${negPayErr?.message}`);

    // Invalid payment method
    const { error: invMethodErr } = await clientA.rpc('record_payment_and_allocate', {
      p_org_id: orgAId, p_customer_id: custAId, p_amount: 100, p_payment_method: 'BITCOIN', p_reference_no: null,
      p_payment_date: '2026-10-27', p_notes: null, p_invoice_id: invAId, p_allocated_amount: 100
    });
    recordResult('T34', 'Financial Boundary: Invalid payment method rejected', Boolean(invMethodErr) && invMethodErr.message.includes('Invalid payment method'), `Message: ${invMethodErr?.message}`);

    // Overpayment beyond invoice balance (invoice total is 1000)
    const { error: overpayErr } = await clientA.rpc('record_payment_and_allocate', {
      p_org_id: orgAId, p_customer_id: custAId, p_amount: 5000, p_payment_method: 'UPI', p_reference_no: null,
      p_payment_date: '2026-10-27', p_notes: null, p_invoice_id: invAId, p_allocated_amount: 5000
    });
    recordResult('T35', 'Financial Integrity: Overpayment beyond invoice balance rejected', Boolean(overpayErr) && (overpayErr.message.includes('exceeds remaining balance') || overpayErr.message.includes('Overpayment violation')), `Message: ${overpayErr?.message}`);

    // Legitimate payment: allocate 400 INR to Invoice A
    const { data: payAllocRes, error: payAllocErr } = await clientA.rpc('record_payment_and_allocate', {
      p_org_id: orgAId, p_customer_id: custAId, p_amount: 400, p_payment_method: 'UPI', p_reference_no: 'REF-12345',
      p_payment_date: '2026-10-27', p_notes: 'Legitimate partial payment', p_invoice_id: invAId, p_allocated_amount: 400
    });
    recordResult('T36', 'Financial Allocation: Legitimate payment of 400 allocated successfully', payAllocRes?.success === true && !payAllocErr, `Payment ID: ${payAllocRes?.payment_id}`);
    if (payAllocRes?.payment_id) cleanupIds.payments.push(payAllocRes.payment_id);

    // Verify invoice total_paid updated to 400 and status changed to PARTIALLY_PAID
    const { data: invAfterPay } = await clientA.from('invoices').select('total_paid, status').eq('id', invAId).single();
    recordResult('T37', 'Invoice State Machine: Invoice updated to PARTIALLY_PAID with total_paid = 400', invAfterPay?.status === 'PARTIALLY_PAID' && Number(invAfterPay?.total_paid) === 400, `Status: ${invAfterPay?.status}, Paid: ${invAfterPay?.total_paid}`);

    // ------------------------------------------------------------------------
    // TEST 12: Trigger Direct Execution Lockdown
    // ------------------------------------------------------------------------
    const { error: trgDirectErr } = await clientA.rpc('trg_check_sales_order_item_org');
    recordResult('T38', 'Function Lockdown: Direct client execution of trigger function rejected', Boolean(trgDirectErr), `Error: ${trgDirectErr?.message}`);

  } catch (err) {
    console.error('FATAL TEST ERROR:', err);
  } finally {
    console.log('=== Beginning Surgical Cleanup of Test Records ===');
    // Safe dependency order deletion
    try {
      // 1. Audit events
      await admin.from('audit_events').delete().in('organization_id', cleanupIds.orgs);
      // 2. Stock movements
      await admin.from('stock_movements').delete().in('organization_id', cleanupIds.orgs);
      // 3. Payment allocations
      await admin.from('payment_allocations').delete().filter('payment_id', 'in', `(${cleanupIds.payments.join(',')})`);
      // 4. Payments
      await admin.from('payments').delete().in('organization_id', cleanupIds.orgs);
      // 5. Invoice items & Invoices
      await admin.from('invoice_items').delete().filter('invoice_id', 'in', `(${cleanupIds.invoices.join(',')})`);
      await admin.from('invoices').delete().in('organization_id', cleanupIds.orgs);
      // 6. Sales order items & Sales orders
      await admin.from('sales_order_items').delete().filter('sales_order_id', 'in', `(${cleanupIds.salesOrders.join(',')})`);
      await admin.from('sales_orders').delete().in('organization_id', cleanupIds.orgs);
      // 7. Quotation items & Quotations
      await admin.from('quotation_items').delete().filter('quotation_id', 'in', `(${cleanupIds.quotations.join(',')})`);
      await admin.from('quotations').delete().in('organization_id', cleanupIds.orgs);
      // 8. Core masters
      await admin.from('suppliers').delete().in('organization_id', cleanupIds.orgs);
      await admin.from('products').delete().in('organization_id', cleanupIds.orgs);
      await admin.from('customers').delete().in('organization_id', cleanupIds.orgs);
      // 9. Memberships & organizations
      await admin.from('memberships').delete().in('organization_id', cleanupIds.orgs);
      await admin.from('organizations').delete().in('id', cleanupIds.orgs);

      // 10. Auth users
      for (const uid of cleanupIds.users) {
        await admin.auth.admin.deleteUser(uid);
      }
      console.log('Surgical cleanup completed successfully.');
    } catch (cleanErr) {
      console.error('Error during cleanup:', cleanErr);
    }
  }

  // Summary
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log(`\n======================================================`);
  console.log(`VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED across ${results.length} controls`);
  console.log(`======================================================`);

  return { passed, failed, total: results.length, results };
}

main();
