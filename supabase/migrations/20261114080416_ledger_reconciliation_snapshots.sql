BEGIN;

-- A single response carries complete totals and a deliberately bounded preview.
CREATE FUNCTION public.get_stock_ledger_summary(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_can_see_costs boolean;
BEGIN
    IF NOT public.can_read_organization_data(p_org_id) THEN
        RAISE EXCEPTION 'Stock ledger access denied' USING ERRCODE = '42501';
    END IF;

    v_can_see_costs := public.user_has_org_role(p_org_id, 'owner', 'admin', 'inventory', 'accounts');

    RETURN (
        WITH stock AS (
            SELECT p.id, p.sku, p.name, p.uom, p.reorder_threshold, p.is_active,
                   p.purchase_cost, levels.current_stock AS quantity
            FROM public.get_product_stock_levels(p_org_id) AS levels
            JOIN public.products AS p ON p.id = levels.product_id AND p.organization_id = p_org_id
        ), low_stock AS (
            SELECT id, sku, name, uom, reorder_threshold AS "reorderThreshold", quantity
            FROM stock
            WHERE is_active AND quantity <= reorder_threshold
            ORDER BY quantity, name, id
            LIMIT 25
        )
        SELECT jsonb_build_object(
            'asOf', statement_timestamp(),
            'productCount', COUNT(*),
            'activeProductCount', COUNT(*) FILTER (WHERE is_active),
            'lowStockCount', COUNT(*) FILTER (WHERE is_active AND quantity <= reorder_threshold),
            'catalogCostValue', CASE WHEN v_can_see_costs
                THEN COALESCE(SUM(GREATEST(quantity, 0) * purchase_cost), 0) END,
            'lowStock', COALESCE((
                SELECT jsonb_agg(to_jsonb(l) ORDER BY quantity, name, id) FROM low_stock AS l
            ), '[]'::jsonb)
        )
        FROM stock
    );
END;
$$;

CREATE FUNCTION public.get_financial_reconciliation(p_org_id uuid, p_today date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF p_today IS NULL THEN
        RAISE EXCEPTION 'Business date is required' USING ERRCODE = '22023';
    END IF;
    IF NOT public.can_read_organization_data(p_org_id) THEN
        RAISE EXCEPTION 'Financial reconciliation access denied' USING ERRCODE = '42501';
    END IF;
    PERFORM public.assert_financial_report_access(p_org_id);

    RETURN (
        WITH posted AS (
            SELECT id, invoice_number, customer_id, total_amount, total_paid, status, due_date
            FROM public.invoices
            WHERE organization_id = p_org_id AND status IN ('ISSUED', 'PARTIALLY_PAID', 'PAID')
        ), receipts AS (
            SELECT id, customer_id, amount FROM public.payments WHERE organization_id = p_org_id
        ), allocations AS (
            SELECT a.payment_id, i.id AS invoice_id, a.amount_allocated
            FROM receipts AS p
            JOIN public.payment_allocations AS a ON a.payment_id = p.id
            LEFT JOIN posted AS i ON i.id = a.invoice_id AND i.customer_id = p.customer_id
        ), receipt_allocations AS (
            SELECT payment_id, SUM(amount_allocated) AS allocated,
                   BOOL_OR(invoice_id IS NULL) AS invalid_target
            FROM allocations GROUP BY payment_id
        ), invoice_allocations AS (
            SELECT invoice_id, SUM(amount_allocated) AS allocated
            FROM allocations WHERE invoice_id IS NOT NULL GROUP BY invoice_id
        ), invoice_totals AS (
            SELECT i.*, COALESCE(a.allocated, 0) AS allocated,
                   GREATEST(i.total_amount - COALESCE(a.allocated, 0), 0) AS outstanding,
                   GREATEST(ABS(i.total_paid - COALESCE(a.allocated, 0)),
                            COALESCE(a.allocated, 0) - i.total_amount, i.total_paid - i.total_amount,
                            CASE WHEN i.status = 'PAID' THEN i.total_amount - COALESCE(a.allocated, 0) ELSE 0 END) AS variance
            FROM posted AS i LEFT JOIN invoice_allocations AS a ON a.invoice_id = i.id
        ), differences AS (
            SELECT id AS "invoiceId", invoice_number AS "invoiceNumber", total_amount AS "totalAmount",
                   total_paid AS "totalPaid", allocated, outstanding AS "outstandingBalance", variance
            FROM invoice_totals WHERE variance > 0
            ORDER BY variance DESC, id LIMIT 25
        ), overdue AS (
            SELECT id, invoice_number AS "invoiceNumber", due_date AS "dueDate", outstanding
            FROM invoice_totals
            WHERE status IN ('ISSUED', 'PARTIALLY_PAID') AND due_date < p_today AND outstanding > 0
            ORDER BY due_date, id LIMIT 25
        ), receipt_totals AS (
            SELECT COUNT(*) AS receipt_count, COALESCE(SUM(p.amount), 0) AS collected,
                   COALESCE(SUM(a.allocated), 0) AS allocated,
                   COALESCE(SUM(GREATEST(p.amount - COALESCE(a.allocated, 0), 0)), 0) AS unapplied,
                   COUNT(*) FILTER (WHERE a.invalid_target OR a.allocated > p.amount) AS issue_count
            FROM receipts AS p LEFT JOIN receipt_allocations AS a ON a.payment_id = p.id
        )
        SELECT jsonb_build_object(
            'asOf', statement_timestamp(),
            'invoiceCount', COUNT(i.id),
            'receiptCount', r.receipt_count,
            'totalInvoiced', COALESCE(SUM(i.total_amount), 0),
            'totalPaid', COALESCE(SUM(i.total_paid), 0),
            'totalOutstanding', COALESCE(SUM(i.outstanding), 0),
            'varianceAmount', COALESCE(SUM(i.variance), 0),
            'totalPaymentsCollected', r.collected,
            'totalAllocated', r.allocated,
            'unallocatedPayments', r.unapplied,
            'receiptIssueCount', r.issue_count,
            'discrepancyCount', COUNT(*) FILTER (WHERE i.variance > 0),
            'discrepancies', COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY variance DESC, "invoiceId")
                                       FROM differences AS d), '[]'::jsonb),
            'overdueCount', COUNT(*) FILTER (WHERE i.status IN ('ISSUED', 'PARTIALLY_PAID')
                AND i.due_date < p_today AND i.outstanding > 0),
            'overdueTotal', COALESCE(SUM(i.outstanding) FILTER (WHERE i.status IN ('ISSUED', 'PARTIALLY_PAID')
                AND i.due_date < p_today AND i.outstanding > 0), 0),
            'overdue', COALESCE((SELECT jsonb_agg(to_jsonb(o) ORDER BY "dueDate", id)
                                 FROM overdue AS o), '[]'::jsonb)
        )
        FROM receipt_totals AS r LEFT JOIN invoice_totals AS i ON true
        GROUP BY r.receipt_count, r.collected, r.allocated, r.unapplied, r.issue_count
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_stock_ledger_summary(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_financial_reconciliation(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_stock_ledger_summary(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_financial_reconciliation(uuid, date) TO authenticated;

COMMIT;
