-- ============================================================================
-- MIGRATION 011: Atomic Payment Receipt Numbering & Sequence Integration (Hardened)
-- ============================================================================
-- REVIEW ONLY: DO NOT DEPLOY OR EXECUTE ON PRODUCTION WITHOUT STAGING VALIDATION.
--
-- Purpose:
-- Replaces non-atomic random payment numbering with an atomic, database-backed
-- sequence allocator per organization, document type ('RECEIPT'), and year.
-- Uses row-level locking on document_sequences to ensure race-free concurrency.
--
-- Security & Integrity Hardening:
-- 1. Transaction-wrapped: fails completely if preflight or any step encounters an error.
-- 2. Preflight validation fails immediately if historical duplicate/null payment_numbers exist.
-- 3. Direct authenticated calls to allocate RECEIPT numbers via public allocate_document_number()
--    are strictly denied. Receipt numbers can ONLY be allocated via the internal allocator
--    invoked from within record_payment_and_allocate().
-- 4. Dynamic owner alignment ensures the effective owner of record_payment_and_allocate()
--    has execution permission on internal_allocate_document_number(), while ordinary
--    'authenticated' and 'anon' roles remain denied.
-- 5. Public allocate_document_number() preserves the existing contract for 'QUOTATION',
--    'SALES_ORDER', and 'INVOICE'.
-- 6. Numbers >= 10000 do not truncate or collide (prevents PostgreSQL LPAD 4-character truncation).
-- 7. Full transactional atomicity: if payment validation, invoice allocation, or audit fails,
--    the entire transaction rolls back including the document sequence row lock.
-- ============================================================================

BEGIN;

-- Step 1: Preflight Historical Data Verification
-- Must run before any schema modifications. Fails immediately and aborts the migration
-- if duplicate or NULL payment numbers exist in public.payments.
DO $$
DECLARE
    v_dup_count INTEGER;
    v_null_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_dup_count
    FROM (
        SELECT organization_id, payment_number
        FROM public.payments
        WHERE payment_number IS NOT NULL
        GROUP BY organization_id, payment_number
        HAVING COUNT(*) > 1
    ) dups;

    IF v_dup_count > 0 THEN
        RAISE EXCEPTION 'Migration 011 aborted: % duplicate payment_number group(s) detected in public.payments. Manual deduplication is required before proceeding.', v_dup_count;
    END IF;

    SELECT COUNT(*) INTO v_null_count
    FROM public.payments
    WHERE payment_number IS NULL;

    IF v_null_count > 0 THEN
        RAISE EXCEPTION 'Migration 011 aborted: % NULL payment_number value(s) detected in public.payments. Manual remediation required before proceeding.', v_null_count;
    END IF;
END $$;

-- Step 2: Schema Adjustments & Constraint Verification
-- Update document_sequences constraint to allow 'RECEIPT'
ALTER TABLE public.document_sequences 
DROP CONSTRAINT IF EXISTS document_sequences_document_type_check;

ALTER TABLE public.document_sequences 
ADD CONSTRAINT document_sequences_document_type_check 
CHECK (document_type IN ('QUOTATION', 'SALES_ORDER', 'INVOICE', 'RECEIPT'));

-- Verify that a unique constraint on (organization_id, payment_number) exists on payments
-- (originally created in migration 005). If not present, add it without creating redundant constraints.
DO $$
DECLARE
    v_has_unique BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        JOIN pg_namespace n ON t.relnamespace = n.oid
        WHERE n.nspname = 'public'
          AND t.relname = 'payments'
          AND c.contype = 'u'
          AND (
            SELECT array_agg(a.attname::TEXT ORDER BY array_position(c.conkey, a.attnum))
            FROM pg_attribute a
            WHERE a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
          ) = ARRAY['organization_id', 'payment_number']::TEXT[]
    ) INTO v_has_unique;

    IF NOT v_has_unique THEN
        ALTER TABLE public.payments 
        ADD CONSTRAINT payments_organization_id_payment_number_key 
        UNIQUE (organization_id, payment_number);
    END IF;
END $$;

-- Step 3: Internal Atomic Sequence Allocation Function
-- Private allocator: revoking execute from PUBLIC, anon, and authenticated.
-- Only callable by SECURITY DEFINER functions (such as record_payment_and_allocate) or service_role.
CREATE OR REPLACE FUNCTION public.internal_allocate_document_number(
    p_org_id UUID,
    p_doc_type VARCHAR,
    p_year INTEGER
)
RETURNS VARCHAR AS $$
DECLARE
    v_prefix VARCHAR;
    v_next_val INTEGER;
    v_candidate VARCHAR;
    v_exists BOOLEAN;
    v_num_part VARCHAR;
    v_fy VARCHAR;
BEGIN
    -- Strict null and range validation
    IF p_org_id IS NULL THEN
        RAISE EXCEPTION 'organization_id cannot be null';
    END IF;

    IF p_doc_type IS NULL THEN
        RAISE EXCEPTION 'document_type cannot be null';
    END IF;

    IF p_year IS NULL OR p_year < 2000 OR p_year > 2100 THEN
        RAISE EXCEPTION 'Invalid year: %. Must be between 2000 and 2100.', p_year;
    END IF;

    -- Validate document type and assign canonical prefix
    IF p_doc_type = 'QUOTATION' THEN
        v_prefix := 'QT';
    ELSIF p_doc_type = 'SALES_ORDER' THEN
        v_prefix := 'SO';
    ELSIF p_doc_type = 'INVOICE' THEN
        v_prefix := 'ATL';
    ELSIF p_doc_type = 'RECEIPT' THEN
        v_prefix := 'RCP';
    ELSE
        RAISE EXCEPTION 'Invalid document type: %. Must be QUOTATION, SALES_ORDER, INVOICE, or RECEIPT.', p_doc_type;
    END IF;

    -- Atomic allocation loop with row-locking and organization-scoped collision check
    LOOP
        -- Atomic upsert increment using row lock on (organization_id, document_type, year)
        INSERT INTO public.document_sequences (
            organization_id, 
            document_type, 
            year, 
            current_value, 
            created_at, 
            updated_at
        ) VALUES (
            p_org_id, 
            p_doc_type, 
            p_year, 
            1, 
            NOW(), 
            NOW()
        )
        ON CONFLICT (organization_id, document_type, year)
        DO UPDATE SET 
            current_value = public.document_sequences.current_value + 1,
            updated_at = NOW()
        RETURNING current_value INTO v_next_val;

        -- Format numeric part: zero-pad to 4 digits if < 10000; preserve full string without truncation if >= 10000
        IF v_next_val < 10000 THEN
            v_num_part := LPAD(v_next_val::TEXT, 4, '0');
        ELSE
            v_num_part := v_next_val::TEXT;
        END IF;

        IF p_doc_type = 'INVOICE' THEN
            -- Indian GST Financial Year format: ATL/YY-YY/NNNN (GST Rule 46 compliant)
            -- Indian FY runs April 1 to March 31.
            IF EXTRACT(MONTH FROM CURRENT_DATE) < 4 THEN
                v_fy := TO_CHAR((p_year - 1) % 100, 'FM00') || '-' || TO_CHAR(p_year % 100, 'FM00');
            ELSE
                v_fy := TO_CHAR(p_year % 100, 'FM00') || '-' || TO_CHAR((p_year + 1) % 100, 'FM00');
            END IF;
            v_candidate := 'ATL/' || v_fy || '/' || v_num_part;
        ELSE
            v_candidate := v_prefix || '-' || p_year::TEXT || '-' || v_num_part;
        END IF;

        -- Verify candidate does not collide with existing historical records for this organization
        IF p_doc_type = 'QUOTATION' THEN
            SELECT EXISTS (
                SELECT 1 FROM public.quotations 
                WHERE organization_id = p_org_id AND quotation_number = v_candidate
            ) INTO v_exists;
        ELSIF p_doc_type = 'SALES_ORDER' THEN
            SELECT EXISTS (
                SELECT 1 FROM public.sales_orders 
                WHERE organization_id = p_org_id AND order_number = v_candidate
            ) INTO v_exists;
        ELSIF p_doc_type = 'INVOICE' THEN
            SELECT EXISTS (
                SELECT 1 FROM public.invoices 
                WHERE organization_id = p_org_id AND invoice_number = v_candidate
            ) INTO v_exists;
        ELSIF p_doc_type = 'RECEIPT' THEN
            SELECT EXISTS (
                SELECT 1 FROM public.payments 
                WHERE organization_id = p_org_id AND payment_number = v_candidate
            ) INTO v_exists;
        END IF;

        IF NOT v_exists THEN
            RETURN v_candidate;
        END IF;
        -- If already exists in table, loop advances sequence to next candidate
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Revoke all permissions on internal allocator from general users
REVOKE ALL ON FUNCTION public.internal_allocate_document_number(UUID, VARCHAR, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.internal_allocate_document_number(UUID, VARCHAR, INTEGER) TO service_role;

-- Step 4: Public Atomic Sequence Allocation RPC Function
-- Preserves existing public contract for QUOTATION, SALES_ORDER, and INVOICE.
-- Explicitly denies direct receipt-number reservation to authenticated users.
CREATE OR REPLACE FUNCTION public.allocate_document_number(
    p_org_id UUID,
    p_doc_type VARCHAR,
    p_year INTEGER DEFAULT EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER
)
RETURNS VARCHAR AS $$
DECLARE
    v_has_access BOOLEAN;
BEGIN
    -- 1. Strict input validation
    IF p_org_id IS NULL THEN
        RAISE EXCEPTION 'organization_id cannot be null';
    END IF;

    IF p_doc_type IS NULL THEN
        RAISE EXCEPTION 'document_type cannot be null';
    END IF;

    IF p_year IS NULL OR p_year < 2000 OR p_year > 2100 THEN
        RAISE EXCEPTION 'Invalid year: %. Must be between 2000 and 2100.', p_year;
    END IF;

    -- 2. Security Check: Authenticated callers must belong to target org with active membership
    IF auth.role() = 'authenticated' THEN
        SELECT EXISTS (
            SELECT 1 FROM public.memberships
            WHERE organization_id = p_org_id 
              AND user_id = auth.uid()
              AND is_active = TRUE
        ) INTO v_has_access;

        IF NOT v_has_access THEN
            RAISE EXCEPTION 'Access denied: caller does not belong to organization %', p_org_id;
        END IF;
    END IF;

    -- 3. Document Type Security Restriction:
    -- Direct external allocation is allowed ONLY for QUOTATION, SALES_ORDER, and INVOICE.
    -- RECEIPT numbers can only be allocated via record_payment_and_allocate().
    IF p_doc_type = 'RECEIPT' THEN
        RAISE EXCEPTION 'Access denied: RECEIPT numbers cannot be allocated directly. They are allocated atomically by record_payment_and_allocate().';
    ELSIF p_doc_type NOT IN ('QUOTATION', 'SALES_ORDER', 'INVOICE') THEN
        RAISE EXCEPTION 'Invalid document type: %. Must be QUOTATION, SALES_ORDER, or INVOICE.', p_doc_type;
    END IF;

    -- 4. Delegate to internal allocator
    RETURN public.internal_allocate_document_number(p_org_id, p_doc_type, p_year);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Permissions for public allocate_document_number
REVOKE ALL ON FUNCTION public.allocate_document_number(UUID, VARCHAR, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.allocate_document_number(UUID, VARCHAR, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_document_number(UUID, VARCHAR, INTEGER) TO service_role;

-- Step 5: Hardened record_payment_and_allocate() with atomic receipt sequence allocation
CREATE OR REPLACE FUNCTION record_payment_and_allocate(
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
BEGIN
    -- 1. Authentication check
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    -- 2. Null & bounds validation
    IF p_org_id IS NULL OR p_customer_id IS NULL OR p_amount IS NULL OR p_payment_method IS NULL THEN
        RAISE EXCEPTION 'Invalid parameters: organization_id, customer_id, amount, and payment_method are required';
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Payment amount must be greater than zero (received %)', p_amount;
    END IF;

    IF p_payment_method NOT IN ('CASH', 'UPI', 'NEFT', 'RTGS', 'CHEQUE', 'BANK_TRANSFER') THEN
        RAISE EXCEPTION 'Invalid payment method: %. Allowed methods: CASH, UPI, NEFT, RTGS, CHEQUE, BANK_TRANSFER', p_payment_method;
    END IF;

    -- 3. Authorization: Caller must have an active membership in target org
    v_user_role := get_user_org_role(p_org_id);
    IF v_user_role IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Caller has no active membership in organization %', p_org_id;
    END IF;

    -- 4. Role verification: Caller must have owner, admin, or accounts role
    IF v_user_role NOT IN ('owner', 'admin', 'accounts') THEN
        RAISE EXCEPTION 'Unauthorized: Caller has insufficient role (%) to record payments in organization %',
            v_user_role, p_org_id;
    END IF;

    -- 5. Tenant verification: Customer must belong to p_org_id
    SELECT EXISTS (
        SELECT 1 FROM public.customers
        WHERE id = p_customer_id AND organization_id = p_org_id
    ) INTO v_customer_exists;

    IF NOT v_customer_exists THEN
        RAISE EXCEPTION 'Customer % not found in organization %', p_customer_id, p_org_id;
    END IF;

    -- 6. Validate allocation bounds if invoice specified
    IF p_invoice_id IS NOT NULL THEN
        IF p_allocated_amount IS NULL OR p_allocated_amount <= 0 THEN
            RAISE EXCEPTION 'Allocated amount must be greater than zero when invoice is specified';
        END IF;

        IF p_allocated_amount > p_amount THEN
            RAISE EXCEPTION 'Allocated amount (%) cannot exceed total payment amount (%)', p_allocated_amount, p_amount;
        END IF;
    ELSE
        IF p_allocated_amount IS NOT NULL AND p_allocated_amount > 0 THEN
            RAISE EXCEPTION 'Cannot allocate amount (%) without specifying an invoice_id', p_allocated_amount;
        END IF;
    END IF;

    -- 7. ATOMIC RECEIPT ALLOCATION (Inside same database transaction via internal allocator)
    -- Derives year from payment date (defaults to current year)
    v_payment_year := EXTRACT(YEAR FROM COALESCE(p_payment_date, CURRENT_DATE))::INTEGER;
    v_payment_num := public.internal_allocate_document_number(p_org_id, 'RECEIPT', v_payment_year);

    -- Insert Payment
    INSERT INTO public.payments (
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
        p_org_id,
        v_payment_num,
        p_customer_id,
        p_amount,
        p_payment_method,
        p_reference_no,
        COALESCE(p_payment_date, CURRENT_DATE),
        p_notes,
        v_uid
    ) RETURNING id INTO v_payment_id;

    -- 8. If invoice allocation is provided, lock and verify invoice tenant, customer, and balance
    IF p_invoice_id IS NOT NULL THEN
        SELECT id, customer_id, total_amount, total_paid, status
        INTO v_inv
        FROM public.invoices
        WHERE id = p_invoice_id AND organization_id = p_org_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Invoice % not found in organization %', p_invoice_id, p_org_id;
        END IF;

        IF v_inv.status = 'CANCELLED' THEN
            RAISE EXCEPTION 'Cannot allocate payment to cancelled invoice %', p_invoice_id;
        END IF;

        IF v_inv.customer_id != p_customer_id THEN
            RAISE EXCEPTION 'Customer mismatch: Payment customer % does not match invoice customer %',
                p_customer_id, v_inv.customer_id;
        END IF;

        IF (v_inv.total_paid + p_allocated_amount) > v_inv.total_amount THEN
            RAISE EXCEPTION 'Overpayment violation: Allocation of % exceeds remaining balance of % (Total: %, Paid: %) on invoice %',
                p_allocated_amount, (v_inv.total_amount - v_inv.total_paid), v_inv.total_amount, v_inv.total_paid, v_inv.id;
        END IF;

        INSERT INTO public.payment_allocations (
            payment_id,
            invoice_id,
            amount_allocated
        ) VALUES (
            v_payment_id,
            p_invoice_id,
            p_allocated_amount
        );

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
    END IF;

    -- 9. Audit log
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
        'payment_number', v_payment_num
    );
END;
$$;

-- Permissions for record_payment_and_allocate
REVOKE ALL ON FUNCTION record_payment_and_allocate(UUID, UUID, NUMERIC, VARCHAR, VARCHAR, DATE, TEXT, UUID, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION record_payment_and_allocate(UUID, UUID, NUMERIC, VARCHAR, VARCHAR, DATE, TEXT, UUID, NUMERIC) TO authenticated;

-- Step 6: Function Owner Alignment
-- Ensure that the effective owner of record_payment_and_allocate has explicit EXECUTE
-- rights on internal_allocate_document_number, without exposing it to 'authenticated' or 'anon'.
DO $$
DECLARE
    v_owner_role NAME;
BEGIN
    SELECT r.rolname INTO v_owner_role
    FROM pg_proc p
    JOIN pg_roles r ON p.proowner = r.oid
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname = 'record_payment_and_allocate'
    LIMIT 1;

    IF v_owner_role IS NOT NULL THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.internal_allocate_document_number(UUID, VARCHAR, INTEGER) TO %I', v_owner_role);
    END IF;
END $$;

COMMIT;
