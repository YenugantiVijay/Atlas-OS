-- B2 PR #44: Bounded operational search without exposing financial totals.
-- Invoker privileges + existing RLS protect suppliers, quotations, orders and customers.
CREATE OR REPLACE FUNCTION public.search_operational_records(
    p_org_id UUID,
    p_query TEXT,
    p_limit_per_type INTEGER DEFAULT 3
)
RETURNS TABLE (
    record_type TEXT,
    record_id UUID,
    reference TEXT,
    display_name TEXT,
    contact_phone TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_query TEXT := btrim(coalesce(p_query, ''));
    v_pattern TEXT;
    v_digits TEXT;
BEGIN
    IF auth.uid() IS NULL OR NOT public.can_read_organization_data(p_org_id) THEN
        RAISE EXCEPTION 'Operational search access denied' USING ERRCODE = '42501';
    END IF;
    IF length(v_query) < 2 OR length(v_query) > 100 THEN
        RAISE EXCEPTION 'Search requires 2 to 100 characters' USING ERRCODE = '22023';
    END IF;
    IF p_limit_per_type IS NULL OR p_limit_per_type < 1 OR p_limit_per_type > 5 THEN
        RAISE EXCEPTION 'Per-type limit must be between 1 and 5' USING ERRCODE = '22023';
    END IF;

    v_pattern := '%' || replace(replace(replace(v_query, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%';
    v_digits := regexp_replace(v_query, '[^0-9]', '', 'g');

    RETURN QUERY
    SELECT hit.kind, hit.id, hit.ref, hit.label, hit.phone
    FROM (
      (SELECT 'supplier'::text AS kind, s.id,
              s.name::text AS ref, coalesce(s.company_name, s.name)::text AS label,
              s.phone::text AS phone
       FROM public.suppliers s
       WHERE s.organization_id = p_org_id
         AND (s.name ILIKE v_pattern ESCAPE E'\\'
              OR coalesce(s.company_name, '') ILIKE v_pattern ESCAPE E'\\'
              OR (length(v_digits) >= 3 AND
                  regexp_replace(coalesce(s.phone, ''), '[^0-9]', '', 'g')
                    LIKE '%' || v_digits || '%'))
       ORDER BY s.name, s.id
       LIMIT p_limit_per_type)
      UNION ALL
      (SELECT 'quotation'::text, q.id, q.quotation_number::text,
              c.name::text, NULL::text
       FROM public.quotations q
       JOIN public.customers c
         ON c.id = q.customer_id AND c.organization_id = q.organization_id
       WHERE q.organization_id = p_org_id
         AND (q.quotation_number ILIKE v_pattern ESCAPE E'\\'
              OR c.name ILIKE v_pattern ESCAPE E'\\'
              OR coalesce(c.company_name, '') ILIKE v_pattern ESCAPE E'\\')
       ORDER BY q.created_at DESC, q.id
       LIMIT p_limit_per_type)
      UNION ALL
      (SELECT 'sales_order'::text, so.id, so.order_number::text,
              c.name::text, NULL::text
       FROM public.sales_orders so
       JOIN public.customers c
         ON c.id = so.customer_id AND c.organization_id = so.organization_id
       WHERE so.organization_id = p_org_id
         AND (so.order_number ILIKE v_pattern ESCAPE E'\\'
              OR c.name ILIKE v_pattern ESCAPE E'\\'
              OR coalesce(c.company_name, '') ILIKE v_pattern ESCAPE E'\\')
       ORDER BY so.created_at DESC, so.id
       LIMIT p_limit_per_type)
    ) hit;
END;
$$;

REVOKE ALL ON FUNCTION public.search_operational_records(UUID, TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_operational_records(UUID, TEXT, INTEGER) TO authenticated;
COMMENT ON FUNCTION public.search_operational_records(UUID, TEXT, INTEGER) IS
'B2: invoker/RLS-bound, per-type-limited supplier, quotation and sales order discovery without monetary fields.';
