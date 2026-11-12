-- Product nicknames and staff-approved, directional substitutes.
ALTER TABLE public.products
  ADD COLUMN search_aliases text NOT NULL DEFAULT '',
  ADD CONSTRAINT products_search_aliases_length CHECK (length(search_aliases) <= 1000);

CREATE TABLE public.product_alternatives (
  organization_id uuid NOT NULL,
  source_product_id uuid NOT NULL,
  alternative_product_id uuid NOT NULL,
  comparison_note text NOT NULL CHECK (length(btrim(comparison_note)) BETWEEN 3 AND 240),
  approved_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, source_product_id, alternative_product_id),
  CHECK (source_product_id <> alternative_product_id),
  CONSTRAINT product_alternatives_source_fk FOREIGN KEY (source_product_id, organization_id)
    REFERENCES public.products (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT product_alternatives_target_fk FOREIGN KEY (alternative_product_id, organization_id)
    REFERENCES public.products (id, organization_id) ON DELETE CASCADE
);

CREATE INDEX product_alternatives_target_idx
  ON public.product_alternatives (alternative_product_id, organization_id);

ALTER TABLE public.product_alternatives ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_alternatives FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON public.product_alternatives TO authenticated;
GRANT INSERT (organization_id, source_product_id, alternative_product_id, comparison_note)
  ON public.product_alternatives TO authenticated;

CREATE POLICY product_alternatives_read ON public.product_alternatives
  FOR SELECT TO authenticated USING (public.can_read_organization_data(organization_id));

CREATE POLICY product_alternatives_approve ON public.product_alternatives
  FOR INSERT TO authenticated WITH CHECK (
    approved_by = (SELECT auth.uid())
    AND public.can_write_organization_operations(organization_id)
    AND public.user_has_org_role(organization_id, 'owner', 'admin', 'inventory')
    AND EXISTS (
      SELECT 1 FROM public.products source
      WHERE source.id = source_product_id
        AND source.organization_id = product_alternatives.organization_id AND source.is_active
    )
    AND EXISTS (
      SELECT 1 FROM public.products alternative
      WHERE alternative.id = alternative_product_id
        AND alternative.organization_id = product_alternatives.organization_id AND alternative.is_active
    )
  );

CREATE POLICY product_alternatives_remove ON public.product_alternatives
  FOR DELETE TO authenticated USING (
    public.can_write_organization_operations(organization_id)
    AND public.user_has_org_role(organization_id, 'owner', 'admin', 'inventory')
  );

CREATE FUNCTION public.get_counter_product_alternatives(p_org_id uuid, p_product_ids uuid[])
RETURNS TABLE (source_product_id uuid, comparison_note text, product jsonb, current_stock numeric)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NOT public.can_read_organization_data(p_org_id) THEN
    RAISE EXCEPTION 'Not authorized to view product alternatives' USING ERRCODE = '42501';
  END IF;
  IF coalesce(cardinality(p_product_ids), 0) NOT BETWEEN 1 AND 8 THEN
    RAISE EXCEPTION 'Choose between one and eight products' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH candidates AS MATERIALIZED (
    SELECT requested.id AS source_id, match.*
    FROM (SELECT DISTINCT unnest(p_product_ids) AS id) requested
    CROSS JOIN LATERAL (
      SELECT alternate.id AS alternative_id, alternate.organization_id, alternate.sku,
        alternate.name, alternate.brand, alternate.category, alternate.uom,
        alternate.selling_price, alternate.tax_rate, alternate.hsn_code, alternate.is_active,
        link.comparison_note
      FROM public.product_alternatives link
      JOIN public.products alternate
        ON alternate.id = link.alternative_product_id AND alternate.organization_id = link.organization_id
      WHERE link.organization_id = p_org_id AND link.source_product_id = requested.id
        AND alternate.is_active
      ORDER BY link.created_at DESC, link.alternative_product_id
      LIMIT 8
    ) match
  ), stocks AS (
    SELECT stock.*
    FROM public.get_page_product_stock_levels(
      p_org_id, ARRAY(SELECT DISTINCT candidate.alternative_id FROM candidates candidate)
    ) stock
  )
  SELECT candidate.source_id, candidate.comparison_note,
    jsonb_build_object(
      'id', candidate.alternative_id, 'organization_id', candidate.organization_id,
      'sku', candidate.sku, 'name', candidate.name, 'brand', candidate.brand,
      'category', candidate.category, 'uom', candidate.uom, 'selling_price', candidate.selling_price,
      'tax_rate', candidate.tax_rate, 'hsn_code', candidate.hsn_code, 'is_active', candidate.is_active
    ),
    stock.current_stock
  FROM candidates candidate
  JOIN stocks stock ON stock.product_id = candidate.alternative_id
  ORDER BY candidate.source_id, (stock.current_stock > 0) DESC, candidate.name, candidate.alternative_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_counter_product_alternatives(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_counter_product_alternatives(uuid, uuid[]) TO authenticated;
