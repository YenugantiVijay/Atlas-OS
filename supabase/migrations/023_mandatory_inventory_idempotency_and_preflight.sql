-- ============================================================================
-- Migration 023: Mandatory Inventory Idempotency & Search Path Hardening
-- ============================================================================
-- Sprint 1 Final Remediation:
--   1. Mandatory Idempotency Key:
--      - Previously, public.record_stock_adjustment permitted p_idempotency_key = NULL.
--      - If clients did not pass an idempotency key, double submissions or network retries
--        could create duplicate stock movements.
--      - This migration makes p_idempotency_key mandatory. NULL, empty, or invalid keys
--        are strictly rejected at the database boundary.
--   2. Explicit Volatility & Fully-Qualified Function Invocations:
--      - Explicitly marks record_stock_adjustment and confirm_sales_order as VOLATILE.
--      - Fully qualifies internal calls with public schema (public.get_user_org_role,
--        public.can_write_organization_operations, public.get_product_stock) to eliminate
--        any possibility of search-path shadowing.
--   3. Service Role Grant Cleanup:
--      - Because authoritative RPCs strictly require an authenticated caller with a non-null
--        auth.uid(), execute grants to service_role are revoked to prevent confusing or broken
--        unauthenticated invocations.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Authoritative RPC: record_stock_adjustment (Mandatory Idempotency Key)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.record_stock_adjustment(UUID, UUID, INTEGER, TEXT, UUID);

CREATE OR REPLACE FUNCTION public.record_stock_adjustment(
    p_org_id UUID,
    p_product_id UUID,
    p_quantity_change INTEGER,
    p_notes TEXT,
    p_idempotency_key UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid UUID;
    v_user_role VARCHAR(50);
    v_product_row RECORD;
    v_current_stock INTEGER;
    v_resulting_stock INTEGER;
    v_new_movement_id UUID;
    v_request_hash TEXT;
    v_existing_movement_id UUID;
    v_existing_hash TEXT;
BEGIN
    -- 1. Authentication check
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'unauthorized';
    END IF;

    -- 2. Input null & bounds validation
    IF p_org_id IS NULL OR p_product_id IS NULL THEN
        RAISE EXCEPTION 'Invalid parameters: org_id and product_id are required'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- Mandatory Idempotency Key Validation
    IF p_idempotency_key IS NULL THEN
        RAISE EXCEPTION 'Idempotency key is required for inventory adjustments'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF p_quantity_change IS NULL OR p_quantity_change = 0 THEN
        RAISE EXCEPTION 'Invalid quantity change: must be non-zero'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF p_notes IS NULL OR trim(p_notes) = '' THEN
        RAISE EXCEPTION 'An audit note is required for all manual inventory adjustments'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- 3. Authorization: Caller must have an active membership in target org
    v_user_role := public.get_user_org_role(p_org_id);
    IF v_user_role IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Caller has no active membership in organization %', p_org_id
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- 4. Role verification: Caller must have owner, admin, or inventory role
    IF v_user_role NOT IN ('owner', 'admin', 'inventory') THEN
        RAISE EXCEPTION 'Unauthorized: Caller has insufficient role (%) to adjust stock in organization %',
            v_user_role, p_org_id
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- 5. Operational write entitlement gate (Migration 014)
    IF NOT public.can_write_organization_operations(p_org_id) THEN
        RAISE EXCEPTION 'Operational write denied: Active subscription or trial required for organization %', p_org_id
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- 6. Mandatory Tenant-Scoped Idempotency with Transaction Advisory Locking
    PERFORM pg_advisory_xact_lock(hashtext('stock_adj:' || p_org_id::text || ':' || p_idempotency_key::text));

    v_request_hash := md5(
        p_org_id::text || '|' ||
        p_product_id::text || '|' ||
        p_quantity_change::text || '|' ||
        trim(p_notes)
    );

    SELECT movement_id, request_hash INTO v_existing_movement_id, v_existing_hash
    FROM public.inventory_adjustment_idempotency
    WHERE organization_id = p_org_id AND idempotency_key = p_idempotency_key;

    IF FOUND THEN
        IF v_existing_hash = v_request_hash THEN
            v_current_stock := public.get_product_stock(p_product_id, p_org_id);

            RETURN jsonb_build_object(
                'success', true,
                'movement_id', v_existing_movement_id,
                'product_id', p_product_id,
                'quantity_change', p_quantity_change,
                'resulting_stock', v_current_stock,
                'idempotent_replay', true
            );
        ELSE
            RAISE EXCEPTION 'Idempotency conflict: Key % was already used with a different request payload in organization %',
                p_idempotency_key, p_org_id
                USING ERRCODE = 'unique_violation';
        END IF;
    END IF;

    -- 7. Lock product row FOR UPDATE and verify tenant ownership
    SELECT id, name, sku INTO v_product_row
    FROM public.products
    WHERE id = p_product_id AND organization_id = p_org_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product % not found in organization %', p_product_id, p_org_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    -- 8. Calculate current stock and verify non-negative balance
    v_current_stock := public.get_product_stock(p_product_id, p_org_id);
    v_resulting_stock := v_current_stock + p_quantity_change;

    IF v_resulting_stock < 0 THEN
        RAISE EXCEPTION 'Insufficient stock for product "%" (SKU: %). Available: %, Requested change: %, Resulting balance: % (Negative stock is not permitted)',
            v_product_row.name, v_product_row.sku, v_current_stock, p_quantity_change, v_resulting_stock
            USING ERRCODE = 'check_violation';
    END IF;

    -- 9. Insert stock movement
    INSERT INTO public.stock_movements (
        organization_id,
        product_id,
        quantity_change,
        movement_type,
        reference_type,
        actor_id,
        notes
    ) VALUES (
        p_org_id,
        p_product_id,
        p_quantity_change,
        'ADJUSTMENT',
        'MANUAL_ADJUSTMENT',
        v_uid,
        trim(p_notes)
    )
    RETURNING id INTO v_new_movement_id;

    -- 10. Record idempotency mapping
    INSERT INTO public.inventory_adjustment_idempotency (
        organization_id,
        idempotency_key,
        user_id,
        movement_id,
        product_id,
        quantity_change,
        request_hash
    ) VALUES (
        p_org_id,
        p_idempotency_key,
        v_uid,
        v_new_movement_id,
        p_product_id,
        p_quantity_change,
        v_request_hash
    );

    -- 11. Log audit event
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
        'ADJUST_INVENTORY',
        'PRODUCT',
        p_product_id,
        jsonb_build_object(
            'movement_id', v_new_movement_id,
            'quantity_change', p_quantity_change,
            'previous_stock', v_current_stock,
            'new_stock', v_resulting_stock,
            'notes', trim(p_notes),
            'idempotency_key', p_idempotency_key
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'movement_id', v_new_movement_id,
        'product_id', p_product_id,
        'quantity_change', p_quantity_change,
        'resulting_stock', v_resulting_stock,
        'idempotent_replay', false
    );
END;
$$;

REVOKE ALL ON FUNCTION public.record_stock_adjustment(UUID, UUID, INTEGER, TEXT, UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_stock_adjustment(UUID, UUID, INTEGER, TEXT, UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. Authoritative RPC: confirm_sales_order Hardening
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION confirm_sales_order(p_order_id UUID, p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_role VARCHAR(50);
    v_order_status VARCHAR(50);
    v_item RECORD;
    v_available_stock INTEGER;
    v_item_count INTEGER := 0;
    v_uid UUID;
BEGIN
    -- 1. Authentication check
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'unauthorized';
    END IF;

    IF p_order_id IS NULL OR p_org_id IS NULL THEN
        RAISE EXCEPTION 'Invalid parameters: order_id and org_id are required'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- 2. Authorization: Caller must have an active membership in target org
    v_user_role := public.get_user_org_role(p_org_id);
    IF v_user_role IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Caller has no active membership in organization %', p_org_id
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- 3. Role verification: Caller must have owner, admin, or sales role
    IF v_user_role NOT IN ('owner', 'admin', 'sales') THEN
        RAISE EXCEPTION 'Unauthorized: Caller has insufficient role (%) to confirm orders in organization %',
            v_user_role, p_org_id
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- 4. Operational write entitlement gate
    IF NOT public.can_write_organization_operations(p_org_id) THEN
        RAISE EXCEPTION 'Operational write denied: Active subscription or trial required for organization %', p_org_id
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- 5. Lock and verify the order strictly within organization
    SELECT status INTO v_order_status
    FROM public.sales_orders
    WHERE id = p_order_id AND organization_id = p_org_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sales order % not found in organization %', p_order_id, p_org_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    -- 5a. Safe idempotent replay: If already CONFIRMED, return success without re-deducting stock
    IF v_order_status = 'CONFIRMED' THEN
        RETURN jsonb_build_object(
            'success', true,
            'order_id', p_order_id,
            'status', 'CONFIRMED',
            'idempotent_replay', true
        );
    END IF;

    IF v_order_status != 'DRAFT' THEN
        RAISE EXCEPTION 'Order % cannot be confirmed because status is % (expected DRAFT)', p_order_id, v_order_status
            USING ERRCODE = 'check_violation';
    END IF;

    -- 6. Verify order has line items
    SELECT COUNT(*) INTO v_item_count
    FROM public.sales_order_items oi
    JOIN public.sales_orders so ON so.id = oi.sales_order_id
    WHERE oi.sales_order_id = p_order_id AND so.organization_id = p_org_id;

    IF v_item_count = 0 THEN
        RAISE EXCEPTION 'Cannot confirm order %: Order has no line items', p_order_id
            USING ERRCODE = 'check_violation';
    END IF;

    -- 7. Deterministic Ascending Lock Ordering (ORDER BY oi.product_id ASC)
    -- Group by product_id to combine multiple lines of the same SKU and acquire locks
    -- in strictly ascending primary-key order to completely eliminate cross-transaction deadlock cycles.
    FOR v_item IN
        SELECT
            oi.product_id,
            SUM(oi.quantity)::INTEGER AS quantity,
            MAX(oi.product_name) AS product_name,
            MAX(oi.product_sku) AS product_sku
        FROM public.sales_order_items oi
        JOIN public.sales_orders so ON so.id = oi.sales_order_id
        WHERE oi.sales_order_id = p_order_id AND so.organization_id = p_org_id
        GROUP BY oi.product_id
        ORDER BY oi.product_id ASC
    LOOP
        IF v_item.quantity <= 0 THEN
            RAISE EXCEPTION 'Invalid item quantity % for product "%"', v_item.quantity, v_item.product_name
                USING ERRCODE = 'check_violation';
        END IF;

        PERFORM id FROM public.products
        WHERE id = v_item.product_id AND organization_id = p_org_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Product % in order does not belong to organization %', v_item.product_id, p_org_id
                USING ERRCODE = 'foreign_key_violation';
        END IF;

        v_available_stock := public.get_product_stock(v_item.product_id, p_org_id);

        IF v_available_stock < v_item.quantity THEN
            RAISE EXCEPTION 'Insufficient stock for product "%" (SKU: %). Available: %, Requested: %',
                v_item.product_name, v_item.product_sku, v_available_stock, v_item.quantity
                USING ERRCODE = 'check_violation';
        END IF;

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
            v_item.product_id,
            -v_item.quantity,
            'SALES_DISPATCH',
            'SALES_ORDER',
            p_order_id,
            v_uid,
            'Order confirmation deduction for ' || v_item.product_sku
        );
    END LOOP;

    -- 8. Mark order CONFIRMED scoped to organization
    UPDATE public.sales_orders
    SET status = 'CONFIRMED',
        confirmed_at = NOW(),
        confirmed_by = v_uid,
        updated_at = NOW()
    WHERE id = p_order_id AND organization_id = p_org_id;

    -- 9. Log audit event
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
        'CONFIRM_ORDER',
        'SALES_ORDER',
        p_order_id,
        jsonb_build_object('order_id', p_order_id, 'previous_status', 'DRAFT', 'new_status', 'CONFIRMED')
    );

    RETURN jsonb_build_object('success', true, 'order_id', p_order_id, 'status', 'CONFIRMED', 'idempotent_replay', false);
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_sales_order(UUID, UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_sales_order(UUID, UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. Schema Privilege Hardening (search_path Safety & Trojan Shadowing Prevention)
-- ----------------------------------------------------------------------------
-- In PostgreSQL, if untrusted roles possess CREATE privileges on schema public,
-- they could define malicious objects or operators that shadow standard functions
-- executed within SECURITY DEFINER contexts under search_path = public, pg_temp.
--
-- We explicitly revoke CREATE on schema public from PUBLIC, anon, and authenticated.
-- Note: USAGE on public and table-level RLS privileges are untouched, allowing
-- standard authenticated application queries to function unimpeded while ensuring
-- that untrusted database roles cannot create trojan objects in public.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM anon;
REVOKE CREATE ON SCHEMA public FROM authenticated;

