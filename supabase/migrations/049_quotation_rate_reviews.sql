-- Review current supplier rate increases against open customer quotation lines.
CREATE SCHEMA IF NOT EXISTS atlas_private;
REVOKE ALL ON SCHEMA atlas_private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA atlas_private TO authenticated;

CREATE TABLE atlas_private.quotation_rate_reviews (
  quotation_item_id uuid NOT NULL REFERENCES public.quotation_items(id) ON DELETE CASCADE,
  supplier_rate_id uuid NOT NULL REFERENCES public.supplier_price_history(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('REQUESTED', 'REVIEWED')),
  PRIMARY KEY (quotation_item_id, supplier_rate_id)
);
ALTER TABLE atlas_private.quotation_rate_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON atlas_private.quotation_rate_reviews FROM PUBLIC, anon, authenticated;

CREATE INDEX quotation_rate_reviews_supplier_rate_idx
  ON atlas_private.quotation_rate_reviews (supplier_rate_id);
CREATE INDEX quotation_items_product_quotation_idx
  ON public.quotation_items (product_id, quotation_id);
CREATE INDEX supplier_price_product_timeline_idx
  ON public.supplier_price_history
    (organization_id, product_id, supplier_id, effective_on DESC, recorded_at DESC, id DESC);

-- A repeated notice or receipt at the same rate keeps the original increase and its review.
-- A subsequent change supersedes it. Compare rates only when their unit snapshots agree.
CREATE FUNCTION atlas_private.quotation_rate_impacts(
  p_org_id uuid, p_quotation_id uuid, p_rate_id uuid, p_item_id uuid
) RETURNS TABLE (
  quotation_id uuid, quotation_number text, item_id uuid, product_name text,
  rate_id uuid, supplier_name text, previous_cost numeric, current_cost numeric,
  previous_margin numeric, current_margin numeric, review_status text
) LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT q.id, q.quotation_number::text, qi.id, qi.product_name::text,
    rate.id, rate.supplier_name, prior.unit_cost, rate.unit_cost,
    round(100 * (revenue.amount - prior.unit_cost * qi.quantity) / nullif(revenue.amount, 0), 1),
    round(100 * (revenue.amount - rate.unit_cost * qi.quantity) / nullif(revenue.amount, 0), 1),
    coalesce(review.status, 'OPEN')
  FROM public.quotations q
  JOIN public.quotation_items qi ON qi.quotation_id = q.id
  JOIN public.supplier_price_history rate ON rate.organization_id = q.organization_id
    AND rate.product_id = qi.product_id AND rate.product_uom = qi.uom
    AND (p_rate_id IS NULL OR rate.id = p_rate_id)
  CROSS JOIN LATERAL (
    SELECT older.unit_cost, older.product_uom
    FROM public.supplier_price_history older
    WHERE older.organization_id = rate.organization_id
      AND older.supplier_id = rate.supplier_id AND older.product_id = rate.product_id
      AND (older.effective_on, older.recorded_at, older.id)
        < (rate.effective_on, rate.recorded_at, rate.id)
    ORDER BY older.effective_on DESC, older.recorded_at DESC, older.id DESC
    LIMIT 1
  ) prior
  CROSS JOIN LATERAL (
    SELECT CASE WHEN q.totals_version = 2 AND qi.line_subtotal > 0
      THEN qi.line_subtotal END AS amount
  ) revenue
  LEFT JOIN atlas_private.quotation_rate_reviews review
    ON review.quotation_item_id = qi.id AND review.supplier_rate_id = rate.id
  WHERE q.organization_id = p_org_id
    AND (p_quotation_id IS NULL OR q.id = p_quotation_id)
    AND (p_item_id IS NULL OR qi.id = p_item_id)
    AND q.status IN ('DRAFT', 'SENT', 'ACCEPTED')
    AND q.valid_until >= (now() AT TIME ZONE 'Asia/Kolkata')::date
    AND prior.product_uom = rate.product_uom AND prior.unit_cost < rate.unit_cost
    AND NOT EXISTS (
      SELECT 1 FROM public.supplier_price_history newer
      WHERE newer.organization_id = rate.organization_id
        AND newer.supplier_id = rate.supplier_id AND newer.product_id = rate.product_id
        AND (newer.effective_on, newer.recorded_at, newer.id)
          > (rate.effective_on, rate.recorded_at, rate.id)
        AND (newer.unit_cost <> rate.unit_cost OR newer.product_uom <> rate.product_uom)
    );
$$;
REVOKE ALL ON FUNCTION atlas_private.quotation_rate_impacts(uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;

CREATE FUNCTION atlas_private.list_quotation_rate_impacts(
  p_org_id uuid, p_quotation_id uuid, p_rate_id uuid, p_offset integer
) RETURNS TABLE (
  quotation_id uuid, quotation_number text, item_id uuid, product_name text,
  rate_id uuid, supplier_name text, previous_cost numeric, current_cost numeric,
  previous_margin numeric, current_margin numeric, review_status text
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_role text := public.get_user_org_role(p_org_id);
  v_can_see_costs boolean := v_role IN ('owner', 'admin', 'inventory', 'accounts');
BEGIN
  IF auth.uid() IS NULL OR v_role IS NULL
    OR v_role NOT IN ('owner', 'admin', 'inventory', 'accounts', 'sales')
    OR NOT public.can_read_organization_data(p_org_id)
    OR (p_rate_id IS NOT NULL AND NOT v_can_see_costs) THEN
    RAISE EXCEPTION 'Not authorized to view quotation rate reviews' USING ERRCODE = '42501';
  END IF;
  IF (p_quotation_id IS NULL) = (p_rate_id IS NULL)
    OR p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'Choose one quotation or supplier rate and a valid offset' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY SELECT impact.quotation_id, impact.quotation_number,
    impact.item_id, impact.product_name, impact.rate_id,
    CASE WHEN v_can_see_costs THEN impact.supplier_name END,
    CASE WHEN v_can_see_costs THEN impact.previous_cost END,
    CASE WHEN v_can_see_costs THEN impact.current_cost END,
    CASE WHEN v_can_see_costs THEN impact.previous_margin END,
    CASE WHEN v_can_see_costs THEN impact.current_margin END,
    impact.review_status
  FROM atlas_private.quotation_rate_impacts(p_org_id, p_quotation_id, p_rate_id, NULL) impact
  ORDER BY impact.quotation_number, impact.item_id, impact.rate_id
  LIMIT 21 OFFSET p_offset;
END;
$$;
REVOKE ALL ON FUNCTION atlas_private.list_quotation_rate_impacts(uuid, uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION atlas_private.list_quotation_rate_impacts(uuid, uuid, uuid, integer)
  TO authenticated;

CREATE FUNCTION public.list_quotation_rate_impacts(
  p_org_id uuid, p_quotation_id uuid, p_rate_id uuid, p_offset integer
) RETURNS TABLE (
  quotation_id uuid, quotation_number text, item_id uuid, product_name text,
  rate_id uuid, supplier_name text, previous_cost numeric, current_cost numeric,
  previous_margin numeric, current_margin numeric, review_status text
) LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT * FROM atlas_private.list_quotation_rate_impacts(p_org_id, p_quotation_id, p_rate_id, p_offset);
$$;
REVOKE ALL ON FUNCTION public.list_quotation_rate_impacts(uuid, uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_quotation_rate_impacts(uuid, uuid, uuid, integer)
  TO authenticated;

CREATE FUNCTION atlas_private.save_quotation_rate_review(
  p_org_id uuid, p_quotation_id uuid, p_item_id uuid, p_rate_id uuid, p_status text
) RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text := public.get_user_org_role(p_org_id);
  v_status text;
BEGIN
  IF v_uid IS NULL OR v_role IS NULL OR p_status IS NULL
    OR p_status NOT IN ('REQUESTED', 'REVIEWED')
    OR v_role NOT IN ('owner', 'admin', 'sales')
    OR (p_status = 'REVIEWED' AND v_role NOT IN ('owner', 'admin'))
    OR NOT public.can_read_organization_data(p_org_id)
    OR NOT public.can_write_organization_operations(p_org_id) THEN
    RAISE EXCEPTION 'Not authorized to change quotation rate reviews' USING ERRCODE = '42501';
  END IF;
  IF p_quotation_id IS NULL OR p_item_id IS NULL OR p_rate_id IS NULL THEN
    RAISE EXCEPTION 'Quotation, item and supplier rate are required' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.quotations q
    WHERE q.id = p_quotation_id AND q.organization_id = p_org_id FOR SHARE;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM atlas_private.quotation_rate_impacts(p_org_id, p_quotation_id, p_rate_id, p_item_id)
  ) THEN
    RAISE EXCEPTION 'This rate review is no longer available' USING ERRCODE = '22023';
  END IF;

  INSERT INTO atlas_private.quotation_rate_reviews AS review (quotation_item_id, supplier_rate_id, status)
  VALUES (p_item_id, p_rate_id, p_status)
  ON CONFLICT (quotation_item_id, supplier_rate_id) DO UPDATE SET status = EXCLUDED.status
    WHERE review.status = 'REQUESTED' AND EXCLUDED.status = 'REVIEWED'
  RETURNING review.status INTO v_status;

  IF FOUND THEN
    INSERT INTO public.audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
    VALUES (p_org_id, v_uid, 'QUOTATION_RATE_' || v_status, 'QUOTATION', p_quotation_id,
      jsonb_build_object('quotation_item_id', p_item_id, 'supplier_rate_id', p_rate_id));
  ELSE
    SELECT review.status INTO v_status FROM atlas_private.quotation_rate_reviews review
    WHERE review.quotation_item_id = p_item_id AND review.supplier_rate_id = p_rate_id;
  END IF;

  RETURN v_status;
END;
$$;
REVOKE ALL ON FUNCTION atlas_private.save_quotation_rate_review(uuid, uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION atlas_private.save_quotation_rate_review(uuid, uuid, uuid, uuid, text)
  TO authenticated;

CREATE FUNCTION public.save_quotation_rate_review(
  p_org_id uuid, p_quotation_id uuid, p_item_id uuid, p_rate_id uuid, p_status text
) RETURNS text LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
  SELECT atlas_private.save_quotation_rate_review(p_org_id, p_quotation_id, p_item_id, p_rate_id, p_status);
$$;
REVOKE ALL ON FUNCTION public.save_quotation_rate_review(uuid, uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_quotation_rate_review(uuid, uuid, uuid, uuid, text)
  TO authenticated;
