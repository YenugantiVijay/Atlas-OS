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
