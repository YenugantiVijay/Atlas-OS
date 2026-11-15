-- Keep totalUnits as the physical receipt count for legacy records.
-- Recalculate usable stock from delivered and damaged quantities on the server.

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
    v_canonical := v_canonical || jsonb_build_array(jsonb_build_object(
      'productId',v_id,'productName',v_product.name,'sku',v_product.sku,'uom',v_product.uom,
      'packageCounts',v_packages,'looseUnits',v_loose,
      'totalUnits',v_total,'unitCost',v_cost,
      'billedUnits',v_billed,'damagedUnits',v_damaged,'usableUnits',v_total-v_damaged,
      'missingUnits',CASE WHEN v_billed IS NULL THEN 0 ELSE greatest(v_billed-v_total,0) END,
      'excessUnits',CASE WHEN v_billed IS NULL THEN 0 ELSE greatest(v_total-v_billed,0) END
    ));
  END LOOP;
  RETURN v_canonical;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_goods_receipt_draft(
  p_org_id UUID, p_receipt_id UUID, p_supplier_id UUID,
  p_supplier_invoice_number TEXT, p_received_on DATE, p_notes TEXT, p_lines JSONB
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_receipt public.goods_receipts%ROWTYPE;
  v_lines JSONB;
BEGIN
  IF v_uid IS NULL OR p_org_id IS NULL OR p_receipt_id IS NULL OR p_supplier_id IS NULL THEN
    RAISE EXCEPTION 'Authentication and valid receipt identifiers required' USING ERRCODE='42501';
  END IF;
  v_role := public.get_user_org_role(p_org_id);
  IF v_role IS NULL OR v_role NOT IN ('owner','admin','inventory')
     OR NOT public.can_write_organization_operations(p_org_id) THEN
    RAISE EXCEPTION 'Not authorized to save goods receipts' USING ERRCODE='42501';
  END IF;
  IF p_supplier_invoice_number IS NULL OR length(btrim(p_supplier_invoice_number)) NOT BETWEEN 1 AND 100
     OR p_received_on IS NULL OR length(COALESCE(p_notes,'')) > 1000 THEN
    RAISE EXCEPTION 'Supplier invoice, receipt date and notes are invalid' USING ERRCODE='22023';
  END IF;
  PERFORM 1 FROM public.suppliers
    WHERE id=p_supplier_id AND organization_id=p_org_id AND is_active=TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Supplier not active or not in this organization' USING ERRCODE='42501';
  END IF;

  v_lines := public.validate_goods_receipt_lines(p_org_id,p_lines);

  -- A fixed receipt UUID safely deduplicates connection retries. The receipt
  -- row is serialized against a simultaneous posting transaction.
  INSERT INTO public.goods_receipts (
    id,organization_id,supplier_id,supplier_invoice_number,
    received_on,notes,lines,created_by
  ) VALUES (
    p_receipt_id,p_org_id,p_supplier_id,btrim(p_supplier_invoice_number),
    p_received_on,btrim(COALESCE(p_notes,'')),v_lines,v_uid
  ) ON CONFLICT (id) DO NOTHING;

  SELECT * INTO v_receipt FROM public.goods_receipts
    WHERE id=p_receipt_id FOR UPDATE;
  IF NOT FOUND OR v_receipt.organization_id <> p_org_id THEN
    RAISE EXCEPTION 'Receipt ID does not belong to this organization' USING ERRCODE='42501';
  END IF;
  IF v_receipt.status <> 'DRAFT' THEN
    -- Retries after a successful post must not mutate a posted receipt.
    RAISE EXCEPTION 'Posted goods receipts are immutable' USING ERRCODE='23514';
  END IF;
  -- Older clients omit both delivery fields. Keep an existing discrepancy
  -- intact unless the caller explicitly supplies the delivery fields.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_receipt.lines) AS t(line)
    WHERE line->>'billedUnits' IS NOT NULL OR COALESCE((line->>'damagedUnits')::INTEGER,0)>0
  ) AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_lines) AS t(line)
    WHERE NOT (line ? 'billedUnits' AND line ? 'damagedUnits')
  ) THEN
    RAISE EXCEPTION 'Refresh Atlas OS to edit this receipt with delivery details' USING ERRCODE='22023';
  END IF;
  UPDATE public.goods_receipts SET
    supplier_id=p_supplier_id,supplier_invoice_number=btrim(p_supplier_invoice_number),
    received_on=p_received_on,notes=btrim(COALESCE(p_notes,'')),lines=v_lines,updated_at=now()
  WHERE id=p_receipt_id AND organization_id=p_org_id AND status='DRAFT';

  RETURN jsonb_build_object('receipt_id',p_receipt_id,'status','DRAFT','line_count',jsonb_array_length(v_lines));
END;
$$;

-- A distinct endpoint lets the delivery-check client fail before saving
-- if the database migration has not been applied. The existing RPC owns
-- validation, permissions, and the transaction.
CREATE FUNCTION public.save_goods_receipt_delivery_draft(
  p_org_id UUID, p_receipt_id UUID, p_supplier_id UUID,
  p_supplier_invoice_number TEXT, p_received_on DATE, p_notes TEXT, p_lines JSONB
) RETURNS JSONB LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
  SELECT public.save_goods_receipt_draft(
    p_org_id,p_receipt_id,p_supplier_id,p_supplier_invoice_number,p_received_on,p_notes,p_lines
  );
$$;
REVOKE ALL ON FUNCTION public.save_goods_receipt_delivery_draft(UUID,UUID,UUID,TEXT,DATE,TEXT,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_goods_receipt_delivery_draft(UUID,UUID,UUID,TEXT,DATE,TEXT,JSONB)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.post_goods_receipt(p_org_id UUID,p_receipt_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_receipt public.goods_receipts%ROWTYPE;
  v_line JSONB;
  v_validated_lines JSONB;
  v_prod UUID;
  v_units INTEGER;
  v_total BIGINT := 0;
  v_received BIGINT := 0;
  v_damaged BIGINT := 0;
  v_missing BIGINT := 0;
  v_excess BIGINT := 0;
BEGIN
  IF v_uid IS NULL OR p_org_id IS NULL OR p_receipt_id IS NULL THEN
    RAISE EXCEPTION 'Authentication and receipt identifiers required' USING ERRCODE='42501';
  END IF;
  v_role := public.get_user_org_role(p_org_id);
  IF v_role IS NULL OR v_role NOT IN ('owner','admin','inventory')
     OR NOT public.can_write_organization_operations(p_org_id) THEN
    RAISE EXCEPTION 'Not authorized to post goods receipts' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_receipt FROM public.goods_receipts
    WHERE id=p_receipt_id AND organization_id=p_org_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receipt not found in organization' USING ERRCODE='42501';
  END IF;
  IF v_receipt.status='POSTED' THEN
    RETURN jsonb_build_object('receipt_id',p_receipt_id,'status','POSTED','idempotent_replay',true);
  END IF;
  IF v_receipt.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Receipt cannot be posted in this status' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM public.suppliers WHERE id=v_receipt.supplier_id
    AND organization_id=p_org_id AND is_active=TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Supplier is inactive or not in organization' USING ERRCODE='42501';
  END IF;

  -- Refuse stale or malformed lines. Totals are recalculated from individual
  -- package counts; no browser total is used for stock postings.
  v_validated_lines := public.validate_goods_receipt_lines(p_org_id,v_receipt.lines);

  -- Deterministic ascending product locks avoid deadlocks with other workflows.
  FOR v_prod IN
    SELECT (line->>'productId')::UUID
    FROM jsonb_array_elements(v_validated_lines) AS t(line)
    ORDER BY 1
  LOOP
    PERFORM 1 FROM public.products
      WHERE id=v_prod AND organization_id=p_org_id AND is_active=TRUE FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product missing/inactive at posting' USING ERRCODE='42501';
    END IF;
  END LOOP;

  FOR v_line IN SELECT value FROM jsonb_array_elements(v_validated_lines)
  LOOP
    v_prod := (v_line->>'productId')::UUID;
    v_units := (v_line->>'usableUnits')::INTEGER;
    v_total := v_total + v_units;
    v_received := v_received + (v_line->>'totalUnits')::INTEGER;
    v_damaged := v_damaged + (v_line->>'damagedUnits')::INTEGER;
    v_missing := v_missing + (v_line->>'missingUnits')::INTEGER;
    v_excess := v_excess + (v_line->>'excessUnits')::INTEGER;
    IF v_units=0 THEN CONTINUE; END IF;
    INSERT INTO public.stock_movements (
      organization_id,product_id,quantity_change,movement_type,
      reference_type,reference_id,actor_id,notes
    ) VALUES (
      p_org_id,v_prod,v_units,'GOODS_RECEIVED',
      'PURCHASE_RECEIPT',p_receipt_id,v_uid,
      'Goods receipt ' || v_receipt.supplier_invoice_number
    );
  END LOOP;

  UPDATE public.goods_receipts SET status='POSTED',posted_by=v_uid,posted_at=now(),updated_at=now()
    WHERE id=p_receipt_id AND organization_id=p_org_id AND status='DRAFT';

  INSERT INTO public.audit_events (
    organization_id,actor_id,action,entity_type,entity_id,details
  ) VALUES (
    p_org_id,v_uid,'POST_GOODS_RECEIPT','GOODS_RECEIPT',p_receipt_id,
    jsonb_build_object('supplier_id',v_receipt.supplier_id,
      'supplier_invoice',v_receipt.supplier_invoice_number,
      'line_count',jsonb_array_length(v_receipt.lines),'total_units',v_total,
      'received_units',v_received,'damaged_units',v_damaged,
      'missing_units',v_missing,'excess_units',v_excess)
  );
  RETURN jsonb_build_object(
    'receipt_id',p_receipt_id,'status','POSTED',
    'line_count',jsonb_array_length(v_receipt.lines),'total_units',v_total,
    'idempotent_replay',false
  );
END;
$$;

-- A line with no usable units is a discrepancy record, not a purchase-rate observation.

CREATE OR REPLACE FUNCTION public.capture_posted_receipt_supplier_prices()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_supplier_name text;
BEGIN
  SELECT coalesce(nullif(btrim(company_name),''),name) INTO v_supplier_name
  FROM public.suppliers WHERE id=NEW.supplier_id AND organization_id=NEW.organization_id;
  IF v_supplier_name IS NULL THEN
    RAISE EXCEPTION 'Receipt supplier missing at posting' USING ERRCODE='23503';
  END IF;
  INSERT INTO public.supplier_price_history (
    organization_id,supplier_id,supplier_name,product_id,product_name,product_sku,
    product_uom,unit_cost,effective_on,source_type,source_receipt_id,
    source_reference,notes,actor_id,recorded_at
  )
  SELECT NEW.organization_id,NEW.supplier_id,v_supplier_name,
         (line->>'productId')::uuid,line->>'productName',line->>'sku',line->>'uom',
         (line->>'unitCost')::numeric(12,2),NEW.received_on,
         'GOODS_RECEIPT',NEW.id,NEW.supplier_invoice_number,
         'Captured from posted GRN',NEW.posted_by,NEW.posted_at
  FROM jsonb_array_elements(NEW.lines) AS t(line)
  WHERE COALESCE((line->>'usableUnits')::INTEGER,(line->>'totalUnits')::INTEGER)>0;
  RETURN NEW;
END;
$$;
