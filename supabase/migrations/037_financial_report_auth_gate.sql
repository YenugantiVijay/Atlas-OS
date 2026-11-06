-- ============================================================================
-- MIGRATION 037: Financial reporting RPC authorization gate
-- ============================================================================
-- Prevents a client from treating a user-supplied "role" parameter as proof
-- of access to organization-wide financial reports.
--
-- NOTE: Existing direct SELECT policies on invoices/payments are intentionally
-- unchanged, because operational sales and accounting screens depend on them.
-- This gate secures the reporting-service entry points; it is NOT a replacement
-- for a future least-privilege review of direct financial table reads.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.assert_financial_report_access(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
BEGIN
    v_user_id := (SELECT auth.uid());

    IF p_org_id IS NULL OR v_user_id IS NULL THEN
        RAISE EXCEPTION 'Financial report access denied: authentication and organization are required.'
            USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.memberships AS m
        WHERE m.organization_id = p_org_id
          AND m.user_id = v_user_id
          AND m.is_active = TRUE
          AND m.role IN ('owner', 'admin', 'accounts')
    ) THEN
        RAISE EXCEPTION 'Financial report access denied: accounts, admin, or owner role required.'
            USING ERRCODE = '42501';
    END IF;

    RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_financial_report_access(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_financial_report_access(UUID) TO authenticated;

COMMENT ON FUNCTION public.assert_financial_report_access(UUID) IS
'Server-authoritative organization and role check for financial reports; does not override financial table SELECT policies.';
