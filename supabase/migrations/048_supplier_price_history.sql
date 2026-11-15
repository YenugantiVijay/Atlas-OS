-- PR #57: append-only supplier rate timeline. Forward-only, depends on 047.
-- A quoted rate is NOT a purchase transaction or an inventory valuation.
CREATE TABLE public.supplier_price_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  supplier_name text NOT NULL CHECK (length(btrim(supplier_name)) BETWEEN 1 AND 255),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  product_name text NOT NULL,
  product_sku text NOT NULL,
  product_uom text NOT NULL,
  unit_cost numeric(12,2) NOT NULL CHECK (unit_cost >= 0),
  effective_on date NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('SUPPLIER_QUOTE','GOODS_RECEIPT')),
  source_receipt_id uuid REFERENCES public.goods_receipts(id) ON DELETE RESTRICT,
  source_reference text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 500),
  actor_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_rate_origin_consistent CHECK (
    (source_type='SUPPLIER_QUOTE' AND source_receipt_id IS NULL)
    OR (source_type='GOODS_RECEIPT' AND source_receipt_id IS NOT NULL)
  )
);
-- An invoice can have several different products, but only one snapshot per product.
CREATE UNIQUE INDEX supplier_price_receipt_product_unique
  ON public.supplier_price_history (organization_id,source_receipt_id,product_id)
  WHERE source_receipt_id IS NOT NULL;
CREATE INDEX supplier_price_tenant_recent_idx ON public.supplier_price_history
  (organization_id, recorded_at DESC, id DESC);
CREATE INDEX supplier_price_pair_timeline_idx ON public.supplier_price_history
  (organization_id,supplier_id,product_id,effective_on DESC,recorded_at DESC,id DESC);

ALTER TABLE public.supplier_price_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.supplier_price_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.supplier_price_history TO authenticated;
GRANT ALL ON TABLE public.supplier_price_history TO service_role;
CREATE POLICY supplier_price_authorized_read ON public.supplier_price_history
  FOR SELECT TO authenticated
  USING (
    public.can_read_organization_data(organization_id)
    AND public.user_has_org_role(organization_id,'owner','admin','inventory','accounts')
  );

-- Even accidental privileged UPDATE/DELETE must not rewrite historic quotes/rates.
CREATE FUNCTION public.reject_supplier_price_history_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Supplier price history is append-only' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER trg_supplier_price_history_append_only
  BEFORE UPDATE OR DELETE ON public.supplier_price_history
  FOR EACH ROW EXECUTE FUNCTION public.reject_supplier_price_history_mutation();
REVOKE ALL ON FUNCTION public.reject_supplier_price_history_mutation()
  FROM PUBLIC,anon,authenticated,service_role;

-- A manual supplier quote requires a reason/reference. Stable client UUID
-- deduplicates retries and refuses payload changes using that same UUID.
CREATE FUNCTION public.record_supplier_price_quote(
  p_org_id uuid, p_entry_id uuid, p_supplier_id uuid, p_product_id uuid,
  p_unit_cost numeric, p_effective_on date, p_notes text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_existing public.supplier_price_history%ROWTYPE;
  v_supplier record;
  v_product record;
  v_previous numeric(12,2);
BEGIN
  IF v_uid IS NULL OR p_org_id IS NULL OR p_entry_id IS NULL
     OR p_supplier_id IS NULL OR p_product_id IS NULL THEN
    RAISE EXCEPTION 'Authentication and valid identifiers required' USING ERRCODE='42501';
  END IF;
  v_role := public.get_user_org_role(p_org_id);
  IF v_role IS NULL OR v_role NOT IN ('owner','admin','inventory')
     OR NOT public.can_write_organization_operations(p_org_id) THEN
    RAISE EXCEPTION 'Not authorized to record supplier purchase quotes' USING ERRCODE='42501';
  END IF;
  IF p_unit_cost IS NULL OR p_unit_cost < 0
     OR p_unit_cost > 9999999999.99 OR p_unit_cost <> round(p_unit_cost,2)
     OR p_effective_on IS NULL OR p_effective_on > current_date
     OR length(btrim(COALESCE(p_notes,''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'Enter a valid purchase rate, effective date (not future), and quote reference'
      USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('supplier_quote:'||p_entry_id::text));

  SELECT * INTO v_existing FROM public.supplier_price_history WHERE id=p_entry_id;
  IF FOUND THEN
    IF v_existing.organization_id<>p_org_id OR v_existing.supplier_id<>p_supplier_id
       OR v_existing.product_id<>p_product_id OR v_existing.unit_cost<>p_unit_cost
       OR v_existing.effective_on<>p_effective_on OR v_existing.notes<>btrim(p_notes)
       OR v_existing.source_type<>'SUPPLIER_QUOTE' THEN
      RAISE EXCEPTION 'Idempotency conflict: entry ID already used for another quote'
        USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('entry_id',p_entry_id,'idempotent_replay',true);
  END IF;

  SELECT id,coalesce(nullif(btrim(company_name),''),name) AS supplier_name
  INTO v_supplier FROM public.suppliers
  WHERE id=p_supplier_id AND organization_id=p_org_id AND is_active=true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Supplier is missing, inactive or outside the business'
      USING ERRCODE='42501';
  END IF;
  SELECT id,name,sku,uom INTO v_product FROM public.products
  WHERE id=p_product_id AND organization_id=p_org_id AND is_active=true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product is missing, inactive or outside the business'
      USING ERRCODE='42501';
  END IF;

  SELECT unit_cost INTO v_previous FROM public.supplier_price_history
  WHERE organization_id=p_org_id AND supplier_id=p_supplier_id AND product_id=p_product_id
    AND effective_on<=p_effective_on
  ORDER BY effective_on DESC,recorded_at DESC,id DESC LIMIT 1;

  INSERT INTO public.supplier_price_history (
    id, organization_id, supplier_id, supplier_name, product_id, product_name,
    product_sku, product_uom, unit_cost, effective_on,
    source_type, source_reference, notes, actor_id
  ) VALUES (
    p_entry_id,p_org_id,p_supplier_id,v_supplier.supplier_name,p_product_id,
    v_product.name,v_product.sku,v_product.uom,p_unit_cost,p_effective_on,
    'SUPPLIER_QUOTE','Supplier notice / manual quote',btrim(p_notes),v_uid
  );
  INSERT INTO public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, details
  ) VALUES (
    p_org_id,v_uid,'RECORD_SUPPLIER_PRICE','SUPPLIER_PRICE',p_entry_id,
    jsonb_build_object('supplier_id',p_supplier_id,'product_id',p_product_id,
      'effective_on',p_effective_on,'unit_cost',p_unit_cost,
      'previous_rate',v_previous,'source','SUPPLIER_QUOTE',
      'reference',btrim(p_notes))
  );
  RETURN jsonb_build_object('entry_id',p_entry_id,'idempotent_replay',false,
    'previous_rate',v_previous,'recorded_rate',p_unit_cost);
END;
$$;
REVOKE ALL ON FUNCTION public.record_supplier_price_quote(uuid,uuid,uuid,uuid,numeric,date,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_supplier_price_quote(uuid,uuid,uuid,uuid,numeric,date,text)
  TO authenticated;

-- Insert purchase-paid price history automatically in the SAME transaction
-- in which PR56 posts stock. A failed post rolls back both movements and rates.
-- The receipt row lock + status transition avoids duplicate rate inserts.
CREATE FUNCTION public.capture_posted_receipt_supplier_prices()
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
  FROM jsonb_array_elements(NEW.lines) AS t(line);
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_capture_posted_receipt_prices
  AFTER UPDATE OF status ON public.goods_receipts
  FOR EACH ROW WHEN (OLD.status='DRAFT' AND NEW.status='POSTED')
  EXECUTE FUNCTION public.capture_posted_receipt_supplier_prices();
REVOKE ALL ON FUNCTION public.capture_posted_receipt_supplier_prices()
  FROM PUBLIC,anon,authenticated,service_role;

-- Forward-only backfill for GRNs already posted under migration 047.
-- Do NOT create any inventory movement or modify product master prices.
INSERT INTO public.supplier_price_history (
  organization_id,supplier_id,supplier_name,product_id,product_name,product_sku,
  product_uom,unit_cost,effective_on,source_type,source_receipt_id,
  source_reference,notes,actor_id,recorded_at
)
SELECT gr.organization_id,gr.supplier_id,
       coalesce(nullif(btrim(s.company_name),''),s.name),
       (line->>'productId')::uuid,line->>'productName',line->>'sku',line->>'uom',
       (line->>'unitCost')::numeric(12,2),gr.received_on,
       'GOODS_RECEIPT',gr.id,gr.supplier_invoice_number,
       'Backfilled from posted GRN',gr.posted_by,gr.posted_at
FROM public.goods_receipts gr
JOIN public.suppliers s ON s.id=gr.supplier_id AND s.organization_id=gr.organization_id
CROSS JOIN LATERAL jsonb_array_elements(gr.lines) AS t(line)
WHERE gr.status='POSTED'
ON CONFLICT DO NOTHING;

COMMENT ON TABLE public.supplier_price_history IS
  'Append-only manually recorded supplier quotes and GRN purchase-rate snapshots; not inventory valuation or selling-price overrides.';
