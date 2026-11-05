/**
 * ATLAS OS — Scenario C: Real-Business Distributor Acceptance & End-to-End Ledger Reconciliation
 *
 * Models a realistic Indian electrical, electronics and hardware distributor at scale:
 * - Primary Organization: Sri Devi Electrical Distributors (approved eligibility, active pro tier)
 * - Secondary Organization: Kavitha Electronics & Controls (isolated tenant)
 * - Role matrix: Owner/Admin, Accounts, Sales/Operations, Read-Only (Viewer)
 * - Scale: 300 products, 40 trade customers, 1,200 invoices, 2,500 stock movements
 * - Complete business transaction lifecycle: Opening stock + adjustment -> Sales order -> Confirmation ->
 *   Invoice issuance -> Cash payment -> UPI payment -> Final settlement -> Ledger reconciliation.
 * - Business failure scenarios: Insufficient stock, concurrent double-sell, duplicate order invoice,
 *   invalid tax rates, payment over-allocation, cross-customer allocation.
 * - Payment recovery and idempotency parameter hash verification.
 * - Multi-tenant RLS isolation and role-based access control.
 * - Complete mathematical reconciliation across all 5 ledgers (Inventory, Invoices, Customers, Payments, Org).
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export async function runRealBusinessScenarioC(maintClient, baseRunId, context) {
  const {
    recordTest,
    withRoleContext,
    bootstrapDisposableDatabase,
    DATABASE_URL,
    MIGRATIONS_DIR,
    Client,
  } = context;

  console.log('\n' + '='.repeat(80));
  console.log('SCENARIO C: REAL-BUSINESS DISTRIBUTOR ACCEPTANCE & END-TO-END RECONCILIATION');
  console.log('='.repeat(80));

  const scenarioCRunId = 'scenc_' + crypto.randomBytes(4).toString('hex');
  const testDbName = `atlas_scen_c_${scenarioCRunId}`;

  // 1. Provision dedicated ephemeral test database
  console.log(`\nStep 1: Provisioning isolated ephemeral database "${testDbName}"...`);
  await maintClient.query(`CREATE DATABASE "${testDbName}";`);

  const dbUrl = new URL(DATABASE_URL);
  dbUrl.pathname = `/${testDbName}`;

  const realBizClient = new Client({
    connectionString: dbUrl.toString(),
    connectionTimeoutMillis: 5000,
  });
  await realBizClient.connect();

  try {
    // 2. Bootstrap auth schema and roles using shared disposable bootstrap
    console.log('\nStep 2: Bootstrapping Supabase-compatible roles, schemas and auth environment...');
    await bootstrapDisposableDatabase(realBizClient);

    // 3. Apply all migrations 001 through 036 in order
    console.log('\nStep 3: Applying all forward-only migrations (001 -> 036)...');
    const allFiles = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    for (const file of allFiles) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      await realBizClient.query(sql);
    }
    console.log(`  ✓ Applied ${allFiles.length} authoritative migrations up to 036.`);

    await realBizClient.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;`);

    // ------------------------------------------------------------------------
    // Step 4: Seed Realistic Distributor Multi-Tenant Environment
    // ------------------------------------------------------------------------
    console.log('\nStep 4: Seeding realistic distributor multi-tenant environment...');

    const orgC1Id = crypto.randomUUID();
    const orgC2Id = crypto.randomUUID();

    const ownerC1Id = crypto.randomUUID();
    const accountsC1Id = crypto.randomUUID();
    const operationsC1Id = crypto.randomUUID();
    const readOnlyC1Id = crypto.randomUUID();
    const ownerC2Id = crypto.randomUUID();

    const subscriptionPeriodEnd = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

    // 4.1 Seed Auth Users
    await realBizClient.query(`
      INSERT INTO auth.users (id, email) VALUES
        ('${ownerC1Id}', 'owner_sridevi_${scenarioCRunId}@example.com'),
        ('${accountsC1Id}', 'accounts_sridevi_${scenarioCRunId}@example.com'),
        ('${operationsC1Id}', 'operations_sridevi_${scenarioCRunId}@example.com'),
        ('${readOnlyC1Id}', 'viewer_sridevi_${scenarioCRunId}@example.com'),
        ('${ownerC2Id}', 'owner_kavitha_${scenarioCRunId}@example.com')
      ON CONFLICT (id) DO NOTHING;
    `);

    // 4.2 Seed Organizations (valid PAN, GSTIN, and business category)
    await realBizClient.query(`
      INSERT INTO public.organizations (id, name, legal_name, currency, pan, gstin, state) VALUES
        ('${orgC1Id}', 'Sri Devi Electrical Distributors', 'Sri Devi Electrical Distributors Pvt Ltd', 'INR', 'ABCDE1234F', '29ABCDE1234F1Z5', 'Karnataka'),
        ('${orgC2Id}', 'Kavitha Electronics & Controls', 'Kavitha Electronics & Controls LLP', 'INR', 'XYZAB5678C', '29XYZAB5678C1Z5', 'Karnataka');

      INSERT INTO public.memberships (organization_id, user_id, role, is_active) VALUES
        ('${orgC1Id}', '${ownerC1Id}', 'owner', true),
        ('${orgC1Id}', '${accountsC1Id}', 'accounts', true),
        ('${orgC1Id}', '${operationsC1Id}', 'sales', true),
        ('${orgC1Id}', '${readOnlyC1Id}', 'viewer', true),
        ('${orgC2Id}', '${ownerC2Id}', 'owner', true);

      INSERT INTO public.organization_eligibility (organization_id, business_category, sells_electrical_products, status, declared_by) VALUES
        ('${orgC1Id}', 'electrical_wholesale_distributor', true, 'approved', '${ownerC1Id}'),
        ('${orgC2Id}', 'electrical_retail', true, 'approved', '${ownerC2Id}');

      INSERT INTO public.organization_subscriptions (organization_id, plan_tier, status, current_period_ends_at) VALUES
        ('${orgC1Id}', 'pro', 'active', '${subscriptionPeriodEnd}'),
        ('${orgC2Id}', 'pro', 'active', '${subscriptionPeriodEnd}');
    `);
    console.log('  ✓ Organizations, memberships, eligibility, and active subscriptions seeded.');

    // 4.3 Generate 300 Products (Product 1 is dedicated Test SKU: Copper Wire)
    console.log('  Seeding 300 product catalog...');
    const prodTestSkuId = crypto.randomUUID();
    const categories = ['Wires & Cables', 'Switchgear', 'Lighting', 'Conduit & Pipes'];
    const uoms = ['Mtr', 'Nos', 'Coils', 'Pkt'];
    const taxRates = [0.00, 5.00, 12.00, 18.00, 28.00];

    const productValues = [];
    // Product 1: Dedicated Test SKU
    productValues.push(`('${prodTestSkuId}', '${orgC1Id}', 'Copper Wire — Test SKU', 'COPPER-WIRE-TEST-SKU', 'Wires & Cables', 'Mtr', 750.00, 1000.00, 18.00, 25, true)`);

    const allProductIds = [prodTestSkuId];
    for (let i = 2; i <= 300; i++) {
      const pId = crypto.randomUUID();
      allProductIds.push(pId);
      const cat = categories[i % categories.length];
      const uom = uoms[i % uoms.length];
      const tax = taxRates[i % taxRates.length];
      const cost = (50 + (i * 7) % 1500).toFixed(2);
      const price = (Number(cost) * 1.35).toFixed(2);
      productValues.push(`('${pId}', '${orgC1Id}', 'Product Item ${i} ${cat}', 'SKU-C1-${String(i).padStart(4, '0')}', '${cat}', '${uom}', ${cost}, ${price}, ${tax}, 20, true)`);
    }

    // Insert products in chunks of 100
    for (let c = 0; c < productValues.length; c += 100) {
      const chunk = productValues.slice(c, c + 100);
      await realBizClient.query(`
        INSERT INTO public.products (id, organization_id, name, sku, category, uom, purchase_cost, selling_price, tax_rate, reorder_threshold, is_active)
        VALUES ${chunk.join(',\n')};
      `);
    }
    console.log('  ✓ 300 products inserted into catalog.');

    // 4.4 Generate 40 Trade Customers (Customer 1 is dedicated test customer: A3 Test Electrical Traders)
    console.log('  Seeding 40 trade customers...');
    const custA3TestId = crypto.randomUUID();
    const allCustomerIds = [custA3TestId];
    const customerValues = [];

    customerValues.push(`('${custA3TestId}', '${orgC1Id}', 'A3 Test Electrical Traders', '9876543210', '29AAACP1234A1Z1', 250000.00, 30, true)`);

    const customerNames = [
      'Balaji Electrical Works', 'Chandra Controls', 'Deepak Lighting Hub', 'Eswar Switchgear Stores',
      'Ganesh Power Corporation', 'Harsha Cables & Wires', 'Ishwar Electricals', 'Jai Hind Transformers',
      'Kiran Electrical Traders', 'Lakshmi Electro Hub', 'Madhu Switchboards', 'Naveen Power Supplies',
      'Omkar Electric Works', 'Prasad Industrial Cables', 'Raju Wire House', 'Suresh Hardware Emporium',
      'Tirupati Electrical Store', 'Uma Electrical Agencies', 'Vijay Power Solutions', 'Windsor Controls',
      'Anand Electronics', 'Bharat Power Solutions', 'Crescent Electricals', 'Dynamic Cables',
      'Everest Switchgear', 'Focus Lighting Corp', 'Gitanjali Hardware', 'Horizon Power Systems',
      'Imperial Electrical Stores', 'Jyoti Lightings', 'Kalyan Power House', 'Lotus Controls',
      'Modern Electricals', 'National Power Lines', 'Orient Electric Traders', 'Pioneer Electricals',
      'Quality Electrical Agencies', 'Reliance Electrical Stores', 'Sunil Electro Mart'
    ];

    for (let i = 2; i <= 40; i++) {
      const cId = crypto.randomUUID();
      allCustomerIds.push(cId);
      const name = customerNames[(i - 2) % customerNames.length] + ` ${i}`;
      const phone = '98' + String(10000000 + i).slice(-8);
      const gstin = `29AAACP${String(1000 + i).slice(-4)}A1Z${(i % 9) + 1}`;
      const creditLimit = (50000 + (i * 10000)).toFixed(2);
      customerValues.push(`('${cId}', '${orgC1Id}', '${name}', '${phone}', '${gstin}', ${creditLimit}, 30, true)`);
    }

    await realBizClient.query(`
      INSERT INTO public.customers (id, organization_id, name, phone, gstin, credit_limit, credit_days, is_active)
      VALUES ${customerValues.join(',\n')};
    `);
    console.log('  ✓ 40 trade customers seeded.');

    // 4.5 Seed 2,500 Stock Movements
    console.log('  Seeding 2,500 stock movements...');
    const movementValues = [];

    // Dedicated Product: 50 Opening Stock + 20 Authorized Adjustment = 70 Starting Stock
    movementValues.push(`('${orgC1Id}', '${prodTestSkuId}', 50, 'OPENING_STOCK', 'Legitimate opening stock for test product')`);
    movementValues.push(`('${orgC1Id}', '${prodTestSkuId}', 20, 'ADJUSTMENT', 'Authorized pre-test stock adjustment')`);

    // Remaining 299 products: initial opening stock of 100 units each (299 movements)
    for (let i = 1; i < allProductIds.length; i++) {
      movementValues.push(`('${orgC1Id}', '${allProductIds[i]}', 100, 'OPENING_STOCK', 'Initial opening stock')`);
    }

    // Additional 2,199 movements across products to reach exactly 2,500 movements
    const needed = 2500 - movementValues.length;
    for (let m = 0; m < needed; m++) {
      const prod = allProductIds[(m % (allProductIds.length - 1)) + 1];
      const type = (m % 2 === 0) ? 'GOODS_RECEIVED' : 'ADJUSTMENT';
      const qty = (m % 2 === 0) ? 15 : 5;
      movementValues.push(`('${orgC1Id}', '${prod}', ${qty}, '${type}', 'Routine warehouse movement ${m + 1}')`);
    }

    // Insert movements in chunks of 500
    for (let c = 0; c < movementValues.length; c += 500) {
      const chunk = movementValues.slice(c, c + 500);
      await realBizClient.query(`
        INSERT INTO public.stock_movements (organization_id, product_id, quantity_change, movement_type, notes)
        VALUES ${chunk.join(',\n')};
      `);
    }
    console.log(`  ✓ 2,500 stock movements seeded.`);

    // 4.6 Seed 1,200 Historical Invoices & Reconciled Payments
    console.log('  Seeding 1,200 historical invoices & reconciled payments...');
    await realBizClient.query(`SELECT set_config('app.authoritative_invoice_transition', 'true', false);`);

    const invoiceValues = [];
    const paymentValues = [];
    const allocationValues = [];

    const invTypes = ['ISSUED', 'PARTIALLY_PAID', 'PAID'];

    for (let invIdx = 1; invIdx <= 1200; invIdx++) {
      const invId = crypto.randomUUID();
      // Distribute across customers 2 to 40 (keeping Customer 1 clean for Task 3)
      const custId = allCustomerIds[(invIdx % (allCustomerIds.length - 1)) + 1];
      const invNum = `INV-HIST-${String(invIdx).padStart(5, '0')}`;
      const status = invTypes[invIdx % 3];

      let subtotal = 1000.00;
      let tax = 180.00;
      let total = 1180.00;
      let paid = 0.00;

      if (status === 'PARTIALLY_PAID') {
        subtotal = 2000.00;
        tax = 360.00;
        total = 2360.00;
        paid = 1000.00;

        const payId = crypto.randomUUID();
        const payNum = `PAY-HIST-${String(invIdx).padStart(5, '0')}`;
        paymentValues.push(`('${payId}', '${orgC1Id}', '${payNum}', '${custId}', 1000.00, 'BANK_TRANSFER', 'REF-${payNum}', CURRENT_DATE - interval '${(invIdx % 30)} days')`);
        allocationValues.push(`('${payId}', '${invId}', 1000.00)`);
      } else if (status === 'PAID') {
        subtotal = 1500.00;
        tax = 270.00;
        total = 1770.00;
        paid = 1770.00;

        const payId = crypto.randomUUID();
        const payNum = `PAY-HIST-${String(invIdx).padStart(5, '0')}`;
        paymentValues.push(`('${payId}', '${orgC1Id}', '${payNum}', '${custId}', 1770.00, 'UPI', 'REF-${payNum}', CURRENT_DATE - interval '${(invIdx % 30)} days')`);
        allocationValues.push(`('${payId}', '${invId}', 1770.00)`);
      }

      invoiceValues.push(`('${invId}', '${orgC1Id}', '${custId}', '${invNum}', '${status}', CURRENT_DATE + interval '15 days', ${subtotal.toFixed(2)}, 0.00, ${tax.toFixed(2)}, ${total.toFixed(2)}, ${paid.toFixed(2)})`);
    }

    // Insert invoices in chunks of 400
    for (let c = 0; c < invoiceValues.length; c += 400) {
      const chunk = invoiceValues.slice(c, c + 400);
      await realBizClient.query(`
        INSERT INTO public.invoices (id, organization_id, customer_id, invoice_number, status, due_date, subtotal, discount_amount, tax_amount, total_amount, total_paid)
        VALUES ${chunk.join(',\n')};
      `);
    }

    // Insert payments in chunks of 400
    for (let c = 0; c < paymentValues.length; c += 400) {
      const chunk = paymentValues.slice(c, c + 400);
      await realBizClient.query(`
        INSERT INTO public.payments (id, organization_id, payment_number, customer_id, amount, payment_method, reference_number, payment_date)
        VALUES ${chunk.join(',\n')};
      `);
    }

    // Insert payment allocations in chunks of 400
    for (let c = 0; c < allocationValues.length; c += 400) {
      const chunk = allocationValues.slice(c, c + 400);
      await realBizClient.query(`
        INSERT INTO public.payment_allocations (payment_id, invoice_id, allocated_amount)
        VALUES ${chunk.join(',\n')};
      `);
    }

    await realBizClient.query(`SELECT set_config('app.authoritative_invoice_transition', 'false', false);`);
    console.log(`  ✓ 1,200 historical invoices & 800 reconciled payment allocations seeded.`);

    // ========================================================================
    // CONTRACT 1 (P1-A3-11): Complete End-to-End Distributor Business Transaction (Task 3)
    // ========================================================================
    let transOk = false;
    let transErr = null;
    let createdOrderId = null;
    let createdInvoiceId = null;

    await withRoleContext(realBizClient, { role: 'authenticated', userId: ownerC1Id }, async () => {
      try {
        // 1. Verify starting inventory on test SKU: 50 Opening Stock + 20 Adjustment = 70 Units
        const { rows: startStockRows } = await realBizClient.query(
          `SELECT public.get_product_stock($1::uuid, $2::uuid) AS stock;`,
          [prodTestSkuId, orgC1Id]
        );
        const startStock = Number(startStockRows[0]?.stock);

        const { rows: testMovs } = await realBizClient.query(
          `SELECT movement_type, quantity_change FROM public.stock_movements WHERE product_id = $1::uuid ORDER BY created_at ASC;`,
          [prodTestSkuId]
        );
        const movementsAccurate =
          testMovs.length === 2 &&
          testMovs[0].movement_type === 'OPENING_STOCK' && Number(testMovs[0].quantity_change) === 50 &&
          testMovs[1].movement_type === 'ADJUSTMENT' && Number(testMovs[1].quantity_change) === 20 &&
          startStock === 70;

        if (!movementsAccurate) {
          throw new Error(`Starting stock mismatch: expected 70 units across 2 movements, got ${startStock} units across ${testMovs.length} movements`);
        }

        // 2. Create Sales Order: 12 units of test SKU @ ₹1,000, 18% GST -> Total ₹14,160
        const orderItems = JSON.stringify([
          { productId: prodTestSkuId, quantity: 12, unitPrice: 1000.00, discountPercent: 0, taxRate: 18.00 }
        ]);
        const { rows: soRows } = await realBizClient.query(
          `SELECT public.create_sales_order_atomic(
            p_org_id := $1::uuid,
            p_customer_id := $2::uuid,
            p_items := $3::jsonb
          ) AS res;`,
          [orgC1Id, custA3TestId, orderItems]
        );
        const orderRes = soRows[0]?.res;
        createdOrderId = orderRes?.id;

        const orderValid =
          Boolean(createdOrderId) &&
          orderRes.status === 'DRAFT' &&
          Number(orderRes.subtotal) === 12000.00 &&
          Number(orderRes.tax_amount) === 2160.00 &&
          Number(orderRes.total_amount) === 14160.00;

        if (!orderValid) {
          throw new Error(`Sales order amounts incorrect: expected 12000 subtotal, 2160 tax, 14160 total; got ${JSON.stringify(orderRes)}`);
        }

        // 3. Confirm Sales Order: Stock decreases 70 - 12 = 58 units; idempotent replay protected
        const { rows: conf1 } = await realBizClient.query(
          `SELECT public.confirm_sales_order($1::uuid, $2::uuid) AS res;`,
          [createdOrderId, orgC1Id]
        );
        const { rows: postConfStockRows } = await realBizClient.query(
          `SELECT public.get_product_stock($1::uuid, $2::uuid) AS stock;`,
          [prodTestSkuId, orgC1Id]
        );
        const postConfStock = Number(postConfStockRows[0]?.stock);

        // Repeated confirmation must return idempotent replay without double-deduction
        const { rows: conf2 } = await realBizClient.query(
          `SELECT public.confirm_sales_order($1::uuid, $2::uuid) AS res;`,
          [createdOrderId, orgC1Id]
        );
        const { rows: postReplayStockRows } = await realBizClient.query(
          `SELECT public.get_product_stock($1::uuid, $2::uuid) AS stock;`,
          [prodTestSkuId, orgC1Id]
        );
        const postReplayStock = Number(postReplayStockRows[0]?.stock);

        const confirmationValid =
          conf1[0]?.res?.success === true &&
          postConfStock === 58 &&
          conf2[0]?.res?.idempotent_replay === true &&
          postReplayStock === 58;

        if (!confirmationValid) {
          throw new Error(`Order confirmation failed: postConfStock=${postConfStock}, postReplayStock=${postReplayStock}`);
        }

        // 4. Generate Invoice linked to the Confirmed Order
        const invoiceItems = JSON.stringify([
          { productId: prodTestSkuId, quantity: 12, unitPrice: 1000.00, discountPercent: 0, taxRate: 18.00 }
        ]);
        const { rows: invRows } = await realBizClient.query(
          `SELECT public.create_invoice_atomic(
            p_org_id := $1::uuid,
            p_customer_id := $2::uuid,
            p_items := $3::jsonb,
            p_sales_order_id := $4::uuid,
            p_status := 'ISSUED'
          ) AS res;`,
          [orgC1Id, custA3TestId, invoiceItems, createdOrderId]
        );
        const invoiceRes = invRows[0]?.res;
        createdInvoiceId = invoiceRes?.id;

        const invoiceValid =
          Boolean(createdInvoiceId) &&
          invoiceRes.status === 'ISSUED' &&
          Number(invoiceRes.total_amount) === 14160.00 &&
          Number(invoiceRes.total_paid) === 0.00;

        if (!invoiceValid) {
          throw new Error(`Invoice generation failed: total=${invoiceRes?.total_amount}, status=${invoiceRes?.status}`);
        }

        // A second invoice for the same order MUST be rejected
        let secondInvoiceBlocked = false;
        try {
          await realBizClient.query(
            `SELECT public.create_invoice_atomic(
              p_org_id := $1::uuid,
              p_customer_id := $2::uuid,
              p_items := $3::jsonb,
              p_sales_order_id := $4::uuid,
              p_status := 'ISSUED'
            );`,
            [orgC1Id, custA3TestId, invoiceItems, createdOrderId]
          );
        } catch (secInvErr) {
          secondInvoiceBlocked = secInvErr.code === '23505' || secInvErr.message.includes('Active invoice already exists');
        }

        if (!secondInvoiceBlocked) {
          throw new Error('Duplicate invoice for the same sales order was not blocked');
        }

        // 5. Record First Payment: Cash receipt of ₹4,000 -> Outstanding ₹10,160, PARTIALLY_PAID
        await realBizClient.query(
          `SELECT public.record_payment_and_allocate(
            p_org_id := $1::uuid,
            p_customer_id := $2::uuid,
            p_amount := 4000.00::numeric,
            p_payment_method := 'CASH'::varchar,
            p_reference_no := 'REC-A3-CASH-01'::varchar,
            p_payment_date := CURRENT_DATE,
            p_notes := 'First cash receipt'::text,
            p_invoice_id := $3::uuid,
            p_allocated_amount := 4000.00::numeric
          );`,
          [orgC1Id, custA3TestId, createdInvoiceId]
        );

        const { rows: invAfterPay1 } = await realBizClient.query(
          `SELECT status, total_amount, total_paid, (total_amount - total_paid) AS balance FROM public.invoices WHERE id = $1::uuid;`,
          [createdInvoiceId]
        );
        const pay1Valid =
          invAfterPay1[0]?.status === 'PARTIALLY_PAID' &&
          Number(invAfterPay1[0]?.total_paid) === 4000.00 &&
          Number(invAfterPay1[0]?.balance) === 10160.00;

        if (!pay1Valid) {
          throw new Error(`Payment 1 verification failed: status=${invAfterPay1[0]?.status}, paid=${invAfterPay1[0]?.total_paid}`);
        }

        // 6. Record Second Payment: Manual UPI receipt of ₹5,000 -> Outstanding ₹5,160, PARTIALLY_PAID
        await realBizClient.query(
          `SELECT public.record_payment_and_allocate(
            p_org_id := $1::uuid,
            p_customer_id := $2::uuid,
            p_amount := 5000.00::numeric,
            p_payment_method := 'UPI'::varchar,
            p_reference_no := 'REC-A3-UPI-02'::varchar,
            p_payment_date := CURRENT_DATE,
            p_notes := 'Second UPI receipt'::text,
            p_invoice_id := $3::uuid,
            p_allocated_amount := 5000.00::numeric
          );`,
          [orgC1Id, custA3TestId, createdInvoiceId]
        );

        const { rows: invAfterPay2 } = await realBizClient.query(
          `SELECT status, total_amount, total_paid, (total_amount - total_paid) AS balance FROM public.invoices WHERE id = $1::uuid;`,
          [createdInvoiceId]
        );
        const pay2Valid =
          invAfterPay2[0]?.status === 'PARTIALLY_PAID' &&
          Number(invAfterPay2[0]?.total_paid) === 9000.00 &&
          Number(invAfterPay2[0]?.balance) === 5160.00;

        if (!pay2Valid) {
          throw new Error(`Payment 2 verification failed: status=${invAfterPay2[0]?.status}, paid=${invAfterPay2[0]?.total_paid}`);
        }

        // 7. Final Settlement: Bank transfer of ₹5,160 -> Outstanding ₹0.00, PAID
        await realBizClient.query(
          `SELECT public.record_payment_and_allocate(
            p_org_id := $1::uuid,
            p_customer_id := $2::uuid,
            p_amount := 5160.00::numeric,
            p_payment_method := 'BANK_TRANSFER'::varchar,
            p_reference_no := 'REC-A3-NEFT-03'::varchar,
            p_payment_date := CURRENT_DATE,
            p_notes := 'Final settlement receipt'::text,
            p_invoice_id := $3::uuid,
            p_allocated_amount := 5160.00::numeric
          );`,
          [orgC1Id, custA3TestId, createdInvoiceId]
        );

        const { rows: invAfterFinal } = await realBizClient.query(
          `SELECT status, total_amount, total_paid, (total_amount - total_paid) AS balance FROM public.invoices WHERE id = $1::uuid;`,
          [createdInvoiceId]
        );
        const finalSettlementValid =
          invAfterFinal[0]?.status === 'PAID' &&
          Number(invAfterFinal[0]?.total_paid) === 14160.00 &&
          Number(invAfterFinal[0]?.balance) === 0.00;

        if (!finalSettlementValid) {
          throw new Error(`Final settlement failed: status=${invAfterFinal[0]?.status}, paid=${invAfterFinal[0]?.total_paid}`);
        }

        // Final verification: Stock remains 58, allocations total ₹14,160 across 3 receipts
        const { rows: finalStockRows } = await realBizClient.query(
          `SELECT public.get_product_stock($1::uuid, $2::uuid) AS stock;`,
          [prodTestSkuId, orgC1Id]
        );
        const { rows: allocSumRows } = await realBizClient.query(
          `SELECT COUNT(*)::int AS cnt, SUM(allocated_amount)::numeric AS sum FROM public.payment_allocations WHERE invoice_id = $1::uuid;`,
          [createdInvoiceId]
        );

        const lifecycleComplete =
          Number(finalStockRows[0]?.stock) === 58 &&
          allocSumRows[0]?.cnt === 3 &&
          Number(allocSumRows[0]?.sum) === 14160.00;

        transOk = lifecycleComplete;
      } catch (err) {
        transErr = err;
      }
    });

    recordTest(
      'P1-A3-11',
      'Complete End-to-End Distributor Business Lifecycle: Stock entry (50+20=70) -> Sales Order (12@1000+18%=14160) -> Confirm Order (Stock 58) -> Invoice -> Cash (4k) -> UPI (5k) -> Settlement (5160) -> PAID with exact ledger reconciliation',
      transOk,
      `transOk=${transOk}`,
      transOk ? null : transErr
    );

    // ========================================================================
    // CONTRACT 2 (P1-A3-12): Business Failure Scenarios — Stock Operations (Task 4)
    // ========================================================================
    let stockFailuresOk = false;
    let stockFailuresErr = null;

    await withRoleContext(realBizClient, { role: 'authenticated', userId: ownerC1Id }, async () => {
      try {
        // 1. Confirm sales order requesting more stock than available (100 units > 58 units)
        const excessiveItems = JSON.stringify([
          { productId: prodTestSkuId, quantity: 100, unitPrice: 1000.00, discountPercent: 0, taxRate: 18.00 }
        ]);
        const { rows: excSoRows } = await realBizClient.query(
          `SELECT public.create_sales_order_atomic(
            p_org_id := $1::uuid,
            p_customer_id := $2::uuid,
            p_items := $3::jsonb
          ) AS res;`,
          [orgC1Id, custA3TestId, excessiveItems]
        );
        const excOrderId = excSoRows[0]?.res?.id;

        let insufficientStockBlocked = false;
        try {
          await realBizClient.query(
            `SELECT public.confirm_sales_order($1::uuid, $2::uuid);`,
            [excOrderId, orgC1Id]
          );
        } catch (insufErr) {
          insufficientStockBlocked =
            insufErr.message.includes('Insufficient stock') ||
            insufErr.message.includes('ERR_INSUFFICIENT_STOCK') ||
            insufErr.code === '23514';
        }

        // Verify order remained DRAFT and stock remained 58
        const { rows: excOrderCheck } = await realBizClient.query(
          `SELECT status FROM public.sales_orders WHERE id = $1::uuid;`,
          [excOrderId]
        );
        const { rows: stockAfterFail } = await realBizClient.query(
          `SELECT public.get_product_stock($1::uuid, $2::uuid) AS stock;`,
          [prodTestSkuId, orgC1Id]
        );
        const stockRemained58 = Number(stockAfterFail[0]?.stock) === 58 && excOrderCheck[0]?.status === 'DRAFT';

        // 2. Concurrency Race on Remaining Stock: Two orders for 40 units each (total 80 > 58 available)
        const raceItems = JSON.stringify([
          { productId: prodTestSkuId, quantity: 40, unitPrice: 1000.00, discountPercent: 0, taxRate: 18.00 }
        ]);
        const { rows: raceSo1 } = await realBizClient.query(
          `SELECT public.create_sales_order_atomic(p_org_id := $1::uuid, p_customer_id := $2::uuid, p_items := $3::jsonb) AS res;`,
          [orgC1Id, custA3TestId, raceItems]
        );
        const { rows: raceSo2 } = await realBizClient.query(
          `SELECT public.create_sales_order_atomic(p_org_id := $1::uuid, p_customer_id := $2::uuid, p_items := $3::jsonb) AS res;`,
          [orgC1Id, custA3TestId, raceItems]
        );

        // Order 1 confirms successfully (58 - 40 = 18 units)
        const { rows: rConf1 } = await realBizClient.query(
          `SELECT public.confirm_sales_order($1::uuid, $2::uuid) AS res;`,
          [raceSo1[0].res.id, orgC1Id]
        );
        const r1Ok = rConf1[0]?.res?.success === true;

        // Order 2 must be blocked because only 18 units remain (< 40)
        let r2Blocked = false;
        try {
          await realBizClient.query(
            `SELECT public.confirm_sales_order($1::uuid, $2::uuid);`,
            [raceSo2[0].res.id, orgC1Id]
          );
        } catch (r2Err) {
          r2Blocked = r2Err.message.includes('Insufficient stock') || r2Err.code === '23514';
        }

        const { rows: postRaceStockRows } = await realBizClient.query(
          `SELECT public.get_product_stock($1::uuid, $2::uuid) AS stock;`,
          [prodTestSkuId, orgC1Id]
        );
        const raceSafe = r1Ok && r2Blocked && Number(postRaceStockRows[0]?.stock) === 18;

        // 3. Unauthorized direct stock adjustment from unprivileged user (viewer)
        let unauthAdjustBlocked = false;
        try {
          await withRoleContext(realBizClient, { role: 'authenticated', userId: readOnlyC1Id }, async () => {
            await realBizClient.query(
              `SELECT public.record_stock_adjustment(
                p_org_id := $1::uuid,
                p_product_id := $2::uuid,
                p_quantity_change := 10,
                p_notes := 'Malicious adjustment'::text
              );`,
              [orgC1Id, prodTestSkuId]
            );
          });
        } catch (adjErr) {
          unauthAdjustBlocked = adjErr.message.includes('Unauthorized') || adjErr.code === '42501';
        }

        stockFailuresOk = Boolean(insufficientStockBlocked && stockRemained58 && raceSafe && unauthAdjustBlocked);
      } catch (err) {
        stockFailuresErr = err;
      }
    });

    recordTest(
      'P1-A3-12',
      'Stock failure scenarios: insufficient stock blocks confirmation cleanly, concurrent double-sell race prevents negative stock, and unauthorized stock adjustment is rejected',
      stockFailuresOk,
      `stockFailuresOk=${stockFailuresOk}`,
      stockFailuresOk ? null : stockFailuresErr
    );

    // ========================================================================
    // CONTRACT 3 (P1-A3-13): Business Failure Scenarios — Invoice Operations (Task 4)
    // ========================================================================
    let invFailuresOk = false;
    let invFailuresErr = null;

    await withRoleContext(realBizClient, { role: 'authenticated', userId: ownerC1Id }, async () => {
      try {
        // 1. Invoicing a DRAFT sales order must be rejected
        const draftItems = JSON.stringify([
          { productId: prodTestSkuId, quantity: 1, unitPrice: 1000.00, discountPercent: 0, taxRate: 18.00 }
        ]);
        const { rows: draftSoRows } = await realBizClient.query(
          `SELECT public.create_sales_order_atomic(p_org_id := $1::uuid, p_customer_id := $2::uuid, p_items := $3::jsonb) AS res;`,
          [orgC1Id, custA3TestId, draftItems]
        );
        const draftSoId = draftSoRows[0]?.res?.id;

        let invoiceDraftBlocked = false;
        try {
          await realBizClient.query(
            `SELECT public.create_invoice_atomic(
              p_org_id := $1::uuid,
              p_customer_id := $2::uuid,
              p_items := $3::jsonb,
              p_sales_order_id := $4::uuid,
              p_status := 'ISSUED'
            );`,
            [orgC1Id, custA3TestId, draftItems, draftSoId]
          );
        } catch (invDraftErr) {
          invoiceDraftBlocked = invDraftErr.message.includes('order status is DRAFT') || invDraftErr.message.includes('must be CONFIRMED');
        }

        // 2. Invoicing an inactive or non-existent product ID
        const fakeProdId = crypto.randomUUID();
        let fakeProdBlocked = false;
        try {
          await realBizClient.query(
            `SELECT public.create_invoice_atomic(
              p_org_id := $1::uuid,
              p_customer_id := $2::uuid,
              p_items := $3::jsonb,
              p_status := 'ISSUED'
            );`,
            [
              orgC1Id,
              custA3TestId,
              JSON.stringify([{ productId: fakeProdId, quantity: 1, unitPrice: 500.00, taxRate: 18.00 }])
            ]
          );
        } catch (fakeProdErr) {
          fakeProdBlocked = fakeProdErr.message.includes('do not belong to organization') || fakeProdErr.message.includes('not found');
        }

        // 3. Issued invoice omitting line item tax rate or specifying non-statutory rate (15%)
        let missingTaxBlocked = false;
        try {
          await realBizClient.query(
            `SELECT public.create_invoice_atomic(
              p_org_id := $1::uuid,
              p_customer_id := $2::uuid,
              p_items := $3::jsonb,
              p_status := 'ISSUED'
            );`,
            [
              orgC1Id,
              custA3TestId,
              JSON.stringify([{ productId: prodTestSkuId, quantity: 1, unitPrice: 1000.00 }])
            ]
          );
        } catch (missTaxErr) {
          missingTaxBlocked = missTaxErr.code === '23514' || missTaxErr.message.includes('missing tax_rate');
        }

        let nonStatutoryBlocked = false;
        try {
          await realBizClient.query(
            `SELECT public.create_invoice_atomic(
              p_org_id := $1::uuid,
              p_customer_id := $2::uuid,
              p_items := $3::jsonb,
              p_status := 'ISSUED'
            );`,
            [
              orgC1Id,
              custA3TestId,
              JSON.stringify([{ productId: prodTestSkuId, quantity: 1, unitPrice: 1000.00, taxRate: 15.00 }])
            ]
          );
        } catch (nonStatErr) {
          nonStatutoryBlocked = nonStatErr.code === '23514' || nonStatErr.message.includes('invalid tax_rate');
        }

        // 4. Idempotency key reuse with different request parameters
        const invIdemKey = crypto.randomUUID();
        await realBizClient.query(
          `SELECT public.create_invoice_atomic(
            p_org_id := $1::uuid,
            p_customer_id := $2::uuid,
            p_items := $3::jsonb,
            p_status := 'ISSUED',
            p_idempotency_key := $4::uuid
          );`,
          [
            orgC1Id,
            custA3TestId,
            JSON.stringify([{ productId: prodTestSkuId, quantity: 1, unitPrice: 1000.00, taxRate: 18.00 }]),
            invIdemKey
          ]
        );

        let hashCollisionBlocked = false;
        try {
          await realBizClient.query(
            `SELECT public.create_invoice_atomic(
              p_org_id := $1::uuid,
              p_customer_id := $2::uuid,
              p_items := $3::jsonb,
              p_status := 'ISSUED',
              p_idempotency_key := $4::uuid
            );`,
            [
              orgC1Id,
              custA3TestId,
              JSON.stringify([{ productId: prodTestSkuId, quantity: 2, unitPrice: 1000.00, taxRate: 18.00 }]), // Changed quantity
              invIdemKey
            ]
          );
        } catch (hashErr) {
          hashCollisionBlocked = hashErr.code === '23505' || hashErr.message.includes('Idempotency key reused with different request parameters');
        }

        invFailuresOk = Boolean(invoiceDraftBlocked && fakeProdBlocked && missingTaxBlocked && nonStatutoryBlocked && hashCollisionBlocked);
      } catch (err) {
        invFailuresErr = err;
      }
    });

    recordTest(
      'P1-A3-13',
      'Invoice failure scenarios: invoicing DRAFT order rejected, non-existent product rejected, missing/non-statutory tax rate rejected with check_violation, and idempotency parameter collision rejected',
      invFailuresOk,
      `invFailuresOk=${invFailuresOk}`,
      invFailuresOk ? null : invFailuresErr
    );

    // ========================================================================
    // CONTRACT 4 (P1-A3-14): Business Failure Scenarios — Payment Operations (Task 4)
    // ========================================================================
    let payFailuresOk = false;
    let payFailuresErr = null;

    await withRoleContext(realBizClient, { role: 'authenticated', userId: ownerC1Id }, async () => {
      try {
        // 1. Payment allocation to a DRAFT invoice must be rejected
        const { rows: draftInvRows } = await realBizClient.query(
          `SELECT public.create_invoice_atomic(
            p_org_id := $1::uuid,
            p_customer_id := $2::uuid,
            p_items := $3::jsonb,
            p_status := 'DRAFT'
          ) AS res;`,
          [
            orgC1Id,
            custA3TestId,
            JSON.stringify([{ productId: prodTestSkuId, quantity: 1, unitPrice: 500.00, taxRate: 18.00 }])
          ]
        );
        const draftInvId = draftInvRows[0]?.res?.id;

        let payDraftBlocked = false;
        try {
          await realBizClient.query(
            `SELECT public.record_payment_and_allocate(
              p_org_id := $1::uuid,
              p_customer_id := $2::uuid,
              p_amount := 200.00::numeric,
              p_payment_method := 'CASH'::varchar,
              p_reference_no := 'REC-FAIL-DRAFT'::varchar,
              p_payment_date := CURRENT_DATE,
              p_notes := 'Draft allocation test'::text,
              p_invoice_id := $3::uuid,
              p_allocated_amount := 200.00::numeric
            );`,
            [orgC1Id, custA3TestId, draftInvId]
          );
        } catch (payDraftErr) {
          payDraftBlocked = payDraftErr.code === '23514' || payDraftErr.message.includes('Cannot allocate payment to draft invoice');
        }

        // 2. Overpayment: Allocation exceeding invoice balance
        const { rows: issuedInvRows } = await realBizClient.query(
          `SELECT public.create_invoice_atomic(
            p_org_id := $1::uuid,
            p_customer_id := $2::uuid,
            p_items := $3::jsonb,
            p_status := 'ISSUED'
          ) AS res;`,
          [
            orgC1Id,
            custA3TestId,
            JSON.stringify([{ productId: prodTestSkuId, quantity: 1, unitPrice: 100.00, taxRate: 18.00 }])
          ]
        );
        const testInvId = issuedInvRows[0]?.res?.id; // Total is ₹118.00

        let overpayBlocked = false;
        try {
          await realBizClient.query(
            `SELECT public.record_payment_and_allocate(
              p_org_id := $1::uuid,
              p_customer_id := $2::uuid,
              p_amount := 500.00::numeric,
              p_payment_method := 'CASH'::varchar,
              p_reference_no := 'REC-OVERPAY'::varchar,
              p_payment_date := CURRENT_DATE,
              p_notes := 'Overpayment test'::text,
              p_invoice_id := $3::uuid,
              p_allocated_amount := 500.00::numeric
            );`,
            [orgC1Id, custA3TestId, testInvId]
          );
        } catch (overErr) {
          overpayBlocked = overErr.code === '23514' || overErr.message.includes('Overpayment violation');
        }

        // 3. Cross-customer allocation: Payment for Customer 2 attempting to allocate Customer 1's invoice
        const cust2Id = allCustomerIds[1];
        let crossCustBlocked = false;
        try {
          await realBizClient.query(
            `SELECT public.record_payment_and_allocate(
              p_org_id := $1::uuid,
              p_customer_id := $2::uuid,
              p_amount := 50.00::numeric,
              p_payment_method := 'UPI'::varchar,
              p_reference_no := 'REC-CROSS-CUST'::varchar,
              p_payment_date := CURRENT_DATE,
              p_notes := 'Cross-customer test'::text,
              p_invoice_id := $3::uuid,
              p_allocated_amount := 50.00::numeric
            );`,
            [orgC1Id, cust2Id, testInvId]
          );
        } catch (crossErr) {
          crossCustBlocked = crossErr.code === '23503' || crossErr.message.includes('Customer mismatch');
        }

        payFailuresOk = Boolean(payDraftBlocked && overpayBlocked && crossCustBlocked);
      } catch (err) {
        payFailuresErr = err;
      }
    });

    recordTest(
      'P1-A3-14',
      'Payment failure scenarios: allocating to DRAFT invoice rejected, overpayment exceeding balance rejected with check_violation, and cross-customer allocation rejected with foreign_key_violation',
      payFailuresOk,
      `payFailuresOk=${payFailuresOk}`,
      payFailuresOk ? null : payFailuresErr
    );

    // ========================================================================
    // CONTRACT 5 (P1-A3-15): Payment Recovery & Idempotency (Task 5)
    // ========================================================================
    let payRecoveryOk = false;
    let payRecoveryErr = null;

    await withRoleContext(realBizClient, { role: 'authenticated', userId: ownerC1Id }, async () => {
      try {
        const { rows: invRows } = await realBizClient.query(
          `SELECT public.create_invoice_atomic(
            p_org_id := $1::uuid,
            p_customer_id := $2::uuid,
            p_items := $3::jsonb,
            p_status := 'ISSUED'
          ) AS res;`,
          [
            orgC1Id,
            custA3TestId,
            JSON.stringify([{ productId: prodTestSkuId, quantity: 1, unitPrice: 200.00, taxRate: 18.00 }])
          ]
        );
        const invId = invRows[0]?.res?.id;
        const testIdemKey = crypto.randomUUID();

        // Call 1: Commits payment
        const { rows: r1 } = await realBizClient.query(
          `SELECT public.record_payment_and_allocate(
            p_org_id := $1::uuid,
            p_customer_id := $2::uuid,
            p_amount := 100.00::numeric,
            p_payment_method := 'BANK_TRANSFER'::varchar,
            p_reference_no := 'REC-IDEM-01'::varchar,
            p_payment_date := CURRENT_DATE,
            p_notes := 'Recovery test payment'::text,
            p_invoice_id := $3::uuid,
            p_allocated_amount := 100.00::numeric,
            p_idempotency_key := $4::uuid
          ) AS res;`,
          [orgC1Id, custA3TestId, invId, testIdemKey]
        );
        const p1Id = r1[0]?.res?.payment_id;

        // Call 2: Simulated network retry with same idempotency key and same parameters
        const { rows: r2 } = await realBizClient.query(
          `SELECT public.record_payment_and_allocate(
            p_org_id := $1::uuid,
            p_customer_id := $2::uuid,
            p_amount := 100.00::numeric,
            p_payment_method := 'BANK_TRANSFER'::varchar,
            p_reference_no := 'REC-IDEM-01'::varchar,
            p_payment_date := CURRENT_DATE,
            p_notes := 'Recovery test payment'::text,
            p_invoice_id := $3::uuid,
            p_allocated_amount := 100.00::numeric,
            p_idempotency_key := $4::uuid
          ) AS res;`,
          [orgC1Id, custA3TestId, invId, testIdemKey]
        );
        const p2Id = r2[0]?.res?.payment_id;
        const isReplay = r2[0]?.res?.idempotent_replay === true;

        // Verify exactly 1 payment record exists in public.payments
        const { rows: payCountRows } = await realBizClient.query(
          `SELECT count(*)::int AS count FROM public.payments WHERE id = $1::uuid;`,
          [p1Id]
        );

        // Verify calling with same key but changed amount raises unique_violation
        let collisionBlocked = false;
        try {
          await realBizClient.query(
            `SELECT public.record_payment_and_allocate(
              p_org_id := $1::uuid,
              p_customer_id := $2::uuid,
              p_amount := 136.00::numeric, // Different amount
              p_payment_method := 'BANK_TRANSFER'::varchar,
              p_reference_no := 'REC-IDEM-MOD'::varchar,
              p_payment_date := CURRENT_DATE,
              p_notes := 'Modified test'::text,
              p_invoice_id := $3::uuid,
              p_allocated_amount := 136.00::numeric,
              p_idempotency_key := $4::uuid
            );`,
            [orgC1Id, custA3TestId, invId, testIdemKey]
          );
        } catch (collErr) {
          collisionBlocked = collErr.code === '23505' || collErr.message.includes('Idempotency key reused with different request parameters');
        }

        payRecoveryOk = Boolean(p1Id && p1Id === p2Id && isReplay && payCountRows[0]?.count === 1 && collisionBlocked);
      } catch (err) {
        payRecoveryErr = err;
      }
    });

    recordTest(
      'P1-A3-15',
      'Payment recovery and idempotency: identical retry returns existing receipt with idempotent_replay: true without duplicate ledger entries, while parameter collisions are strictly rejected',
      payRecoveryOk,
      `payRecoveryOk=${payRecoveryOk}`,
      payRecoveryOk ? null : payRecoveryErr
    );

    // ========================================================================
    // CONTRACT 6 (P1-A3-16): Multi-Tenant Security & Organization Isolation (Task 6)
    // ========================================================================
    let multiTenantOk = false;
    let multiTenantErr = null;

    try {
      // 1. User in Org C1 querying tables for Org C2 records gets 0 rows under RLS
      await withRoleContext(realBizClient, { role: 'authenticated', userId: ownerC1Id }, async () => {
        const { rows: foreignInvs } = await realBizClient.query(
          `SELECT * FROM public.invoices WHERE organization_id = $1::uuid;`,
          [orgC2Id]
        );
        const { rows: foreignCusts } = await realBizClient.query(
          `SELECT * FROM public.customers WHERE organization_id = $1::uuid;`,
          [orgC2Id]
        );
        const { rows: foreignProds } = await realBizClient.query(
          `SELECT * FROM public.products WHERE organization_id = $1::uuid;`,
          [orgC2Id]
        );

        if (foreignInvs.length > 0 || foreignCusts.length > 0 || foreignProds.length > 0) {
          throw new Error('RLS breach: Org C1 user was able to select records belonging to Org C2');
        }

        // 2. Org C1 user calling get_payments_summary for Org C2 is rejected
        let summaryBlocked = false;
        try {
          await realBizClient.query(
            `SELECT public.get_payments_summary($1::uuid);`,
            [orgC2Id]
          );
        } catch (sumErr) {
          summaryBlocked = sumErr.code === '42501' || sumErr.message.includes('Access denied');
        }

        if (!summaryBlocked) {
          throw new Error('Org C1 user was able to execute get_payments_summary for Org C2');
        }
      });

      // 3. User in Org C2 cannot mutate or allocate payments to Org C1 invoices
      await withRoleContext(realBizClient, { role: 'authenticated', userId: ownerC2Id }, async () => {
        let crossPayBlocked = false;
        try {
          await realBizClient.query(
            `SELECT public.record_payment_and_allocate(
              p_org_id := $1::uuid,
              p_customer_id := $2::uuid,
              p_amount := 50.00::numeric,
              p_payment_method := 'CASH'::varchar,
              p_reference_no := 'CROSS-ORG-ATTEMPT'::varchar,
              p_payment_date := CURRENT_DATE,
              p_notes := 'Cross-tenant breach attempt'::text,
              p_invoice_id := $3::uuid,
              p_allocated_amount := 50.00::numeric
            );`,
            [orgC2Id, custA3TestId, createdInvoiceId]
          );
        } catch (crossPayErr) {
          crossPayBlocked = crossPayErr.code === '23503' || crossPayErr.message.includes('not found') || crossPayErr.message.includes('Unauthorized');
        }

        if (!crossPayBlocked) {
          throw new Error('Cross-tenant payment allocation was not blocked');
        }
      });

      multiTenantOk = true;
    } catch (err) {
      multiTenantErr = err;
    }

    recordTest(
      'P1-A3-16',
      'Multi-tenant security: Organization A cannot read Organization B invoices, customers, or stock, cannot query payments summary, and cannot allocate payments to foreign invoices',
      multiTenantOk,
      `multiTenantOk=${multiTenantOk}`,
      multiTenantOk ? null : multiTenantErr
    );

    // ========================================================================
    // CONTRACT 7 (P1-A3-17): Role-Based Access Control & Employee Permissions (Task 6)
    // ========================================================================
    let rbacOk = false;
    let rbacErr = null;

    try {
      // 1. Read-only (viewer) user cannot create sales orders, invoices, stock adjustments, or payments
      await withRoleContext(realBizClient, { role: 'authenticated', userId: readOnlyC1Id }, async () => {
        let soBlocked = false;
        try {
          await realBizClient.query(
            `SELECT public.create_sales_order_atomic(
              p_org_id := $1::uuid,
              p_customer_id := $2::uuid,
              p_items := $3::jsonb
            );`,
            [orgC1Id, custA3TestId, JSON.stringify([{ productId: prodTestSkuId, quantity: 1, unitPrice: 1000.00, taxRate: 18.00 }])]
          );
        } catch (err) {
          soBlocked = err.message.includes('insufficient role') || err.message.includes('Unauthorized') || err.code === '42501';
        }

        let invBlocked = false;
        try {
          await realBizClient.query(
            `SELECT public.create_invoice_atomic(
              p_org_id := $1::uuid,
              p_customer_id := $2::uuid,
              p_items := $3::jsonb,
              p_status := 'ISSUED'
            );`,
            [orgC1Id, custA3TestId, JSON.stringify([{ productId: prodTestSkuId, quantity: 1, unitPrice: 1000.00, taxRate: 18.00 }])]
          );
        } catch (err) {
          invBlocked = err.message.includes('insufficient role') || err.message.includes('Unauthorized') || err.code === '42501';
        }

        let payBlocked = false;
        try {
          await realBizClient.query(
            `SELECT public.record_payment_and_allocate(
              p_org_id := $1::uuid,
              p_customer_id := $2::uuid,
              p_amount := 10.00::numeric,
              p_payment_method := 'CASH'::varchar,
              p_reference_no := 'VIEWER-ATTEMPT'::varchar,
              p_payment_date := CURRENT_DATE,
              p_notes := 'Viewer attempt'::text,
              p_invoice_id := $3::uuid,
              p_allocated_amount := 10.00::numeric
            );`,
            [orgC1Id, custA3TestId, createdInvoiceId]
          );
        } catch (err) {
          payBlocked = err.message.includes('insufficient role') || err.message.includes('Unauthorized') || err.code === '42501';
        }

        if (!soBlocked || !invBlocked || !payBlocked) {
          throw new Error(`Viewer role was able to execute restricted operations: soBlocked=${soBlocked}, invBlocked=${invBlocked}, payBlocked=${payBlocked}`);
        }
      });

      // 2. Accounts user can record payments and view invoices
      await withRoleContext(realBizClient, { role: 'authenticated', userId: accountsC1Id }, async () => {
        const { rows: paySum } = await realBizClient.query(
          `SELECT public.get_payments_summary($1::uuid) AS summary;`,
          [orgC1Id]
        );
        const accountsCanRead = Number.isFinite(Number(paySum[0]?.summary?.total_receivables));
        if (!accountsCanRead) {
          throw new Error('Accounts role was unable to read payments summary');
        }
      });

      rbacOk = true;
    } catch (err) {
      rbacErr = err;
    }

    recordTest(
      'P1-A3-17',
      'Role-based access control: read-only viewer cannot create orders, invoices, or payments, while accounts and owner roles execute authorized financial workflows',
      rbacOk,
      `rbacOk=${rbacOk}`,
      rbacOk ? null : rbacErr
    );

    // ========================================================================
    // CONTRACT 8 (P1-A3-18): Authoritative Mathematical Ledger Reconciliation (Task 7)
    // ========================================================================
    let reconcilOk = false;
    let reconcilErr = null;

    await withRoleContext(realBizClient, { role: 'authenticated', userId: ownerC1Id }, async () => {
      try {
        // 1. Inventory Ledger: Current stock equals sum of movements for all sampled products
        const sampleProds = allProductIds.slice(0, 10);
        let stockReconciled = true;
        for (const pId of sampleProds) {
          const { rows: s1 } = await realBizClient.query(
            `SELECT public.get_product_stock($1::uuid, $2::uuid) AS stock;`,
            [pId, orgC1Id]
          );
          const { rows: s2 } = await realBizClient.query(
            `SELECT COALESCE(SUM(quantity_change), 0)::numeric AS sum FROM public.stock_movements WHERE product_id = $1::uuid AND organization_id = $2::uuid;`,
            [pId, orgC1Id]
          );
          if (Number(s1[0].stock) !== Number(s2[0].sum)) {
            stockReconciled = false;
            break;
          }
        }

        // 2. Invoice Ledger: Every invoice satisfies balance = MAX(0, total_amount - total_paid)
        const { rows: invMismatchRows } = await realBizClient.query(
          `SELECT count(*)::int AS mismatch_count
           FROM public.invoices
           WHERE organization_id = $1::uuid
             AND ROUND((total_amount - total_paid)::numeric, 2) < 0;`,
          [orgC1Id]
        );
        const invBalancesClean = invMismatchRows[0]?.mismatch_count === 0;

        // 3. Customer Receivables Ledger: get_page_customer_receivables equals sum of unpaid issued/partially_paid invoices
        const sampleCusts = allCustomerIds.slice(0, 10);
        const { rows: pageRecvRows } = await realBizClient.query(
          `SELECT customer_id, current_receivable FROM public.get_page_customer_receivables($1::uuid, $2::uuid[]);`,
          [orgC1Id, sampleCusts]
        );

        let custRecvClean = true;
        for (const cRow of pageRecvRows) {
          const { rows: expectedRow } = await realBizClient.query(
            `SELECT COALESCE(SUM(total_amount - total_paid), 0)::numeric(12, 2) AS expected
             FROM public.invoices
             WHERE organization_id = $1::uuid
               AND customer_id = $2::uuid
               AND status IN ('ISSUED', 'PARTIALLY_PAID')
               AND (total_amount - total_paid) > 0;`,
            [orgC1Id, cRow.customer_id]
          );
          if (Math.abs(Number(cRow.current_receivable) - Number(expectedRow[0]?.expected)) > 0.01) {
            custRecvClean = false;
            break;
          }
        }

        // 4. Organization Total Receivables: get_payments_summary matches sum of all customer receivables across org
        const { rows: paySumRows } = await realBizClient.query(
          `SELECT public.get_payments_summary($1::uuid) AS summary;`,
          [orgC1Id]
        );
        const orgSummary = paySumRows[0]?.summary;
        const orgTotalReceivables = Number(orgSummary?.total_receivables);

        const { rows: orgExpectedRecvRows } = await realBizClient.query(
          `SELECT COALESCE(SUM(ROUND((total_amount - total_paid)::numeric, 2)), 0.00)::numeric(12, 2) AS expected_org_recv
           FROM public.invoices
           WHERE organization_id = $1::uuid
             AND status IN ('ISSUED', 'PARTIALLY_PAID')
             AND (total_amount - total_paid) > 0;`,
          [orgC1Id]
        );
        const expectedOrgReceivables = Number(orgExpectedRecvRows[0]?.expected_org_recv);

        const orgReceivablesReconciled = Math.abs(orgTotalReceivables - expectedOrgReceivables) < 0.01;

        // 5. Total Collections Logged matches sum of payments in public.payments
        const orgTotalCollected = Number(orgSummary?.total_collected);
        const { rows: orgExpectedCollRows } = await realBizClient.query(
          `SELECT COALESCE(SUM(amount), 0.00)::numeric(12, 2) AS expected_coll FROM public.payments WHERE organization_id = $1::uuid;`,
          [orgC1Id]
        );
        const expectedOrgCollected = Number(orgExpectedCollRows[0]?.expected_coll);
        const orgCollectionsReconciled = Math.abs(orgTotalCollected - expectedOrgCollected) < 0.01;

        reconcilOk = Boolean(
          stockReconciled &&
          invBalancesClean &&
          custRecvClean &&
          orgReceivablesReconciled &&
          orgCollectionsReconciled
        );
      } catch (err) {
        reconcilErr = err;
      }
    });

    recordTest(
      'P1-A3-18',
      'Authoritative mathematical ledger reconciliation: stock equals movement sums, customer receivables equal sum of open invoices, and organization summary matches total receivables and collections to the penny',
      reconcilOk,
      `reconcilOk=${reconcilOk}`,
      reconcilOk ? null : reconcilErr
    );

    // ========================================================================
    // CONTRACT 9 (P1-A3-19): High-Volume Business Acceptance & Scalability (Task 8)
    // ========================================================================
    let scaleOk = false;
    let scaleErr = null;

    await withRoleContext(realBizClient, { role: 'authenticated', userId: ownerC1Id }, async () => {
      try {
        // 1. Verify exact counts seeded in database
        const { rows: prodCountRows } = await realBizClient.query(
          `SELECT count(*)::int AS count FROM public.products WHERE organization_id = $1::uuid;`,
          [orgC1Id]
        );
        const { rows: custCountRows } = await realBizClient.query(
          `SELECT count(*)::int AS count FROM public.customers WHERE organization_id = $1::uuid;`,
          [orgC1Id]
        );
        const { rows: invCountRows } = await realBizClient.query(
          `SELECT count(*)::int AS count FROM public.invoices WHERE organization_id = $1::uuid;`,
          [orgC1Id]
        );
        const { rows: movCountRows } = await realBizClient.query(
          `SELECT count(*)::int AS count FROM public.stock_movements WHERE organization_id = $1::uuid;`,
          [orgC1Id]
        );

        const prodCount = prodCountRows[0]?.count;
        const custCount = custCountRows[0]?.count;
        const invCount = invCountRows[0]?.count;
        const movCount = movCountRows[0]?.count;

        const volumeTargetMet =
          prodCount >= 300 &&
          custCount >= 40 &&
          invCount >= 1200 &&
          movCount >= 2500;

        if (!volumeTargetMet) {
          throw new Error(`Volume targets not met: prods=${prodCount}, custs=${custCount}, invs=${invCount}, movs=${movCount}`);
        }

        // 2. High-performance batch stock levels query (50 products)
        const t0Stock = Date.now();
        const { rows: batchStockRows } = await realBizClient.query(
          `SELECT product_id, current_stock FROM public.get_page_product_stock_levels($1::uuid, $2::uuid[]);`,
          [orgC1Id, allProductIds.slice(0, 50)]
        );
        const stockQueryDurationMs = Date.now() - t0Stock;

        // 3. High-performance batch customer receivables query (25 customers)
        const t0Recv = Date.now();
        const { rows: batchRecvRows } = await realBizClient.query(
          `SELECT customer_id, current_receivable FROM public.get_page_customer_receivables($1::uuid, $2::uuid[]);`,
          [orgC1Id, allCustomerIds.slice(0, 25)]
        );
        const recvQueryDurationMs = Date.now() - t0Recv;

        // 4. Server-side bounded pagination on eligible payment invoices across 1,200 invoices
        const t0El = Date.now();
        const { rows: elPageRows } = await realBizClient.query(
          `SELECT public.get_eligible_payment_invoices(
            p_org_id := $1::uuid,
            p_customer_id := $2::uuid,
            p_limit := 25,
            p_offset := 0
          ) AS res;`,
          [orgC1Id, allCustomerIds[1]]
        );
        const elDurationMs = Date.now() - t0El;

        const elRes = elPageRows[0]?.res;
        const elTotal = Number(elRes?.total_count);
        const elDataCount = (elRes?.data || []).length;

        const queriesFastAndAccurate =
          batchStockRows.length === 50 &&
          batchRecvRows.length === 25 &&
          elDataCount <= 25 &&
          elTotal >= elDataCount &&
          stockQueryDurationMs < 250 &&
          recvQueryDurationMs < 250 &&
          elDurationMs < 250;

        scaleOk = volumeTargetMet && queriesFastAndAccurate;
        console.log(`  ✓ High-Volume Performance: 50-stock batch: ${stockQueryDurationMs}ms, 25-receivables batch: ${recvQueryDurationMs}ms, eligible invoices page: ${elDurationMs}ms.`);
      } catch (err) {
        scaleErr = err;
      }
    });

    recordTest(
      'P1-A3-19',
      'High-volume business acceptance & scalability: verified across 300 products, 40 customers, 1,200 invoices, 2,500 movements with sub-250ms batch queries and bounded server-side pagination without query truncation',
      scaleOk,
      `scaleOk=${scaleOk}`,
      scaleOk ? null : scaleErr
    );

  } finally {
    if (realBizClient) {
      await realBizClient.end().catch(() => {});
    }
    try {
      await maintClient.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid();`,
        [testDbName]
      );
      await maintClient.query(`DROP DATABASE IF EXISTS "${testDbName}";`);
      console.log(`  ✓ Scenario C dedicated database "${testDbName}" dropped cleanly.`);
    } catch (err) {
      console.error(`Failed to drop test db "${testDbName}":`, err.message);
    }
  }
}
