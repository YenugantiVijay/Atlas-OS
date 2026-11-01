-- ============================================================================
-- Migration 021: Inventory Integrity, Serialized Stock Validation & Negative Stock Prevention
-- ============================================================================
-- Sprint 1: Critical Inventory Integrity Remediation
--
-- Vulnerability / Architectural Gap:
--   1. Direct Adjustment Bypass: The inventory service previously performed direct client
--      INSERT statements into public.stock_movements for manual adjustments, bypassing
--      the centralized stock-locking and negative balance validation present in
--      sales order confirmation.
--   2. Permissive RLS Policy: Migration 014 created 'stock_movements_insert', which
--      permitted authenticated users with 'owner', 'admin', or 'inventory' roles to
--      directly insert arbitrary quantity changes (including massive negative numbers)
--      without verifying that the resulting on-hand stock remained >= 0.
--   3. Concurrency Race Conditions: Un-serialized concurrent stock mutations on the same
--      product could collectively drive inventory negative.
--   4. Deadlock Vulnerability in confirm_sales_order: Previous versions of confirm_sales_order
--      did not enforce deterministic lock ordering when locking multiple products.
--   5. Idempotency Absence: Network retries on stock adjustments could duplicate stock
--      movements, creating phantom additions or deductions.
--
-- Target Invariant:
--   For every product and organization, the resulting on-hand quantity must NEVER
--   be below zero (resulting_stock >= 0) through ANY supported mutation path,
--   including concurrent operations.
--
-- Remediation Strategy (Multi-Layer Defense in Depth):
--   1. Database Invariant Trigger on public.stock_movements:
--      A BEFORE INSERT trigger (check_stock_movement_invariant) acquires a row-level
--      lock (FOR UPDATE) on public.products, calculates the authoritative current on-hand
--      balance (SUM(quantity_change)), and strictly rejects any movement that would make
--      resulting stock < 0. It also enforces non-zero quantity changes and positive opening stock.
--   2. Authoritative Atomic RPC (public.record_stock_adjustment):
--      Provides the secure, serialized mutation boundary for manual inventory adjustments:
--      - Enforces authenticated caller and active tenant membership.
--      - Checks operational write entitlement via can_write_organization_operations(p_org_id).
--      - Verifies caller role in ('owner', 'admin', 'inventory').
--      - Acquires transaction-level advisory lock on (org_id, idempotency_key).
--      - Verifies and locks product row FOR UPDATE.
--      - Verifies resulting stock >= 0 (allowing exactly zero).
--      - Inserts stock movement, logs audit event, and records idempotency mapping atomically.
--   3. Deadlock-Free Sales Order Confirmation:
--      Updates confirm_sales_order to lock products in deterministic ascending ID order
--      (ORDER BY oi.product_id ASC) and supports safe idempotent replay if already CONFIRMED.
--   4. RLS Policy Hardening:
--      Restricts direct client INSERT on public.stock_movements to 'OPENING_STOCK' only.
--      Direct client inserts for 'ADJUSTMENT' and 'SALES_DISPATCH' are strictly denied.
--      UPDATE, DELETE, and TRUNCATE remain prohibited for all authenticated users.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Idempotency Tracking Table for Inventory Adjustments
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory_adjustment_idempotency (
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    idempotency_key UUID NOT NULL,
    user_id UUID NOT NULL,
    movement_id UUID NOT NULL REFERENCES public.stock_movements(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    quantity_change INTEGER NOT NULL,
    request_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    PRIMARY KEY (organization_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_inventory_adj_idempotency_lookup
    ON public.inventory_adjustment_idempotency(organization_id, idempotency_key);

ALTER TABLE public.inventory_adjustment_idempotency ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_adj_idempotency_select ON public.inventory_adjustment_idempotency;
CREATE POLICY inventory_adj_idempotency_select ON public.inventory_adjustment_idempotency
    FOR SELECT TO authenticated
    USING (public.can_read_organization_data(organization_id));

REVOKE ALL ON TABLE public.inventory_adjustment_idempotency FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.inventory_adjustment_idempotency FROM authenticated;
GRANT SELECT ON TABLE public.inventory_adjustment_idempotency TO authenticated;
GRANT ALL ON TABLE public.inventory_adjustment_idempotency TO service_role;

-- ----------------------------------------------------------------------------
-- 2. Database Trigger: Physical Negative-Stock Invariant Enforcement
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_stock_movement_invariant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_current_stock INTEGER;
    v_resulting_stock INTEGER;
BEGIN
    -- 1. Disallow zero-quantity movements
    IF NEW.quantity_change = 0 THEN
        RAISE EXCEPTION 'Stock movement quantity_change cannot be zero'
            USING ERRCODE = 'check_violation';
    END IF;

    -- 2. Validate product belongs to the organization and serialize concurrent writes
    -- Acquires product-row lock FOR UPDATE. If caller already holds this lock, re-entrant lock is instantaneous.
    PERFORM id FROM public.products
    WHERE id = NEW.product_id AND organization_id = NEW.organization_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product % does not belong to organization %', NEW.product_id, NEW.organization_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    -- 3. Opening stock must be strictly positive
    IF NEW.movement_type = 'OPENING_STOCK' AND NEW.quantity_change < 0 THEN
        RAISE EXCEPTION 'Opening stock cannot be negative (got %)', NEW.quantity_change
            USING ERRCODE = 'check_violation';
    END IF;

    -- 4. Authoritative stock sum calculation within the locked transaction
    SELECT COALESCE(SUM(quantity_change), 0)
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

DROP TRIGGER IF EXISTS trg_enforce_stock_movement_invariant ON public.stock_movements;
CREATE TRIGGER trg_enforce_stock_movement_invariant
    BEFORE INSERT ON public.stock_movements
    FOR EACH ROW
    EXECUTE FUNCTION public.check_stock_movement_invariant();

-- ----------------------------------------------------------------------------
-- 3. Authoritative Atomic RPC: record_stock_adjustment
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_stock_adjustment(
    p_org_id UUID,
    p_product_id UUID,
    p_quantity_change INTEGER,
    p_notes TEXT,
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

    IF p_quantity_change IS NULL OR p_quantity_change = 0 THEN
        RAISE EXCEPTION 'Invalid quantity change: must be non-zero'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF p_notes IS NULL OR trim(p_notes) = '' THEN
        RAISE EXCEPTION 'An audit note is required for all manual inventory adjustments'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- 3. Authorization: Caller must have an active membership in target org
    v_user_role := get_user_org_role(p_org_id);
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

    -- 6. Idempotency handling with transaction advisory locking
    IF p_idempotency_key IS NOT NULL THEN
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
                v_current_stock := get_product_stock(p_product_id, p_org_id);

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
    v_current_stock := get_product_stock(p_product_id, p_org_id);
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

    -- 10. Record idempotency mapping if key supplied
    IF p_idempotency_key IS NOT NULL THEN
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
    END IF;

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
            'notes', trim(p_notes)
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

REVOKE ALL ON FUNCTION public.record_stock_adjustment(UUID, UUID, INTEGER, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_stock_adjustment(UUID, UUID, INTEGER, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_stock_adjustment(UUID, UUID, INTEGER, TEXT, UUID) TO service_role;

-- ----------------------------------------------------------------------------
-- 4. Deadlock-Free & Idempotent confirm_sales_order
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION confirm_sales_order(p_order_id UUID, p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
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
    v_user_role := get_user_org_role(p_org_id);
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

        v_available_stock := get_product_stock(v_item.product_id, p_org_id);

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

REVOKE ALL ON FUNCTION confirm_sales_order(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION confirm_sales_order(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION confirm_sales_order(UUID, UUID) TO service_role;

-- ----------------------------------------------------------------------------
-- 5. Hardened RLS Policies & Table Privileges for stock_movements
-- ----------------------------------------------------------------------------

-- Revoke table mutations from public, anon, and authenticated
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.stock_movements FROM PUBLIC, anon, authenticated;

-- Drop obsolete permissive insert policy
DROP POLICY IF EXISTS stock_movements_insert ON public.stock_movements;

-- Restrict direct client INSERT exclusively to OPENING_STOCK
-- All adjustments and sales order deductions must execute via the authoritative RPCs.
CREATE POLICY stock_movements_insert ON public.stock_movements
    FOR INSERT TO authenticated
    WITH CHECK (
        public.can_write_organization_operations(organization_id)
        AND public.user_has_org_role(organization_id, 'owner', 'admin', 'inventory')
        AND movement_type = 'OPENING_STOCK'
    );

-- Table documentation comment
COMMENT ON TABLE public.stock_movements IS
    'Immutable stock movement ledger. Direct client DML for adjustments and sales dispatches is prohibited; manual adjustments must execute via public.record_stock_adjustment() and order deductions via public.confirm_sales_order(). Direct client INSERT is restricted strictly to initial OPENING_STOCK under active operational write entitlement, subject to the non-negative stock invariant trigger.';
