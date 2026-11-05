-- ============================================================================
-- MIGRATION 036: Ledger Reconciliation, Workflow Consistency & Financial Reliability
-- ============================================================================
-- 1. Hardens public.create_invoice_atomic:
--    - Strictly enforces explicit statutory tax rates (0, 5, 12, 18, 28%) on final invoice issuance
--    - Independent PostgreSQL check_violation rejection when issued invoice line items omit or have invalid tax rates
--    - Preserves non-blocking draft creation without premature tax rate enforcement
-- 2. Introduces public.get_eligible_payment_invoices:
--    - Scalable server-side search and lookup for eligible unpaid invoices for a specific customer
--    - Strictly filters status IN ('ISSUED', 'PARTIALLY_PAID') and (total_amount - total_paid) > 0
--    - Bounded pagination with support for exact invoice retention
-- 3. Financial Reconciliation Indexes:
--    - Covering index on invoices (organization_id, customer_id, status, due_date)
--    - Covering index on payment_allocations (invoice_id)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Authoritative create_invoice_atomic with Statutory Tax Rate Enforcement
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

        -- Strict statutory tax rate verification on final invoice issuance
        IF v_status = 'ISSUED' THEN
            IF v_item_tax_rate IS NULL OR v_item_tax_rate NOT IN (0.00, 5.00, 12.00, 18.00, 28.00) THEN
                RAISE EXCEPTION 'Item % has invalid tax_rate: % (must be one of 0, 5, 12, 18, 28 for issued invoices)',
                    v_item_count, COALESCE(v_item_tax_rate::TEXT, 'NULL')
                    USING ERRCODE = 'check_violation';
            END IF;
        ELSE
            IF v_item_tax_rate IS NOT NULL AND v_item_tax_rate < 0 THEN
                RAISE EXCEPTION 'Item % has invalid tax_rate: % (must be >= 0)', v_item_count, v_item_tax_rate
                    USING ERRCODE = 'check_violation';
            END IF;
        END IF;

        v_item_name := COALESCE(v_item->>'productName', v_item->>'product_name', v_prod.name);
        v_item_sku := COALESCE(v_item->>'productSku', v_item->>'product_sku', v_prod.sku);
        v_item_hsn := COALESCE(v_item->>'hsnCode', v_item->>'hsn_code', v_prod.hsn_code);
        v_item_uom := COALESCE(v_item->>'uom', v_prod.uom);

        v_gross := ROUND(v_item_qty * v_item_price, 2);
        v_disc := ROUND(v_gross * (v_item_disc_pct / 100.0), 2);
        v_taxable := v_gross - v_disc;
        v_tax := ROUND(v_taxable * (COALESCE(v_item_tax_rate, 0.00) / 100.0), 2);
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
-- 2. Authoritative get_eligible_payment_invoices RPC
--    Server-side bounded lookup for eligible ISSUED/PARTIALLY_PAID customer invoices
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_eligible_payment_invoices(
    p_org_id UUID,
    p_customer_id UUID,
    p_search TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 25,
    p_offset INTEGER DEFAULT 0,
    p_exact_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_total_count INTEGER := 0;
    v_invoices JSONB := '[]'::JSONB;
    v_exact_invoice JSONB := NULL;
    v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
    v_offset INTEGER := GREATEST(COALESCE(p_offset, 0), 0);
    v_search TEXT := NULLIF(TRIM(COALESCE(p_search, '')), '');
BEGIN
    IF NOT public.can_read_organization_data(p_org_id) THEN
        RAISE EXCEPTION 'Access denied: Caller cannot read organization data'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Count eligible invoices with positive balance
    SELECT COUNT(*)::INTEGER
    INTO v_total_count
    FROM public.invoices i
    WHERE i.organization_id = p_org_id
      AND i.customer_id = p_customer_id
      AND i.status IN ('ISSUED', 'PARTIALLY_PAID')
      AND (i.total_amount - i.total_paid) > 0
      AND (v_search IS NULL OR i.invoice_number ILIKE ('%' || v_search || '%'));

    -- Fetch paginated invoices ordered by due_date ASC (oldest due first)
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id', inv.id,
                'organization_id', inv.organization_id,
                'invoice_number', inv.invoice_number,
                'customer_id', inv.customer_id,
                'status', inv.status,
                'invoice_date', inv.invoice_date,
                'due_date', inv.due_date,
                'subtotal', inv.subtotal,
                'discount_amount', inv.discount_amount,
                'tax_amount', inv.tax_amount,
                'total_amount', inv.total_amount,
                'total_paid', inv.total_paid,
                'outstanding_balance', ROUND((inv.total_amount - inv.total_paid)::NUMERIC, 2),
                'created_at', inv.created_at
            )
        ),
        '[]'::JSONB
    )
    INTO v_invoices
    FROM (
        SELECT i.*
        FROM public.invoices i
        WHERE i.organization_id = p_org_id
          AND i.customer_id = p_customer_id
          AND i.status IN ('ISSUED', 'PARTIALLY_PAID')
          AND (i.total_amount - i.total_paid) > 0
          AND (v_search IS NULL OR i.invoice_number ILIKE ('%' || v_search || '%'))
        ORDER BY i.due_date ASC, i.created_at ASC, i.id ASC
        LIMIT v_limit
        OFFSET v_offset
    ) inv;

    -- If exact_id was requested, ensure it is included
    IF p_exact_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_invoices) elem WHERE (elem->>'id')::UUID = p_exact_id
    ) THEN
        SELECT jsonb_build_object(
            'id', i.id,
            'organization_id', i.organization_id,
            'invoice_number', i.invoice_number,
            'customer_id', i.customer_id,
            'status', i.status,
            'invoice_date', i.invoice_date,
            'due_date', i.due_date,
            'subtotal', i.subtotal,
            'discount_amount', i.discount_amount,
            'tax_amount', i.tax_amount,
            'total_amount', i.total_amount,
            'total_paid', i.total_paid,
            'outstanding_balance', ROUND((i.total_amount - i.total_paid)::NUMERIC, 2),
            'created_at', i.created_at
        )
        INTO v_exact_invoice
        FROM public.invoices i
        WHERE i.id = p_exact_id
          AND i.organization_id = p_org_id
          AND i.customer_id = p_customer_id;

        IF v_exact_invoice IS NOT NULL THEN
            v_invoices := jsonb_build_array(v_exact_invoice) || v_invoices;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'data', v_invoices,
        'total_count', v_total_count,
        'limit', v_limit,
        'offset', v_offset
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_eligible_payment_invoices(UUID, UUID, TEXT, INTEGER, INTEGER, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_eligible_payment_invoices(UUID, UUID, TEXT, INTEGER, INTEGER, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_eligible_payment_invoices(UUID, UUID, TEXT, INTEGER, INTEGER, UUID) TO service_role;

-- ----------------------------------------------------------------------------
-- 3. Financial Reconciliation & Covering Indexes
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_invoices_org_cust_status_due
    ON public.invoices(organization_id, customer_id, status, due_date);

CREATE INDEX IF NOT EXISTS idx_payment_allocations_inv_id
    ON public.payment_allocations(invoice_id);
