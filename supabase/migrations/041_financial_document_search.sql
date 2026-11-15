-- B2: Bounded, finance-role protected global document search.
-- All results are scoped to one eligible organization and the caller's
-- authoritative authenticated membership. No raw ledger exposed to other roles.
CREATE OR REPLACE FUNCTION public.search_financial_documents(
    p_org_id UUID,
    p_query TEXT,
    p_limit INTEGER DEFAULT 8
)
RETURNS TABLE (
    record_type TEXT,
    record_id UUID,
    document_number TEXT,
    customer_name TEXT,
    document_date DATE
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_query TEXT;
    v_pattern TEXT;
BEGIN
    PERFORM public.assert_financial_report_access(p_org_id);
    v_query := trim(coalesce(p_query, ''));
    IF length(v_query) < 2 OR length(v_query) > 100 THEN
        RAISE EXCEPTION 'Search requires 2 to 100 characters'
            USING ERRCODE = '22023';
    END IF;
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 20 THEN
        RAISE EXCEPTION 'Search limit must be between 1 and 20'
            USING ERRCODE = '22023';
    END IF;
    v_pattern := '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';

    RETURN QUERY
    SELECT hits.kind, hits.doc_id, hits.doc_number, hits.customer, hits.doc_date
    FROM (
        SELECT 'invoice'::text AS kind, i.id AS doc_id,
               i.invoice_number::text AS doc_number, c.name::text AS customer,
               i.invoice_date AS doc_date
        FROM public.invoices i
        JOIN public.customers c ON c.id = i.customer_id AND c.organization_id = i.organization_id
        WHERE i.organization_id = p_org_id
          AND (i.invoice_number ILIKE v_pattern ESCAPE '\' OR c.name ILIKE v_pattern ESCAPE '\')
        UNION ALL
        SELECT 'payment'::text, p.id, p.payment_number::text,
               c.name::text, p.payment_date
        FROM public.payments p
        JOIN public.customers c ON c.id = p.customer_id AND c.organization_id = p.organization_id
        WHERE p.organization_id = p_org_id
          AND (p.payment_number ILIKE v_pattern ESCAPE '\'
               OR coalesce(p.reference_number, '') ILIKE v_pattern ESCAPE '\'
               OR c.name ILIKE v_pattern ESCAPE '\')
    ) hits
    ORDER BY hits.doc_date DESC, hits.doc_number ASC, hits.doc_id ASC
    LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.search_financial_documents(UUID, TEXT, INTEGER)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_financial_documents(UUID, TEXT, INTEGER)
    TO authenticated;
COMMENT ON FUNCTION public.search_financial_documents(UUID, TEXT, INTEGER) IS
'B2: finance-role checked, bounded invoice and receipt number/customer search within one organization.';
