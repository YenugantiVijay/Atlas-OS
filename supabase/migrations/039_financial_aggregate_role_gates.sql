-- ============================================================================
-- Migration 039: SEC-01 continued — close SECURITY DEFINER aggregate leaks
-- ============================================================================
-- Protected RPCs continue to run as definer for stable privileged aggregates,
-- but explicitly validate the caller's real active owner/admin/accounts role.
-- Finance-free dashboard callers get no receivables amounts or overdue counts.
-- Existing routine signatures, non-financial behavior and read eligibility are
-- preserved; do not fake zero receivables in the client UI for restricted users.
-- ============================================================================
BEGIN;

-- SEC-01: get_customer_receivables
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

    PERFORM public.assert_financial_report_access(p_org_id);

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

-- SEC-01: get_customer_receivable
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

    PERFORM public.assert_financial_report_access(p_org_id);

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

-- SEC-01: get_page_customer_receivables
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

    PERFORM public.assert_financial_report_access(p_org_id);

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

-- SEC-01: get_receivables_summary
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

    PERFORM public.assert_financial_report_access(p_org_id);

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

-- SEC-01: get_dashboard_metrics
CREATE OR REPLACE FUNCTION public.get_dashboard_metrics(
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
    v_today_sales NUMERIC(12, 2) := 0.00;
    v_orders_count INTEGER := 0;
    v_total_receivables NUMERIC(12, 2) := 0.00;
    v_overdue_count INTEGER := 0;
    v_low_stock_count INTEGER := 0;
    v_total_stock_value NUMERIC(12, 2) := 0.00;
    v_low_stock_preview JSONB := '[]'::jsonb;
BEGIN
    -- Tenant isolation and caller authorization
    IF NOT public.can_read_organization_data(p_org_id) THEN
        RAISE EXCEPTION 'Access denied: Caller cannot read organization data'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- 1. Today's confirmed/fulfilled sales orders
    SELECT COALESCE(SUM(total_amount), 0.00)
    INTO v_today_sales
    FROM public.sales_orders
    WHERE organization_id = p_org_id
      AND order_date = p_today
      AND status IN ('CONFIRMED', 'FULFILLED');

    -- 2. Total non-cancelled sales orders count
    SELECT COUNT(*)
    INTO v_orders_count
    FROM public.sales_orders
    WHERE organization_id = p_org_id
      AND status != 'CANCELLED';

    -- 3. Authoritative receivables & overdue invoices (strictly excluding DRAFT and PAID)
    SELECT
        COALESCE(SUM(ROUND(GREATEST(0.00, total_amount - total_paid)::NUMERIC, 2)), 0.00),
        COUNT(*) FILTER (WHERE due_date < p_today AND (total_amount - total_paid) > 0)
    INTO v_total_receivables, v_overdue_count
    FROM public.invoices
    WHERE organization_id = p_org_id
      AND status IN ('ISSUED', 'PARTIALLY_PAID');

    -- 4. Inventory stock levels, valuation & low-stock count
    WITH stock_agg AS (
        SELECT
            p.id,
            p.sku,
            p.name,
            COALESCE(NULLIF(TRIM(p.brand), ''), 'Generic / Unbranded') AS brand,
            p.category,
            p.uom,
            p.purchase_cost,
            p.reorder_threshold,
            p.is_active,
            COALESCE(SUM(sm.quantity_change), 0) AS on_hand
        FROM public.products p
        LEFT JOIN public.stock_movements sm
            ON sm.product_id = p.id
           AND sm.organization_id = p.organization_id
        WHERE p.organization_id = p_org_id
        GROUP BY p.id, p.sku, p.name, p.brand, p.category, p.uom, p.purchase_cost, p.reorder_threshold, p.is_active
    ),
    low_stock_ranked AS (
        SELECT
            jsonb_build_object(
                'id', id,
                'sku', sku,
                'name', name,
                'brand', brand,
                'category', category,
                'uom', uom,
                'purchaseCost', purchase_cost,
                'reorderThreshold', reorder_threshold,
                'currentStock', on_hand,
                'isActive', is_active
            ) AS item_json
        FROM stock_agg
        WHERE is_active = TRUE
          AND on_hand <= reorder_threshold
        ORDER BY on_hand ASC, name ASC
        LIMIT 5
    )
    SELECT
        COUNT(*) FILTER (WHERE is_active = TRUE AND on_hand <= reorder_threshold),
        COALESCE(SUM(GREATEST(0, on_hand) * purchase_cost), 0.00),
        COALESCE((SELECT jsonb_agg(item_json) FROM low_stock_ranked), '[]'::jsonb)
    INTO v_low_stock_count, v_total_stock_value, v_low_stock_preview
    FROM stock_agg;

    -- A dashboard is available to operational staff, but raw financial totals
    -- cannot leak through this privileged function.
    IF NOT public.user_has_org_role(p_org_id, 'owner', 'admin', 'accounts') THEN
        v_total_receivables := 0.00;
        v_overdue_count := 0;
    END IF;

    RETURN jsonb_build_object(
        'today_sales', v_today_sales,
        'orders_count', v_orders_count,
        'total_receivables', v_total_receivables,
        'overdue_invoices_count', v_overdue_count,
        'low_stock_items_count', v_low_stock_count,
        'total_stock_value', v_total_stock_value,
        'low_stock_preview', v_low_stock_preview
    );
END;
$$;

COMMIT;
