-- ============================================================================
-- MIGRATION 027: Fix Atomic Document Product Locking
-- ============================================================================
-- Purpose:
-- 1. Resolves PostgreSQL syntax error: "FOR UPDATE is not allowed with aggregate functions"
--    in `create_invoice_atomic`, `create_sales_order_atomic`, and `create_quotation_atomic`.
-- 2. Migration 024 used:
--      SELECT COUNT(*) INTO v_locked_prod_count
--      FROM public.products
--      WHERE id = ANY(v_product_ids) AND organization_id = p_org_id
--      FOR UPDATE;
--    which PostgreSQL rejects because row-level locks (FOR UPDATE) cannot be applied
--    to aggregate query projections.
-- 3. Replaces this pattern with deterministic row-level locking ordered by product ID:
--      PERFORM p.id
--      FROM public.products AS p
--      WHERE p.id = ANY(v_product_ids)
--        AND p.organization_id = p_org_id
--      ORDER BY p.id
--      FOR UPDATE;
--      GET DIAGNOSTICS v_locked_prod_count = ROW_COUNT;
-- 4. Preserves all existing RPC signatures, authorization logic, security context,
--    function grants, idempotency checks, document-number allocation, and financial totals.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Authoritative create_invoice_atomic with Deterministic Product Row Locking
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
        RAISE EXCEPTION 'Invalid invoice status: %. Must be DRAFT or ISSUED.', p_status;
    END IF;

    v_user_role := get_user_org_role(p_org_id);
    IF v_user_role IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Caller has no active membership in organization %', p_org_id;
    END IF;

    IF v_user_role NOT IN ('owner', 'admin', 'accounts') THEN
        RAISE EXCEPTION 'Unauthorized: Caller has insufficient role (%) to create invoices in organization %',
            v_user_role, p_org_id;
    END IF;

    IF NOT public.can_write_organization_operations(p_org_id) THEN
        RAISE EXCEPTION 'Operational write denied: Active subscription or trial required for organization %', p_org_id;
    END IF;

    -- Compute request hash for idempotency comparison
    v_request_hash := md5(
        p_org_id::TEXT || ':' ||
        p_customer_id::TEXT || ':' ||
        COALESCE(p_sales_order_id::TEXT, '') || ':' ||
        COALESCE(p_invoice_date::TEXT, '') || ':' ||
        v_status || ':' ||
        p_items::TEXT
    );

    IF p_idempotency_key IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtext('inv:' || p_org_id::TEXT || ':' || p_idempotency_key::TEXT));

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

    -- Collect and lock products in ascending ID order (deterministic deadlock avoidance)
    SELECT array_agg(DISTINCT (item->>'productId')::UUID ORDER BY (item->>'productId')::UUID ASC)
    INTO v_product_ids
    FROM jsonb_array_elements(p_items) AS item;

    IF v_product_ids IS NULL OR array_length(v_product_ids, 1) = 0 THEN
        SELECT array_agg(DISTINCT (item->>'product_id')::UUID ORDER BY (item->>'product_id')::UUID ASC)
        INTO v_product_ids
        FROM jsonb_array_elements(p_items) AS item;
    END IF;

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
    ELSIF jsonb_typeof(p_items) = 'array' AND jsonb_array_length(p_items) > 0 THEN
        RAISE EXCEPTION 'One or more products in items do not belong to organization %', p_org_id;
    END IF;

    -- In-memory calculation of line items
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_item_count := v_item_count + 1;
        v_item_prod_id := COALESCE(
            (v_item->>'productId')::UUID,
            (v_item->>'product_id')::UUID
        );
        IF v_item_prod_id IS NULL THEN
            RAISE EXCEPTION 'Item % is missing required productId', v_item_count;
        END IF;

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
        'DRAFT',
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

    -- Update to ISSUED if requested
    IF v_status = 'ISSUED' THEN
        UPDATE public.invoices
           SET status = 'ISSUED',
               updated_at = NOW()
         WHERE id = v_invoice_id;
    END IF;

    -- Update sales order to FULFILLED
    IF p_sales_order_id IS NOT NULL THEN
        UPDATE public.sales_orders
           SET status = 'FULFILLED',
               updated_at = NOW()
         WHERE id = p_sales_order_id
           AND organization_id = p_org_id;

        GET DIAGNOSTICS v_so_updated_count = ROW_COUNT;
        IF v_so_updated_count != 1 THEN
            RAISE EXCEPTION 'Failed to update sales order % status to FULFILLED', p_sales_order_id;
        END IF;
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
-- 2. Authoritative create_sales_order_atomic with Deterministic Product Row Locking
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

    -- Collect and lock products in ascending ID order (deterministic deadlock avoidance)
    SELECT array_agg(DISTINCT (item->>'productId')::UUID ORDER BY (item->>'productId')::UUID ASC)
    INTO v_product_ids
    FROM jsonb_array_elements(p_items) AS item;

    IF v_product_ids IS NULL OR array_length(v_product_ids, 1) = 0 THEN
        SELECT array_agg(DISTINCT (item->>'product_id')::UUID ORDER BY (item->>'product_id')::UUID ASC)
        INTO v_product_ids
        FROM jsonb_array_elements(p_items) AS item;
    END IF;

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
    ELSIF jsonb_typeof(p_items) = 'array' AND jsonb_array_length(p_items) > 0 THEN
        RAISE EXCEPTION 'One or more products in items do not belong to organization %', p_org_id;
    END IF;

    -- Compute line item calculations
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_item_count := v_item_count + 1;
        v_item_prod_id := COALESCE(
            (v_item->>'productId')::UUID,
            (v_item->>'product_id')::UUID
        );
        IF v_item_prod_id IS NULL THEN
            RAISE EXCEPTION 'Item % is missing required productId', v_item_count;
        END IF;

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

    -- Set local transaction flag to authorize insertion
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
        'order_date', COALESCE(p_order_date, CURRENT_DATE),
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
-- 3. Authoritative create_quotation_atomic with Deterministic Product Row Locking
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_quotation_atomic(
    p_org_id UUID,
    p_customer_id UUID,
    p_valid_until DATE,
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
    v_request_hash TEXT;
    v_existing_q_id UUID;
    v_existing_hash TEXT;
    v_existing_quot JSONB;
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

    -- Collect and lock products in ascending ID order (deterministic deadlock avoidance)
    SELECT array_agg(DISTINCT (item->>'productId')::UUID ORDER BY (item->>'productId')::UUID ASC)
    INTO v_product_ids
    FROM jsonb_array_elements(p_items) AS item;

    IF v_product_ids IS NULL OR array_length(v_product_ids, 1) = 0 THEN
        SELECT array_agg(DISTINCT (item->>'product_id')::UUID ORDER BY (item->>'product_id')::UUID ASC)
        INTO v_product_ids
        FROM jsonb_array_elements(p_items) AS item;
    END IF;

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
    ELSIF jsonb_typeof(p_items) = 'array' AND jsonb_array_length(p_items) > 0 THEN
        RAISE EXCEPTION 'One or more products in items do not belong to organization %', p_org_id;
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_item_count := v_item_count + 1;
        v_item_prod_id := COALESCE(
            (v_item->>'productId')::UUID,
            (v_item->>'product_id')::UUID
        );
        IF v_item_prod_id IS NULL THEN
            RAISE EXCEPTION 'Item % is missing required productId', v_item_count;
        END IF;

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
        COALESCE(p_valid_until, CURRENT_DATE + INTERVAL '15 days'),
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
        'valid_until', COALESCE(p_valid_until, CURRENT_DATE + INTERVAL '15 days'),
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
