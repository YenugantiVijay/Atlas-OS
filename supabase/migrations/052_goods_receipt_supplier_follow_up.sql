-- Keep the supplier's resolution separate from the posted receipt and its stock ledger.
CREATE TABLE atlas_private.goods_receipt_follow_up_resolutions (
  receipt_id uuid PRIMARY KEY REFERENCES public.goods_receipts(id) ON DELETE RESTRICT,
  resolution_note text NOT NULL CHECK (char_length(btrim(resolution_note)) BETWEEN 3 AND 500),
  resolved_by uuid NOT NULL,
  resolved_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE atlas_private.goods_receipt_follow_up_resolutions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON atlas_private.goods_receipt_follow_up_resolutions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON atlas_private.goods_receipt_follow_up_resolutions TO authenticated;
CREATE POLICY goods_receipt_follow_up_read ON atlas_private.goods_receipt_follow_up_resolutions
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.goods_receipts receipt
    WHERE receipt.id = goods_receipt_follow_up_resolutions.receipt_id
      AND public.user_has_org_role(receipt.organization_id, 'owner', 'admin', 'inventory')
  ));

CREATE INDEX goods_receipts_delivery_follow_up_idx ON public.goods_receipts (organization_id, posted_at, id)
  WHERE status = 'POSTED'
    AND jsonb_path_exists(lines, '$[*] ? (@.missingUnits > 0 || @.damagedUnits > 0 || @.excessUnits > 0)');

CREATE FUNCTION public.list_goods_receipt_follow_ups(
  p_org_id uuid, p_resolved boolean, p_after_posted_at timestamptz, p_after_receipt_id uuid
) RETURNS TABLE (
  receipt_id uuid, supplier_invoice_number text, supplier_name text, received_on date,
  posted_at timestamptz, lines jsonb, resolution_note text, resolved_at timestamptz
) LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL
     OR public.user_has_org_role(p_org_id, 'owner', 'admin', 'inventory') IS NOT TRUE
     OR public.can_read_organization_data(p_org_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'Not authorized to view supplier follow-ups' USING ERRCODE = '42501';
  END IF;
  IF p_resolved IS NULL OR (p_after_posted_at IS NULL) <> (p_after_receipt_id IS NULL) THEN
    RAISE EXCEPTION 'Invalid supplier follow-up filter or page cursor' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT receipt.id, receipt.supplier_invoice_number,
    coalesce(nullif(btrim(supplier.company_name), ''), supplier.name, 'Supplier')::text,
    receipt.received_on, receipt.posted_at,
    (SELECT jsonb_agg(jsonb_build_object(
       'productId', line->>'productId', 'productName', line->>'productName', 'sku', line->>'sku',
       'totalUnits', line->'totalUnits', 'billedUnits', line->'billedUnits', 'damagedUnits', line->'damagedUnits'
     ) ORDER BY position)
     FROM jsonb_path_query(receipt.lines,
       '$[*] ? (@.missingUnits > 0 || @.damagedUnits > 0 || @.excessUnits > 0)'
     ) WITH ORDINALITY AS discrepancy(line, position)),
    resolution.resolution_note, resolution.resolved_at
  FROM public.goods_receipts receipt
  LEFT JOIN atlas_private.goods_receipt_follow_up_resolutions resolution ON resolution.receipt_id = receipt.id
  LEFT JOIN public.suppliers supplier ON supplier.id = receipt.supplier_id
    AND supplier.organization_id = receipt.organization_id
  WHERE receipt.organization_id = p_org_id AND receipt.status = 'POSTED'
    AND jsonb_path_exists(receipt.lines, '$[*] ? (@.missingUnits > 0 || @.damagedUnits > 0 || @.excessUnits > 0)')
    AND (resolution.receipt_id IS NOT NULL) = p_resolved
    AND (p_after_posted_at IS NULL OR (receipt.posted_at, receipt.id) > (p_after_posted_at, p_after_receipt_id))
  ORDER BY receipt.posted_at, receipt.id
  LIMIT 26;
END;
$$;
REVOKE ALL ON FUNCTION public.list_goods_receipt_follow_ups(uuid, boolean, timestamptz, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_goods_receipt_follow_ups(uuid, boolean, timestamptz, uuid) TO authenticated;

CREATE FUNCTION atlas_private.resolve_goods_receipt_follow_up(
  p_org_id uuid, p_receipt_id uuid, p_resolution_note text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_note text;
  v_invoice text;
  v_existing atlas_private.goods_receipt_follow_up_resolutions%ROWTYPE;
BEGIN
  IF v_uid IS NULL
     OR public.user_has_org_role(p_org_id, 'owner', 'admin', 'inventory') IS NOT TRUE
     OR public.can_write_organization_operations(p_org_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'Not authorized to resolve supplier follow-ups' USING ERRCODE = '42501';
  END IF;
  v_note := regexp_replace(coalesce(p_resolution_note, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  IF p_receipt_id IS NULL OR char_length(v_note) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'Enter a resolution note of 3 to 500 characters' USING ERRCODE = '22023';
  END IF;

  SELECT receipt.supplier_invoice_number INTO v_invoice
  FROM public.goods_receipts receipt
  WHERE receipt.id = p_receipt_id AND receipt.organization_id = p_org_id AND receipt.status = 'POSTED'
    AND jsonb_path_exists(receipt.lines, '$[*] ? (@.missingUnits > 0 || @.damagedUnits > 0 || @.excessUnits > 0)');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No posted delivery discrepancy found for this receipt in the workspace' USING ERRCODE = '22023';
  END IF;

  -- The receipt primary key serializes resolution attempts from different operators.
  INSERT INTO atlas_private.goods_receipt_follow_up_resolutions (receipt_id, resolution_note, resolved_by)
  VALUES (p_receipt_id, v_note, v_uid) ON CONFLICT (receipt_id) DO NOTHING;
  IF NOT FOUND THEN
    SELECT * INTO STRICT v_existing FROM atlas_private.goods_receipt_follow_up_resolutions
    WHERE receipt_id = p_receipt_id;
    IF v_existing.resolved_by <> v_uid OR v_existing.resolution_note <> v_note THEN
      RAISE EXCEPTION 'This follow-up is already resolved. Refresh to see the recorded note.' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('receipt_id', p_receipt_id, 'idempotent_replay', true);
  END IF;

  INSERT INTO public.audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
  VALUES (p_org_id, v_uid, 'RESOLVE_GOODS_RECEIPT_FOLLOW_UP', 'GOODS_RECEIPT', p_receipt_id,
    jsonb_build_object('supplier_invoice', v_invoice));
  RETURN jsonb_build_object('receipt_id', p_receipt_id, 'idempotent_replay', false);
END;
$$;
REVOKE ALL ON FUNCTION atlas_private.resolve_goods_receipt_follow_up(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION atlas_private.resolve_goods_receipt_follow_up(uuid, uuid, text) TO authenticated;

CREATE FUNCTION public.resolve_goods_receipt_follow_up(
  p_org_id uuid, p_receipt_id uuid, p_resolution_note text
) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
  SELECT atlas_private.resolve_goods_receipt_follow_up(p_org_id, p_receipt_id, p_resolution_note);
$$;
REVOKE ALL ON FUNCTION public.resolve_goods_receipt_follow_up(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_goods_receipt_follow_up(uuid, uuid, text) TO authenticated;
