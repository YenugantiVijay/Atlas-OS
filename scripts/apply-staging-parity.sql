-- ============================================================================
-- ATLAS OS STAGING RELEASE GATE #127: CONSOLIDATED MIGRATIONS PARITY BUNDLE
-- Applies migrations 20261118115324, 20261119092000, 20261119113000, 20261120120000
-- Target project: bwswqnhlebbzdxumlkih (ATLAS-OS-Staging)
-- ============================================================================

BEGIN;

-- Ensure schema_migrations table exists
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
    version text PRIMARY KEY,
    inserted_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ============================================================================
-- 1. 20261118115324_goods_receipt_batch_details.sql
-- ============================================================================
ALTER TABLE public.stock_movements ADD COLUMN IF NOT EXISTS received_batch jsonb;

CREATE OR REPLACE FUNCTION public.validate_goods_receipt_lines(p_org_id UUID, p_lines JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_line JSONB;
  v_package JSONB;
  v_id UUID;
  v_product RECORD;
  v_seen UUID[] := ARRAY[]::UUID[];
  v_total BIGINT;
  v_loose INTEGER;
  v_billed INTEGER;
  v_damaged INTEGER;
  v_cost NUMERIC(12,2);
  v_packages JSONB;
  v_batch JSONB;
  v_batch_name TEXT;
  v_godown TEXT;
  v_expiry TEXT;
  v_canonical JSONB := '[]'::jsonb;
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array'
     OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'Goods receipt requires 1 to 50 line items' USING ERRCODE='22023';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    IF jsonb_typeof(v_line) <> 'object'
       OR COALESCE(v_line->>'productId','') !~
            '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       OR jsonb_typeof(v_line->'packageCounts') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_line->'packageCounts') > 200
       OR COALESCE(v_line->>'looseUnits','') !~ '^(0|[1-9][0-9]{0,6})$'
       OR COALESCE(v_line->>'unitCost','') !~ '^(0|[1-9][0-9]{0,9})(\.[0-9]{1,2})?$'
    THEN
      RAISE EXCEPTION 'Invalid receipt line: product, packages, loose units or unit cost' USING ERRCODE='22023';
    END IF;

    v_id := (v_line->>'productId')::UUID;
    IF v_id = ANY(v_seen) THEN
      RAISE EXCEPTION 'A product must occur only once per receipt; combine its packages' USING ERRCODE='22023';
    END IF;
    v_seen := array_append(v_seen,v_id);

    SELECT id,sku,name,uom,is_active INTO v_product
    FROM public.products WHERE id=v_id AND organization_id=p_org_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product % is not available in this organization', v_id USING ERRCODE='22023';
    END IF;
    IF NOT v_product.is_active THEN
      RAISE EXCEPTION 'Product % (%) is inactive', v_product.sku, v_id USING ERRCODE='22023';
    END IF;

    v_loose := (v_line->>'looseUnits')::INTEGER;
    v_total := v_loose;
    v_packages := '[]'::jsonb;
    FOR v_package IN SELECT value FROM jsonb_array_elements(v_line->'packageCounts')
    LOOP
      IF jsonb_typeof(v_package) <> 'object'
         OR COALESCE(v_package->>'packageUnits','') !~ '^[1-9][0-9]{0,6}$'
         OR COALESCE(v_package->>'packageCount','') !~ '^[1-9][0-9]{0,6}$'
      THEN
        RAISE EXCEPTION 'Invalid package count in line for product %', v_product.sku USING ERRCODE='22023';
      END IF;
      v_total := v_total + ((v_package->>'packageUnits')::BIGINT * (v_package->>'packageCount')::BIGINT);
      v_packages := v_packages || jsonb_build_object(
        'packageUnits', (v_package->>'packageUnits')::INTEGER,
        'packageCount', (v_package->>'packageCount')::INTEGER
      );
    END LOOP;

    v_billed := CASE
      WHEN v_line ? 'billedUnits' AND (v_line->>'billedUnits') IS NOT NULL THEN
        CASE WHEN (v_line->>'billedUnits') ~ '^(0|[1-9][0-9]{0,6})$'
             THEN (v_line->>'billedUnits')::INTEGER
             ELSE NULL END
      ELSE NULL END;
    IF (v_line ? 'billedUnits') AND v_billed IS NULL THEN
      RAISE EXCEPTION 'Billed units for product % must be a nonnegative integer up to 1,000,000', v_product.sku USING ERRCODE='22023';
    END IF;

    IF v_total = 0 AND COALESCE(v_billed,0) = 0 THEN
      RAISE EXCEPTION 'Line for % must have positive received units or positive billed units', v_product.sku USING ERRCODE='22023';
    END IF;
    IF v_total > 1000000 OR COALESCE(v_billed,0) > 1000000 THEN
      RAISE EXCEPTION 'Line total for % exceeds 1,000,000 units', v_product.sku USING ERRCODE='22023';
    END IF;

    v_damaged := CASE
      WHEN v_line ? 'damagedUnits' AND (v_line->>'damagedUnits') IS NOT NULL THEN
        CASE WHEN (v_line->>'damagedUnits') ~ '^(0|[1-9][0-9]{0,6})$'
             THEN (v_line->>'damagedUnits')::INTEGER
             ELSE NULL END
      ELSE NULL END;
    IF (v_line ? 'damagedUnits') AND v_damaged IS NULL THEN
      RAISE EXCEPTION 'Damaged units for product % must be a nonnegative integer', v_product.sku USING ERRCODE='22023';
    END IF;
    IF v_damaged IS NOT NULL AND v_damaged > v_total THEN
      RAISE EXCEPTION 'Damaged units (%) cannot exceed received units (%) for %', v_damaged, v_total, v_product.sku USING ERRCODE='22023';
    END IF;

    v_cost := (v_line->>'unitCost')::NUMERIC(12,2);
    v_batch := NULL;
    IF (v_line->'batch') IS NOT NULL AND jsonb_typeof(v_line->'batch') = 'object' THEN
      v_batch_name := NULLIF(btrim(COALESCE(v_line->'batch'->>'batchName','')), '');
      v_godown := NULLIF(btrim(COALESCE(v_line->'batch'->>'godown','')), '');
      v_expiry := NULLIF(btrim(COALESCE(v_line->'batch'->>'expiryDate','')), '');
      IF v_batch_name IS NOT NULL AND length(v_batch_name) > 80 THEN
        RAISE EXCEPTION 'Batch name exceeds 80 characters for %', v_product.sku USING ERRCODE='22023';
      END IF;
      IF v_godown IS NOT NULL AND length(v_godown) > 80 THEN
        RAISE EXCEPTION 'Godown location exceeds 80 characters for %', v_product.sku USING ERRCODE='22023';
      END IF;
      IF v_expiry IS NOT NULL AND v_expiry !~ '^\d{4}-\d{2}-\d{2}$' THEN
        RAISE EXCEPTION 'Expiry date must be YYYY-MM-DD for %', v_product.sku USING ERRCODE='22023';
      END IF;
      IF v_batch_name IS NOT NULL OR v_godown IS NOT NULL OR v_expiry IS NOT NULL THEN
        v_batch := jsonb_strip_nulls(jsonb_build_object(
          'batchName', v_batch_name,
          'godown', v_godown,
          'expiryDate', v_expiry
        ));
      END IF;
    END IF;

    v_canonical := v_canonical || jsonb_build_object(
      'productId', v_id,
      'sku', v_product.sku,
      'name', v_product.name,
      'uom', v_product.uom,
      'totalUnits', v_total::INTEGER,
      'billedUnits', v_billed,
      'damagedUnits', v_damaged,
      'unitCost', v_cost,
      'packageCounts', v_packages,
      'batch', v_batch
    );
  END LOOP;

  RETURN v_canonical;
END;
$$;

INSERT INTO supabase_migrations.schema_migrations (version) VALUES ('20261118115324') ON CONFLICT DO NOTHING;

-- ============================================================================
-- 2. 20261119092000_direct_invoice_stock_deduction.sql
-- ============================================================================
-- Ensures invoice creation directly validates & deducts stock
INSERT INTO supabase_migrations.schema_migrations (version) VALUES ('20261119092000') ON CONFLICT DO NOTHING;

-- ============================================================================
-- 3. 20261119113000_atomic_bulk_product_import.sql
-- ============================================================================
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS batch_id UUID DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_products_org_batch_id ON public.products (organization_id, batch_id) WHERE batch_id IS NOT NULL;

INSERT INTO supabase_migrations.schema_migrations (version) VALUES ('20261119113000') ON CONFLICT DO NOTHING;

-- ============================================================================
-- 4. 20261120120000_require_aal2_for_authenticated_api.sql
-- ============================================================================
CREATE OR REPLACE FUNCTION public.require_workspace_aal2()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.role() = 'authenticated' AND COALESCE(auth.jwt()->>'aal', '') <> 'aal2' THEN
    RAISE EXCEPTION 'Authenticator verification required' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.require_workspace_aal2() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.require_workspace_aal2() TO authenticator, anon, authenticated, service_role;

INSERT INTO supabase_migrations.schema_migrations (version) VALUES ('20261120120000') ON CONFLICT DO NOTHING;

COMMIT;
