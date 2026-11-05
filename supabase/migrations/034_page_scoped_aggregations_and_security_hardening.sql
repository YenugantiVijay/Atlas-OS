-- ============================================================================
-- Migration 034: Page-Scoped Aggregations, Financial Reconciliation & Security Hardening
-- 
-- 1. Eliminates Paginated Aggregation Overfetching:
--    - Introduces `public.get_page_product_stock_levels(p_org_id, p_product_ids)`:
--      Authoritatively aggregates stock strictly for the requested page of product UUIDs.
--      Completely eliminates 1,000+ item silent truncation in PostgREST and overfetching.
--    - Introduces `public.get_page_customer_receivables(p_org_id, p_customer_ids)`:
--      Authoritatively aggregates receivables strictly for the requested page of customer UUIDs.
--      Preserves zero receivables for settled customers and customers without invoices.
--
-- 2. Reconciles Financial Definitions in `public.get_receivables_summary`:
--    - Strictly excludes DRAFT invoices from issued-invoice and collections metrics.
--    - `v_total_invoiced` and `v_total_settled` query `status IN ('ISSUED', 'PARTIALLY_PAID', 'PAID')`.
--    - Reconciles 100% with `get_dashboard_metrics` and customer account balance totals.
--
-- 3. Supabase Security Advisor Hardening:
--    - Explicitly revokes EXECUTE from PUBLIC and anon on `allocate_document_number`.
--    - Hardens `inspect_audit_privacy_compliance` with admin/owner/service_role authorization.
--    - Revokes EXECUTE from PUBLIC and anon on internal trigger helper functions.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Page-Scoped Authoritative Product Stock Aggregation RPC
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_page_product_stock_levels(
    p_org_id UUID,
    p_product_ids UUID[]
)
RETURNS TABLE (
    product_id UUID,
    current_stock NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF p_org_id IS NULL THEN
        RAISE EXCEPTION 'ERR_INVALID_PARAMETER: Organization ID is required';
    END IF;

    -- Validate tenant isolation and caller authorization
    IF NOT public.can_read_organization_data(p_org_id) THEN
        RAISE EXCEPTION 'ERR_UNAUTHORIZED: Access to organization stock data denied'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- If no product IDs provided, return empty set
    IF p_product_ids IS NULL OR cardinality(p_product_ids) = 0 THEN
        RETURN;
    END IF;

    -- Bound batch size to prevent query exhaustion
    IF cardinality(p_product_ids) > 100 THEN
        RAISE EXCEPTION 'ERR_INVALID_PARAMETER: Page product ID batch size cannot exceed 100';
    END IF;

    RETURN QUERY
    SELECT
        p.id AS product_id,
        COALESCE(SUM(sm.quantity_change), 0)::NUMERIC AS current_stock
    FROM public.products p
    LEFT JOIN public.stock_movements sm
        ON sm.product_id = p.id
       AND sm.organization_id = p.organization_id
    WHERE p.organization_id = p_org_id
      AND p.id = ANY(p_product_ids)
    GROUP BY p.id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_page_product_stock_levels(UUID, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_page_product_stock_levels(UUID, UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_page_product_stock_levels(UUID, UUID[]) TO service_role;

-- ----------------------------------------------------------------------------
-- 2. Page-Scoped Authoritative Customer Receivables Aggregation RPC
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_page_customer_receivables(
    p_org_id UUID,
    p_customer_ids UUID[]
)
RETURNS TABLE (
    customer_id UUID,
    current_receivable NUMERIC(12, 2)
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF p_org_id IS NULL THEN
        RAISE EXCEPTION 'ERR_INVALID_PARAMETER: Organization ID is required';
    END IF;

    -- Validate tenant isolation and caller authorization
    IF NOT public.can_read_organization_data(p_org_id) THEN
        RAISE EXCEPTION 'ERR_UNAUTHORIZED: Access to organization customer data denied'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- If no customer IDs provided, return empty set
    IF p_customer_ids IS NULL OR cardinality(p_customer_ids) = 0 THEN
        RETURN;
    END IF;

    -- Bound batch size to prevent query exhaustion
    IF cardinality(p_customer_ids) > 100 THEN
        RAISE EXCEPTION 'ERR_INVALID_PARAMETER: Page customer ID batch size cannot exceed 100';
    END IF;

    RETURN QUERY
    SELECT
        c.id AS customer_id,
        COALESCE(
            SUM(
                ROUND(GREATEST(0.00, i.total_amount - i.total_paid)::NUMERIC, 2)
            ),
            0.00
        )::NUMERIC(12, 2) AS current_receivable
    FROM public.customers c
    LEFT JOIN public.invoices i
        ON i.customer_id = c.id
       AND i.organization_id = c.organization_id
       AND i.status IN ('ISSUED', 'PARTIALLY_PAID')
    WHERE c.organization_id = p_org_id
      AND c.id = ANY(p_customer_ids)
    GROUP BY c.id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_page_customer_receivables(UUID, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_page_customer_receivables(UUID, UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_page_customer_receivables(UUID, UUID[]) TO service_role;

-- ----------------------------------------------------------------------------
-- 3. Reconcile Financial Definitions in get_receivables_summary
--    Strictly exclude DRAFT invoices from issued commercial metrics
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_receivables_summary(
    p_org_id UUID,
    p_today DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_total_invoiced NUMERIC(12, 2) := 0.00;
    v_total_settled NUMERIC(12, 2) := 0.00;
    v_total_outstanding NUMERIC(12, 2) := 0.00;
    v_overdue_count INTEGER := 0;
    v_settled_pct INTEGER := 100;
BEGIN
    IF NOT public.can_read_organization_data(p_org_id) THEN
        RAISE EXCEPTION 'Access denied: Caller cannot read organization data'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Cumulative invoiced and settled across all ISSUED commercial invoices
    -- Strictly excludes DRAFT and CANCELLED invoices
    SELECT
        COALESCE(SUM(total_amount), 0.00),
        COALESCE(SUM(total_paid), 0.00)
    INTO v_total_invoiced, v_total_settled
    FROM public.invoices
    WHERE organization_id = p_org_id
      AND status IN ('ISSUED', 'PARTIALLY_PAID', 'PAID');

    -- Outstanding balance and overdue strictly on issued & partially paid invoices
    SELECT
        COALESCE(SUM(ROUND(GREATEST(0.00, total_amount - total_paid)::NUMERIC, 2)), 0.00),
        COUNT(*) FILTER (WHERE due_date < p_today AND (total_amount - total_paid) > 0)
    INTO v_total_outstanding, v_overdue_count
    FROM public.invoices
    WHERE organization_id = p_org_id
      AND status IN ('ISSUED', 'PARTIALLY_PAID');

    IF v_total_invoiced > 0 THEN
        v_settled_pct := ROUND((v_total_settled / v_total_invoiced) * 100)::INTEGER;
    ELSE
        v_settled_pct := 100;
    END IF;

    RETURN jsonb_build_object(
        'total_invoiced', v_total_invoiced,
        'total_settled', v_total_settled,
        'total_outstanding', v_total_outstanding,
        'overdue_count', v_overdue_count,
        'settled_pct', v_settled_pct
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_receivables_summary(UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_receivables_summary(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_receivables_summary(UUID, DATE) TO service_role;

-- ----------------------------------------------------------------------------
-- 4. Supabase Security Advisor Hardening: Explicit Revocations
-- ----------------------------------------------------------------------------

-- Revoke anonymous access from document number allocation
REVOKE ALL ON FUNCTION public.allocate_document_number(UUID, VARCHAR, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.allocate_document_number(UUID, VARCHAR, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_document_number(UUID, VARCHAR, INTEGER) TO service_role;

-- Harden audit privacy inspection with role check
CREATE OR REPLACE FUNCTION public.inspect_audit_privacy_compliance()
RETURNS TABLE (
    total_audit_events BIGINT,
    events_with_unmasked_pan BIGINT,
    events_with_unmasked_gstin BIGINT,
    compliance_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_total BIGINT;
    v_unmasked_pan BIGINT;
    v_unmasked_gstin BIGINT;
BEGIN
    -- Only allow service_role or authenticated owners/admins to inspect audit compliance
    IF auth.role() != 'service_role' THEN
        IF auth.uid() IS NULL OR NOT EXISTS (
            SELECT 1 FROM public.organization_members
            WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
        ) THEN
            RAISE EXCEPTION 'Access denied: Administrative privileges required'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;

    SELECT count(*) INTO v_total FROM public.audit_events;

    SELECT count(*) INTO v_unmasked_pan
    FROM public.audit_events
    WHERE details::text ~ '[A-Z]{5}[0-9]{4}[A-Z]{1}';

    SELECT count(*) INTO v_unmasked_gstin
    FROM public.audit_events
    WHERE details::text ~ '[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}';

    RETURN QUERY
    SELECT
        v_total,
        v_unmasked_pan,
        v_unmasked_gstin,
        CASE
            WHEN v_unmasked_pan = 0 AND v_unmasked_gstin = 0 THEN 'COMPLIANT'
            ELSE 'NON_COMPLIANT'
        END;
END;
$$;

REVOKE ALL ON FUNCTION public.inspect_audit_privacy_compliance() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inspect_audit_privacy_compliance() TO authenticated;
GRANT EXECUTE ON FUNCTION public.inspect_audit_privacy_compliance() TO service_role;

-- Revoke execute on internal trigger functions from PUBLIC and anon
DO $$
BEGIN
    -- Check and revoke trigger functions if they exist
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'trg_check_quotation_item_org') THEN
        EXECUTE 'REVOKE ALL ON FUNCTION public.trg_check_quotation_item_org() FROM PUBLIC, anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'trg_check_sales_order_item_org') THEN
        EXECUTE 'REVOKE ALL ON FUNCTION public.trg_check_sales_order_item_org() FROM PUBLIC, anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'trg_check_invoice_item_org') THEN
        EXECUTE 'REVOKE ALL ON FUNCTION public.trg_check_invoice_item_org() FROM PUBLIC, anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'trg_check_payment_allocation_org') THEN
        EXECUTE 'REVOKE ALL ON FUNCTION public.trg_check_payment_allocation_org() FROM PUBLIC, anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'prevent_audit_log_mutation') THEN
        EXECUTE 'REVOKE ALL ON FUNCTION public.prevent_audit_log_mutation() FROM PUBLIC, anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'check_stock_movement_invariant') THEN
        EXECUTE 'REVOKE ALL ON FUNCTION public.check_stock_movement_invariant() FROM PUBLIC, anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'trg_sales_order_lifecycle') THEN
        EXECUTE 'REVOKE ALL ON FUNCTION public.trg_sales_order_lifecycle() FROM PUBLIC, anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'trg_sales_order_items_enforce_status') THEN
        EXECUTE 'REVOKE ALL ON FUNCTION public.trg_sales_order_items_enforce_status() FROM PUBLIC, anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'trg_invoice_lifecycle') THEN
        EXECUTE 'REVOKE ALL ON FUNCTION public.trg_invoice_lifecycle() FROM PUBLIC, anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'trg_invoice_items_enforce_status') THEN
        EXECUTE 'REVOKE ALL ON FUNCTION public.trg_invoice_items_enforce_status() FROM PUBLIC, anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'validate_organization_pan_gstin') THEN
        EXECUTE 'REVOKE ALL ON FUNCTION public.validate_organization_pan_gstin() FROM PUBLIC, anon';
    END IF;
END;
$$;
