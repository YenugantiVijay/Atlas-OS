-- ============================================================================
-- Migration 040 — FIN-01: statement-consistent financial export snapshot
-- ============================================================================
-- The browser's independent PostgREST pages do not share an MVCC snapshot.
-- This STABLE function reads invoice, payment, children, customers, and
-- referenced invoice metadata under the snapshot of ONE RPC statement.
-- It is read-only; no durable snapshot table or production mutation required.
--
-- A single bounded JSON payload is returned rather than paginating changing
-- relations across separate client transactions. Oversized exports fail closed.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_financial_export_snapshot(
    p_org_id UUID,
    p_start_date DATE,
    p_end_date DATE,
    p_document_type TEXT DEFAULT 'ALL',
    p_customer_id UUID DEFAULT NULL,
    p_invoice_status TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_invoice_count INTEGER := 0;
    v_payment_count INTEGER := 0;
    v_invoice_item_count BIGINT := 0;
    v_payment_allocation_count BIGINT := 0;
    v_invoices JSONB := '[]'::jsonb;
    v_payments JSONB := '[]'::jsonb;
    v_references JSONB := '[]'::jsonb;
    v_snapshot JSONB;
BEGIN
    -- Must verify the ACTUAL caller, not a role supplied by the browser.
    PERFORM public.assert_financial_report_access(p_org_id);

    IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date THEN
        RAISE EXCEPTION 'FIN-01: Valid start and end dates are required.'
            USING ERRCODE = '22023';
    END IF;
    IF p_document_type IS NULL OR p_document_type NOT IN ('ALL', 'INVOICES', 'PAYMENTS') THEN
        RAISE EXCEPTION 'FIN-01: Unsupported document type.'
            USING ERRCODE = '22023';
    END IF;
    IF p_invoice_status IS NOT NULL AND p_invoice_status NOT IN (
        'ALL', 'DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'
    ) THEN
        RAISE EXCEPTION 'FIN-01: Unsupported invoice status.'
            USING ERRCODE = '22023';
    END IF;

    -- Count and size guards execute inside the SAME MVCC snapshot as the data
    -- aggregation; unlike client count rechecks, same-count edits cannot drift.
    IF p_document_type <> 'PAYMENTS' THEN
        SELECT COUNT(*)::INTEGER
        INTO v_invoice_count
        FROM public.invoices i
        WHERE i.organization_id = p_org_id
          AND i.invoice_date BETWEEN p_start_date AND p_end_date
          AND (p_customer_id IS NULL OR i.customer_id = p_customer_id)
          AND (p_invoice_status IS NULL OR p_invoice_status = 'ALL' OR i.status = p_invoice_status);

        IF v_invoice_count > 10000 THEN
            RAISE EXCEPTION 'FIN-01: More than 10000 invoices. Narrow the report range.'
                USING ERRCODE = '54000';
        END IF;

        SELECT COUNT(*)
        INTO v_invoice_item_count
        FROM public.invoice_items ii
        JOIN public.invoices i ON i.id = ii.invoice_id
        WHERE i.organization_id = p_org_id
          AND i.invoice_date BETWEEN p_start_date AND p_end_date
          AND (p_customer_id IS NULL OR i.customer_id = p_customer_id)
          AND (p_invoice_status IS NULL OR p_invoice_status = 'ALL' OR i.status = p_invoice_status);
    END IF;

    IF p_document_type <> 'INVOICES' THEN
        SELECT COUNT(*)::INTEGER
        INTO v_payment_count
        FROM public.payments p
        WHERE p.organization_id = p_org_id
          AND p.payment_date BETWEEN p_start_date AND p_end_date
          AND (p_customer_id IS NULL OR p.customer_id = p_customer_id);

        IF v_payment_count > 10000 THEN
            RAISE EXCEPTION 'FIN-01: More than 10000 receipts. Narrow the report range.'
                USING ERRCODE = '54000';
        END IF;

        SELECT COUNT(*)
        INTO v_payment_allocation_count
        FROM public.payment_allocations pa
        JOIN public.payments p ON p.id = pa.payment_id
        WHERE p.organization_id = p_org_id
          AND p.payment_date BETWEEN p_start_date AND p_end_date
          AND (p_customer_id IS NULL OR p.customer_id = p_customer_id);
    END IF;

    IF (v_invoice_item_count + v_payment_allocation_count) > 100000 THEN
        RAISE EXCEPTION 'FIN-01: Too many invoice lines/payment allocations. Narrow the report range.'
            USING ERRCODE = '54000';
    END IF;

    IF p_document_type <> 'PAYMENTS' THEN
        SELECT COALESCE(
            jsonb_agg(
                to_jsonb(i) || jsonb_build_object(
                    'customer', to_jsonb(c),
                    'items', COALESCE(
                        (SELECT jsonb_agg(to_jsonb(ii) ORDER BY ii.id)
                         FROM public.invoice_items ii WHERE ii.invoice_id = i.id),
                        '[]'::jsonb
                    )
                )
                ORDER BY i.invoice_date, i.id
            ),
            '[]'::jsonb
        )
        INTO v_invoices
        FROM public.invoices i
        JOIN public.customers c
          ON c.id = i.customer_id AND c.organization_id = i.organization_id
        WHERE i.organization_id = p_org_id
          AND i.invoice_date BETWEEN p_start_date AND p_end_date
          AND (p_customer_id IS NULL OR i.customer_id = p_customer_id)
          AND (p_invoice_status IS NULL OR p_invoice_status = 'ALL' OR i.status = p_invoice_status);
    END IF;

    IF p_document_type <> 'INVOICES' THEN
        SELECT COALESCE(
            jsonb_agg(
                to_jsonb(p) || jsonb_build_object(
                    'customer', to_jsonb(c),
                    'allocations', COALESCE(
                        (SELECT jsonb_agg(to_jsonb(pa) ORDER BY pa.id)
                         FROM public.payment_allocations pa WHERE pa.payment_id = p.id),
                        '[]'::jsonb
                    )
                )
                ORDER BY p.payment_date, p.id
            ),
            '[]'::jsonb
        )
        INTO v_payments
        FROM public.payments p
        JOIN public.customers c
          ON c.id = p.customer_id AND c.organization_id = p.organization_id
        WHERE p.organization_id = p_org_id
          AND p.payment_date BETWEEN p_start_date AND p_end_date
          AND (p_customer_id IS NULL OR p.customer_id = p_customer_id);

        -- The allocation may refer to a different financial period.
        -- Include its invoice metadata from the same statement snapshot.
        SELECT COALESCE(
            jsonb_agg(to_jsonb(i) ORDER BY i.id),
            '[]'::jsonb
        )
        INTO v_references
        FROM public.invoices i
        WHERE i.organization_id = p_org_id
          AND EXISTS (
              SELECT 1
              FROM public.payment_allocations pa
              JOIN public.payments p ON p.id = pa.payment_id
              WHERE pa.invoice_id = i.id
                AND p.organization_id = p_org_id
                AND p.payment_date BETWEEN p_start_date AND p_end_date
                AND (p_customer_id IS NULL OR p.customer_id = p_customer_id)
          );
    END IF;

    IF jsonb_array_length(v_invoices) <> v_invoice_count
       OR jsonb_array_length(v_payments) <> v_payment_count THEN
        RAISE EXCEPTION 'FIN-01: Export snapshot row-count mismatch.'
            USING ERRCODE = '22000';
    END IF;

    v_snapshot := jsonb_build_object(
        'snapshot_at', statement_timestamp(),
        'invoice_count', v_invoice_count,
        'payment_count', v_payment_count,
        'invoice_item_count', v_invoice_item_count,
        'payment_allocation_count', v_payment_allocation_count,
        'invoices', v_invoices,
        'payments', v_payments,
        'referenced_invoices', v_references
    );

    -- Browser-generated XLSX must not unexpectedly consume excessive memory.
    IF pg_column_size(v_snapshot) > 16777216 THEN
        RAISE EXCEPTION 'FIN-01: Snapshot exceeds 16 MiB. Narrow the export period.'
            USING ERRCODE = '54000';
    END IF;

    RETURN v_snapshot;
END;
$$;

REVOKE ALL ON FUNCTION public.get_financial_export_snapshot(UUID, DATE, DATE, TEXT, UUID, TEXT)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_financial_export_snapshot(UUID, DATE, DATE, TEXT, UUID, TEXT)
    TO authenticated;

COMMENT ON FUNCTION public.get_financial_export_snapshot(UUID, DATE, DATE, TEXT, UUID, TEXT) IS
'FIN-01: Bounded single-statement MVCC snapshot of invoices, items, payments, allocations and cross-period references. Requires finance role.';
