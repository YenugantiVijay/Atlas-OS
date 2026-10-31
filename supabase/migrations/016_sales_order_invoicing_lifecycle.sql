-- ============================================================================
-- Migration 016: Sales Order Invoicing Lifecycle & Duplicate Prevention
-- ============================================================================
-- Purpose:
--   Resolves DEF-003 by enforcing the sales order to invoice lifecycle invariant:
--   1. Rejects invoice creation from sales orders that are not in 'CONFIRMED' status
--      (explicitly blocking DRAFT, CANCELLED, and FULFILLED orders).
--   2. Prevents duplicate invoicing of the same sales order under the existing
--      sales order row lock (FOR UPDATE), including concurrent requests with different keys.
--   3. Atomically transitions the sales order status from 'CONFIRMED' to 'FULFILLED'
--      upon successful invoice creation and issuance within the same ACID transaction.
--   4. Preserves idempotent request replays for identical submissions.
--
-- Migration Strategy:
--   Follows a forward-only migration pattern using CREATE OR REPLACE FUNCTION.
--   Preserves all existing security controls, role checks, search_path,
--   entitlement gates, and product row locking hierarchy from Migration 015.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_invoice_atomic(
    p_org_id UUID,
    p_customer_id UUID,
    p_items JSONB,
    p_invoice_date DATE DEFAULT CURRENT_DATE,
    p_due_date DATE DEFAULT NULL,
    p_status VARCHAR DEFAULT 'ISSUED',
    p_notes TEXT DEFAULT NULL,
    p_sales_order_id UUID DEFAULT NULL,
    p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid UUID;
    v_user_role VARCHAR(50);
    v_customer_exists BOOLEAN;
    v_so_status VARCHAR(50);
    v_so_updated_count INTEGER;
    v_invoice_year INTEGER;
    v_invoice_number VARCHAR(100);
    v_invoice_id UUID;
    v_due_date DATE;
    v_status VARCHAR(50);
    v_request_hash TEXT;
    v_existing_inv_id UUID;
    v_existing_hash TEXT;
    v_existing_invoice JSONB;
    v_product_ids UUID[];
    v_locked_prod_count INTEGER;
    v_item JSONB;
    v_calc_item JSONB;
    v_item_prod_id UUID;
    v_item_qty INTEGER;
    v_item_price NUMERIC(12, 2);
    v_item_disc_pct NUMERIC(5, 2);
    v_item_tax_rate NUMERIC(5, 2);
    v_item_name VARCHAR(255);
    v_item_sku VARCHAR(100);
    v_item_hsn VARCHAR(20);
    v_item_uom VARCHAR(50);
    v_prod RECORD;
    v_gross NUMERIC(12, 2);
    v_disc NUMERIC(12, 2);
    v_taxable NUMERIC(12, 2);
    v_tax NUMERIC(12, 2);
    v_line_total NUMERIC(12, 2);
    v_subtotal NUMERIC(12, 2) := 0.00;
    v_discount_total NUMERIC(12, 2) := 0.00;
    v_tax_total NUMERIC(12, 2) := 0.00;
    v_grand_total NUMERIC(12, 2) := 0.00;
    v_item_count INTEGER := 0;
    v_calculated_items JSONB := '[]'::JSONB;
    v_line_item_id UUID;
BEGIN
    -- 1. Authenticate caller
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'unauthorized';
    END IF;

    -- 2. Input null & bounds validation
    IF p_org_id IS NULL OR p_customer_id IS NULL OR p_items IS NULL THEN
        RAISE EXCEPTION 'Invalid parameters: organization_id, customer_id, and items are required';
    END IF;

    IF jsonb_typeof(p_items) != 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Invoice must contain at least one line item';
    END IF;

    v_status := UPPER(TRIM(COALESCE(p_status, 'ISSUED')));
    IF v_status NOT IN ('DRAFT', 'ISSUED') THEN
        RAISE EXCEPTION 'Invalid invoice status: %. Must be DRAFT or ISSUED.', p_status;
    END IF;

    -- 3. Authorization: Caller must have an active membership in target org with appropriate role
    v_user_role := get_user_org_role(p_org_id);
    IF v_user_role IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Caller has no active membership in organization %', p_org_id;
    END IF;

    IF v_user_role NOT IN ('owner', 'admin', 'accounts') THEN
        RAISE EXCEPTION 'Unauthorized: Caller has insufficient role (%) to create invoices in organization %',
            v_user_role, p_org_id;
    END IF;

    -- 4. Operational write entitlement gate (Migration 014)
    IF NOT public.can_write_organization_operations(p_org_id) THEN
        RAISE EXCEPTION 'Operational write denied: Active subscription or trial required for organization %', p_org_id;
    END IF;

    -- 5. Idempotency handling with transaction advisory locking
    IF p_idempotency_key IS NOT NULL THEN
        -- Acquire a transaction-level advisory lock hashed to the organization and key to serialize concurrent submissions
        PERFORM pg_advisory_xact_lock(hashtext('invoice_create:' || p_org_id::text || ':' || p_idempotency_key::text));

        -- Canonical request fingerprint
        v_request_hash := md5(
            p_org_id::text || '|' ||
            p_customer_id::text || '|' ||
            coalesce(p_sales_order_id::text, '') || '|' ||
            coalesce(p_invoice_date::text, '') || '|' ||
            coalesce(p_due_date::text, '') || '|' ||
            v_status || '|' ||
            coalesce(trim(p_notes), '') || '|' ||
            p_items::text
        );

        -- Check if key already processed for this organization
        SELECT invoice_id, request_hash
          INTO v_existing_inv_id, v_existing_hash
          FROM public.invoice_creation_idempotency
         WHERE organization_id = p_org_id
           AND idempotency_key = p_idempotency_key;

        IF FOUND THEN
            IF v_existing_hash = v_request_hash THEN
                -- Exact replay: return existing invoice details
                SELECT jsonb_build_object(
                    'id', inv.id,
                    'organization_id', inv.organization_id,
                    'invoice_number', inv.invoice_number,
                    'customer_id', inv.customer_id,
                    'sales_order_id', inv.sales_order_id,
                    'status', inv.status,
                    'invoice_date', inv.invoice_date,
                    'due_date', inv.due_date,
                    'subtotal', inv.subtotal,
                    'discount_amount', inv.discount_amount,
                    'tax_amount', inv.tax_amount,
                    'total_amount', inv.total_amount,
                    'total_paid', inv.total_paid,
                    'totals_version', inv.totals_version,
                    'notes', inv.notes,
                    'created_by', inv.created_by,
                    'created_at', inv.created_at,
                    'updated_at', inv.updated_at,
                    'idempotent_replay', true,
                    'items', COALESCE((
                        SELECT jsonb_agg(
                            jsonb_build_object(
                                'id', itm.id,
                                'invoice_id', itm.invoice_id,
                                'product_id', itm.product_id,
                                'product_name', itm.product_name,
                                'product_sku', itm.product_sku,
                                'hsn_code', itm.hsn_code,
                                'uom', itm.uom,
                                'quantity', itm.quantity,
                                'unit_price', itm.unit_price,
                                'discount_percent', itm.discount_percent,
                                'tax_rate', itm.tax_rate,
                                'line_subtotal', itm.line_subtotal,
                                'line_tax', itm.line_tax,
                                'line_total', itm.line_total,
                                'document_discount_share', itm.document_discount_share
                            )
                        )
                        FROM public.invoice_items itm
                        WHERE itm.invoice_id = inv.id
                    ), '[]'::JSONB)
                ) INTO v_existing_invoice
                FROM public.invoices inv
                WHERE inv.id = v_existing_inv_id;

                RETURN v_existing_invoice;
            ELSE
                RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: Idempotency key "%" reused with different request payload', p_idempotency_key;
            END IF;
        END IF;
    END IF;

    -- 6. Customer validation & Level 2.1 row lock
    SELECT EXISTS (
        SELECT 1 FROM public.customers
        WHERE id = p_customer_id AND organization_id = p_org_id AND is_active = TRUE
        FOR UPDATE
    ) INTO v_customer_exists;

    IF NOT v_customer_exists THEN
        RAISE EXCEPTION 'Customer % not found or inactive in organization %', p_customer_id, p_org_id;
    END IF;

    -- 7. Sales order validation & Level 2.15 row lock (if provided)
    -- DEF-003 Hardening: Strictly require CONFIRMED status and prevent duplicate invoicing
    IF p_sales_order_id IS NOT NULL THEN
        SELECT status INTO v_so_status
        FROM public.sales_orders
        WHERE id = p_sales_order_id AND organization_id = p_org_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Sales order % not found in organization %', p_sales_order_id, p_org_id;
        END IF;

        IF v_so_status != 'CONFIRMED' THEN
            RAISE EXCEPTION 'Cannot create invoice from sales order % with status %. Only CONFIRMED orders can be invoiced.',
                p_sales_order_id, v_so_status;
        END IF;

        -- Verify no active (non-cancelled) invoice already exists for this sales order
        IF EXISTS (
            SELECT 1 FROM public.invoices
            WHERE sales_order_id = p_sales_order_id
              AND organization_id = p_org_id
              AND status != 'CANCELLED'
        ) THEN
            RAISE EXCEPTION 'Sales order % has already been invoiced', p_sales_order_id;
        END IF;
    END IF;

    -- 8. Extract distinct product IDs and acquire Level 2.2 row locks in deterministic ascending ID order
    SELECT array_agg(DISTINCT (elem->>'product_id')::UUID)
      INTO v_product_ids
      FROM jsonb_array_elements(p_items) AS elem
     WHERE (elem->>'product_id') IS NOT NULL;

    IF cardinality(v_product_ids) IS NULL OR cardinality(v_product_ids) = 0 THEN
        RAISE EXCEPTION 'All line items must contain a valid product_id';
    END IF;

    PERFORM id FROM public.products
    WHERE id = ANY(v_product_ids) AND organization_id = p_org_id
    ORDER BY id ASC
    FOR UPDATE;

    GET DIAGNOSTICS v_locked_prod_count = ROW_COUNT;
    IF v_locked_prod_count != cardinality(v_product_ids) THEN
        RAISE EXCEPTION 'One or more products not found or belong to another organization';
    END IF;

    -- 9. Pre-calculate all line items & invoice totals in memory BEFORE sequence allocation or database writes
    -- Generate target invoice UUID in memory for item references
    v_invoice_id := gen_random_uuid();

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_item_prod_id := (v_item->>'product_id')::UUID;

        IF v_item_prod_id IS NULL THEN
            RAISE EXCEPTION 'Item % must contain a valid product_id', v_item_count + 1;
        END IF;

        v_item_qty := (v_item->>'quantity')::INTEGER;
        v_item_price := (v_item->>'unit_price')::NUMERIC(12, 2);
        v_item_disc_pct := COALESCE((v_item->>'discount_percent')::NUMERIC(5, 2), 0.00);
        v_item_tax_rate := COALESCE((v_item->>'tax_rate')::NUMERIC(5, 2), 18.00);

        IF v_item_qty IS NULL OR v_item_qty <= 0 THEN
            RAISE EXCEPTION 'Item quantity must be greater than zero (received %)', v_item_qty;
        END IF;

        IF v_item_price IS NULL OR v_item_price < 0 THEN
            RAISE EXCEPTION 'Item unit price cannot be negative (received %)', v_item_price;
        END IF;

        IF v_item_disc_pct < 0 OR v_item_disc_pct > 100 THEN
            RAISE EXCEPTION 'Discount percent must be between 0 and 100 (received %)', v_item_disc_pct;
        END IF;

        IF v_item_tax_rate < 0 THEN
            RAISE EXCEPTION 'Tax rate cannot be negative (received %)', v_item_tax_rate;
        END IF;

        -- Get product snapshot metadata from locked master catalog
        SELECT name, sku, hsn_code, uom INTO v_prod
        FROM public.products
        WHERE id = v_item_prod_id;

        -- Resolve catalog snapshots: SKU and HSN code are immutable from catalog; custom descriptions permitted
        v_item_name := COALESCE(NULLIF(TRIM(v_item->>'product_name'), ''), v_prod.name);
        v_item_sku := COALESCE(v_prod.sku, NULLIF(TRIM(v_item->>'product_sku'), ''));
        v_item_hsn := COALESCE(v_prod.hsn_code, NULLIF(TRIM(v_item->>'hsn_code'), ''));
        v_item_uom := COALESCE(v_prod.uom, NULLIF(TRIM(v_item->>'uom'), ''), 'Nos');

        -- Calculate line financials using standard Indian GST Rule 46 arithmetic
        v_gross := ROUND(v_item_qty * v_item_price, 2);
        v_disc := ROUND(v_gross * (v_item_disc_pct / 100.0), 2);
        v_taxable := v_gross - v_disc;
        v_tax := ROUND(v_taxable * (v_item_tax_rate / 100.0), 2);
        v_line_total := v_taxable + v_tax;

        v_subtotal := v_subtotal + v_gross;
        v_discount_total := v_discount_total + v_disc;
        v_tax_total := v_tax_total + v_tax;
        v_grand_total := v_grand_total + v_line_total;
        v_item_count := v_item_count + 1;

        v_line_item_id := gen_random_uuid();

        -- Accumulate in memory array
        v_calculated_items := v_calculated_items || jsonb_build_object(
            'id', v_line_item_id,
            'invoice_id', v_invoice_id,
            'product_id', v_item_prod_id,
            'product_name', v_item_name,
            'product_sku', v_item_sku,
            'hsn_code', v_item_hsn,
            'uom', v_item_uom,
            'quantity', v_item_qty,
            'unit_price', v_item_price,
            'discount_percent', v_item_disc_pct,
            'tax_rate', v_item_tax_rate,
            'line_subtotal', v_taxable,
            'line_tax', v_tax,
            'line_total', v_line_total,
            'document_discount_share', 0.00
        );
    END LOOP;

    -- 10. Due date resolution & Document number allocation (Level 4 sequence lock)
    v_due_date := COALESCE(p_due_date, COALESCE(p_invoice_date, CURRENT_DATE) + 30);
    v_invoice_year := EXTRACT(YEAR FROM COALESCE(p_invoice_date, CURRENT_DATE))::INTEGER;
    v_invoice_number := public.internal_allocate_document_number(p_org_id, 'INVOICE', v_invoice_year);

    -- 11. STEP A: Insert Invoice Header FIRST (Level 3.2 write)
    -- Insert initially with status = 'DRAFT' to respect child attachment policy & lifecycle
    INSERT INTO public.invoices (
        id,
        organization_id,
        invoice_number,
        customer_id,
        sales_order_id,
        status,
        invoice_date,
        due_date,
        subtotal,
        discount_amount,
        tax_amount,
        total_amount,
        total_paid,
        totals_version,
        notes,
        created_by,
        created_at,
        updated_at
    ) VALUES (
        v_invoice_id,
        p_org_id,
        v_invoice_number,
        p_customer_id,
        p_sales_order_id,
        'DRAFT',
        COALESCE(p_invoice_date, CURRENT_DATE),
        v_due_date,
        v_subtotal,
        v_discount_total,
        v_tax_total,
        v_grand_total,
        0.00,
        2,
        TRIM(p_notes),
        v_uid,
        NOW(),
        NOW()
    );

    -- 12. STEP B: Insert Invoice Line Items SECOND (Level 3.5 write)
    -- Parent invoice row now exists; satisfies foreign key and trg_check_invoice_item_org trigger
    FOR v_calc_item IN SELECT * FROM jsonb_array_elements(v_calculated_items)
    LOOP
        INSERT INTO public.invoice_items (
            id,
            invoice_id,
            product_id,
            product_name,
            product_sku,
            hsn_code,
            uom,
            quantity,
            unit_price,
            discount_percent,
            tax_rate,
            line_subtotal,
            line_tax,
            line_total,
            document_discount_share
        ) VALUES (
            (v_calc_item->>'id')::UUID,
            v_invoice_id,
            (v_calc_item->>'product_id')::UUID,
            v_calc_item->>'product_name',
            v_calc_item->>'product_sku',
            v_calc_item->>'hsn_code',
            v_calc_item->>'uom',
            (v_calc_item->>'quantity')::INTEGER,
            (v_calc_item->>'unit_price')::NUMERIC(12, 2),
            (v_calc_item->>'discount_percent')::NUMERIC(5, 2),
            (v_calc_item->>'tax_rate')::NUMERIC(5, 2),
            (v_calc_item->>'line_subtotal')::NUMERIC(12, 2),
            (v_calc_item->>'line_tax')::NUMERIC(12, 2),
            (v_calc_item->>'line_total')::NUMERIC(12, 2),
            0.00
        );
    END LOOP;

    -- 13. STEP C: Complete lifecycle transition if caller requested ISSUED status
    IF v_status = 'ISSUED' THEN
        UPDATE public.invoices
           SET status = 'ISSUED',
               updated_at = NOW()
         WHERE id = v_invoice_id;
    END IF;

    -- 13.5 STEP D: Atomically transition sales order to FULFILLED (DEF-003)
    IF p_sales_order_id IS NOT NULL THEN
        UPDATE public.sales_orders
           SET status = 'FULFILLED',
               updated_at = NOW()
         WHERE id = p_sales_order_id
           AND organization_id = p_org_id;

        GET DIAGNOSTICS v_so_updated_count = ROW_COUNT;
        IF v_so_updated_count != 1 THEN
            RAISE EXCEPTION 'Failed to update sales order % status to FULFILLED (updated % rows)',
                p_sales_order_id, v_so_updated_count;
        END IF;
    END IF;

    -- 14. Record Idempotency Mapping (Level 3.8 write, if key provided)
    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO public.invoice_creation_idempotency (
            organization_id,
            idempotency_key,
            user_id,
            invoice_id,
            request_hash
        ) VALUES (
            p_org_id,
            p_idempotency_key,
            v_uid,
            v_invoice_id,
            v_request_hash
        );
    END IF;

    -- 15. Log Audit Event (Level 5 write)
    INSERT INTO public.audit_events (
        organization_id,
        actor_id,
        action,
        entity_type,
        entity_id,
        details
    ) VALUES (
        p_org_id,
        v_uid,
        'CREATE_INVOICE',
        'INVOICE',
        v_invoice_id,
        jsonb_build_object(
            'invoice_number', v_invoice_number,
            'status', v_status,
            'customer_id', p_customer_id,
            'sales_order_id', p_sales_order_id,
            'total_amount', v_grand_total,
            'item_count', v_item_count
        )
    );

    -- 16. Return complete canonical invoice payload
    RETURN jsonb_build_object(
        'id', v_invoice_id,
        'organization_id', p_org_id,
        'invoice_number', v_invoice_number,
        'customer_id', p_customer_id,
        'sales_order_id', p_sales_order_id,
        'status', v_status,
        'invoice_date', COALESCE(p_invoice_date, CURRENT_DATE),
        'due_date', v_due_date,
        'subtotal', v_subtotal,
        'discount_amount', v_discount_total,
        'tax_amount', v_tax_total,
        'total_amount', v_grand_total,
        'total_paid', 0.00,
        'totals_version', 2,
        'notes', TRIM(p_notes),
        'created_by', v_uid,
        'created_at', NOW(),
        'updated_at', NOW(),
        'idempotent_replay', false,
        'items', v_calculated_items
    );
END;
$$;

-- 3. Execution Permissions
REVOKE ALL ON FUNCTION public.create_invoice_atomic(UUID, UUID, JSONB, DATE, DATE, VARCHAR, TEXT, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_invoice_atomic(UUID, UUID, JSONB, DATE, DATE, VARCHAR, TEXT, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_invoice_atomic(UUID, UUID, JSONB, DATE, DATE, VARCHAR, TEXT, UUID, UUID) TO service_role;

-- 4. Function Owner Privileges Alignment
DO $$
DECLARE
    v_owner_role NAME;
BEGIN
    SELECT r.rolname INTO v_owner_role
    FROM pg_proc p
    JOIN pg_roles r ON p.proowner = r.oid
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname = 'create_invoice_atomic'
    LIMIT 1;

    IF v_owner_role IS NOT NULL THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.internal_allocate_document_number(UUID, VARCHAR, INTEGER) TO %I', v_owner_role);
    END IF;
END $$;
