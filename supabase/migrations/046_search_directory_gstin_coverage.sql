-- PR #54: Search customer and supplier GSTIN alongside existing name,
-- company and punctuation-independent phone matching. Deliberately retain the
-- existing RETURNS TABLE shape: directory responses remain minimal and MUST
-- NOT disclose credit limits, receivables or financial totals.
-- SECURITY INVOKER + active membership and RLS still authorize every lookup.
-- Preserve legacy function signatures/grants; only additional indexed master
-- fields are matched (no new search entity or unrestricted data access).

-- B2 PR #43: role-scoped directory lookup with punctuation-independent phone search.
-- Unlike full customer data reads this returns no balances or credit-limit fields.
-- SECURITY INVOKER intentionally retains customers RLS, table grants, and tenant isolation.
CREATE OR REPLACE FUNCTION public.search_customer_directory(
    p_org_id uuid,
    p_query text,
    p_limit integer DEFAULT 3
)
RETURNS TABLE (
    id uuid,
    name text,
    company_name text,
    phone text
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_query text := btrim(coalesce(p_query, ''));
    v_digits text;
    v_pattern text;
BEGIN
    IF auth.uid() IS NULL OR NOT public.can_read_organization_data(p_org_id) THEN
        RAISE EXCEPTION 'Customer directory search access denied'
            USING ERRCODE = '42501';
    END IF;
    IF length(v_query) < 2 OR length(v_query) > 100 THEN
        RAISE EXCEPTION 'Search query requires 2 to 100 characters'
            USING ERRCODE = '22023';
    END IF;
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 20 THEN
        RAISE EXCEPTION 'Search limit must be between 1 and 20'
            USING ERRCODE = '22023';
    END IF;

    -- ESCAPE the SQL LIKE metacharacters: queries such as '%' are literal.
    v_pattern := '%' || replace(replace(replace(v_query, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%';
    v_digits := regexp_replace(v_query, '[^0-9]', '', 'g');

    RETURN QUERY
    SELECT c.id, c.name::text, c.company_name::text, c.phone::text
    FROM public.customers AS c
    WHERE c.organization_id = p_org_id
      AND (
        c.name ILIKE v_pattern ESCAPE E'\\'
        OR coalesce(c.company_name, '') ILIKE v_pattern ESCAPE E'\\'
        OR coalesce(c.gstin, '') ILIKE v_pattern ESCAPE E'\\'
        OR (
          length(v_digits) >= 3
          AND regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g')
              LIKE ('%' || v_digits || '%')
        )
      )
    ORDER BY c.name, c.id
    LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.search_customer_directory(uuid, text, integer)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_customer_directory(uuid, text, integer)
    TO authenticated;
COMMENT ON FUNCTION public.search_customer_directory(uuid, text, integer) IS
'B2: bounded tenant/RLS-scoped directory lookup using normalized phone digits, without financial balances.';

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
              OR coalesce(s.gstin, '') ILIKE v_pattern ESCAPE E'\\'
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

