-- Capture incoming batch identity on the authoritative stock movement.
ALTER TABLE public.stock_movements ADD COLUMN received_batch jsonb;

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
      RAISE EXCEPTION 'Receipt product not in this organization' USING ERRCODE='42501';
    END IF;
    IF NOT v_product.is_active THEN
      RAISE EXCEPTION 'Receipt product is inactive' USING ERRCODE='42501';
    END IF;

    v_loose := (v_line->>'looseUnits')::INTEGER;
    v_cost := (v_line->>'unitCost')::NUMERIC(12,2);
    IF (v_line->>'billedUnits' IS NOT NULL AND (
          jsonb_typeof(v_line->'billedUnits') IS DISTINCT FROM 'number'
          OR v_line->>'billedUnits' !~ '^(0|[1-9][0-9]{0,6})$'
        )) OR (v_line ? 'damagedUnits' AND (
          jsonb_typeof(v_line->'damagedUnits') IS DISTINCT FROM 'number'
          OR v_line->>'damagedUnits' !~ '^(0|[1-9][0-9]{0,6})$'
        )) THEN
      RAISE EXCEPTION 'Billed and damaged units must be nonnegative whole numbers' USING ERRCODE='22023';
    END IF;
    v_billed := (v_line->>'billedUnits')::INTEGER;
    v_damaged := COALESCE((v_line->>'damagedUnits')::INTEGER,0);
    IF v_billed > 1000000 OR v_damaged > 1000000 THEN
      RAISE EXCEPTION 'Billed and damaged units cannot exceed 1,000,000 per line' USING ERRCODE='22023';
    END IF;
    v_total := v_loose;
    v_packages := '[]'::jsonb;

    FOR v_package IN SELECT value FROM jsonb_array_elements(v_line->'packageCounts')
    LOOP
      IF jsonb_typeof(v_package) <> 'number'
         OR v_package::text !~ '^[1-9][0-9]{0,6}$' THEN
        RAISE EXCEPTION 'Each carton requires a positive whole-number unit count' USING ERRCODE='22023';
      END IF;
      v_total := v_total + (v_package::text)::INTEGER;
      v_packages := v_packages || jsonb_build_array((v_package::text)::INTEGER);
    END LOOP;
    IF v_total NOT BETWEEN 0 AND 1000000 OR (v_total=0 AND COALESCE(v_billed,0)=0) THEN
      RAISE EXCEPTION 'Enter received units or a positive billed quantity for an undelivered line' USING ERRCODE='22023';
    END IF;
    IF v_damaged > v_total THEN
      RAISE EXCEPTION 'Damaged units cannot exceed received units' USING ERRCODE='22023';
    END IF;
    -- Legacy lines have no batch details and keep their original payload.
    v_batch := v_line->'batch';
    IF v_batch IS NOT NULL THEN
      v_batch_name := btrim(v_batch->>'number');
      v_godown := btrim(v_batch->>'godown');
      v_expiry := v_batch->>'expiryDate';
      IF jsonb_typeof(v_batch) IS DISTINCT FROM 'object'
        OR jsonb_typeof(v_batch->'number') IS DISTINCT FROM 'string'
        OR jsonb_typeof(v_batch->'godown') IS DISTINCT FROM 'string'
        OR char_length(v_batch_name) NOT BETWEEN 1 AND 255
        OR char_length(v_godown) NOT BETWEEN 1 AND 255
        OR v_total = v_damaged
        OR (v_expiry IS NOT NULL AND v_expiry !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
      THEN
        RAISE EXCEPTION 'Batch details require a batch number, godown, and usable stock.' USING ERRCODE='22023';
      END IF;
      IF v_expiry IS NOT NULL AND v_expiry::date NOT BETWEEN DATE '1900-01-01' AND DATE '9999-12-31' THEN
        RAISE EXCEPTION 'Enter a valid batch expiry date.' USING ERRCODE='22023';
      END IF;
      v_batch := jsonb_strip_nulls(jsonb_build_object('number', v_batch_name, 'godown', v_godown, 'expiryDate', v_expiry::date));
    END IF;

    v_canonical := v_canonical || jsonb_build_array(jsonb_build_object(
      'productId',v_id,'productName',v_product.name,'sku',v_product.sku,'uom',v_product.uom,
      'packageCounts',v_packages,'looseUnits',v_loose,
      'totalUnits',v_total,'unitCost',v_cost,
      'billedUnits',v_billed,'damagedUnits',v_damaged,'usableUnits',v_total-v_damaged,
      'missingUnits',CASE WHEN v_billed IS NULL THEN 0 ELSE greatest(v_billed-v_total,0) END,
      'excessUnits',CASE WHEN v_billed IS NULL THEN 0 ELSE greatest(v_total-v_billed,0) END
    ) || CASE WHEN v_batch IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('batch', v_batch) END);
  END LOOP;
  RETURN v_canonical;
END;
$$;

CREATE FUNCTION public.set_received_stock_batch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  -- Movement writers cannot supply their own attribution.
  NEW.received_batch := NULL;
  IF NEW.movement_type = 'GOODS_RECEIVED' AND NEW.reference_type = 'PURCHASE_RECEIPT' THEN
    SELECT l.line->'batch' INTO NEW.received_batch
    FROM public.goods_receipts r
    CROSS JOIN LATERAL jsonb_array_elements(r.lines) AS l(line)
    WHERE r.id = NEW.reference_id AND r.organization_id = NEW.organization_id
      AND r.status = 'DRAFT' AND l.line->>'productId' = NEW.product_id::text;
    IF (NEW.received_batch->>'expiryDate')::date <= (clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date THEN
      RAISE EXCEPTION 'This batch is expired. Keep it out of usable receiving stock.' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_received_stock_batch() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_set_received_stock_batch
    BEFORE INSERT ON public.stock_movements
    FOR EACH ROW EXECUTE FUNCTION public.set_received_stock_batch();
