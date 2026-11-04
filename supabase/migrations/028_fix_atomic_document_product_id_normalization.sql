-- ============================================================================
-- MIGRATION 028: Fix Atomic Document Product-ID Normalization
-- ============================================================================
-- Purpose:
-- 1. Corrects the product-ID extraction and normalization defect in:
--      - public.create_invoice_atomic
--      - public.create_sales_order_atomic
--      - public.create_quotation_atomic
-- 2. Root Cause:
--      In Migration 027, the initial product-locking collection used:
--        SELECT array_agg(DISTINCT (item->>'productId')::UUID ...) INTO v_product_ids
--      When line items supplied `product_id` (snake_case) rather than `productId`
--      (camelCase), PostgreSQL evaluated `(item->>'productId')::UUID` to NULL.
--      In PostgreSQL, `array_agg(NULL)` returns `ARRAY[NULL]` (`'{NULL}'::uuid[]`).
--      Because `ARRAY[NULL]` is NOT NULL and has `array_length = 1`, the subsequent
--      fallback check `IF v_product_ids IS NULL OR array_length(v_product_ids, 1) = 0`
--      evaluated to FALSE and was completely skipped.
--      As a result, `v_product_ids` remained `ARRAY[NULL]`, the row-locking query
--      matched zero products, and the function raised:
--        'One or more products in items do not belong to organization %'
--      even for legitimate same-organization products.
-- 3. Solution:
--      - Normalizes line items before collection using:
--          COALESCE(NULLIF(TRIM(item->>'productId'), ''), NULLIF(TRIM(item->>'product_id'), ''))
--      - Validates each line item: rejects ambiguous conflicting keys, missing IDs,
--        and invalid UUID formats upfront with descriptive exceptions.
--      - Constructs a unique, deterministically ordered UUID collection with NO NULL elements.
--      - Preserves deterministic product row-locking (`ORDER BY p.id FOR UPDATE`).
--      - Preserves all authorization, tenant isolation, idempotency, document numbering,
--        financial rounding, and statutory immutability rules.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Authoritative create_invoice_atomic with Robust Product-ID Normalization
-- ----------------------------------------------------------------------------
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
    v_raw_camel TEXT;
    v_raw_snake TEXT;
    v_raw_id TEXT;
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
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'unauthorized';
    END IF;

    IF p_org_id IS NULL OR p_customer_id IS NULL OR p_items IS NULL THEN
        RAISE EXCEPTION 'Invalid parameters: organization_id, customer_id, and items are required';
    END IF;

    IF jsonb_typeof(p_items) != 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Invoice must contain at least one line item';
    END IF;

    v_status := UPPER(TRIM(COALESCE(p_status, 'ISSUED')));
    IF v_status NOT IN ('DRAFT', 'ISSUED') THEN
        RAISE EXCEPTION 'Invalid status: % (must be DRAFT or ISSUED)', v_status;
    END IF;

    v_user_role := get_user_org_role(p_org_id);
    IF v_user_role IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Caller has no active membership in organization %', p_org_id;
    END IF;

    IF v_user_role NOT IN ('owner', 'admin', 'sales') THEN
        RAISE EXCEPTION 'Unauthorized: Caller has insufficient role (%) to create invoices in organization %',
            v_user_role, p_org_id;
    END IF;

    IF NOT public.can_write_organization_operations(p_org_id) THEN
        RAISE EXCEPTION 'Operational write denied: Active subscription or trial required for organization %', p_org_id;
    END IF;

    v_request_hash := md5(
        p_org_id::TEXT || ':' ||
        p_customer_id::TEXT || ':' ||
        COALESCE(p_sales_order_id::TEXT, '') || ':' ||
        v_status || ':' ||
        COALESCE(p_invoice_date::TEXT, '') || ':' ||
        p_items::TEXT
    );

    IF p_idempotency_key IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtext('inv_create:' || p_org_id::TEXT || ':' || p_idempotency_key::TEXT));

        SELECT invoice_id, request_hash
          INTO v_existing_inv_id, v_existing_hash
          FROM public.invoice_creation_idempotency
         WHERE organization_id = p_org_id
           AND idempotency_key = p_idempotency_key;

        IF FOUND THEN
            IF v_existing_hash = v_request_hash THEN
                SELECT jsonb_build_object(
                    'id', inv.id,
                    'invoice_number', inv.invoice_number,
                    'organization_id', inv.organization_id,
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
                    'created_at', inv.created_at,
                    'updated_at', inv.updated_at,
                    'idempotent_replay', true,
                    'items', COALESCE(
                        (SELECT jsonb_agg(jsonb_build_object(
                            'id', ii.id,
                            'invoice_id', ii.invoice_id,
                            'product_id', ii.product_id,
                            'product_name', ii.product_name,
                            'product_sku', ii.product_sku,
                            'hsn_code', ii.hsn_code,
                            'uom', ii.uom,
                            'quantity', ii.quantity,
                            'unit_price', ii.unit_price,
                            'discount_percent', ii.discount_percent,
                            'tax_rate', ii.tax_rate,
                            'line_subtotal', ii.line_subtotal,
                            'line_tax', ii.line_tax,
                            'line_total', ii.line_total,
                            'document_discount_share', ii.document_discount_share
                        )) FROM public.invoice_items ii WHERE ii.invoice_id = inv.id),
                        '[]'::JSONB
                    )
                ) INTO v_existing_invoice
                FROM public.invoices inv
                WHERE inv.id = v_existing_inv_id;

                RETURN v_existing_invoice;
            ELSE
                RAISE EXCEPTION 'Idempotency key reused with different request parameters'
                    USING ERRCODE = 'unique_violation';
            END IF;
        END IF;
    END IF;

    -- Validate customer belongs to organization
    SELECT EXISTS (
        SELECT 1 FROM public.customers
        WHERE id = p_customer_id AND organization_id = p_org_id AND is_active = TRUE
    ) INTO v_customer_exists;

    IF NOT v_customer_exists THEN
        RAISE EXCEPTION 'Customer % not found or inactive in organization %', p_customer_id, p_org_id;
    END IF;

    -- Validate sales order if provided
    IF p_sales_order_id IS NOT NULL THEN
        SELECT status INTO v_so_status
        FROM public.sales_orders
        WHERE id = p_sales_order_id AND organization_id = p_org_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Sales order % not found in organization %', p_sales_order_id, p_org_id;
        END IF;

        IF v_so_status != 'CONFIRMED' THEN
            RAISE EXCEPTION 'Cannot create invoice from sales order %: order status is % (must be CONFIRMED)',
                p_sales_order_id, v_so_status;
        END IF;

        IF EXISTS (
            SELECT 1 FROM public.invoices
            WHERE sales_order_id = p_sales_order_id
              AND organization_id = p_org_id
              AND status != 'CANCELLED'
        ) THEN
            RAISE EXCEPTION 'Active invoice already exists for sales order % in organization %',
                p_sales_order_id, p_org_id
                USING ERRCODE = 'unique_violation';
        END IF;
    END IF;

    -- Pre-flight line item normalization and identifier validation
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_item_count := v_item_count + 1;
        v_raw_camel := NULLIF(TRIM(COALESCE(v_item->>'productId', '')), '');
        v_raw_snake := NULLIF(TRIM(COALESCE(v_item->>'product_id', '')), '');

        IF v_raw_camel IS NOT NULL AND v_raw_snake IS NOT NULL AND LOWER(v_raw_camel) != LOWER(v_raw_snake) THEN
            RAISE EXCEPTION 'Ambiguous product identifier in line item %: conflicting productId (%) and product_id (%)',
                v_item_count, v_raw_camel, v_raw_snake;
        END IF;

        v_raw_id := COALESCE(v_raw_camel, v_raw_snake);

        IF v_raw_id IS NULL THEN
            RAISE EXCEPTION 'Item % is missing required product identifier (productId or product_id)', v_item_count;
        END IF;

        IF NOT (v_raw_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
            RAISE EXCEPTION 'Item % has invalid product identifier: % (valid UUID required)', v_item_count, v_raw_id;
        END IF;
    END LOOP;

    -- Collect unique, deterministically ordered product IDs (no NULLs)
    SELECT ARRAY(
        SELECT DISTINCT (COALESCE(
            NULLIF(TRIM(item->>'productId'), ''),
            NULLIF(TRIM(item->>'product_id'), '')
        ))::UUID
        FROM jsonb_array_elements(p_items) AS item
        ORDER BY 1 ASC
    ) INTO v_product_ids;

    IF v_product_ids IS NOT NULL AND array_length(v_product_ids, 1) > 0 THEN
        PERFORM p.id
        FROM public.products AS p
        WHERE p.id = ANY(v_product_ids)
          AND p.organization_id = p_org_id
        ORDER BY p.id
        FOR UPDATE;

        GET DIAGNOSTICS v_locked_prod_count = ROW_COUNT;

        IF v_locked_prod_count != array_length(v_product_ids, 1) THEN
            RAISE EXCEPTION 'One or more products in items do not belong to organization %', p_org_id;
        END IF;
    ELSE
        RAISE EXCEPTION 'One or more products in items do not belong to organization %', p_org_id;
    END IF;

    -- Reset counter and compute line items
    v_item_count := 0;
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_item_count := v_item_count + 1;
        v_item_prod_id := (COALESCE(
            NULLIF(TRIM(v_item->>'productId'), ''),
            NULLIF(TRIM(v_item->>'product_id'), '')
        ))::UUID;

        v_item_qty := COALESCE(
            (v_item->>'quantity')::INTEGER,
            0
        );
        IF v_item_qty <= 0 THEN
            RAISE EXCEPTION 'Item % has invalid quantity: % (must be >= 1)', v_item_count, v_item_qty;
        END IF;

        SELECT id, name, sku, hsn_code, uom, selling_price, tax_rate, is_active
          INTO v_prod
          FROM public.products
         WHERE id = v_item_prod_id AND organization_id = p_org_id;

        IF NOT FOUND OR NOT v_prod.is_active THEN
            RAISE EXCEPTION 'Product % is not found or inactive in organization %', v_item_prod_id, p_org_id;
        END IF;

        v_item_price := COALESCE(
            (v_item->>'unitPrice')::NUMERIC(12, 2),
            (v_item->>'unit_price')::NUMERIC(12, 2),
            v_prod.selling_price
        );
        IF v_item_price < 0 THEN
            RAISE EXCEPTION 'Item % has invalid unit_price: % (must be >= 0)', v_item_count, v_item_price;
        END IF;

        v_item_disc_pct := COALESCE(
            (v_item->>'discountPercent')::NUMERIC(5, 2),
            (v_item->>'discount_percent')::NUMERIC(5, 2),
            0.00
        );
        IF v_item_disc_pct < 0 OR v_item_disc_pct > 100 THEN
            RAISE EXCEPTION 'Item % has invalid discount_percent: % (must be between 0 and 100)', v_item_count, v_item_disc_pct;
        END IF;

        v_item_tax_rate := COALESCE(
            (v_item->>'taxRate')::NUMERIC(5, 2),
            (v_item->>'tax_rate')::NUMERIC(5, 2),
            v_prod.tax_rate
        );
        IF v_item_tax_rate < 0 THEN
            RAISE EXCEPTION 'Item % has invalid tax_rate: % (must be >= 0)', v_item_count, v_item_tax_rate;
        END IF;

        v_item_name := COALESCE(v_item->>'productName', v_item->>'product_name', v_prod.name);
        v_item_sku := COALESCE(v_item->>'productSku', v_item->>'product_sku', v_prod.sku);
        v_item_hsn := COALESCE(v_item->>'hsnCode', v_item->>'hsn_code', v_prod.hsn_code);
        v_item_uom := COALESCE(v_item->>'uom', v_prod.uom);

        v_gross := ROUND(v_item_qty * v_item_price, 2);
        v_disc := ROUND(v_gross * (v_item_disc_pct / 100.0), 2);
        v_taxable := v_gross - v_disc;
        v_tax := ROUND(v_taxable * (v_item_tax_rate / 100.0), 2);
        v_line_total := v_taxable + v_tax;

        v_subtotal := v_subtotal + v_gross;
        v_discount_total := v_discount_total + v_disc;
        v_tax_total := v_tax_total + v_tax;
        v_grand_total := v_grand_total + v_line_total;

        v_line_item_id := gen_random_uuid();
        v_calculated_items := v_calculated_items || jsonb_build_array(jsonb_build_object(
            'id', v_line_item_id,
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
            'line_total', v_line_total
        ));
    END LOOP;

    v_invoice_year := EXTRACT(YEAR FROM COALESCE(p_invoice_date, CURRENT_DATE))::INTEGER;
    v_invoice_number := public.internal_allocate_document_number(p_org_id, 'INVOICE', v_invoice_year);
    v_invoice_id := gen_random_uuid();
    v_due_date := COALESCE(p_due_date, p_invoice_date + INTERVAL '30 days');

    -- Set local transaction flags to authorize invoice and sales order transition
    PERFORM set_config('app.authoritative_invoice_transition', 'true', true);
    PERFORM set_config('app.authoritative_order_transition', 'true', true);

    -- Insert invoice header
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
        created_by
    ) VALUES (
        v_invoice_id,
        p_org_id,
        v_invoice_number,
        p_customer_id,
        p_sales_order_id,
        v_status,
        COALESCE(p_invoice_date, CURRENT_DATE),
        v_due_date,
        v_subtotal,
        v_discount_total,
        v_tax_total,
        v_grand_total,
        0.00,
        2,
        p_notes,
        v_uid
    );

    -- Insert line items
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

    -- If invoice created from sales order, mark sales order FULFILLED
    IF p_sales_order_id IS NOT NULL THEN
        UPDATE public.sales_orders
        SET status = 'FULFILLED',
            updated_at = NOW()
        WHERE id = p_sales_order_id AND organization_id = p_org_id;

        GET DIAGNOSTICS v_so_updated_count = ROW_COUNT;
        IF v_so_updated_count != 1 THEN
            RAISE EXCEPTION 'Failed to transition sales order % to FULFILLED', p_sales_order_id;
        END IF;

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
            'FULFILL_ORDER',
            'SALES_ORDER',
            p_sales_order_id,
            jsonb_build_object(
                'invoice_id', v_invoice_id,
                'invoice_number', v_invoice_number,
                'previous_status', v_so_status,
                'new_status', 'FULFILLED'
            )
        );
    END IF;

    -- Record idempotency mapping
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

    -- Audit event
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

    RETURN jsonb_build_object(
        'id', v_invoice_id,
        'invoice_number', v_invoice_number,
        'organization_id', p_org_id,
        'customer_id', p_customer_id,
        'sales_order_id', p_sales_order_id,
        'status', v_status,
        'invoice_date', p_invoice_date,
        'due_date', v_due_date,
        'subtotal', v_subtotal,
        'discount_amount', v_discount_total,
        'tax_amount', v_tax_total,
        'total_amount', v_grand_total,
        'total_paid', 0.00,
        'totals_version', 2,
        'notes', p_notes,
        'idempotent_replay', false,
        'items', v_calculated_items
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_invoice_atomic(UUID, UUID, JSONB, DATE, DATE, VARCHAR, TEXT, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_invoice_atomic(UUID, UUID, JSONB, DATE, DATE, VARCHAR, TEXT, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_invoice_atomic(UUID, UUID, JSONB, DATE, DATE, VARCHAR, TEXT, UUID, UUID) TO service_role;

-- ----------------------------------------------------------------------------
-- 2. Authoritative create_sales_order_atomic with Robust Product-ID Normalization
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_sales_order_atomic(
    p_org_id UUID,
    p_customer_id UUID,
    p_order_date DATE DEFAULT CURRENT_DATE,
    p_items JSONB DEFAULT '[]'::JSONB,
    p_notes TEXT DEFAULT NULL,
    p_quotation_id UUID DEFAULT NULL,
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
    v_order_year INTEGER;
    v_order_number VARCHAR(100);
    v_order_id UUID;
    v_request_hash TEXT;
    v_existing_so_id UUID;
    v_existing_hash TEXT;
    v_existing_order JSONB;
    v_product_ids UUID[];
    v_locked_prod_count INTEGER;
    v_raw_camel TEXT;
    v_raw_snake TEXT;
    v_raw_id TEXT;
    v_item JSONB;
    v_calc_item JSONB;
    v_item_prod_id UUID;
    v_item_qty INTEGER;
    v_item_price NUMERIC(12, 2);
    v_item_disc_pct NUMERIC(5, 2);
    v_item_tax_rate NUMERIC(5, 2);
    v_item_name VARCHAR(255);
    v_item_sku VARCHAR(100);
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
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'unauthorized';
    END IF;

    IF p_org_id IS NULL OR p_customer_id IS NULL OR p_items IS NULL THEN
        RAISE EXCEPTION 'Invalid parameters: organization_id, customer_id, and items are required';
    END IF;

    IF jsonb_typeof(p_items) != 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Sales order must contain at least one line item';
    END IF;

    v_user_role := get_user_org_role(p_org_id);
    IF v_user_role IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Caller has no active membership in organization %', p_org_id;
    END IF;

    IF v_user_role NOT IN ('owner', 'admin', 'sales') THEN
        RAISE EXCEPTION 'Unauthorized: Caller has insufficient role (%) to create sales orders in organization %',
            v_user_role, p_org_id;
    END IF;

    IF NOT public.can_write_organization_operations(p_org_id) THEN
        RAISE EXCEPTION 'Operational write denied: Active subscription or trial required for organization %', p_org_id;
    END IF;

    v_request_hash := md5(
        p_org_id::TEXT || ':' ||
        p_customer_id::TEXT || ':' ||
        COALESCE(p_quotation_id::TEXT, '') || ':' ||
        COALESCE(p_order_date::TEXT, '') || ':' ||
        p_items::TEXT
    );

    IF p_idempotency_key IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtext('so_create:' || p_org_id::TEXT || ':' || p_idempotency_key::TEXT));

        SELECT sales_order_id, request_hash
          INTO v_existing_so_id, v_existing_hash
          FROM public.sales_order_creation_idempotency
         WHERE organization_id = p_org_id
           AND idempotency_key = p_idempotency_key;

        IF FOUND THEN
            IF v_existing_hash = v_request_hash THEN
                SELECT jsonb_build_object(
                    'id', so.id,
                    'order_number', so.order_number,
                    'organization_id', so.organization_id,
                    'customer_id', so.customer_id,
                    'quotation_id', so.quotation_id,
                    'status', so.status,
                    'order_date', so.order_date,
                    'subtotal', so.subtotal,
                    'discount_amount', so.discount_amount,
                    'tax_amount', so.tax_amount,
                    'total_amount', so.total_amount,
                    'totals_version', so.totals_version,
                    'notes', so.notes,
                    'created_at', so.created_at,
                    'updated_at', so.updated_at,
                    'idempotent_replay', true,
                    'items', COALESCE(
                        (SELECT jsonb_agg(jsonb_build_object(
                            'id', soi.id,
                            'sales_order_id', soi.sales_order_id,
                            'product_id', soi.product_id,
                            'product_name', soi.product_name,
                            'product_sku', soi.product_sku,
                            'uom', soi.uom,
                            'quantity', soi.quantity,
                            'unit_price', soi.unit_price,
                            'discount_percent', soi.discount_percent,
                            'tax_rate', soi.tax_rate,
                            'line_subtotal', soi.line_subtotal,
                            'line_tax', soi.line_tax,
                            'line_total', soi.line_total,
                            'document_discount_share', soi.document_discount_share
                        )) FROM public.sales_order_items soi WHERE soi.sales_order_id = so.id),
                        '[]'::JSONB
                    )
                ) INTO v_existing_order
                FROM public.sales_orders so
                WHERE so.id = v_existing_so_id;

                RETURN v_existing_order;
            ELSE
                RAISE EXCEPTION 'Idempotency key reused with different request parameters'
                    USING ERRCODE = 'unique_violation';
            END IF;
        END IF;
    END IF;

    -- Validate customer belongs to organization and is active
    SELECT EXISTS (
        SELECT 1 FROM public.customers
        WHERE id = p_customer_id AND organization_id = p_org_id AND is_active = TRUE
    ) INTO v_customer_exists;

    IF NOT v_customer_exists THEN
        RAISE EXCEPTION 'Customer % not found or inactive in organization %', p_customer_id, p_org_id;
    END IF;

    -- Validate quotation if specified
    IF p_quotation_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.quotations
            WHERE id = p_quotation_id AND organization_id = p_org_id
        ) THEN
            RAISE EXCEPTION 'Quotation % not found in organization %', p_quotation_id, p_org_id;
        END IF;
    END IF;

    -- Pre-flight line item normalization and identifier validation
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_item_count := v_item_count + 1;
        v_raw_camel := NULLIF(TRIM(COALESCE(v_item->>'productId', '')), '');
        v_raw_snake := NULLIF(TRIM(COALESCE(v_item->>'product_id', '')), '');

        IF v_raw_camel IS NOT NULL AND v_raw_snake IS NOT NULL AND LOWER(v_raw_camel) != LOWER(v_raw_snake) THEN
            RAISE EXCEPTION 'Ambiguous product identifier in line item %: conflicting productId (%) and product_id (%)',
                v_item_count, v_raw_camel, v_raw_snake;
        END IF;

        v_raw_id := COALESCE(v_raw_camel, v_raw_snake);

        IF v_raw_id IS NULL THEN
            RAISE EXCEPTION 'Item % is missing required product identifier (productId or product_id)', v_item_count;
        END IF;

        IF NOT (v_raw_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
            RAISE EXCEPTION 'Item % has invalid product identifier: % (valid UUID required)', v_item_count, v_raw_id;
        END IF;
    END LOOP;

    -- Collect unique, deterministically ordered product IDs (no NULLs)
    SELECT ARRAY(
        SELECT DISTINCT (COALESCE(
            NULLIF(TRIM(item->>'productId'), ''),
            NULLIF(TRIM(item->>'product_id'), '')
        ))::UUID
        FROM jsonb_array_elements(p_items) AS item
        ORDER BY 1 ASC
    ) INTO v_product_ids;

    IF v_product_ids IS NOT NULL AND array_length(v_product_ids, 1) > 0 THEN
        PERFORM p.id
        FROM public.products AS p
        WHERE p.id = ANY(v_product_ids)
          AND p.organization_id = p_org_id
        ORDER BY p.id
        FOR UPDATE;

        GET DIAGNOSTICS v_locked_prod_count = ROW_COUNT;

        IF v_locked_prod_count != array_length(v_product_ids, 1) THEN
            RAISE EXCEPTION 'One or more products in items do not belong to organization %', p_org_id;
        END IF;
    ELSE
        RAISE EXCEPTION 'One or more products in items do not belong to organization %', p_org_id;
    END IF;

    -- Reset counter and compute line items
    v_item_count := 0;
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_item_count := v_item_count + 1;
        v_item_prod_id := (COALESCE(
            NULLIF(TRIM(v_item->>'productId'), ''),
            NULLIF(TRIM(v_item->>'product_id'), '')
        ))::UUID;

        v_item_qty := COALESCE((v_item->>'quantity')::INTEGER, 0);
        IF v_item_qty <= 0 THEN
            RAISE EXCEPTION 'Item % has invalid quantity: % (must be >= 1)', v_item_count, v_item_qty;
        END IF;

        SELECT id, name, sku, uom, selling_price, tax_rate, is_active
          INTO v_prod
          FROM public.products
         WHERE id = v_item_prod_id AND organization_id = p_org_id;

        IF NOT FOUND OR NOT v_prod.is_active THEN
            RAISE EXCEPTION 'Product % is not found or inactive in organization %', v_item_prod_id, p_org_id;
        END IF;

        v_item_price := COALESCE(
            (v_item->>'unitPrice')::NUMERIC(12, 2),
            (v_item->>'unit_price')::NUMERIC(12, 2),
            v_prod.selling_price
        );
        IF v_item_price < 0 THEN
            RAISE EXCEPTION 'Item % has invalid unit_price: % (must be >= 0)', v_item_count, v_item_price;
        END IF;

        v_item_disc_pct := COALESCE(
            (v_item->>'discountPercent')::NUMERIC(5, 2),
            (v_item->>'discount_percent')::NUMERIC(5, 2),
            0.00
        );
        IF v_item_disc_pct < 0 OR v_item_disc_pct > 100 THEN
            RAISE EXCEPTION 'Item % has invalid discount_percent: % (must be between 0 and 100)', v_item_count, v_item_disc_pct;
        END IF;

        v_item_tax_rate := COALESCE(
            (v_item->>'taxRate')::NUMERIC(5, 2),
            (v_item->>'tax_rate')::NUMERIC(5, 2),
            v_prod.tax_rate
        );
        IF v_item_tax_rate < 0 THEN
            RAISE EXCEPTION 'Item % has invalid tax_rate: % (must be >= 0)', v_item_count, v_item_tax_rate;
        END IF;

        v_item_name := COALESCE(v_item->>'productName', v_item->>'product_name', v_prod.name);
        v_item_sku := COALESCE(v_item->>'productSku', v_item->>'product_sku', v_prod.sku);
        v_item_uom := COALESCE(v_item->>'uom', v_prod.uom);

        v_gross := ROUND(v_item_qty * v_item_price, 2);
        v_disc := ROUND(v_gross * (v_item_disc_pct / 100.0), 2);
        v_taxable := v_gross - v_disc;
        v_tax := ROUND(v_taxable * (v_item_tax_rate / 100.0), 2);
        v_line_total := v_taxable + v_tax;

        v_subtotal := v_subtotal + v_gross;
        v_discount_total := v_discount_total + v_disc;
        v_tax_total := v_tax_total + v_tax;
        v_grand_total := v_grand_total + v_line_total;

        v_line_item_id := gen_random_uuid();
        v_calculated_items := v_calculated_items || jsonb_build_array(jsonb_build_object(
            'id', v_line_item_id,
            'product_id', v_item_prod_id,
            'product_name', v_item_name,
            'product_sku', v_item_sku,
            'uom', v_item_uom,
            'quantity', v_item_qty,
            'unit_price', v_item_price,
            'discount_percent', v_item_disc_pct,
            'tax_rate', v_item_tax_rate,
            'line_subtotal', v_taxable,
            'line_tax', v_tax,
            'line_total', v_line_total
        ));
    END LOOP;

    v_order_year := EXTRACT(YEAR FROM COALESCE(p_order_date, CURRENT_DATE))::INTEGER;
    v_order_number := public.internal_allocate_document_number(p_org_id, 'SALES_ORDER', v_order_year);
    v_order_id := gen_random_uuid();

    -- Set local transaction flag to authorize order creation under DRAFT status
    PERFORM set_config('app.authoritative_order_transition', 'true', true);

    INSERT INTO public.sales_orders (
        id,
        organization_id,
        order_number,
        customer_id,
        quotation_id,
        status,
        order_date,
        subtotal,
        discount_amount,
        tax_amount,
        total_amount,
        totals_version,
        notes,
        created_by
    ) VALUES (
        v_order_id,
        p_org_id,
        v_order_number,
        p_customer_id,
        p_quotation_id,
        'DRAFT',
        COALESCE(p_order_date, CURRENT_DATE),
        v_subtotal,
        v_discount_total,
        v_tax_total,
        v_grand_total,
        2,
        p_notes,
        v_uid
    );

    FOR v_calc_item IN SELECT * FROM jsonb_array_elements(v_calculated_items)
    LOOP
        INSERT INTO public.sales_order_items (
            id,
            sales_order_id,
            product_id,
            product_name,
            product_sku,
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
            v_order_id,
            (v_calc_item->>'product_id')::UUID,
            v_calc_item->>'product_name',
            v_calc_item->>'product_sku',
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

    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO public.sales_order_creation_idempotency (
            organization_id,
            idempotency_key,
            user_id,
            sales_order_id,
            request_hash
        ) VALUES (
            p_org_id,
            p_idempotency_key,
            v_uid,
            v_order_id,
            v_request_hash
        );
    END IF;

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
        'CREATE_SALES_ORDER',
        'SALES_ORDER',
        v_order_id,
        jsonb_build_object(
            'order_number', v_order_number,
            'status', 'DRAFT',
            'customer_id', p_customer_id,
            'quotation_id', p_quotation_id,
            'total_amount', v_grand_total,
            'item_count', v_item_count
        )
    );

    RETURN jsonb_build_object(
        'id', v_order_id,
        'order_number', v_order_number,
        'organization_id', p_org_id,
        'customer_id', p_customer_id,
        'quotation_id', p_quotation_id,
        'status', 'DRAFT',
        'order_date', p_order_date,
        'subtotal', v_subtotal,
        'discount_amount', v_discount_total,
        'tax_amount', v_tax_total,
        'total_amount', v_grand_total,
        'totals_version', 2,
        'notes', p_notes,
        'idempotent_replay', false,
        'items', v_calculated_items
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_sales_order_atomic(UUID, UUID, DATE, JSONB, TEXT, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sales_order_atomic(UUID, UUID, DATE, JSONB, TEXT, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_sales_order_atomic(UUID, UUID, DATE, JSONB, TEXT, UUID, UUID) TO service_role;

-- ----------------------------------------------------------------------------
-- 3. Authoritative create_quotation_atomic with Robust Product-ID Normalization
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_quotation_atomic(
    p_org_id UUID,
    p_customer_id UUID,
    p_valid_until DATE DEFAULT CURRENT_DATE + INTERVAL '30 days',
    p_items JSONB DEFAULT '[]'::JSONB,
    p_notes TEXT DEFAULT NULL,
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
    v_quot_year INTEGER;
    v_quot_number VARCHAR(100);
    v_quot_id UUID;
    v_valid_until DATE;
    v_request_hash TEXT;
    v_existing_q_id UUID;
    v_existing_hash TEXT;
    v_existing_quot JSONB;
    v_product_ids UUID[];
    v_locked_prod_count INTEGER;
    v_raw_camel TEXT;
    v_raw_snake TEXT;
    v_raw_id TEXT;
    v_item JSONB;
    v_calc_item JSONB;
    v_item_prod_id UUID;
    v_item_qty INTEGER;
    v_item_price NUMERIC(12, 2);
    v_item_disc_pct NUMERIC(5, 2);
    v_item_tax_rate NUMERIC(5, 2);
    v_item_name VARCHAR(255);
    v_item_sku VARCHAR(100);
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
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'unauthorized';
    END IF;

    IF p_org_id IS NULL OR p_customer_id IS NULL OR p_items IS NULL THEN
        RAISE EXCEPTION 'Invalid parameters: organization_id, customer_id, and items are required';
    END IF;

    IF jsonb_typeof(p_items) != 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Quotation must contain at least one line item';
    END IF;

    v_user_role := get_user_org_role(p_org_id);
    IF v_user_role IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Caller has no active membership in organization %', p_org_id;
    END IF;

    IF v_user_role NOT IN ('owner', 'admin', 'sales') THEN
        RAISE EXCEPTION 'Unauthorized: Caller has insufficient role (%) to create quotations in organization %',
            v_user_role, p_org_id;
    END IF;

    IF NOT public.can_write_organization_operations(p_org_id) THEN
        RAISE EXCEPTION 'Operational write denied: Active subscription or trial required for organization %', p_org_id;
    END IF;

    v_request_hash := md5(
        p_org_id::TEXT || ':' ||
        p_customer_id::TEXT || ':' ||
        COALESCE(p_valid_until::TEXT, '') || ':' ||
        p_items::TEXT
    );

    IF p_idempotency_key IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtext('quot_create:' || p_org_id::TEXT || ':' || p_idempotency_key::TEXT));

        SELECT quotation_id, request_hash
          INTO v_existing_q_id, v_existing_hash
          FROM public.quotation_creation_idempotency
         WHERE organization_id = p_org_id
           AND idempotency_key = p_idempotency_key;

        IF FOUND THEN
            IF v_existing_hash = v_request_hash THEN
                SELECT jsonb_build_object(
                    'id', q.id,
                    'quotation_number', q.quotation_number,
                    'organization_id', q.organization_id,
                    'customer_id', q.customer_id,
                    'status', q.status,
                    'valid_until', q.valid_until,
                    'subtotal', q.subtotal,
                    'discount_amount', q.discount_amount,
                    'tax_amount', q.tax_amount,
                    'total_amount', q.total_amount,
                    'totals_version', q.totals_version,
                    'notes', q.notes,
                    'created_at', q.created_at,
                    'updated_at', q.updated_at,
                    'idempotent_replay', true,
                    'items', COALESCE(
                        (SELECT jsonb_agg(jsonb_build_object(
                            'id', qi.id,
                            'quotation_id', qi.quotation_id,
                            'product_id', qi.product_id,
                            'product_name', qi.product_name,
                            'product_sku', qi.product_sku,
                            'uom', qi.uom,
                            'quantity', qi.quantity,
                            'unit_price', qi.unit_price,
                            'discount_percent', qi.discount_percent,
                            'tax_rate', qi.tax_rate,
                            'line_subtotal', qi.line_subtotal,
                            'line_tax', qi.line_tax,
                            'line_total', qi.line_total,
                            'document_discount_share', qi.document_discount_share
                        )) FROM public.quotation_items qi WHERE qi.quotation_id = q.id),
                        '[]'::JSONB
                    )
                ) INTO v_existing_quot
                FROM public.quotations q
                WHERE q.id = v_existing_q_id;

                RETURN v_existing_quot;
            ELSE
                RAISE EXCEPTION 'Idempotency key reused with different request parameters'
                    USING ERRCODE = 'unique_violation';
            END IF;
        END IF;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.customers
        WHERE id = p_customer_id AND organization_id = p_org_id AND is_active = TRUE
    ) INTO v_customer_exists;

    IF NOT v_customer_exists THEN
        RAISE EXCEPTION 'Customer % not found or inactive in organization %', p_customer_id, p_org_id;
    END IF;

    -- Pre-flight line item normalization and identifier validation
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_item_count := v_item_count + 1;
        v_raw_camel := NULLIF(TRIM(COALESCE(v_item->>'productId', '')), '');
        v_raw_snake := NULLIF(TRIM(COALESCE(v_item->>'product_id', '')), '');

        IF v_raw_camel IS NOT NULL AND v_raw_snake IS NOT NULL AND LOWER(v_raw_camel) != LOWER(v_raw_snake) THEN
            RAISE EXCEPTION 'Ambiguous product identifier in line item %: conflicting productId (%) and product_id (%)',
                v_item_count, v_raw_camel, v_raw_snake;
        END IF;

        v_raw_id := COALESCE(v_raw_camel, v_raw_snake);

        IF v_raw_id IS NULL THEN
            RAISE EXCEPTION 'Item % is missing required product identifier (productId or product_id)', v_item_count;
        END IF;

        IF NOT (v_raw_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
            RAISE EXCEPTION 'Item % has invalid product identifier: % (valid UUID required)', v_item_count, v_raw_id;
        END IF;
    END LOOP;

    -- Collect unique, deterministically ordered product IDs (no NULLs)
    SELECT ARRAY(
        SELECT DISTINCT (COALESCE(
            NULLIF(TRIM(item->>'productId'), ''),
            NULLIF(TRIM(item->>'product_id'), '')
        ))::UUID
        FROM jsonb_array_elements(p_items) AS item
        ORDER BY 1 ASC
    ) INTO v_product_ids;

    IF v_product_ids IS NOT NULL AND array_length(v_product_ids, 1) > 0 THEN
        PERFORM p.id
        FROM public.products AS p
        WHERE p.id = ANY(v_product_ids)
          AND p.organization_id = p_org_id
        ORDER BY p.id
        FOR UPDATE;

        GET DIAGNOSTICS v_locked_prod_count = ROW_COUNT;

        IF v_locked_prod_count != array_length(v_product_ids, 1) THEN
            RAISE EXCEPTION 'One or more products in items do not belong to organization %', p_org_id;
        END IF;
    ELSE
        RAISE EXCEPTION 'One or more products in items do not belong to organization %', p_org_id;
    END IF;

    -- Reset counter and compute line items
    v_item_count := 0;
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_item_count := v_item_count + 1;
        v_item_prod_id := (COALESCE(
            NULLIF(TRIM(v_item->>'productId'), ''),
            NULLIF(TRIM(v_item->>'product_id'), '')
        ))::UUID;

        v_item_qty := COALESCE((v_item->>'quantity')::INTEGER, 0);
        IF v_item_qty <= 0 THEN
            RAISE EXCEPTION 'Item % has invalid quantity: % (must be >= 1)', v_item_count, v_item_qty;
        END IF;

        SELECT id, name, sku, uom, selling_price, tax_rate, is_active
          INTO v_prod
          FROM public.products
         WHERE id = v_item_prod_id AND organization_id = p_org_id;

        IF NOT FOUND OR NOT v_prod.is_active THEN
            RAISE EXCEPTION 'Product % is not found or inactive in organization %', v_item_prod_id, p_org_id;
        END IF;

        v_item_price := COALESCE(
            (v_item->>'unitPrice')::NUMERIC(12, 2),
            (v_item->>'unit_price')::NUMERIC(12, 2),
            v_prod.selling_price
        );
        IF v_item_price < 0 THEN
            RAISE EXCEPTION 'Item % has invalid unit_price: % (must be >= 0)', v_item_count, v_item_price;
        END IF;

        v_item_disc_pct := COALESCE(
            (v_item->>'discountPercent')::NUMERIC(5, 2),
            (v_item->>'discount_percent')::NUMERIC(5, 2),
            0.00
        );
        IF v_item_disc_pct < 0 OR v_item_disc_pct > 100 THEN
            RAISE EXCEPTION 'Item % has invalid discount_percent: % (must be between 0 and 100)', v_item_count, v_item_disc_pct;
        END IF;

        v_item_tax_rate := COALESCE(
            (v_item->>'taxRate')::NUMERIC(5, 2),
            (v_item->>'tax_rate')::NUMERIC(5, 2),
            v_prod.tax_rate
        );
        IF v_item_tax_rate < 0 THEN
            RAISE EXCEPTION 'Item % has invalid tax_rate: % (must be >= 0)', v_item_count, v_item_tax_rate;
        END IF;

        v_item_name := COALESCE(v_item->>'productName', v_item->>'product_name', v_prod.name);
        v_item_sku := COALESCE(v_item->>'productSku', v_item->>'product_sku', v_prod.sku);
        v_item_uom := COALESCE(v_item->>'uom', v_prod.uom);

        v_gross := ROUND(v_item_qty * v_item_price, 2);
        v_disc := ROUND(v_gross * (v_item_disc_pct / 100.0), 2);
        v_taxable := v_gross - v_disc;
        v_tax := ROUND(v_taxable * (v_item_tax_rate / 100.0), 2);
        v_line_total := v_taxable + v_tax;

        v_subtotal := v_subtotal + v_gross;
        v_discount_total := v_discount_total + v_disc;
        v_tax_total := v_tax_total + v_tax;
        v_grand_total := v_grand_total + v_line_total;

        v_line_item_id := gen_random_uuid();
        v_calculated_items := v_calculated_items || jsonb_build_array(jsonb_build_object(
            'id', v_line_item_id,
            'product_id', v_item_prod_id,
            'product_name', v_item_name,
            'product_sku', v_item_sku,
            'uom', v_item_uom,
            'quantity', v_item_qty,
            'unit_price', v_item_price,
            'discount_percent', v_item_disc_pct,
            'tax_rate', v_item_tax_rate,
            'line_subtotal', v_taxable,
            'line_tax', v_tax,
            'line_total', v_line_total
        ));
    END LOOP;

    v_quot_year := EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER;
    v_quot_number := public.internal_allocate_document_number(p_org_id, 'QUOTATION', v_quot_year);
    v_quot_id := gen_random_uuid();
    v_valid_until := COALESCE(p_valid_until, CURRENT_DATE + INTERVAL '30 days');

    INSERT INTO public.quotations (
        id,
        organization_id,
        quotation_number,
        customer_id,
        status,
        valid_until,
        subtotal,
        discount_amount,
        tax_amount,
        total_amount,
        totals_version,
        notes,
        created_by
    ) VALUES (
        v_quot_id,
        p_org_id,
        v_quot_number,
        p_customer_id,
        'DRAFT',
        v_valid_until,
        v_subtotal,
        v_discount_total,
        v_tax_total,
        v_grand_total,
        2,
        p_notes,
        v_uid
    );

    FOR v_calc_item IN SELECT * FROM jsonb_array_elements(v_calculated_items)
    LOOP
        INSERT INTO public.quotation_items (
            id,
            quotation_id,
            product_id,
            product_name,
            product_sku,
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
            v_quot_id,
            (v_calc_item->>'product_id')::UUID,
            v_calc_item->>'product_name',
            v_calc_item->>'product_sku',
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

    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO public.quotation_creation_idempotency (
            organization_id,
            idempotency_key,
            user_id,
            quotation_id,
            request_hash
        ) VALUES (
            p_org_id,
            p_idempotency_key,
            v_uid,
            v_quot_id,
            v_request_hash
        );
    END IF;

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
        'CREATE_QUOTATION',
        'QUOTATION',
        v_quot_id,
        jsonb_build_object(
            'quotation_number', v_quot_number,
            'status', 'DRAFT',
            'customer_id', p_customer_id,
            'total_amount', v_grand_total,
            'item_count', v_item_count
        )
    );

    RETURN jsonb_build_object(
        'id', v_quot_id,
        'quotation_number', v_quot_number,
        'organization_id', p_org_id,
        'customer_id', p_customer_id,
        'status', 'DRAFT',
        'valid_until', v_valid_until,
        'subtotal', v_subtotal,
        'discount_amount', v_discount_total,
        'tax_amount', v_tax_total,
        'total_amount', v_grand_total,
        'totals_version', 2,
        'notes', p_notes,
        'idempotent_replay', false,
        'items', v_calculated_items
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_quotation_atomic(UUID, UUID, DATE, JSONB, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_quotation_atomic(UUID, UUID, DATE, JSONB, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_quotation_atomic(UUID, UUID, DATE, JSONB, TEXT, UUID) TO service_role;


-- ----------------------------------------------------------------------------
-- 4. Authoritative record_payment_and_allocate Matching payment_allocations Schema
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_payment_and_allocate(
    p_org_id UUID,
    p_customer_id UUID,
    p_amount NUMERIC(12, 2),
    p_payment_method VARCHAR,
    p_reference_no VARCHAR,
    p_payment_date DATE,
    p_notes TEXT,
    p_invoice_id UUID,
    p_allocated_amount NUMERIC(12, 2),
    p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_role VARCHAR(50);
    v_customer_exists BOOLEAN;
    v_payment_id UUID;
    v_inv RECORD;
    v_new_paid NUMERIC(12, 2);
    v_new_status VARCHAR(50);
    v_payment_num VARCHAR(100);
    v_uid UUID;
    v_payment_year INTEGER;
    v_request_hash TEXT;
    v_existing_pay_id UUID;
    v_existing_hash TEXT;
    v_existing_payment JSONB;
BEGIN
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF p_org_id IS NULL OR p_customer_id IS NULL OR p_amount IS NULL OR p_payment_method IS NULL THEN
        RAISE EXCEPTION 'Invalid parameters: organization_id, customer_id, amount, and payment_method are required';
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Payment amount must be greater than zero (received %)', p_amount;
    END IF;

    IF p_payment_method NOT IN ('CASH', 'UPI', 'NEFT', 'RTGS', 'CHEQUE', 'BANK_TRANSFER') THEN
        RAISE EXCEPTION 'Invalid payment method: %. Allowed methods: CASH, UPI, NEFT, RTGS, CHEQUE, BANK_TRANSFER', p_payment_method;
    END IF;

    v_user_role := get_user_org_role(p_org_id);
    IF v_user_role IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Caller has no active membership in organization %', p_org_id;
    END IF;

    IF v_user_role NOT IN ('owner', 'admin', 'accounts') THEN
        RAISE EXCEPTION 'Unauthorized: Caller has insufficient role (%) to record payments in organization %',
            v_user_role, p_org_id;
    END IF;

    IF NOT public.can_write_organization_operations(p_org_id) THEN
        RAISE EXCEPTION 'Operational write denied: Active subscription or trial required for organization %', p_org_id;
    END IF;

    -- Compute request fingerprint
    v_request_hash := md5(
        p_org_id::TEXT || ':' ||
        p_customer_id::TEXT || ':' ||
        p_amount::TEXT || ':' ||
        p_payment_method || ':' ||
        COALESCE(p_reference_no, '') || ':' ||
        COALESCE(p_payment_date::TEXT, '') || ':' ||
        COALESCE(p_invoice_id::TEXT, '') || ':' ||
        COALESCE(p_allocated_amount::TEXT, '')
    );

    -- Idempotency check with transaction-level advisory lock
    IF p_idempotency_key IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtext('payment:' || p_org_id::TEXT || ':' || p_idempotency_key::TEXT));

        SELECT payment_id, request_hash
          INTO v_existing_pay_id, v_existing_hash
          FROM public.payment_idempotency
         WHERE organization_id = p_org_id
           AND idempotency_key = p_idempotency_key;

        IF FOUND THEN
            IF v_existing_hash = v_request_hash THEN
                SELECT jsonb_build_object(
                    'success', true,
                    'payment_id', p.id,
                    'payment_number', p.payment_number,
                    'amount', p.amount,
                    'customer_id', p.customer_id,
                    'payment_date', p.payment_date,
                    'payment_method', p.payment_method,
                    'reference_number', p.reference_number,
                    'idempotent_replay', true,
                    'allocations', COALESCE(
                        (SELECT jsonb_agg(jsonb_build_object(
                            'id', pa.id,
                            'invoice_id', pa.invoice_id,
                            'amount_allocated', pa.amount_allocated
                        )) FROM public.payment_allocations pa WHERE pa.payment_id = p.id),
                        '[]'::JSONB
                    )
                ) INTO v_existing_payment
                FROM public.payments p
                WHERE p.id = v_existing_pay_id;

                RETURN v_existing_payment;
            ELSE
                RAISE EXCEPTION 'Idempotency key reused with different request parameters'
                    USING ERRCODE = 'unique_violation';
            END IF;
        END IF;
    END IF;

    -- Tenant verification: Customer must belong to p_org_id
    SELECT EXISTS (
        SELECT 1 FROM public.customers
        WHERE id = p_customer_id AND organization_id = p_org_id AND is_active = TRUE
    ) INTO v_customer_exists;

    IF NOT v_customer_exists THEN
        RAISE EXCEPTION 'Customer % not found or inactive in organization %', p_customer_id, p_org_id;
    END IF;

    -- Validate allocation bounds if invoice specified
    IF p_invoice_id IS NOT NULL THEN
        IF p_allocated_amount IS NULL OR p_allocated_amount <= 0 THEN
            RAISE EXCEPTION 'Allocated amount must be greater than zero when invoice is specified';
        END IF;

        IF p_allocated_amount > p_amount THEN
            RAISE EXCEPTION 'Allocated amount (%) cannot exceed total payment amount (%)', p_allocated_amount, p_amount;
        END IF;
    ELSE
        IF p_allocated_amount IS NOT NULL AND p_allocated_amount > 0 THEN
            RAISE EXCEPTION 'Cannot allocate amount (%) without specifying an invoice_id', p_allocated_amount;
        END IF;
    END IF;

    -- Allocate receipt number
    v_payment_year := EXTRACT(YEAR FROM COALESCE(p_payment_date, CURRENT_DATE))::INTEGER;
    v_payment_num := public.internal_allocate_document_number(p_org_id, 'RECEIPT', v_payment_year);
    v_payment_id := gen_random_uuid();

    -- Set local transaction flags for payment allocation & invoice update
    PERFORM set_config('app.authoritative_payment_allocation', 'true', true);
    PERFORM set_config('app.authoritative_invoice_transition', 'true', true);

    INSERT INTO public.payments (
        id,
        organization_id,
        payment_number,
        customer_id,
        amount,
        payment_method,
        reference_number,
        payment_date,
        notes,
        created_by
    ) VALUES (
        v_payment_id,
        p_org_id,
        v_payment_num,
        p_customer_id,
        p_amount,
        p_payment_method,
        p_reference_no,
        COALESCE(p_payment_date, CURRENT_DATE),
        p_notes,
        v_uid
    );

    IF p_invoice_id IS NOT NULL THEN
        SELECT id, customer_id, total_amount, total_paid, status
        INTO v_inv
        FROM public.invoices
        WHERE id = p_invoice_id AND organization_id = p_org_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Invoice % not found in organization %', p_invoice_id, p_org_id;
        END IF;

        IF v_inv.status = 'CANCELLED' THEN
            RAISE EXCEPTION 'Cannot allocate payment to cancelled invoice %', p_invoice_id;
        END IF;

        IF v_inv.customer_id != p_customer_id THEN
            RAISE EXCEPTION 'Customer mismatch: Payment customer % does not match invoice customer %',
                p_customer_id, v_inv.customer_id;
        END IF;

        IF (v_inv.total_paid + p_allocated_amount) > v_inv.total_amount THEN
            RAISE EXCEPTION 'Overpayment violation: Allocation of % exceeds remaining balance of % (Total: %, Paid: %) on invoice %',
                p_allocated_amount, (v_inv.total_amount - v_inv.total_paid), v_inv.total_amount, v_inv.total_paid, p_invoice_id;
        END IF;

        v_new_paid := v_inv.total_paid + p_allocated_amount;
        IF v_new_paid >= v_inv.total_amount THEN
            v_new_status := 'PAID';
        ELSE
            v_new_status := 'PARTIALLY_PAID';
        END IF;

        UPDATE public.invoices
        SET total_paid = v_new_paid,
            status = v_new_status,
            updated_at = NOW()
        WHERE id = p_invoice_id AND organization_id = p_org_id;

        INSERT INTO public.payment_allocations (
            payment_id,
            invoice_id,
            amount_allocated
        ) VALUES (
            v_payment_id,
            p_invoice_id,
            p_allocated_amount
        );
    END IF;

    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO public.payment_idempotency (
            organization_id,
            idempotency_key,
            user_id,
            payment_id,
            request_hash
        ) VALUES (
            p_org_id,
            p_idempotency_key,
            v_uid,
            v_payment_id,
            v_request_hash
        );
    END IF;

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
        'RECORD_PAYMENT',
        'PAYMENT',
        v_payment_id,
        jsonb_build_object(
            'payment_number', v_payment_num,
            'amount', p_amount,
            'customer_id', p_customer_id,
            'invoice_id', p_invoice_id,
            'allocated_amount', p_allocated_amount
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'payment_id', v_payment_id,
        'payment_number', v_payment_num,
        'amount', p_amount,
        'customer_id', p_customer_id,
        'payment_date', COALESCE(p_payment_date, CURRENT_DATE),
        'payment_method', p_payment_method,
        'reference_number', p_reference_no,
        'idempotent_replay', false
    );
END;
$$;

-- Overload for backwards compatibility (9 parameters)
CREATE OR REPLACE FUNCTION public.record_payment_and_allocate(
    p_org_id UUID,
    p_customer_id UUID,
    p_amount NUMERIC(12, 2),
    p_payment_method VARCHAR,
    p_reference_no VARCHAR,
    p_payment_date DATE,
    p_notes TEXT,
    p_invoice_id UUID,
    p_allocated_amount NUMERIC(12, 2)
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN public.record_payment_and_allocate(
        p_org_id,
        p_customer_id,
        p_amount,
        p_payment_method,
        p_reference_no,
        p_payment_date,
        p_notes,
        p_invoice_id,
        p_allocated_amount,
        NULL::UUID
    );
END;
$$;

REVOKE ALL ON FUNCTION public.record_payment_and_allocate(UUID, UUID, NUMERIC, VARCHAR, VARCHAR, DATE, TEXT, UUID, NUMERIC, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_payment_and_allocate(UUID, UUID, NUMERIC, VARCHAR, VARCHAR, DATE, TEXT, UUID, NUMERIC, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_payment_and_allocate(UUID, UUID, NUMERIC, VARCHAR, VARCHAR, DATE, TEXT, UUID, NUMERIC, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.record_payment_and_allocate(UUID, UUID, NUMERIC, VARCHAR, VARCHAR, DATE, TEXT, UUID, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_payment_and_allocate(UUID, UUID, NUMERIC, VARCHAR, VARCHAR, DATE, TEXT, UUID, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_payment_and_allocate(UUID, UUID, NUMERIC, VARCHAR, VARCHAR, DATE, TEXT, UUID, NUMERIC) TO service_role;
