-- ============================================================================
-- ATLAS OS MIGRATION: Direct Invoice Stock Deduction & Fractional UOM Alignment
-- Timestamp: 20261119092000
-- ============================================================================
-- 1. Alters document item and stock movement quantity columns to NUMERIC(12, 3)
--    to support continuous fractional UOMs (Meters, Kg, Litres, Coils, Bundles).
-- 2. Updates `check_stock_movement_invariant` trigger to support fractional quantities.
-- 3. Updates `create_invoice_atomic`:
--    - Supports fractional quantities up to 3 decimal places (> 0).
--    - When `p_sales_order_id IS NULL` and `v_status = 'ISSUED'`, atomically
--      records `SALES_DISPATCH` stock movements in `stock_movements`.
--    - Invoices with an existing `p_sales_order_id` fulfill the sales order
--      without double-deducting stock.
-- ============================================================================

BEGIN;

-- 1. Schema Updates: Support fractional quantities up to 3 decimal places
ALTER TABLE public.invoice_items 
    ALTER COLUMN quantity TYPE NUMERIC(12, 3);

-- Drop trigger depending on quantity_change before altering column type
DROP TRIGGER IF EXISTS trg_protect_quarantined_stock ON public.stock_movements;

ALTER TABLE public.stock_movements 
    ALTER COLUMN quantity_change TYPE NUMERIC(12, 3);

-- Recreate trigger with updated column type
CREATE TRIGGER trg_protect_quarantined_stock
    BEFORE INSERT ON public.stock_movements
    FOR EACH ROW WHEN (NEW.quantity_change < 0)
    EXECUTE FUNCTION public.protect_quarantined_stock();

ALTER TABLE public.sales_order_items 
    ALTER COLUMN quantity TYPE NUMERIC(12, 3);

ALTER TABLE public.quotation_items 
    ALTER COLUMN quantity TYPE NUMERIC(12, 3);

-- 2. Update stock movement invariant trigger for NUMERIC(12, 3) precision
CREATE OR REPLACE FUNCTION public.check_stock_movement_invariant()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_current_stock NUMERIC(12, 3);
    v_resulting_stock NUMERIC(12, 3);
BEGIN
    -- 1. Disallow zero-quantity movements
    IF NEW.quantity_change = 0 THEN
        RAISE EXCEPTION 'Stock movement quantity_change cannot be zero'
            USING ERRCODE = 'check_violation';
    END IF;

    -- 2. Validate product belongs to the organization and serialize concurrent writes
    PERFORM id FROM public.products
    WHERE id = NEW.product_id AND organization_id = NEW.organization_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product % does not belong to organization %', NEW.product_id, NEW.organization_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    -- 3. Strict Opening Stock Invariant:
    -- Opening stock must be strictly positive AND can ONLY be recorded if NO prior movements exist.
    IF NEW.movement_type = 'OPENING_STOCK' THEN
        IF NEW.quantity_change < 0 THEN
            RAISE EXCEPTION 'Opening stock cannot be negative (got %)', NEW.quantity_change
                USING ERRCODE = 'check_violation';
        END IF;

        IF EXISTS (
            SELECT 1 FROM public.stock_movements
            WHERE product_id = NEW.product_id
              AND organization_id = NEW.organization_id
        ) THEN
            RAISE EXCEPTION 'Opening stock can only be recorded as the initial movement for product % in organization % (movement history already exists)',
                NEW.product_id, NEW.organization_id
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    -- 4. Authoritative stock sum calculation within the locked transaction
    SELECT COALESCE(SUM(quantity_change), 0)::NUMERIC(12, 3)
    INTO v_current_stock
    FROM public.stock_movements
    WHERE product_id = NEW.product_id
      AND organization_id = NEW.organization_id;

    v_resulting_stock := v_current_stock + NEW.quantity_change;

    -- 5. Non-negative stock invariant gate
    IF v_resulting_stock < 0 THEN
        RAISE EXCEPTION 'Insufficient stock for product % in organization %: Available: %, Requested change: %, Resulting balance: % (Negative stock is not permitted)',
            NEW.product_id, NEW.organization_id, v_current_stock, NEW.quantity_change, v_resulting_stock
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

-- 3. Authoritative create_invoice_atomic with Direct Invoice Stock Deduction
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
    v_item_qty NUMERIC(12, 3);
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
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
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

    v_user_role := public.get_user_org_role(p_org_id);
    IF v_user_role IS NULL OR v_user_role NOT IN ('owner', 'admin', 'accounts') THEN
        RAISE EXCEPTION 'Invoice creation requires an active owner, admin, or accounts membership'
            USING ERRCODE = '42501';
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
        COALESCE(p_due_date::TEXT, '') || ':' ||
        COALESCE(p_notes, '') || ':' ||
        p_items::TEXT
    );

    IF p_idempotency_key IS NOT NULL THEN
        SELECT invoice_id, request_hash INTO v_existing_inv_id, v_existing_hash
        FROM public.invoice_creation_idempotency
        WHERE organization_id = p_org_id AND idempotency_key = p_idempotency_key
        FOR UPDATE;

        IF FOUND THEN
            IF v_existing_hash != v_request_hash THEN
                RAISE EXCEPTION 'Idempotency conflict: Key % was already used for a different invoice creation request',
                    p_idempotency_key USING ERRCODE = 'unique_violation';
            END IF;

            SELECT jsonb_build_object(
                'id', i.id,
                'invoice_number', i.invoice_number,
                'organization_id', i.organization_id,
                'customer_id', i.customer_id,
                'sales_order_id', i.sales_order_id,
                'status', i.status,
                'invoice_date', i.invoice_date,
                'due_date', i.due_date,
                'subtotal', i.subtotal,
                'discount_amount', i.discount_amount,
                'tax_amount', i.tax_amount,
                'total_amount', i.total_amount,
                'total_paid', i.total_paid,
                'totals_version', i.totals_version,
                'notes', i.notes,
                'idempotent_replay', true,
                'items', COALESCE(
                    (
                        SELECT jsonb_agg(jsonb_build_object(
                            'id', ii.id,
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
                        ))
                        FROM public.invoice_items ii
                        WHERE ii.invoice_id = i.id
                    ),
                    '[]'::JSONB
                )
            ) INTO v_existing_invoice
            FROM public.invoices i
            WHERE i.id = v_existing_inv_id AND i.organization_id = p_org_id;

            IF v_existing_invoice IS NOT NULL THEN
                RETURN v_existing_invoice;
            END IF;
        END IF;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.customers
        WHERE id = p_customer_id AND organization_id = p_org_id
    ) INTO v_customer_exists;

    IF NOT v_customer_exists THEN
        RAISE EXCEPTION 'Customer % does not belong to organization %', p_customer_id, p_org_id;
    END IF;

    IF p_sales_order_id IS NOT NULL THEN
        SELECT status INTO v_so_status
        FROM public.sales_orders
        WHERE id = p_sales_order_id AND organization_id = p_org_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Sales order % does not belong to organization %', p_sales_order_id, p_org_id;
        END IF;

        IF v_so_status != 'CONFIRMED' THEN
            RAISE EXCEPTION 'Sales order % is in status "%" (must be CONFIRMED to invoice)',
                p_sales_order_id, v_so_status;
        END IF;

        IF EXISTS (
            SELECT 1 FROM public.invoices
            WHERE sales_order_id = p_sales_order_id
              AND organization_id = p_org_id
              AND status != 'CANCELLED'
        ) THEN
            RAISE EXCEPTION 'Sales order % has already been invoiced', p_sales_order_id;
        END IF;
    END IF;

    -- Deduplicate before aggregation: ORDER BY belongs inside array_agg,
    -- and the FROM clause belongs to the SELECT, not the aggregate call.
    SELECT array_agg(product_id ORDER BY product_id)
      INTO v_product_ids
    FROM (
        SELECT DISTINCT COALESCE(
            NULLIF(TRIM(item->>'productId'), ''),
            NULLIF(TRIM(item->>'product_id'), '')
        )::UUID AS product_id
        FROM jsonb_array_elements(p_items) AS item
    ) normalized_product_ids;

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
            ROUND((v_item->>'quantity')::NUMERIC, 3),
            0.000
        );
        IF v_item_qty <= 0 THEN
            RAISE EXCEPTION 'Item % has invalid quantity: % (must be > 0)', v_item_count, v_item_qty;
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
            IF (v_item->>'taxRate' IS NULL AND v_item->>'tax_rate' IS NULL) THEN
                RAISE EXCEPTION 'Item % is missing tax_rate (mandatory for issued invoices)',
                    v_item_count
                    USING ERRCODE = 'check_violation';
            END IF;

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
            (v_calc_item->>'quantity')::NUMERIC(12, 3),
            (v_calc_item->>'unit_price')::NUMERIC(12, 2),
            (v_calc_item->>'discount_percent')::NUMERIC(5, 2),
            (v_calc_item->>'tax_rate')::NUMERIC(5, 2),
            (v_calc_item->>'line_subtotal')::NUMERIC(12, 2),
            (v_calc_item->>'line_tax')::NUMERIC(12, 2),
            (v_calc_item->>'line_total')::NUMERIC(12, 2),
            0.00
        );
    END LOOP;

    -- If invoice created from sales order, mark sales order FULFILLED (stock already deducted on order confirmation)
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
    ELSIF v_status = 'ISSUED' THEN
        -- Direct counter / B2B invoice without sales order: deduct inventory atomically
        FOR v_calc_item IN SELECT * FROM jsonb_array_elements(v_calculated_items)
        LOOP
            INSERT INTO public.stock_movements (
                organization_id,
                product_id,
                quantity_change,
                movement_type,
                reference_type,
                reference_id,
                actor_id,
                notes
            ) VALUES (
                p_org_id,
                (v_calc_item->>'product_id')::UUID,
                -ROUND((v_calc_item->>'quantity')::NUMERIC, 3),
                'SALES_DISPATCH',
                'INVOICE',
                v_invoice_id,
                v_uid,
                'Direct invoice dispatch for ' || (v_calc_item->>'product_sku')
            );
        END LOOP;
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

COMMIT;
