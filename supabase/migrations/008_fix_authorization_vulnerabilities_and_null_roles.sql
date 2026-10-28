-- ============================================================================
-- ATLAS OS MIGRATION 008: FIX AUTHORIZATION VULNERABILITIES & NULL ROLES
-- ============================================================================
-- Vulnerability Addressed:
-- In PostgreSQL PL/pgSQL, three-valued logic causes:
--   IF v_user_role NOT IN ('owner', 'admin', ...) THEN
-- to evaluate to NULL when v_user_role IS NULL (e.g. for unauthenticated
-- callers, authenticated users with no membership, users from other orgs,
-- or deactivated members).
-- Because PL/pgSQL IF statements only branch on TRUE, NULL conditions are
-- skipped, allowing unauthorized callers to bypass role enforcement in
-- SECURITY DEFINER functions.
--
-- Fixes in this migration:
-- 1. Helper Function: user_has_org_role(p_org_id UUID, VARIADIC p_roles VARCHAR[])
--    Guaranteed non-null BOOLEAN evaluation for fail-safe role verification.
-- 2. Explicit NULL-role check in confirm_sales_order():
--    Explicitly raises exception if v_user_role IS NULL before checking role membership.
-- 3. Explicit NULL-role check in record_payment_and_allocate():
--    Explicitly raises exception if v_user_role IS NULL before checking role membership.
-- 4. Explicit NULL-role check in get_product_stock():
--    Verifies caller has active membership in target organization.
-- 5. Strict Permission Revocation:
--    Ensures REVOKE ALL FROM PUBLIC, anon on all privileged functions.
--    Re-confirms trigger function direct-execution lockdown.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- PART 1: FAIL-SAFE ROLE VERIFICATION HELPER
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION user_has_org_role(p_org_id UUID, VARIADIC p_roles VARCHAR[])
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_role VARCHAR(50);
    v_uid UUID;
    v_matched BOOLEAN;
BEGIN
    -- Fail-closed: Return FALSE if org_id or roles array is null or empty
    IF p_org_id IS NULL OR p_roles IS NULL OR cardinality(p_roles) IS NULL OR cardinality(p_roles) = 0 THEN
        RETURN FALSE;
    END IF;

    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
        RETURN FALSE;
    END IF;

    SELECT role INTO v_role
    FROM public.memberships
    WHERE organization_id = p_org_id
      AND user_id = v_uid
      AND is_active = TRUE
    LIMIT 1;

    IF v_role IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Safely check membership against non-null entries in p_roles, guaranteeing non-null boolean
    SELECT EXISTS (
        SELECT 1
        FROM unnest(p_roles) AS r
        WHERE r IS NOT NULL AND r = v_role
    ) INTO v_matched;

    RETURN COALESCE(v_matched, FALSE);
END;
$$;

REVOKE ALL ON FUNCTION user_has_org_role(UUID, VARCHAR[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION user_has_org_role(UUID, VARCHAR[]) TO authenticated;

-- ----------------------------------------------------------------------------
-- PART 2: HARDENED confirm_sales_order() WITH EXPLICIT NULL-ROLE DENIAL
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION confirm_sales_order(p_order_id UUID, p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_role VARCHAR(50);
    v_order_status VARCHAR(50);
    v_item RECORD;
    v_available_stock INTEGER;
    v_item_count INTEGER := 0;
    v_uid UUID;
BEGIN
    -- 1. Authentication check
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF p_order_id IS NULL OR p_org_id IS NULL THEN
        RAISE EXCEPTION 'Invalid parameters: order_id and org_id are required';
    END IF;

    -- 2. Authorization: Caller must have an active membership in target org
    v_user_role := get_user_org_role(p_org_id);
    IF v_user_role IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Caller has no active membership in organization %', p_org_id;
    END IF;

    -- 3. Role verification: Caller must have owner, admin, or sales role
    IF v_user_role NOT IN ('owner', 'admin', 'sales') THEN
        RAISE EXCEPTION 'Unauthorized: Caller has insufficient role (%) to confirm orders in organization %',
            v_user_role, p_org_id;
    END IF;

    -- 4. Lock and verify the order strictly within organization
    SELECT status INTO v_order_status
    FROM public.sales_orders
    WHERE id = p_order_id AND organization_id = p_org_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sales order % not found in organization %', p_order_id, p_org_id;
    END IF;

    IF v_order_status != 'DRAFT' THEN
        RAISE EXCEPTION 'Order % cannot be confirmed because status is % (expected DRAFT)', p_order_id, v_order_status;
    END IF;

    -- 5. Verify order has line items
    SELECT COUNT(*) INTO v_item_count
    FROM public.sales_order_items oi
    JOIN public.sales_orders so ON so.id = oi.sales_order_id
    WHERE oi.sales_order_id = p_order_id AND so.organization_id = p_org_id;

    IF v_item_count = 0 THEN
        RAISE EXCEPTION 'Cannot confirm order %: Order has no line items', p_order_id;
    END IF;

    -- 6. Iterate over items, lock product records and verify inventory balances
    FOR v_item IN
        SELECT oi.product_id, oi.quantity, oi.product_name, oi.product_sku
        FROM public.sales_order_items oi
        JOIN public.sales_orders so ON so.id = oi.sales_order_id
        WHERE oi.sales_order_id = p_order_id AND so.organization_id = p_org_id
    LOOP
        IF v_item.quantity <= 0 THEN
            RAISE EXCEPTION 'Invalid item quantity % for product "%"', v_item.quantity, v_item.product_name;
        END IF;

        PERFORM id FROM public.products
        WHERE id = v_item.product_id AND organization_id = p_org_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Product % in order does not belong to organization %', v_item.product_id, p_org_id;
        END IF;

        v_available_stock := get_product_stock(v_item.product_id, p_org_id);

        IF v_available_stock < v_item.quantity THEN
            RAISE EXCEPTION 'Insufficient stock for product "%" (SKU: %). Available: %, Requested: %',
                v_item.product_name, v_item.product_sku, v_available_stock, v_item.quantity;
        END IF;

        INSERT INTO public.stock_movements (
            organization_id,
            product_id,
            quantity_change,
            movement_type,
            reference_type,
            reference_id,
            actor_id,
            notes
        ) VALUES (
            p_org_id,
            v_item.product_id,
            -v_item.quantity,
            'SALES_DISPATCH',
            'SALES_ORDER',
            p_order_id,
            v_uid,
            'Order confirmation deduction for ' || v_item.product_sku
        );
    END LOOP;

    -- 7. Mark order CONFIRMED scoped to organization
    UPDATE public.sales_orders
    SET status = 'CONFIRMED',
        confirmed_at = NOW(),
        confirmed_by = v_uid,
        updated_at = NOW()
    WHERE id = p_order_id AND organization_id = p_org_id;

    -- 8. Log audit event
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
        'CONFIRM_ORDER',
        'SALES_ORDER',
        p_order_id,
        jsonb_build_object('order_id', p_order_id, 'previous_status', 'DRAFT', 'new_status', 'CONFIRMED')
    );

    RETURN jsonb_build_object('success', true, 'order_id', p_order_id, 'status', 'CONFIRMED');
END;
$$;

REVOKE ALL ON FUNCTION confirm_sales_order(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION confirm_sales_order(UUID, UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- PART 3: HARDENED record_payment_and_allocate() WITH EXPLICIT NULL-ROLE DENIAL
-- ----------------------------------------------------------------------------

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

    -- Generate payment number
    v_payment_num := 'PAY-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');

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

    -- 7. If invoice allocation is provided, lock and verify invoice tenant, customer, and balance
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

    -- 8. Audit log
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
            'invoice_id', p_invoice_id,
            'allocated_amount', p_allocated_amount
        )
    );

    RETURN jsonb_build_object('success', true, 'payment_id', v_payment_id, 'payment_number', v_payment_num);
END;
$$;

REVOKE ALL ON FUNCTION record_payment_and_allocate(UUID, UUID, NUMERIC, VARCHAR, VARCHAR, DATE, TEXT, UUID, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION record_payment_and_allocate(UUID, UUID, NUMERIC, VARCHAR, VARCHAR, DATE, TEXT, UUID, NUMERIC) TO authenticated;

-- ----------------------------------------------------------------------------
-- PART 4: HARDENED get_product_stock() WITH EXPLICIT NULL-ROLE DENIAL
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_product_stock(p_product_id UUID, p_org_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_role VARCHAR(50);
    v_product_exists BOOLEAN;
    v_total INTEGER;
BEGIN
    -- 1. Authentication check
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF p_product_id IS NULL OR p_org_id IS NULL THEN
        RAISE EXCEPTION 'Invalid parameters: product_id and org_id are required';
    END IF;

    -- 2. Organization membership check with explicit NULL check
    v_user_role := get_user_org_role(p_org_id);
    IF v_user_role IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Caller has no active membership in organization %', p_org_id;
    END IF;

    -- 3. Tenant verification: Product must belong to p_org_id
    SELECT EXISTS (
        SELECT 1 FROM public.products
        WHERE id = p_product_id AND organization_id = p_org_id
    ) INTO v_product_exists;

    IF NOT v_product_exists THEN
        RAISE EXCEPTION 'Product % not found in organization %', p_product_id, p_org_id;
    END IF;

    -- 4. Calculate stock strictly within tenant ledger
    SELECT COALESCE(SUM(quantity_change), 0)
    INTO v_total
    FROM public.stock_movements
    WHERE product_id = p_product_id
      AND organization_id = p_org_id;

    RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION get_product_stock(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_product_stock(UUID, UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- PART 5: RE-CONFIRM TRIGGER FUNCTIONS DIRECT EXECUTION LOCKDOWN
-- ----------------------------------------------------------------------------

REVOKE ALL ON FUNCTION trg_check_quotation_item_org() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION trg_check_sales_order_item_org() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION trg_check_invoice_item_org() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION trg_check_payment_allocation_org() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- PART 6: SUMMARY NOTIFICATION
-- ----------------------------------------------------------------------------

DO $$
BEGIN
    RAISE NOTICE 'Atlas OS Migration 008: Authorization vulnerabilities & NULL-role bypasses successfully patched.';
END;
$$;
