-- ============================================================================
-- Migration 022: Secure Opening Stock & Atomic Product Creation (Sprint 1 Review)
-- ============================================================================
-- Sprint 1 Review: Close Remaining Inventory Integrity Gaps
--
-- Findings Resolved:
--   1. Direct Opening-Stock DML Bypass: Migration 021 still allowed direct client
--      INSERT on public.stock_movements for 'OPENING_STOCK'. This permitted malicious
--      or buggy clients to insert arbitrary positive opening-stock movements on existing
--      products at any time without bounds or uniqueness checks.
--   2. Non-Atomic Product & Opening Stock Creation: products.service.ts previously created
--      a product via direct REST insert, followed by a separate direct insert for opening
--      stock. If the opening-stock movement failed, the product remained orphaned with zero stock.
--   3. Lack of Engine-Level Single Opening Stock Constraint: No database constraint prevented
--      recording multiple opening-stock movements for the same product.
--
-- Architectural Corrections:
--   1. Total Direct DML Revocation on public.stock_movements:
--      - Drop stock_movements_insert RLS policy completely.
--      - Revoke INSERT from authenticated, anon, and PUBLIC.
--      - Authenticated users retain SELECT privilege only (governed by tenant-isolation RLS).
--      - All stock-mutating operations MUST execute strictly through authoritative SECURITY DEFINER RPCs.
--   2. Unique Partial Index on Opening Stock:
--      - Adds idx_stock_movements_unique_opening_stock on (organization_id, product_id)
--        WHERE movement_type = 'OPENING_STOCK'.
--      - Guarantees at the database engine level that no product can EVER have more than one opening-stock movement.
--   3. Hardened check_stock_movement_invariant Trigger:
--      - Enforces that OPENING_STOCK can ONLY be inserted when ZERO prior movements exist for that SKU.
--   4. Authoritative Atomic RPC: public.create_product_atomic()
--      - Creates the product and its opening-stock movement in a single atomic database transaction.
--      - Validates caller authentication, active role ('owner', 'admin', 'inventory'), operational write entitlement,
--        SKU uniqueness, non-negative prices, and non-negative opening stock.
--   5. Authoritative RPC: public.initialize_opening_stock()
--      - Provides a controlled mechanism to initialize opening stock on an existing product that has no movement history.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Total Direct Client DML Revocation on public.stock_movements
-- ----------------------------------------------------------------------------

-- Drop the permissive opening-stock insert policy from Migration 021
DROP POLICY IF EXISTS stock_movements_insert ON public.stock_movements;

-- Revoke all table-level DML privileges from PUBLIC, anon, and authenticated
REVOKE ALL PRIVILEGES ON TABLE public.stock_movements FROM PUBLIC, anon, authenticated;

-- Regrant SELECT only to authenticated (subject to stock_movements_select tenant isolation)
GRANT SELECT ON TABLE public.stock_movements TO authenticated;

-- Service role retains trusted internal access (SELECT, INSERT)
GRANT SELECT, INSERT ON TABLE public.stock_movements TO service_role;

-- ----------------------------------------------------------------------------
-- 2. Migration Preflight Check & Engine-Level Unique Opening Stock Constraint
-- ----------------------------------------------------------------------------
-- CRITICAL LEDGER AUDIT RULE:
-- Migration 022 does NOT automatically delete, rewrite, merge or alter historical
-- ledger records. If duplicate OPENING_STOCK records exist for any product, this
-- preflight block raises an actionable exception directing the operator to audit
-- and reconcile the records before the unique index can be created.
DO $$
DECLARE
    v_duplicate_count INTEGER;
    v_sample_org_id UUID;
    v_sample_prod_id UUID;
BEGIN
    SELECT COUNT(*)
    INTO v_duplicate_count
    FROM (
        SELECT organization_id, product_id
        FROM public.stock_movements
        WHERE movement_type = 'OPENING_STOCK'
        GROUP BY organization_id, product_id
        HAVING COUNT(*) > 1
    ) dupes;

    IF v_duplicate_count > 0 THEN
        SELECT organization_id, product_id
        INTO v_sample_org_id, v_sample_prod_id
        FROM public.stock_movements
        WHERE movement_type = 'OPENING_STOCK'
        GROUP BY organization_id, product_id
        HAVING COUNT(*) > 1
        LIMIT 1;

        RAISE EXCEPTION 'MIGRATION PREFLIGHT FAILURE: Found % product(s) with duplicate OPENING_STOCK records in public.stock_movements (sample: org %, product %). Migration 022 cannot create unique index idx_stock_movements_unique_opening_stock without failing. Run diagnostic query: "SELECT organization_id, product_id, COUNT(*) FROM public.stock_movements WHERE movement_type = ''OPENING_STOCK'' GROUP BY organization_id, product_id HAVING COUNT(*) > 1;" and reconcile records before applying this migration.',
            v_duplicate_count, v_sample_org_id, v_sample_prod_id
            USING ERRCODE = 'check_violation';
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_movements_unique_opening_stock
    ON public.stock_movements (organization_id, product_id)
    WHERE movement_type = 'OPENING_STOCK';

-- ----------------------------------------------------------------------------
-- 3. Hardened Trigger: Strict Initial-Movement Validation for OPENING_STOCK
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_stock_movement_invariant()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
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

-- ----------------------------------------------------------------------------
-- 4. Authoritative Atomic RPC: create_product_atomic
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_product_atomic(
    p_org_id UUID,
    p_sku VARCHAR,
    p_name VARCHAR,
    p_brand VARCHAR DEFAULT NULL,
    p_category VARCHAR DEFAULT 'General',
    p_description TEXT DEFAULT NULL,
    p_uom VARCHAR DEFAULT 'Nos',
    p_purchase_cost NUMERIC DEFAULT 0,
    p_selling_price NUMERIC DEFAULT 0,
    p_tax_rate NUMERIC DEFAULT 18,
    p_hsn_code VARCHAR DEFAULT NULL,
    p_reorder_threshold INTEGER DEFAULT 0,
    p_is_active BOOLEAN DEFAULT TRUE,
    p_opening_stock INTEGER DEFAULT 0,
    p_notes TEXT DEFAULT 'Initial opening stock'
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
    v_product_id UUID;
    v_movement_id UUID := NULL;
    v_created_at TIMESTAMPTZ;
    v_updated_at TIMESTAMPTZ;
BEGIN
    -- 1. Authentication check
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'unauthorized';
    END IF;

    -- 2. Input null & bounds validation
    IF p_org_id IS NULL THEN
        RAISE EXCEPTION 'Organization ID is required' USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF p_sku IS NULL OR trim(p_sku) = '' THEN
        RAISE EXCEPTION 'SKU is required' USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF p_name IS NULL OR trim(p_name) = '' THEN
        RAISE EXCEPTION 'Product name is required' USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF p_purchase_cost < 0 THEN
        RAISE EXCEPTION 'Purchase cost cannot be negative' USING ERRCODE = 'check_violation';
    END IF;

    IF p_selling_price < 0 THEN
        RAISE EXCEPTION 'Selling price cannot be negative' USING ERRCODE = 'check_violation';
    END IF;

    IF p_opening_stock < 0 THEN
        RAISE EXCEPTION 'Opening stock cannot be negative (got %)', p_opening_stock
            USING ERRCODE = 'check_violation';
    END IF;

    -- 3. Authorization: Caller must have an active membership in target org
    v_user_role := public.get_user_org_role(p_org_id);
    IF v_user_role IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Caller has no active membership in organization %', p_org_id
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- 4. Role verification: Caller must have owner, admin, or inventory role
    IF v_user_role NOT IN ('owner', 'admin', 'inventory') THEN
        RAISE EXCEPTION 'Unauthorized: Caller has insufficient role (%) to create products in organization %',
            v_user_role, p_org_id
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- 5. Operational write entitlement gate (Migration 014)
    IF NOT public.can_write_organization_operations(p_org_id) THEN
        RAISE EXCEPTION 'Operational write denied: Active subscription or trial required for organization %', p_org_id
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- 6. Check SKU uniqueness within organization
    IF EXISTS (
        SELECT 1 FROM public.products
        WHERE organization_id = p_org_id AND LOWER(sku) = LOWER(trim(p_sku))
    ) THEN
        RAISE EXCEPTION 'Product with SKU "%" already exists in organization %', trim(p_sku), p_org_id
            USING ERRCODE = 'unique_violation';
    END IF;

    -- 7. Insert product record
    INSERT INTO public.products (
        organization_id,
        sku,
        name,
        brand,
        category,
        description,
        uom,
        purchase_cost,
        selling_price,
        tax_rate,
        hsn_code,
        reorder_threshold,
        is_active
    ) VALUES (
        p_org_id,
        trim(p_sku),
        trim(p_name),
        trim(p_brand),
        trim(p_category),
        trim(p_description),
        COALESCE(trim(p_uom), 'Nos'),
        p_purchase_cost,
        p_selling_price,
        p_tax_rate,
        trim(p_hsn_code),
        p_reorder_threshold,
        COALESCE(p_is_active, TRUE)
    )
    RETURNING id, created_at, updated_at INTO v_product_id, v_created_at, v_updated_at;

    -- 8. Atomic Opening Stock Movement insertion
    IF p_opening_stock > 0 THEN
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
            v_product_id,
            p_opening_stock,
            'OPENING_STOCK',
            'INITIAL_STOCK',
            v_uid,
            COALESCE(trim(p_notes), 'Initial opening stock')
        )
        RETURNING id INTO v_movement_id;
    END IF;

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
        'CREATE_PRODUCT',
        'PRODUCT',
        v_product_id,
        jsonb_build_object(
            'sku', trim(p_sku),
            'name', trim(p_name),
            'opening_stock', p_opening_stock,
            'movement_id', v_movement_id
        )
    );

    RETURN jsonb_build_object(
        'id', v_product_id,
        'organization_id', p_org_id,
        'sku', trim(p_sku),
        'name', trim(p_name),
        'brand', trim(p_brand),
        'category', trim(p_category),
        'description', trim(p_description),
        'uom', COALESCE(trim(p_uom), 'Nos'),
        'purchase_cost', p_purchase_cost,
        'selling_price', p_selling_price,
        'tax_rate', p_tax_rate,
        'hsn_code', trim(p_hsn_code),
        'reorder_threshold', p_reorder_threshold,
        'is_active', COALESCE(p_is_active, TRUE),
        'current_stock', p_opening_stock,
        'created_at', v_created_at,
        'updated_at', v_updated_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_product_atomic FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_product_atomic TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. Authoritative RPC: initialize_opening_stock (for Existing Products)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.initialize_opening_stock(
    p_org_id UUID,
    p_product_id UUID,
    p_opening_stock INTEGER,
    p_notes TEXT DEFAULT 'Initial opening stock'
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
    v_new_movement_id UUID;
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

    IF p_opening_stock IS NULL OR p_opening_stock <= 0 THEN
        RAISE EXCEPTION 'Opening stock must be strictly greater than zero (got %)', p_opening_stock
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- 3. Authorization check
    v_user_role := public.get_user_org_role(p_org_id);
    IF v_user_role IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Caller has no active membership in organization %', p_org_id
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF v_user_role NOT IN ('owner', 'admin', 'inventory') THEN
        RAISE EXCEPTION 'Unauthorized: Caller has insufficient role (%) to initialize opening stock in organization %',
            v_user_role, p_org_id
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- 4. Operational write entitlement check
    IF NOT public.can_write_organization_operations(p_org_id) THEN
        RAISE EXCEPTION 'Operational write denied: Active subscription or trial required for organization %', p_org_id
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- 5. Lock product row FOR UPDATE and verify ownership
    SELECT id, name, sku INTO v_product_row
    FROM public.products
    WHERE id = p_product_id AND organization_id = p_org_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product % not found in organization %', p_product_id, p_org_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    -- 6. Strict Single-Initialization Check: Cannot add opening stock if ANY stock movements already exist!
    IF EXISTS (
        SELECT 1 FROM public.stock_movements
        WHERE product_id = p_product_id AND organization_id = p_org_id
    ) THEN
        RAISE EXCEPTION 'Cannot initialize opening stock: Product "%" (SKU: %) already has stock movement history in organization %',
            v_product_row.name, v_product_row.sku, p_org_id
            USING ERRCODE = 'check_violation';
    END IF;

    -- 7. Insert opening stock movement
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
        p_opening_stock,
        'OPENING_STOCK',
        'INITIAL_STOCK',
        v_uid,
        COALESCE(trim(p_notes), 'Initial opening stock')
    )
    RETURNING id INTO v_new_movement_id;

    -- 8. Log audit event
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
        'INITIALIZE_OPENING_STOCK',
        'PRODUCT',
        p_product_id,
        jsonb_build_object(
            'movement_id', v_new_movement_id,
            'opening_stock', p_opening_stock,
            'notes', trim(p_notes)
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'movement_id', v_new_movement_id,
        'product_id', p_product_id,
        'opening_stock', p_opening_stock
    );
END;
$$;

REVOKE ALL ON FUNCTION public.initialize_opening_stock FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.initialize_opening_stock TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. Table Documentation Comment
-- ----------------------------------------------------------------------------
COMMENT ON TABLE public.stock_movements IS
    'Authoritative, immutable stock movement ledger. Direct client DML (INSERT, UPDATE, DELETE, TRUNCATE) is strictly prohibited for all authenticated and anon roles. All stock mutations MUST execute via authoritative atomic RPCs: public.create_product_atomic() or public.initialize_opening_stock() for initial opening stock, public.record_stock_adjustment() for manual adjustments, and public.confirm_sales_order() for order fulfillment dispatches.';
