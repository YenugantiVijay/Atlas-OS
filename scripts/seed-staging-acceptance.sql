-- ============================================================================
-- ATLAS OS STAGING RELEASE GATE #127: NON-EMPTY ACCEPTANCE FIXTURE SEED
-- Seeds minimal valid customer, invoice, payment, and allocation in staging
-- Target project: bwswqnhlebbzdxumlkih (ATLAS-OS-Staging)
-- ============================================================================

DO $$
DECLARE
  v_org_id UUID;
  v_cust_id UUID;
  v_inv_id UUID;
  v_pmt_id UUID;
  v_prod_id UUID;
BEGIN
  -- 1. Grab the existing staging organization
  SELECT id INTO v_org_id FROM public.organizations LIMIT 1;
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'No organization found in staging. Creating baseline organization...';
    INSERT INTO public.organizations (name, legal_name, gstin, state, address_line1, city, pincode)
    VALUES ('Atlas Staging Test Org', 'Atlas Staging Test Org LLP', '29ABCDE1234F1Z5', 'Karnataka', '1 MG Road', 'Bengaluru', '560001')
    RETURNING id INTO v_org_id;
  END IF;

  -- 2. Grab an existing active product or create one
  SELECT id INTO v_prod_id FROM public.products WHERE organization_id = v_org_id AND is_active = TRUE LIMIT 1;
  IF v_prod_id IS NULL THEN
    INSERT INTO public.products (organization_id, sku, name, uom, purchase_cost, selling_price, tax_rate, current_stock, reorder_threshold, is_active)
    VALUES (v_org_id, 'STG-CBL-01', 'Staging Industrial Cable 4sqmm', 'Meters', 80.00, 100.00, 18.00, 100, 10, TRUE)
    RETURNING id INTO v_prod_id;
  END IF;

  -- 3. Create or reuse staging customer
  SELECT id INTO v_cust_id FROM public.customers WHERE organization_id = v_org_id LIMIT 1;
  IF v_cust_id IS NULL THEN
    INSERT INTO public.customers (organization_id, name, company_name, gstin, phone, billing_address, credit_limit, credit_days, is_active)
    VALUES (v_org_id, 'Staging Test Customer', 'Staging Electricals Pvt Ltd', '29AAAAA0000A1Z5', '+91 99000 11223', 'Bengaluru, Karnataka - 560001', 500000, 30, TRUE)
    RETURNING id INTO v_cust_id;
  END IF;

  -- 4. Check if invoices already exist; if not, create one
  SELECT id INTO v_inv_id FROM public.invoices WHERE organization_id = v_org_id LIMIT 1;
  IF v_inv_id IS NULL THEN
    INSERT INTO public.invoices (
      organization_id, invoice_number, customer_id, status, invoice_date, due_date,
      subtotal, discount_amount, tax_amount, total_amount, total_paid, notes
    ) VALUES (
      v_org_id, 'INV-STG-2026-0001', v_cust_id, 'PARTIALLY_PAID', CURRENT_DATE, CURRENT_DATE + 30,
      10000.00, 0.00, 1800.00, 11800.00, 5000.00, 'Issue #127 hosted acceptance fixture'
    ) RETURNING id INTO v_inv_id;

    -- Add line item
    INSERT INTO public.invoice_items (
      invoice_id, product_id, product_name, product_sku, uom, quantity, unit_price, discount_percent, tax_rate, line_subtotal, line_tax, line_total
    ) VALUES (
      v_inv_id, v_prod_id, 'Staging Industrial Cable 4sqmm', 'STG-CBL-01', 'Meters', 100, 100.00, 0.00, 18.00, 10000.00, 1800.00, 11800.00
    );

    -- 5. Create payment
    INSERT INTO public.payments (
      organization_id, payment_number, customer_id, amount, payment_method, reference_number, payment_date, notes
    ) VALUES (
      v_org_id, 'PAY-STG-2026-0001', v_cust_id, 5000.00, 'UPI', 'UPI/20261122/STG001', CURRENT_DATE, 'Issue #127 hosted acceptance payment'
    ) RETURNING id INTO v_pmt_id;

    -- 6. Create payment allocation matching invoice.total_paid exactly
    INSERT INTO public.payment_allocations (
      payment_id, invoice_id, amount_allocated
    ) VALUES (
      v_pmt_id, v_inv_id, 5000.00
    );

    RAISE NOTICE 'Created acceptance fixture: Invoice % (total: 11800, paid: 5000), Payment % (amount: 5000), Allocation (5000)', v_inv_id, v_pmt_id;
  ELSE
    RAISE NOTICE 'Invoices already exist in staging; skipping insertion to prevent duplicate collision.';
  END IF;
END;
$$;
