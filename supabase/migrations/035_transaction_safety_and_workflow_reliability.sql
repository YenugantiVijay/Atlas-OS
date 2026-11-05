-- ============================================================================
-- Migration 035: Transaction Safety, Payment Workflow Reliability & Authoritative Summaries
-- ============================================================================
-- Technical Rationale:
--   1. Payment Allocation Integrity in record_payment_and_allocate():
--      - Explicitly prohibits payment allocation to DRAFT invoices (status = 'DRAFT').
--        Invoices must be legally issued (status IN ('ISSUED', 'PARTIALLY_PAID'))
--        before receiving settlement allocations.
--      - Explicitly checks and rejects allocation to invoices that carry no positive
--        outstanding balance.
--      - Preserves existing customer matching, overpayment checks, receipt sequencing,
--        and idempotent replay behavior.
--   2. Authoritative Payments Summary RPC:
--      - Adds public.get_payments_summary(p_org_id UUID) to provide organization-wide
--        financial metrics (total_collected, payment_count, total_receivables, open_invoices_count)
--        directly calculated in the PostgreSQL engine, eliminating client-side slicing errors.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Hardened record_payment_and_allocate RPC
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_payment_and_allocate(
    p_org_id UUID,
    p_customer_id UUID,
    p_amount NUMERIC(12, 2),
    p_payment_method VARCHAR,
    p_reference_no VARCHAR,
    p_payment_date DATE,
    p_notes TEXT,
    p_invoice_id UUID,
    p_allocated_amount NUMERIC(12, 2),
    p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_role VARCHAR(50);
    v_customer_exists BOOLEAN;
    v_payment_id UUID;
    v_inv RECORD;
    v_new_paid NUMERIC(12, 2);
    v_new_status VARCHAR(50);
    v_payment_num VARCHAR(100);
    v_uid UUID;
    v_payment_year INTEGER;
    v_request_hash TEXT;
    v_existing_pay_id UUID;
    v_existing_hash TEXT;
    v_existing_payment JSONB;
BEGIN
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF p_org_id IS NULL OR p_customer_id IS NULL OR p_amount IS NULL OR p_payment_method IS NULL THEN
        RAISE EXCEPTION 'Invalid parameters: organization_id, customer_id, amount, and payment_method are required'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Payment amount must be greater than zero (received %)', p_amount
            USING ERRCODE = 'check_violation';
    END IF;

    IF p_payment_method NOT IN ('CASH', 'UPI', 'NEFT', 'RTGS', 'CHEQUE', 'BANK_TRANSFER') THEN
        RAISE EXCEPTION 'Invalid payment method: %. Allowed methods: CASH, UPI, NEFT, RTGS, CHEQUE, BANK_TRANSFER', p_payment_method
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    v_user_role := public.get_user_org_role(p_org_id);
    IF v_user_role IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Caller has no active membership in organization %', p_org_id
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF v_user_role NOT IN ('owner', 'admin', 'accounts') THEN
        RAISE EXCEPTION 'Unauthorized: Caller has insufficient role (%) to record payments in organization %',
            v_user_role, p_org_id
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF NOT public.can_write_organization_operations(p_org_id) THEN
        RAISE EXCEPTION 'Operational write denied: Active subscription or trial required for organization %', p_org_id
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Compute request fingerprint
    v_request_hash := md5(
        p_org_id::TEXT || ':' ||
        p_customer_id::TEXT || ':' ||
        p_amount::TEXT || ':' ||
        p_payment_method || ':' ||
        COALESCE(p_reference_no, '') || ':' ||
        COALESCE(p_payment_date::TEXT, '') || ':' ||
        COALESCE(p_invoice_id::TEXT, '') || ':' ||
        COALESCE(p_allocated_amount::TEXT, '')
    );

    -- Idempotency check with transaction-level advisory lock
    IF p_idempotency_key IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtext('payment:' || p_org_id::TEXT || ':' || p_idempotency_key::TEXT));

        SELECT payment_id, request_hash
          INTO v_existing_pay_id, v_existing_hash
          FROM public.payment_idempotency
         WHERE organization_id = p_org_id
           AND idempotency_key = p_idempotency_key;

        IF FOUND THEN
            IF v_existing_hash = v_request_hash THEN
                SELECT jsonb_build_object(
                    'success', true,
                    'payment_id', p.id,
                    'payment_number', p.payment_number,
                    'amount', p.amount,
                    'customer_id', p.customer_id,
                    'payment_date', p.payment_date,
                    'payment_method', p.payment_method,
                    'reference_number', p.reference_number,
                    'idempotent_replay', true,
                    'allocations', COALESCE(
                        (SELECT jsonb_agg(jsonb_build_object(
                            'id', pa.id,
                            'invoice_id', pa.invoice_id,
                            'amount_allocated', pa.amount_allocated
                        )) FROM public.payment_allocations pa WHERE pa.payment_id = p.id),
                        '[]'::JSONB
                    )
                ) INTO v_existing_payment
                FROM public.payments p
                WHERE p.id = v_existing_pay_id;

                RETURN v_existing_payment;
            ELSE
                RAISE EXCEPTION 'Idempotency key reused with different request parameters'
                    USING ERRCODE = 'unique_violation';
            END IF;
        END IF;
    END IF;

    -- Tenant verification: Customer must belong to p_org_id
    SELECT EXISTS (
        SELECT 1 FROM public.customers
        WHERE id = p_customer_id AND organization_id = p_org_id AND is_active = TRUE
    ) INTO v_customer_exists;

    IF NOT v_customer_exists THEN
        RAISE EXCEPTION 'Customer % not found or inactive in organization %', p_customer_id, p_org_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    -- Validate allocation bounds if invoice specified
    IF p_invoice_id IS NOT NULL THEN
        IF p_allocated_amount IS NULL OR p_allocated_amount <= 0 THEN
            RAISE EXCEPTION 'Allocated amount must be greater than zero when invoice is specified'
                USING ERRCODE = 'check_violation';
        END IF;

        IF p_allocated_amount > p_amount THEN
            RAISE EXCEPTION 'Allocated amount (%) cannot exceed total payment amount (%)', p_allocated_amount, p_amount
                USING ERRCODE = 'check_violation';
        END IF;
    ELSE
        IF p_allocated_amount IS NOT NULL AND p_allocated_amount > 0 THEN
            RAISE EXCEPTION 'Cannot allocate amount (%) without specifying an invoice_id', p_allocated_amount
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    -- Allocate receipt number
    v_payment_year := EXTRACT(YEAR FROM COALESCE(p_payment_date, CURRENT_DATE))::INTEGER;
    v_payment_num := public.internal_allocate_document_number(p_org_id, 'RECEIPT', v_payment_year);
    v_payment_id := gen_random_uuid();

    -- Set local transaction flags for payment allocation & invoice update
    PERFORM set_config('app.authoritative_payment_allocation', 'true', true);
    PERFORM set_config('app.authoritative_invoice_transition', 'true', true);

    INSERT INTO public.payments (
        id,
        organization_id,
        payment_number,
        customer_id,
        amount,
        payment_method,
        reference_number,
        payment_date,
        notes,
        created_by
    ) VALUES (
        v_payment_id,
        p_org_id,
        v_payment_num,
        p_customer_id,
        p_amount,
        p_payment_method,
        p_reference_no,
        COALESCE(p_payment_date, CURRENT_DATE),
        p_notes,
        v_uid
    );

    IF p_invoice_id IS NOT NULL THEN
        SELECT id, customer_id, total_amount, total_paid, status
        INTO v_inv
        FROM public.invoices
        WHERE id = p_invoice_id AND organization_id = p_org_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Invoice % not found in organization %', p_invoice_id, p_org_id
                USING ERRCODE = 'foreign_key_violation';
        END IF;

        IF v_inv.status = 'CANCELLED' THEN
            RAISE EXCEPTION 'Cannot allocate payment to cancelled invoice %', p_invoice_id
                USING ERRCODE = 'check_violation';
        END IF;

        IF v_inv.status = 'DRAFT' THEN
            RAISE EXCEPTION 'Cannot allocate payment to draft invoice %. Invoice must be issued before recording payments.', p_invoice_id
                USING ERRCODE = 'check_violation';
        END IF;

        IF v_inv.status NOT IN ('ISSUED', 'PARTIALLY_PAID') THEN
            RAISE EXCEPTION 'Invoice % with status "%" is not eligible for payment allocation. Only ISSUED or PARTIALLY_PAID invoices can receive payments.',
                p_invoice_id, v_inv.status
                USING ERRCODE = 'check_violation';
        END IF;

        IF (v_inv.total_amount - v_inv.total_paid) <= 0 THEN
            RAISE EXCEPTION 'Invoice % is already fully paid or has no outstanding balance', p_invoice_id
                USING ERRCODE = 'check_violation';
        END IF;

        IF v_inv.customer_id != p_customer_id THEN
            RAISE EXCEPTION 'Customer mismatch: Payment customer % does not match invoice customer %',
                p_customer_id, v_inv.customer_id
                USING ERRCODE = 'foreign_key_violation';
        END IF;

        IF (v_inv.total_paid + p_allocated_amount) > v_inv.total_amount THEN
            RAISE EXCEPTION 'Overpayment violation: Allocation of % exceeds remaining balance of % (Total: %, Paid: %) on invoice %',
                p_allocated_amount, (v_inv.total_amount - v_inv.total_paid), v_inv.total_amount, v_inv.total_paid, p_invoice_id
                USING ERRCODE = 'check_violation';
        END IF;

        v_new_paid := v_inv.total_paid + p_allocated_amount;
        IF v_new_paid >= v_inv.total_amount THEN
            v_new_status := 'PAID';
        ELSE
            v_new_status := 'PARTIALLY_PAID';
        END IF;

        UPDATE public.invoices
        SET total_paid = v_new_paid,
            status = v_new_status,
            updated_at = NOW()
        WHERE id = p_invoice_id AND organization_id = p_org_id;

        INSERT INTO public.payment_allocations (
            payment_id,
            invoice_id,
            amount_allocated
        ) VALUES (
            v_payment_id,
            p_invoice_id,
            p_allocated_amount
        );
    END IF;

    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO public.payment_idempotency (
            organization_id,
            idempotency_key,
            user_id,
            payment_id,
            request_hash
        ) VALUES (
            p_org_id,
            p_idempotency_key,
            v_uid,
            v_payment_id,
            v_request_hash
        );
    END IF;

    INSERT INTO public.audit_events (
        organization_id,
        actor_id,
        action,
        entity_type,
        entity_id,
        details
    ) VALUES (
        p_org_id,
        v_uid,
        'RECORD_PAYMENT',
        'PAYMENT',
        v_payment_id,
        jsonb_build_object(
            'payment_number', v_payment_num,
            'amount', p_amount,
            'customer_id', p_customer_id,
            'invoice_id', p_invoice_id,
            'allocated_amount', p_allocated_amount
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'payment_id', v_payment_id,
        'payment_number', v_payment_num,
        'amount', p_amount,
        'customer_id', p_customer_id,
        'payment_date', COALESCE(p_payment_date, CURRENT_DATE),
        'payment_method', p_payment_method,
        'reference_number', p_reference_no,
        'idempotent_replay', false
    );
END;
$$;

-- Overload for backwards compatibility (9 parameters)
CREATE OR REPLACE FUNCTION public.record_payment_and_allocate(
    p_org_id UUID,
    p_customer_id UUID,
    p_amount NUMERIC(12, 2),
    p_payment_method VARCHAR,
    p_reference_no VARCHAR,
    p_payment_date DATE,
    p_notes TEXT,
    p_invoice_id UUID,
    p_allocated_amount NUMERIC(12, 2)
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN public.record_payment_and_allocate(
        p_org_id,
        p_customer_id,
        p_amount,
        p_payment_method,
        p_reference_no,
        p_payment_date,
        p_notes,
        p_invoice_id,
        p_allocated_amount,
        NULL::UUID
    );
END;
$$;

REVOKE ALL ON FUNCTION public.record_payment_and_allocate(UUID, UUID, NUMERIC, VARCHAR, VARCHAR, DATE, TEXT, UUID, NUMERIC, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_payment_and_allocate(UUID, UUID, NUMERIC, VARCHAR, VARCHAR, DATE, TEXT, UUID, NUMERIC, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_payment_and_allocate(UUID, UUID, NUMERIC, VARCHAR, VARCHAR, DATE, TEXT, UUID, NUMERIC, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.record_payment_and_allocate(UUID, UUID, NUMERIC, VARCHAR, VARCHAR, DATE, TEXT, UUID, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_payment_and_allocate(UUID, UUID, NUMERIC, VARCHAR, VARCHAR, DATE, TEXT, UUID, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_payment_and_allocate(UUID, UUID, NUMERIC, VARCHAR, VARCHAR, DATE, TEXT, UUID, NUMERIC) TO service_role;

-- ----------------------------------------------------------------------------
-- 2. Authoritative get_payments_summary RPC
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_payments_summary(
    p_org_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_total_collected NUMERIC(12, 2) := 0.00;
    v_payment_count INTEGER := 0;
    v_total_receivables NUMERIC(12, 2) := 0.00;
    v_open_invoices_count INTEGER := 0;
BEGIN
    IF NOT public.can_read_organization_data(p_org_id) THEN
        RAISE EXCEPTION 'Access denied: Caller cannot read organization data'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Aggregate all verified payments for the organization
    SELECT
        COALESCE(SUM(amount), 0.00),
        COUNT(*)::INTEGER
    INTO v_total_collected, v_payment_count
    FROM public.payments
    WHERE organization_id = p_org_id;

    -- Aggregate active accounts receivable strictly on ISSUED & PARTIALLY_PAID invoices
    SELECT
        COALESCE(SUM(ROUND(GREATEST(0.00, total_amount - total_paid)::NUMERIC, 2)), 0.00),
        COUNT(*)::INTEGER
    INTO v_total_receivables, v_open_invoices_count
    FROM public.invoices
    WHERE organization_id = p_org_id
      AND status IN ('ISSUED', 'PARTIALLY_PAID')
      AND (total_amount - total_paid) > 0;

    RETURN jsonb_build_object(
        'total_collected', v_total_collected,
        'payment_count', v_payment_count,
        'total_receivables', v_total_receivables,
        'open_invoices_count', v_open_invoices_count
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_payments_summary(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_payments_summary(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_payments_summary(UUID) TO service_role;
