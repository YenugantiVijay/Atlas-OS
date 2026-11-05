-- ============================================================================
-- Migration 033: Authoritative Dashboard Aggregations, Chart RPCs & Covering Indexes
-- ============================================================================
-- Technical Rationale:
--   1. Authoritative Financial Definitions:
--      - Aligns get_dashboard_metrics with Migration 031's authoritative receivables
--        definition: strictly status IN ('ISSUED', 'PARTIALLY_PAID'), eliminating
--        erroneous inclusion of DRAFT invoices.
--      - Defines today's sales strictly as CONFIRMED and FULFILLED orders placed on p_today.
--      - Calculates overdue invoices strictly for status IN ('ISSUED', 'PARTIALLY_PAID')
--        where due_date < p_today and balance > 0.
--      - Emits bounded low_stock_preview (top 5 SKUs) directly from PostgreSQL,
--        eliminating client-side download of the entire catalog.
--   2. Dedicated Server-Side Chart Aggregations:
--      - get_sales_trend(p_org_id, p_days, p_today): Bounded daily sales time-series
--        using generate_series, ensuring days with zero sales return 0.00.
--      - get_receivables_summary(p_org_id, p_today): Aggregates total_invoiced, total_settled,
--        total_outstanding, and overdue_count directly in PostgreSQL, perfectly reconciling
--        with authoritative receivables.
--      - get_top_brand_stock_valuation(p_org_id, p_limit): Server-side brand valuation breakdown.
--   3. Covering Indexes:
--      - idx_sales_orders_org_date_status for rapid dashboard sales & trend calculations.
--      - idx_invoices_org_status_due for instant receivables and overdue status filtering.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Covering Indexes for High-Performance Dashboard Queries
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_sales_orders_org_date_status
ON public.sales_orders (organization_id, order_date, status)
INCLUDE (total_amount);

CREATE INDEX IF NOT EXISTS idx_invoices_org_status_due
ON public.invoices (organization_id, status, due_date)
INCLUDE (total_amount, total_paid);

CREATE INDEX IF NOT EXISTS idx_payments_org_date
ON public.payments (organization_id, payment_date DESC);

CREATE INDEX IF NOT EXISTS idx_products_org_active_reorder
ON public.products (organization_id, is_active, reorder_threshold);

-- ----------------------------------------------------------------------------
-- 2. Enhanced Authoritative get_dashboard_metrics RPC
-- ----------------------------------------------------------------------------
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

REVOKE ALL ON FUNCTION public.get_dashboard_metrics(UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_metrics(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_metrics(UUID, DATE) TO service_role;

-- ----------------------------------------------------------------------------
-- 3. Dedicated Server-Side Sales Trend Aggregation RPC
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_sales_trend(
    p_org_id UUID,
    p_days INTEGER DEFAULT 30,
    p_today DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
    order_date DATE,
    total_amount NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_start_date DATE;
BEGIN
    IF NOT public.can_read_organization_data(p_org_id) THEN
        RAISE EXCEPTION 'Access denied: Caller cannot read organization data'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    v_start_date := p_today - (GREATEST(1, LEAST(p_days, 365)) - 1);

    RETURN QUERY
    WITH date_series AS (
        SELECT s.d::date AS series_date
        FROM generate_series(v_start_date::timestamp, p_today::timestamp, INTERVAL '1 day') AS s(d)
    ),
    order_sums AS (
        SELECT
            so.order_date,
            SUM(so.total_amount) AS day_total
        FROM public.sales_orders so
        WHERE so.organization_id = p_org_id
          AND so.order_date >= v_start_date
          AND so.order_date <= p_today
          AND so.status IN ('CONFIRMED', 'FULFILLED')
        GROUP BY so.order_date
    )
    SELECT
        ds.series_date AS order_date,
        COALESCE(os.day_total, 0.00)::NUMERIC(12, 2) AS total_amount
    FROM date_series ds
    LEFT JOIN order_sums os ON os.order_date = ds.series_date
    ORDER BY ds.series_date ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_sales_trend(UUID, INTEGER, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sales_trend(UUID, INTEGER, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_sales_trend(UUID, INTEGER, DATE) TO service_role;

-- ----------------------------------------------------------------------------
-- 4. Dedicated Server-Side Receivables & Collections Summary RPC
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

    -- Cumulative invoiced and settled across all active commercial invoices
    SELECT
        COALESCE(SUM(total_amount), 0.00),
        COALESCE(SUM(total_paid), 0.00)
    INTO v_total_invoiced, v_total_settled
    FROM public.invoices
    WHERE organization_id = p_org_id
      AND status != 'CANCELLED';

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
-- 5. Dedicated Server-Side Brand Inventory Valuation Breakdown RPC
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_top_brand_stock_valuation(
    p_org_id UUID,
    p_limit INTEGER DEFAULT 5
)
RETURNS TABLE (
    brand VARCHAR,
    total_value NUMERIC,
    sku_count BIGINT,
    total_units NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NOT public.can_read_organization_data(p_org_id) THEN
        RAISE EXCEPTION 'Access denied: Caller cannot read organization data'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN QUERY
    WITH product_stock AS (
        SELECT
            p.id,
            COALESCE(NULLIF(TRIM(p.brand), ''), 'Generic / Unbranded')::VARCHAR AS brand_name,
            p.purchase_cost,
            GREATEST(0, COALESCE(SUM(sm.quantity_change), 0)) AS on_hand
        FROM public.products p
        LEFT JOIN public.stock_movements sm
            ON sm.product_id = p.id
           AND sm.organization_id = p.organization_id
        WHERE p.organization_id = p_org_id
          AND p.is_active = TRUE
        GROUP BY p.id, p.brand, p.purchase_cost
    )
    SELECT
        ps.brand_name AS brand,
        COALESCE(SUM(ps.on_hand * ps.purchase_cost), 0.00)::NUMERIC(12, 2) AS total_value,
        COUNT(ps.id) AS sku_count,
        COALESCE(SUM(ps.on_hand), 0)::NUMERIC AS total_units
    FROM product_stock ps
    GROUP BY ps.brand_name
    ORDER BY total_value DESC, brand_name ASC
    LIMIT GREATEST(1, LEAST(p_limit, 50));
END;
$$;

REVOKE ALL ON FUNCTION public.get_top_brand_stock_valuation(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_top_brand_stock_valuation(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_top_brand_stock_valuation(UUID, INTEGER) TO service_role;
