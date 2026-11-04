-- ============================================================================
-- Migration 031: Authoritative Database Aggregations for Inventory & Receivables
-- 
-- 1. Hardens `public.get_product_stock_levels(UUID)`:
--    - Enforces caller authorization via `public.can_read_organization_data(p_org_id)`.
--    - Rejects unauthorized cross-tenant calls with `ERR_UNAUTHORIZED` / `insufficient_privilege`.
--    - Authoritatively calculates on-hand stock for all organization products in PostgreSQL,
--      preserving explicit zero stock and eliminating client-side truncation risks.
--
-- 2. Introduces `public.get_customer_receivables(UUID)`:
--    - Authoritative multi-customer receivables aggregation directly within PostgreSQL engine.
--    - Only includes active issued and partially paid invoices ('ISSUED', 'PARTIALLY_PAID').
--    - Strictly excludes draft, fully paid ('PAID'), and cancelled ('CANCELLED') invoices.
--    - Applies exact monetary rounding `ROUND(GREATEST(0.00, total_amount - total_paid)::NUMERIC, 2)`.
--    - Preserves zero receivables for settled customers and customers without invoices.
--    - Immune to client-side API pagination truncation on large invoice histories (> 1,000 records).
--    - Enforces tenant isolation and caller authorization via `can_read_organization_data`.
--
-- 3. Introduces `public.get_customer_receivable(UUID, UUID)`:
--    - Single-customer authoritative receivable calculation.
--    - Enforces tenant membership and validates customer belongs to organization.
--
-- 4. Creates covering index for invoice status and payment aggregations:
--    - Optimizes high-volume invoice receivables calculation.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Covering Index for High-Volume Invoices & Receivables Aggregation
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_invoices_customer_receivables
ON public.invoices (organization_id, customer_id, status)
INCLUDE (total_amount, total_paid);

-- ----------------------------------------------------------------------------
-- 2. Authoritative Product Stock Aggregation RPC (Hardened)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_product_stock_levels(p_org_id UUID)
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

    RETURN QUERY
    SELECT
        p.id AS product_id,
        COALESCE(SUM(sm.quantity_change), 0)::NUMERIC AS current_stock
    FROM public.products p
    LEFT JOIN public.stock_movements sm
        ON sm.product_id = p.id
       AND sm.organization_id = p.organization_id
    WHERE p.organization_id = p_org_id
    GROUP BY p.id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_product_stock_levels(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_product_stock_levels(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_product_stock_levels(UUID) TO service_role;

-- ----------------------------------------------------------------------------
-- 3. Authoritative Multi-Customer Receivables Aggregation RPC
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_customer_receivables(p_org_id UUID)
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
    GROUP BY c.id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_customer_receivables(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_receivables(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_receivables(UUID) TO service_role;

-- ----------------------------------------------------------------------------
-- 4. Authoritative Single-Customer Receivable RPC
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_customer_receivable(p_customer_id UUID, p_org_id UUID)
RETURNS NUMERIC(12, 2)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_total NUMERIC(12, 2) := 0.00;
BEGIN
    IF p_customer_id IS NULL OR p_org_id IS NULL THEN
        RAISE EXCEPTION 'ERR_INVALID_PARAMETER: Customer ID and Organization ID are required';
    END IF;

    -- Validate tenant isolation and caller authorization
    IF NOT public.can_read_organization_data(p_org_id) THEN
        RAISE EXCEPTION 'ERR_UNAUTHORIZED: Access to organization customer data denied'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Verify customer exists within the specified organization
    IF NOT EXISTS (
        SELECT 1 FROM public.customers
        WHERE id = p_customer_id AND organization_id = p_org_id
    ) THEN
        RAISE EXCEPTION 'ERR_CUSTOMER_NOT_FOUND: Customer % not found in organization %', p_customer_id, p_org_id;
    END IF;

    SELECT COALESCE(
        SUM(
            ROUND(GREATEST(0.00, i.total_amount - i.total_paid)::NUMERIC, 2)
        ),
        0.00
    )::NUMERIC(12, 2)
    INTO v_total
    FROM public.invoices i
    WHERE i.customer_id = p_customer_id
      AND i.organization_id = p_org_id
      AND i.status IN ('ISSUED', 'PARTIALLY_PAID');

    RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.get_customer_receivable(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_receivable(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_receivable(UUID, UUID) TO service_role;
