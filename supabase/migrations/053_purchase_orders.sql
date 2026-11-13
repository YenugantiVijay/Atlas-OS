CREATE TABLE public.purchase_orders (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  supplier_id uuid NOT NULL,
  supplier_name text NOT NULL,
  expected_on date,
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 500),
  lines jsonb NOT NULL CHECK (jsonb_typeof(lines) = 'array' AND jsonb_array_length(lines) BETWEEN 1 AND 50),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ORDERED')),
  order_number text,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_by uuid NOT NULL,
  ordered_by uuid,
  ordered_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (supplier_id, organization_id) REFERENCES public.suppliers(id, organization_id) ON DELETE RESTRICT,
  UNIQUE (organization_id, order_number),
  CHECK (
    (status = 'DRAFT' AND order_number IS NULL AND ordered_by IS NULL AND ordered_at IS NULL)
    OR (status = 'ORDERED' AND order_number IS NOT NULL AND ordered_by IS NOT NULL AND ordered_at IS NOT NULL)
  )
);
CREATE INDEX purchase_orders_recent_idx ON public.purchase_orders (organization_id, updated_at DESC, id DESC);
CREATE INDEX purchase_orders_supplier_idx ON public.purchase_orders (supplier_id, organization_id);

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.purchase_orders FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.purchase_orders TO authenticated;
CREATE POLICY purchase_orders_read ON public.purchase_orders FOR SELECT TO authenticated USING (
  public.can_read_organization_data(organization_id)
  AND public.user_has_org_role(organization_id, 'owner', 'admin', 'inventory')
);

CREATE TABLE atlas_private.purchase_order_counters (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  order_year integer NOT NULL,
  last_value bigint NOT NULL CHECK (last_value > 0),
  PRIMARY KEY (organization_id, order_year)
);
ALTER TABLE atlas_private.purchase_order_counters ENABLE ROW LEVEL SECURITY;
-- Only the order-placement function can advance the sequence.
REVOKE ALL ON atlas_private.purchase_order_counters FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION atlas_private.save_purchase_order_draft(
  p_org_id uuid, p_order_id uuid, p_expected_revision integer, p_supplier_id uuid,
  p_expected_on date, p_notes text, p_lines jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_order public.purchase_orders%ROWTYPE;
  v_supplier_name text;
  v_notes text := btrim(coalesce(p_notes, ''));
  v_line jsonb;
  v_product record;
  v_product_id uuid;
  v_seen uuid[] := ARRAY[]::uuid[];
  v_quantity integer;
  v_lines jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL OR public.user_has_org_role(p_org_id, 'owner', 'admin', 'inventory') IS NOT TRUE
     OR public.can_write_organization_operations(p_org_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'Not authorized to save purchase orders' USING ERRCODE = '42501';
  END IF;
  IF p_order_id IS NULL OR p_supplier_id IS NULL OR p_expected_revision < 1
     OR (p_expected_on IS NOT NULL AND NOT isfinite(p_expected_on)) OR char_length(v_notes) > 500
     OR jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Choose an active supplier and 1 to 50 products with valid order details' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_lines) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'A purchase order needs 1 to 50 products' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(nullif(btrim(company_name), ''), name) INTO v_supplier_name
  FROM public.suppliers WHERE id = p_supplier_id AND organization_id = p_org_id AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The supplier is unavailable in this workspace' USING ERRCODE = '22023';
  END IF;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    IF jsonb_typeof(v_line) IS DISTINCT FROM 'object'
       OR coalesce(v_line->>'productId', '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       OR jsonb_typeof(v_line->'quantity') IS DISTINCT FROM 'number'
       OR coalesce(v_line->>'quantity', '') !~ '^[1-9][0-9]{0,6}$'
       OR jsonb_typeof(v_line->'unitCost') IS DISTINCT FROM 'number'
       OR coalesce(v_line->>'unitCost', '') !~ '^(0|[1-9][0-9]{0,9})(\.[0-9]{1,2})?$' THEN
      RAISE EXCEPTION 'Enter a product, whole quantity and valid purchase rate on each line' USING ERRCODE = '22023';
    END IF;
    v_product_id := (v_line->>'productId')::uuid;
    v_quantity := (v_line->>'quantity')::integer;
    IF v_quantity > 1000000 OR v_product_id = ANY(v_seen) THEN
      RAISE EXCEPTION 'Each product needs one line with 1 to 1,000,000 units' USING ERRCODE = '22023';
    END IF;
    SELECT id, name, sku, uom INTO v_product FROM public.products
    WHERE id = v_product_id AND organization_id = p_org_id AND is_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'An order product is unavailable in this workspace' USING ERRCODE = '22023';
    END IF;
    IF v_product.uom IS DISTINCT FROM v_line->>'uom' THEN
      RAISE EXCEPTION 'A product unit changed. Remove and reselect that product.' USING ERRCODE = '22023';
    END IF;
    v_seen := array_append(v_seen, v_product_id);
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'productId', v_product.id, 'productName', v_product.name, 'sku', v_product.sku, 'uom', v_product.uom,
      'quantity', v_quantity, 'unitCost', (v_line->>'unitCost')::numeric(12,2)
    ));
  END LOOP;

  IF p_expected_revision IS NULL THEN
    INSERT INTO public.purchase_orders (id, organization_id, supplier_id, supplier_name, expected_on, notes, lines, created_by)
    VALUES (p_order_id, p_org_id, p_supplier_id, v_supplier_name, p_expected_on, v_notes, v_lines, v_uid)
    ON CONFLICT (id) DO NOTHING;
  END IF;
  SELECT * INTO v_order FROM public.purchase_orders WHERE id = p_order_id AND organization_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order is unavailable in this workspace' USING ERRCODE = '22023';
  END IF;
  IF v_order.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'An ordered purchase order is finalized' USING ERRCODE = '23514';
  END IF;
  IF v_order.supplier_id = p_supplier_id AND v_order.supplier_name = v_supplier_name
     AND v_order.expected_on IS NOT DISTINCT FROM p_expected_on AND v_order.notes = v_notes AND v_order.lines = v_lines THEN
    RETURN to_jsonb(v_order);
  END IF;
  IF v_order.revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'This draft was updated. Reopen it before saving changes.' USING ERRCODE = '40001';
  END IF;

  UPDATE public.purchase_orders SET supplier_id = p_supplier_id, supplier_name = v_supplier_name,
    expected_on = p_expected_on, notes = v_notes, lines = v_lines, revision = revision + 1, updated_at = now()
  WHERE id = p_order_id AND organization_id = p_org_id RETURNING * INTO v_order;
  RETURN to_jsonb(v_order);
END;
$$;

CREATE FUNCTION atlas_private.mark_purchase_order_ordered(p_org_id uuid, p_order_id uuid, p_expected_revision integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_order public.purchase_orders%ROWTYPE;
  v_product_count integer;
  v_year integer := extract(year FROM timezone('Asia/Kolkata', now()))::integer;
  v_sequence text;
  v_number text;
BEGIN
  IF v_uid IS NULL OR public.user_has_org_role(p_org_id, 'owner', 'admin', 'inventory') IS NOT TRUE
     OR public.can_write_organization_operations(p_org_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'Not authorized to place purchase orders' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_order FROM public.purchase_orders WHERE id = p_order_id AND organization_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order is unavailable in this workspace' USING ERRCODE = '22023';
  END IF;
  IF v_order.status = 'ORDERED' AND v_order.revision - 1 = p_expected_revision THEN
    RETURN to_jsonb(v_order);
  END IF;
  IF v_order.status <> 'DRAFT' OR v_order.revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'This order was updated. Reopen it before placing the order.' USING ERRCODE = '40001';
  END IF;

  PERFORM 1 FROM public.suppliers WHERE id = v_order.supplier_id AND organization_id = p_org_id AND is_active FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The supplier is no longer active' USING ERRCODE = '22023';
  END IF;
  PERFORM product.id FROM public.products product
  JOIN jsonb_array_elements(v_order.lines) AS item(line) ON product.id = (item.line->>'productId')::uuid
  WHERE product.organization_id = p_org_id AND product.is_active AND product.uom = item.line->>'uom'
  ORDER BY product.id FOR SHARE OF product;
  GET DIAGNOSTICS v_product_count = ROW_COUNT;
  IF v_product_count <> jsonb_array_length(v_order.lines) THEN
    RAISE EXCEPTION 'An order product is inactive or its unit changed' USING ERRCODE = '22023';
  END IF;

  INSERT INTO atlas_private.purchase_order_counters AS counter (organization_id, order_year, last_value)
  VALUES (p_org_id, v_year, 1)
  ON CONFLICT (organization_id, order_year) DO UPDATE SET last_value = counter.last_value + 1
  RETURNING last_value::text INTO v_sequence;
  v_number := 'PO-' || v_year || '-' || lpad(v_sequence, greatest(4, char_length(v_sequence)), '0');

  UPDATE public.purchase_orders SET status = 'ORDERED', order_number = v_number, ordered_at = now(),
    ordered_by = v_uid, revision = revision + 1, updated_at = now()
  WHERE id = p_order_id AND organization_id = p_org_id RETURNING * INTO v_order;
  INSERT INTO public.audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
  VALUES (p_org_id, v_uid, 'ISSUE_PURCHASE_ORDER', 'PURCHASE_ORDER', p_order_id,
    jsonb_build_object('order_number', v_number, 'supplier_id', v_order.supplier_id));
  RETURN to_jsonb(v_order);
END;
$$;

CREATE FUNCTION public.save_purchase_order_draft(
  p_org_id uuid, p_order_id uuid, p_expected_revision integer, p_supplier_id uuid,
  p_expected_on date, p_notes text, p_lines jsonb
) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
  SELECT atlas_private.save_purchase_order_draft(
    p_org_id, p_order_id, p_expected_revision, p_supplier_id, p_expected_on, p_notes, p_lines
  );
$$;

CREATE FUNCTION public.mark_purchase_order_ordered(p_org_id uuid, p_order_id uuid, p_expected_revision integer)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
  SELECT atlas_private.mark_purchase_order_ordered(p_org_id, p_order_id, p_expected_revision);
$$;

REVOKE ALL ON FUNCTION atlas_private.save_purchase_order_draft(uuid,uuid,integer,uuid,date,text,jsonb),
  atlas_private.mark_purchase_order_ordered(uuid,uuid,integer), public.save_purchase_order_draft(uuid,uuid,integer,uuid,date,text,jsonb),
  public.mark_purchase_order_ordered(uuid,uuid,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION atlas_private.save_purchase_order_draft(uuid,uuid,integer,uuid,date,text,jsonb),
  atlas_private.mark_purchase_order_ordered(uuid,uuid,integer), public.save_purchase_order_draft(uuid,uuid,integer,uuid,date,text,jsonb),
  public.mark_purchase_order_ordered(uuid,uuid,integer) TO authenticated;
