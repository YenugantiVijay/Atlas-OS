-- ============================================================================
-- Migration: Atomic Bulk Product Import & Cloud Batch Undo Engine
-- Timestamp: 20261119113000
-- ============================================================================
-- Adds:
--   1. batch_id column on public.products for tracking bulk import provenance.
--   2. public.create_products_batch(...) atomic bulk import RPC.
--      Rolls back the entire transaction if any single row fails validation,
--      uniqueness, or permission checks.
--   3. public.undo_product_import_batch(...) companion RPC for safe, verified
--      batch rollback of unreferenced products.
-- ============================================================================

BEGIN;

-- 1. Add batch_id to products
ALTER TABLE public.products
ADD COLUMN IF NOT EXISTS batch_id UUID DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_products_org_batch_id
ON public.products (organization_id, batch_id)
WHERE batch_id IS NOT NULL;

-- 2. Atomic Bulk Product Import RPC
CREATE OR REPLACE FUNCTION public.create_products_batch(
    p_org_id UUID,
    p_batch_id UUID,
    p_products JSONB
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
    v_item JSONB;
    v_sku VARCHAR;
    v_name VARCHAR;
    v_brand VARCHAR;
    v_category VARCHAR;
    v_uom VARCHAR;
    v_hsn_code VARCHAR;
    v_purchase_cost NUMERIC;
    v_selling_price NUMERIC;
    v_tax_rate NUMERIC;
    v_reorder_threshold INTEGER;
    v_opening_stock INTEGER;
    v_is_active BOOLEAN;
    v_product_id UUID;
    v_record_ids UUID[] := ARRAY[]::UUID[];
    v_dupe_sku VARCHAR;
BEGIN
    -- 1. Authentication Check
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'unauthorized';
    END IF;

    -- 2. Input null & bounds validation
    IF p_org_id IS NULL THEN
        RAISE EXCEPTION 'Organization ID is required' USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF p_batch_id IS NULL THEN
        RAISE EXCEPTION 'Batch ID is required' USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF p_products IS NULL OR jsonb_typeof(p_products) <> 'array' OR jsonb_array_length(p_products) = 0 THEN
        RAISE EXCEPTION 'Products array cannot be empty' USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- 3. Authorization Check
    v_user_role := public.get_user_org_role(p_org_id);
    IF v_user_role IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Caller has no active membership in organization %', p_org_id
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF v_user_role NOT IN ('owner', 'admin', 'inventory') THEN
        RAISE EXCEPTION 'Unauthorized: Caller has insufficient role (%) to import products in organization %',
            v_user_role, p_org_id
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- 4. Operational Write Entitlement Gate
    IF NOT public.can_write_organization_operations(p_org_id) THEN
        RAISE EXCEPTION 'Operational write denied: Active subscription or trial required for organization %', p_org_id
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- 5. Detect duplicate SKUs inside the incoming payload batch
    SELECT trim(p->>'sku') INTO v_dupe_sku
    FROM jsonb_array_elements(p_products) AS p
    GROUP BY lower(trim(p->>'sku'))
    HAVING count(*) > 1
    LIMIT 1;

    IF v_dupe_sku IS NOT NULL THEN
        RAISE EXCEPTION 'Duplicate SKU "%" found within the import batch.', v_dupe_sku
            USING ERRCODE = 'unique_violation';
    END IF;

    -- 6. Validate and Insert all products atomically
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_products)
    LOOP
        v_sku := trim(COALESCE(v_item->>'sku', ''));
        v_name := trim(COALESCE(v_item->>'name', ''));
        v_brand := trim(COALESCE(v_item->>'brand', ''));
        v_category := trim(COALESCE(v_item->>'category', 'General'));
        v_uom := trim(COALESCE(v_item->>'uom', 'Nos'));
        v_hsn_code := trim(COALESCE(v_item->>'hsn_code', ''));
        v_purchase_cost := COALESCE((v_item->>'purchase_cost')::numeric, 0);
        v_selling_price := COALESCE((v_item->>'selling_price')::numeric, 0);
        v_tax_rate := COALESCE((v_item->>'tax_rate')::numeric, 18);
        v_reorder_threshold := COALESCE((v_item->>'reorder_threshold')::integer, 0);
        v_opening_stock := COALESCE((v_item->>'opening_stock')::integer, 0);
        v_is_active := COALESCE((v_item->>'is_active')::boolean, TRUE);

        IF v_sku = '' THEN
            RAISE EXCEPTION 'SKU is mandatory for all imported products.' USING ERRCODE = 'invalid_parameter_value';
        END IF;

        IF v_name = '' THEN
            RAISE EXCEPTION 'Product name is mandatory for SKU "%".', v_sku USING ERRCODE = 'invalid_parameter_value';
        END IF;

        IF v_purchase_cost < 0 THEN
            RAISE EXCEPTION 'Purchase cost cannot be negative for SKU "%".', v_sku USING ERRCODE = 'check_violation';
        END IF;

        IF v_selling_price < 0 THEN
            RAISE EXCEPTION 'Selling price cannot be negative for SKU "%".', v_sku USING ERRCODE = 'check_violation';
        END IF;

        IF v_opening_stock < 0 THEN
            RAISE EXCEPTION 'Opening stock cannot be negative for SKU "%".', v_sku USING ERRCODE = 'check_violation';
        END IF;

        -- Check if SKU already exists in this organization
        IF EXISTS (
            SELECT 1 FROM public.products
            WHERE organization_id = p_org_id AND lower(sku) = lower(v_sku)
        ) THEN
            RAISE EXCEPTION 'Product with SKU "%" already exists in organization %', v_sku, p_org_id
                USING ERRCODE = 'unique_violation';
        END IF;

        -- Insert product record
        INSERT INTO public.products (
            organization_id,
            batch_id,
            sku,
            name,
            brand,
            category,
            uom,
            purchase_cost,
            selling_price,
            tax_rate,
            hsn_code,
            reorder_threshold,
            is_active
        ) VALUES (
            p_org_id,
            p_batch_id,
            v_sku,
            v_name,
            v_brand,
            v_category,
            v_uom,
            v_purchase_cost,
            v_selling_price,
            v_tax_rate,
            v_hsn_code,
            v_reorder_threshold,
            v_is_active
        )
        RETURNING id INTO v_product_id;

        v_record_ids := array_append(v_record_ids, v_product_id);

        -- Insert Opening Stock Movement if applicable
        IF v_opening_stock > 0 THEN
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
                v_product_id,
                v_opening_stock,
                'OPENING_STOCK',
                'INITIAL_STOCK',
                p_batch_id,
                v_uid,
                'Bulk import opening stock · batch ' || p_batch_id::text
            );
        END IF;
    END LOOP;

    -- 7. Log Audit Event
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
        'IMPORT_PRODUCTS_BATCH',
        'IMPORT_BATCH',
        p_batch_id,
        jsonb_build_object(
            'batch_id', p_batch_id,
            'count', array_length(v_record_ids, 1),
            'record_ids', to_jsonb(v_record_ids)
        )
    );

    RETURN jsonb_build_object(
        'batch_id', p_batch_id,
        'imported_count', array_length(v_record_ids, 1),
        'record_ids', to_jsonb(v_record_ids)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_products_batch FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_products_batch TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_products_batch TO service_role;

-- 3. Companion Batch Undo RPC
CREATE OR REPLACE FUNCTION public.undo_product_import_batch(
    p_org_id UUID,
    p_batch_id UUID
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
    v_prod RECORD;
    v_undone_count INTEGER := 0;
    v_failed_count INTEGER := 0;
    v_details TEXT[] := ARRAY[]::TEXT[];
    v_has_refs BOOLEAN;
BEGIN
    -- 1. Authentication Check
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'unauthorized';
    END IF;

    -- 2. Input null validation
    IF p_org_id IS NULL OR p_batch_id IS NULL THEN
        RAISE EXCEPTION 'Organization ID and Batch ID are required' USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- 3. Authorization Check (Owner or Admin role required for batch rollback)
    v_user_role := public.get_user_org_role(p_org_id);
    IF v_user_role IS NULL OR v_user_role NOT IN ('owner', 'admin') THEN
        RAISE EXCEPTION 'Unauthorized: Caller has insufficient role (%) to roll back import batches in organization %',
            COALESCE(v_user_role, 'none'), p_org_id
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- 4. Operational Write Entitlement Gate
    IF NOT public.can_write_organization_operations(p_org_id) THEN
        RAISE EXCEPTION 'Operational write denied: Active subscription or trial required for organization %', p_org_id
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- 5. Check if any products exist for this batch
    IF NOT EXISTS (
        SELECT 1 FROM public.products
        WHERE organization_id = p_org_id AND batch_id = p_batch_id
    ) THEN
        RETURN jsonb_build_object(
            'batch_id', p_batch_id,
            'success', FALSE,
            'undone_count', 0,
            'failed_count', 1,
            'message', 'Import batch ' || p_batch_id::text || ' was not found or is not persisted on the cloud.',
            'details', jsonb_build_array('No matching cloud products found for batch ' || p_batch_id::text)
        );
    END IF;

    -- 6. Check references and delete unreferenced products
    FOR v_prod IN
        SELECT id, sku, name
        FROM public.products
        WHERE organization_id = p_org_id AND batch_id = p_batch_id
    LOOP
        v_has_refs := FALSE;

        -- Check sales order items
        IF EXISTS (SELECT 1 FROM public.sales_order_items WHERE product_id = v_prod.id) THEN
            v_has_refs := TRUE;
            v_failed_count := v_failed_count + 1;
            v_details := array_append(v_details, 'Product ' || v_prod.sku || ' is referenced in existing sales orders.');
        -- Check invoice items
        ELSIF EXISTS (SELECT 1 FROM public.invoice_items WHERE product_id = v_prod.id) THEN
            v_has_refs := TRUE;
            v_failed_count := v_failed_count + 1;
            v_details := array_append(v_details, 'Product ' || v_prod.sku || ' is referenced in existing invoices.');
        -- Check non-opening stock movements (sales dispatch, adjustments, receiving)
        ELSIF EXISTS (
            SELECT 1 FROM public.stock_movements
            WHERE organization_id = p_org_id AND product_id = v_prod.id AND movement_type <> 'OPENING_STOCK'
        ) THEN
            v_has_refs := TRUE;
            v_failed_count := v_failed_count + 1;
            v_details := array_append(v_details, 'Product ' || v_prod.sku || ' has operational stock movement history.');
        END IF;

        IF NOT v_has_refs THEN
            -- Delete initial opening stock movement
            DELETE FROM public.stock_movements
            WHERE organization_id = p_org_id AND product_id = v_prod.id AND movement_type = 'OPENING_STOCK';

            -- Delete product row
            DELETE FROM public.products
            WHERE id = v_prod.id AND organization_id = p_org_id;

            v_undone_count := v_undone_count + 1;
        END IF;
    END LOOP;

    -- 7. Audit log
    IF v_undone_count > 0 THEN
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
            'UNDO_IMPORT_BATCH',
            'IMPORT_BATCH',
            p_batch_id,
            jsonb_build_object(
                'batch_id', p_batch_id,
                'undone_count', v_undone_count,
                'failed_count', v_failed_count
            )
        );
    END IF;

    RETURN jsonb_build_object(
        'batch_id', p_batch_id,
        'success', (v_failed_count = 0 AND v_undone_count > 0),
        'undone_count', v_undone_count,
        'failed_count', v_failed_count,
        'message', CASE
            WHEN v_failed_count = 0 THEN 'Successfully rolled back batch ' || p_batch_id::text || '. ' || v_undone_count || ' record(s) safely removed.'
            ELSE 'Partial undo: ' || v_undone_count || ' record(s) removed, but ' || v_failed_count || ' could not be removed due to transaction references.'
        END,
        'details', to_jsonb(v_details)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.undo_product_import_batch FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_product_import_batch TO authenticated;
GRANT EXECUTE ON FUNCTION public.undo_product_import_batch TO service_role;

COMMIT;
