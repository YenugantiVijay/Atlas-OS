-- PR #50 / SEC-02: limit externally callable privileged diagnostics, harden
-- document-number allocation RBAC, and pin three advisor-flagged search paths.
-- Forward-only; apply to STAGING after disposable acceptance and approval.
-- No data deletion or migration-history manipulation.
--
-- SECURITY NOTE: Creating invoices/orders/quotations already uses authoritative
-- atomic creation RPCs. This legacy document-number reservation endpoint must
-- remain available to permitted roles for compatibility (numbering.service.ts),
-- but membership alone must never grant allocation to viewers/inventory.
CREATE OR REPLACE FUNCTION public.allocate_document_number(
    p_org_id UUID,
    p_doc_type VARCHAR,
    p_year INTEGER DEFAULT EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER
)
RETURNS VARCHAR
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_has_access BOOLEAN;
BEGIN
    IF p_org_id IS NULL THEN
        RAISE EXCEPTION 'organization_id cannot be null' USING ERRCODE = '22023';
    END IF;
    IF p_doc_type IS NULL THEN
        RAISE EXCEPTION 'document_type cannot be null' USING ERRCODE = '22023';
    END IF;
    IF p_year IS NULL OR p_year < 2000 OR p_year > 2100 THEN
        RAISE EXCEPTION 'Invalid year: %. Must be between 2000 and 2100.', p_year
            USING ERRCODE = '22023';
    END IF;

    IF auth.role() = 'authenticated' THEN
        SELECT EXISTS (
            SELECT 1 FROM public.memberships
             WHERE organization_id = p_org_id
               AND user_id = (SELECT auth.uid())
               AND is_active = TRUE
        ) INTO v_has_access;
        IF NOT v_has_access THEN
            RAISE EXCEPTION 'Document numbering denied: active membership required'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    IF NOT public.can_write_organization_operations(p_org_id) THEN
        RAISE EXCEPTION 'Document numbering denied: active entitlement required'
            USING ERRCODE = '42501';
    END IF;

    -- Direct RECEIPT allocation is forbidden: receipts are allocated only
    -- atomically by record_payment_and_allocate().
    IF p_doc_type = 'RECEIPT' THEN
        RAISE EXCEPTION 'Access denied: RECEIPT numbers must be allocated atomically'
            USING ERRCODE = '42501';
    ELSIF p_doc_type NOT IN ('QUOTATION', 'SALES_ORDER', 'INVOICE') THEN
        RAISE EXCEPTION 'Invalid document type' USING ERRCODE = '22023';
    END IF;

    -- SEC-02: never let a viewer or inventory-only member advance sequences
    -- merely because their organization has an active subscription.
    IF auth.role() = 'authenticated' THEN
        IF p_doc_type = 'INVOICE' THEN
            IF NOT public.user_has_org_role(p_org_id, 'owner', 'admin', 'accounts') THEN
                RAISE EXCEPTION 'Document numbering denied: invoice role required'
                    USING ERRCODE = '42501';
            END IF;
        ELSIF NOT public.user_has_org_role(p_org_id, 'owner', 'admin', 'sales') THEN
            RAISE EXCEPTION 'Document numbering denied: sales role required'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    RETURN public.internal_allocate_document_number(p_org_id, p_doc_type, p_year);
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_document_number(UUID, VARCHAR, INTEGER)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.allocate_document_number(UUID, VARCHAR, INTEGER)
  TO authenticated, service_role;

-- This diagnostic reads aggregate compliance information from ALL businesses.
-- Its previous authenticated-owner branch referenced the removed table
-- public.organization_members, and even if fixed would expose cross-tenant
-- audit totals. Only back-office service_role should be allowed to run it.
REVOKE ALL ON FUNCTION public.inspect_audit_privacy_compliance()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inspect_audit_privacy_compliance()
  TO service_role;

-- The bodies only use PostgreSQL built-ins, so pg_catalog is sufficient.
-- Explicit paths remove mutable-function-search-path warnings while
-- avoiding changes to existing redaction/immutable-audit behavior.
ALTER FUNCTION public.mask_pan(TEXT)
  SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION public.mask_gstin(TEXT)
  SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION public.prevent_audit_log_mutation()
  SET search_path = pg_catalog, pg_temp;

COMMENT ON FUNCTION public.allocate_document_number(UUID, VARCHAR, INTEGER)
IS 'SEC-02: member+entitlement+role-gated legacy sequence reservation. Use atomic creation RPCs for final business documents.';
COMMENT ON FUNCTION public.inspect_audit_privacy_compliance()
IS 'Service-role-only global diagnostic. Must not be exposed to organization members.';
