-- ============================================================================
-- MIGRATION 007: Critical Security Hardening, Tenant Isolation,
--                Composite Foreign-Key Fixes & RPC Integrity
-- ============================================================================
-- Forward-only migration addressing findings from remote live database audit:
-- 1. Fixes composite foreign-key ON DELETE SET NULL bug on sales_orders & invoices:
--    Replaces dangerous ON DELETE SET NULL ('n') with ON DELETE RESTRICT ('r')
--    on (quotation_id, organization_id) and (sales_order_id, organization_id).
--    Prevents PostgreSQL from attempting to set NOT NULL organization_id to NULL.
-- 2. Revokes execution from PUBLIC and anon on all SECURITY DEFINER functions,
--    granting EXECUTE strictly to authenticated.
-- 3. Fixes auth_rls_initplan warning by wrapping auth.uid() in (SELECT auth.uid()).
-- 4. Fixes multiple_permissive_policies warning by separating SELECT policies from
--    INSERT, UPDATE, and DELETE policies across all tenant tables.
-- 5. Complete input validation and boundary enforcement on privileged functions:
--    - get_user_organizations()
--    - get_user_org_role(UUID)
--    - get_product_stock(UUID, UUID)
--    - confirm_sales_order(UUID, UUID)
--    - record_payment_and_allocate(UUID, UUID, NUMERIC, VARCHAR, VARCHAR, DATE, TEXT, UUID, NUMERIC)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- PART 1: SECURE, NON-RECURSIVE MEMBERSHIP HELPER FUNCTIONS
-- ----------------------------------------------------------------------------

-- Returns set of organization IDs that current authenticated user belongs to
CREATE OR REPLACE FUNCTION get_user_organizations()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT organization_id
    FROM public.memberships
    WHERE user_id = (SELECT auth.uid())
      AND is_active = TRUE;
$$;

REVOKE ALL ON FUNCTION get_user_organizations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_user_organizations() TO authenticated;

-- Returns caller's active role within a specific organization
CREATE OR REPLACE FUNCTION get_user_org_role(p_org_id UUID)
RETURNS VARCHAR(50)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_role VARCHAR(50);
    v_uid UUID;
BEGIN
    v_uid := (SELECT auth.uid());
    IF p_org_id IS NULL OR v_uid IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT role INTO v_role
    FROM public.memberships
    WHERE organization_id = p_org_id
      AND user_id = v_uid
      AND is_active = TRUE
    LIMIT 1;

    RETURN v_role;
END;
$$;

REVOKE ALL ON FUNCTION get_user_org_role(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_user_org_role(UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- PART 2: IDEMPOTENT COMPOSITE UNIQUE CONSTRAINTS
-- ----------------------------------------------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_products_id_org') THEN
        ALTER TABLE products ADD CONSTRAINT uq_products_id_org UNIQUE (id, organization_id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_customers_id_org') THEN
        ALTER TABLE customers ADD CONSTRAINT uq_customers_id_org UNIQUE (id, organization_id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_suppliers_id_org') THEN
        ALTER TABLE suppliers ADD CONSTRAINT uq_suppliers_id_org UNIQUE (id, organization_id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_quotations_id_org') THEN
        ALTER TABLE quotations ADD CONSTRAINT uq_quotations_id_org UNIQUE (id, organization_id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_sales_orders_id_org') THEN
        ALTER TABLE sales_orders ADD CONSTRAINT uq_sales_orders_id_org UNIQUE (id, organization_id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_invoices_id_org') THEN
        ALTER TABLE invoices ADD CONSTRAINT uq_invoices_id_org UNIQUE (id, organization_id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_payments_id_org') THEN
        ALTER TABLE payments ADD CONSTRAINT uq_payments_id_org UNIQUE (id, organization_id);
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- PART 3: FIX COMPOSITE FOREIGN-KEY DELETION BEHAVIOR
-- Replaces ON DELETE SET NULL ('n') with ON DELETE RESTRICT ('r')
-- ----------------------------------------------------------------------------

-- 3a. Fix sales_orders -> quotations foreign key
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sales_orders_quotation_org') THEN
        ALTER TABLE sales_orders DROP CONSTRAINT fk_sales_orders_quotation_org;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_orders_quotation_id_fkey') THEN
        ALTER TABLE sales_orders DROP CONSTRAINT sales_orders_quotation_id_fkey;
    END IF;

    ALTER TABLE sales_orders
        ADD CONSTRAINT fk_sales_orders_quotation_org
        FOREIGN KEY (quotation_id, organization_id)
        REFERENCES quotations(id, organization_id)
        ON DELETE RESTRICT;
END $$;

-- 3b. Fix invoices -> sales_orders foreign key
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_invoices_sales_order_org') THEN
        ALTER TABLE invoices DROP CONSTRAINT fk_invoices_sales_order_org;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_sales_order_id_fkey') THEN
        ALTER TABLE invoices DROP CONSTRAINT invoices_sales_order_id_fkey;
    END IF;

    ALTER TABLE invoices
        ADD CONSTRAINT fk_invoices_sales_order_org
        FOREIGN KEY (sales_order_id, organization_id)
        REFERENCES sales_orders(id, organization_id)
        ON DELETE RESTRICT;
END $$;

-- 3c. Ensure all other composite foreign keys exist with ON DELETE RESTRICT
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_stock_movements_product_org') THEN
        ALTER TABLE stock_movements
            ADD CONSTRAINT fk_stock_movements_product_org
            FOREIGN KEY (product_id, organization_id)
            REFERENCES products(id, organization_id)
            ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_quotations_customer_org') THEN
        ALTER TABLE quotations
            ADD CONSTRAINT fk_quotations_customer_org
            FOREIGN KEY (customer_id, organization_id)
            REFERENCES customers(id, organization_id)
            ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sales_orders_customer_org') THEN
        ALTER TABLE sales_orders
            ADD CONSTRAINT fk_sales_orders_customer_org
            FOREIGN KEY (customer_id, organization_id)
            REFERENCES customers(id, organization_id)
            ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_invoices_customer_org') THEN
        ALTER TABLE invoices
            ADD CONSTRAINT fk_invoices_customer_org
            FOREIGN KEY (customer_id, organization_id)
            REFERENCES customers(id, organization_id)
            ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_payments_customer_org') THEN
        ALTER TABLE payments
            ADD CONSTRAINT fk_payments_customer_org
            FOREIGN KEY (customer_id, organization_id)
            REFERENCES customers(id, organization_id)
            ON DELETE RESTRICT;
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- PART 4: RELATIONAL INTEGRITY TRIGGERS & ACCESS LOCKDOWN
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trg_check_quotation_item_org()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_quotation_org_id UUID;
    v_product_org_id UUID;
BEGIN
    SELECT organization_id INTO v_quotation_org_id
    FROM public.quotations
    WHERE id = NEW.quotation_id;

    SELECT organization_id INTO v_product_org_id
    FROM public.products
    WHERE id = NEW.product_id;

    IF v_quotation_org_id IS NULL OR v_product_org_id IS NULL THEN
        RAISE EXCEPTION 'Referenced quotation or product not found';
    END IF;

    IF v_quotation_org_id != v_product_org_id THEN
        RAISE EXCEPTION 'Cross-tenant violation: Product % (org %) cannot be added to quotation % (org %)',
            NEW.product_id, v_product_org_id, NEW.quotation_id, v_quotation_org_id;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION trg_check_quotation_item_org() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS check_quotation_item_org_trigger ON quotation_items;
CREATE TRIGGER check_quotation_item_org_trigger
BEFORE INSERT OR UPDATE ON quotation_items
FOR EACH ROW EXECUTE FUNCTION trg_check_quotation_item_org();

CREATE OR REPLACE FUNCTION trg_check_sales_order_item_org()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order_org_id UUID;
    v_product_org_id UUID;
BEGIN
    SELECT organization_id INTO v_order_org_id
    FROM public.sales_orders
    WHERE id = NEW.sales_order_id;

    SELECT organization_id INTO v_product_org_id
    FROM public.products
    WHERE id = NEW.product_id;

    IF v_order_org_id IS NULL OR v_product_org_id IS NULL THEN
        RAISE EXCEPTION 'Referenced sales order or product not found';
    END IF;

    IF v_order_org_id != v_product_org_id THEN
        RAISE EXCEPTION 'Cross-tenant violation: Product % (org %) cannot be added to sales order % (org %)',
            NEW.product_id, v_product_org_id, NEW.sales_order_id, v_order_org_id;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION trg_check_sales_order_item_org() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS check_sales_order_item_org_trigger ON sales_order_items;
CREATE TRIGGER check_sales_order_item_org_trigger
BEFORE INSERT OR UPDATE ON sales_order_items
FOR EACH ROW EXECUTE FUNCTION trg_check_sales_order_item_org();

CREATE OR REPLACE FUNCTION trg_check_invoice_item_org()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_invoice_org_id UUID;
    v_product_org_id UUID;
BEGIN
    SELECT organization_id INTO v_invoice_org_id
    FROM public.invoices
    WHERE id = NEW.invoice_id;

    IF NEW.product_id IS NOT NULL THEN
        SELECT organization_id INTO v_product_org_id
        FROM public.products
        WHERE id = NEW.product_id;

        IF v_product_org_id IS NULL THEN
            RAISE EXCEPTION 'Referenced product not found';
        END IF;

        IF v_invoice_org_id != v_product_org_id THEN
            RAISE EXCEPTION 'Cross-tenant violation: Product % (org %) cannot be added to invoice % (org %)',
                NEW.product_id, v_product_org_id, NEW.invoice_id, v_invoice_org_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION trg_check_invoice_item_org() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS check_invoice_item_org_trigger ON invoice_items;
CREATE TRIGGER check_invoice_item_org_trigger
BEFORE INSERT OR UPDATE ON invoice_items
FOR EACH ROW EXECUTE FUNCTION trg_check_invoice_item_org();

CREATE OR REPLACE FUNCTION trg_check_payment_allocation_org()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_payment_org_id UUID;
    v_payment_customer_id UUID;
    v_invoice_org_id UUID;
    v_invoice_customer_id UUID;
BEGIN
    SELECT organization_id, customer_id INTO v_payment_org_id, v_payment_customer_id
    FROM public.payments
    WHERE id = NEW.payment_id;

    SELECT organization_id, customer_id INTO v_invoice_org_id, v_invoice_customer_id
    FROM public.invoices
    WHERE id = NEW.invoice_id;

    IF v_payment_org_id IS NULL OR v_invoice_org_id IS NULL THEN
        RAISE EXCEPTION 'Referenced payment or invoice not found';
    END IF;

    IF v_payment_org_id != v_invoice_org_id THEN
        RAISE EXCEPTION 'Cross-tenant violation: Payment % (org %) cannot be allocated to invoice % (org %)',
            NEW.payment_id, v_payment_org_id, NEW.invoice_id, v_invoice_org_id;
    END IF;

    IF v_payment_customer_id != v_invoice_customer_id THEN
        RAISE EXCEPTION 'Cross-customer violation: Payment is for customer %, but invoice is for customer %',
            v_payment_customer_id, v_invoice_customer_id;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION trg_check_payment_allocation_org() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS check_payment_allocation_org_trigger ON payment_allocations;
CREATE TRIGGER check_payment_allocation_org_trigger
BEFORE INSERT OR UPDATE ON payment_allocations
FOR EACH ROW EXECUTE FUNCTION trg_check_payment_allocation_org();

-- ----------------------------------------------------------------------------
-- PART 5: HARDENED PRIVILEGED DATABASE FUNCTIONS
-- ----------------------------------------------------------------------------

-- Function 1: get_product_stock()
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

    -- 2. Organization membership check
    v_user_role := get_user_org_role(p_org_id);
    IF v_user_role IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Caller is not an active member of organization %', p_org_id;
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

-- Function 2: confirm_sales_order()
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

    -- 2. Authorization: Caller must have owner, admin, or sales role
    v_user_role := get_user_org_role(p_org_id);
    IF v_user_role NOT IN ('owner', 'admin', 'sales') THEN
        RAISE EXCEPTION 'Unauthorized: Caller has insufficient role (%) to confirm orders in organization %',
            COALESCE(v_user_role, 'none'), p_org_id;
    END IF;

    -- 3. Lock and verify the order strictly within organization
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

    -- 4. Verify order has line items
    SELECT COUNT(*) INTO v_item_count
    FROM public.sales_order_items oi
    JOIN public.sales_orders so ON so.id = oi.sales_order_id
    WHERE oi.sales_order_id = p_order_id AND so.organization_id = p_org_id;

    IF v_item_count = 0 THEN
        RAISE EXCEPTION 'Cannot confirm order %: Order has no line items', p_order_id;
    END IF;

    -- 5. Iterate over items, lock product records and verify inventory balances
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

    -- 6. Mark order CONFIRMED scoped to organization
    UPDATE public.sales_orders
    SET status = 'CONFIRMED',
        confirmed_at = NOW(),
        confirmed_by = v_uid,
        updated_at = NOW()
    WHERE id = p_order_id AND organization_id = p_org_id;

    -- 7. Log audit event
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

-- Function 3: record_payment_and_allocate()
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

    -- 3. Authorization: Caller must have owner, admin, or accounts role
    v_user_role := get_user_org_role(p_org_id);
    IF v_user_role NOT IN ('owner', 'admin', 'accounts') THEN
        RAISE EXCEPTION 'Unauthorized: Caller has insufficient role (%) to record payments in organization %',
            COALESCE(v_user_role, 'none'), p_org_id;
    END IF;

    -- 4. Tenant verification: Customer must belong to p_org_id
    SELECT EXISTS (
        SELECT 1 FROM public.customers
        WHERE id = p_customer_id AND organization_id = p_org_id
    ) INTO v_customer_exists;

    IF NOT v_customer_exists THEN
        RAISE EXCEPTION 'Customer % not found in organization %', p_customer_id, p_org_id;
    END IF;

    -- 5. Validate allocation bounds if invoice specified
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

    -- 6. If invoice allocation is provided, lock and verify invoice tenant, customer, and balance
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

    -- 7. Audit log
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
-- PART 6: OPTIMIZED ROW LEVEL SECURITY POLICIES (NO MULTIPLE PERMISSIVE POLICIES)
-- Explicitly separates SELECT from INSERT, UPDATE, and DELETE.
-- Wraps auth.uid() in (SELECT auth.uid()) to eliminate per-row re-evaluation.
-- ----------------------------------------------------------------------------

-- 1. Organizations
DROP POLICY IF EXISTS "Users can view organizations they belong to" ON organizations;
DROP POLICY IF EXISTS "Owners and admins can update their organization" ON organizations;

CREATE POLICY "Users can view organizations they belong to"
ON organizations FOR SELECT
USING (id IN (SELECT get_user_organizations()));

CREATE POLICY "Owners and admins can update their organization"
ON organizations FOR UPDATE
USING (get_user_org_role(id) IN ('owner', 'admin'))
WITH CHECK (get_user_org_role(id) IN ('owner', 'admin'));

-- 2. Memberships
DROP POLICY IF EXISTS "Users can view memberships of their organizations" ON memberships;
DROP POLICY IF EXISTS "Owners can manage organization memberships" ON memberships;
DROP POLICY IF EXISTS "Users can view own memberships" ON memberships;
DROP POLICY IF EXISTS "Users can view organization member list" ON memberships;
DROP POLICY IF EXISTS "Owners can insert organization memberships" ON memberships;
DROP POLICY IF EXISTS "Owners can update organization memberships" ON memberships;
DROP POLICY IF EXISTS "Owners can delete organization memberships" ON memberships;

-- Consolidated SELECT policy with cached auth.uid()
CREATE POLICY "Users can view organization member list"
ON memberships FOR SELECT
USING (
    user_id = (SELECT auth.uid()) 
    OR organization_id IN (SELECT get_user_organizations())
);

CREATE POLICY "Owners can insert organization memberships"
ON memberships FOR INSERT
WITH CHECK (get_user_org_role(organization_id) = 'owner');

CREATE POLICY "Owners can update organization memberships"
ON memberships FOR UPDATE
USING (get_user_org_role(organization_id) = 'owner')
WITH CHECK (get_user_org_role(organization_id) = 'owner');

CREATE POLICY "Owners can delete organization memberships"
ON memberships FOR DELETE
USING (get_user_org_role(organization_id) = 'owner');

-- 3. Audit Events
DROP POLICY IF EXISTS "Admins and owners can view audit logs" ON audit_events;
DROP POLICY IF EXISTS "Members can log audit events" ON audit_events;

CREATE POLICY "Admins and owners can view audit logs"
ON audit_events FOR SELECT
USING (get_user_org_role(organization_id) IN ('owner', 'admin'));

CREATE POLICY "Members can log audit events"
ON audit_events FOR INSERT
WITH CHECK (organization_id IN (SELECT get_user_organizations()));

-- 4. Products
DROP POLICY IF EXISTS "Users can view products of their organization" ON products;
DROP POLICY IF EXISTS "Inventory and admins can manage products" ON products;
DROP POLICY IF EXISTS "Inventory and admins can insert products" ON products;
DROP POLICY IF EXISTS "Inventory and admins can update products" ON products;
DROP POLICY IF EXISTS "Inventory and admins can delete products" ON products;

CREATE POLICY "Users can view products of their organization"
ON products FOR SELECT
USING (organization_id IN (SELECT get_user_organizations()));

CREATE POLICY "Inventory and admins can insert products"
ON products FOR INSERT
WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin', 'inventory'));

CREATE POLICY "Inventory and admins can update products"
ON products FOR UPDATE
USING (get_user_org_role(organization_id) IN ('owner', 'admin', 'inventory'))
WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin', 'inventory'));

CREATE POLICY "Inventory and admins can delete products"
ON products FOR DELETE
USING (get_user_org_role(organization_id) IN ('owner', 'admin', 'inventory'));

-- 5. Customers
DROP POLICY IF EXISTS "Users can view customers of their organization" ON customers;
DROP POLICY IF EXISTS "Sales, accounts and admins can manage customers" ON customers;
DROP POLICY IF EXISTS "Sales, accounts and admins can insert customers" ON customers;
DROP POLICY IF EXISTS "Sales, accounts and admins can update customers" ON customers;
DROP POLICY IF EXISTS "Sales, accounts and admins can delete customers" ON customers;

CREATE POLICY "Users can view customers of their organization"
ON customers FOR SELECT
USING (organization_id IN (SELECT get_user_organizations()));

CREATE POLICY "Sales, accounts and admins can insert customers"
ON customers FOR INSERT
WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin', 'sales', 'accounts'));

CREATE POLICY "Sales, accounts and admins can update customers"
ON customers FOR UPDATE
USING (get_user_org_role(organization_id) IN ('owner', 'admin', 'sales', 'accounts'))
WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin', 'sales', 'accounts'));

CREATE POLICY "Sales, accounts and admins can delete customers"
ON customers FOR DELETE
USING (get_user_org_role(organization_id) IN ('owner', 'admin', 'sales', 'accounts'));

-- 6. Suppliers
DROP POLICY IF EXISTS "Users can view suppliers of their organization" ON suppliers;
DROP POLICY IF EXISTS "Inventory, accounts and admins can manage suppliers" ON suppliers;
DROP POLICY IF EXISTS "Inventory, accounts and admins can insert suppliers" ON suppliers;
DROP POLICY IF EXISTS "Inventory, accounts and admins can update suppliers" ON suppliers;
DROP POLICY IF EXISTS "Inventory, accounts and admins can delete suppliers" ON suppliers;

CREATE POLICY "Users can view suppliers of their organization"
ON suppliers FOR SELECT
USING (organization_id IN (SELECT get_user_organizations()));

CREATE POLICY "Inventory, accounts and admins can insert suppliers"
ON suppliers FOR INSERT
WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin', 'inventory', 'accounts'));

CREATE POLICY "Inventory, accounts and admins can update suppliers"
ON suppliers FOR UPDATE
USING (get_user_org_role(organization_id) IN ('owner', 'admin', 'inventory', 'accounts'))
WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin', 'inventory', 'accounts'));

CREATE POLICY "Inventory, accounts and admins can delete suppliers"
ON suppliers FOR DELETE
USING (get_user_org_role(organization_id) IN ('owner', 'admin', 'inventory', 'accounts'));

-- 7. Stock Movements
DROP POLICY IF EXISTS "Users can view stock movements of their organization" ON stock_movements;
DROP POLICY IF EXISTS "Inventory staff and admins can insert stock movements" ON stock_movements;

CREATE POLICY "Users can view stock movements of their organization"
ON stock_movements FOR SELECT
USING (organization_id IN (SELECT get_user_organizations()));

CREATE POLICY "Inventory staff and admins can insert stock movements"
ON stock_movements FOR INSERT
WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin', 'inventory'));

-- 8. Quotations & Items
DROP POLICY IF EXISTS "Users can view quotations of their organization" ON quotations;
DROP POLICY IF EXISTS "Sales and admins can manage quotations" ON quotations;
DROP POLICY IF EXISTS "Sales and admins can insert quotations" ON quotations;
DROP POLICY IF EXISTS "Sales and admins can update quotations" ON quotations;
DROP POLICY IF EXISTS "Sales and admins can delete quotations" ON quotations;

CREATE POLICY "Users can view quotations of their organization"
ON quotations FOR SELECT
USING (organization_id IN (SELECT get_user_organizations()));

CREATE POLICY "Sales and admins can insert quotations"
ON quotations FOR INSERT
WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin', 'sales'));

CREATE POLICY "Sales and admins can update quotations"
ON quotations FOR UPDATE
USING (get_user_org_role(organization_id) IN ('owner', 'admin', 'sales'))
WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin', 'sales'));

CREATE POLICY "Sales and admins can delete quotations"
ON quotations FOR DELETE
USING (get_user_org_role(organization_id) IN ('owner', 'admin', 'sales'));

DROP POLICY IF EXISTS "Users can view quotation items" ON quotation_items;
DROP POLICY IF EXISTS "Sales and admins can manage quotation items" ON quotation_items;
DROP POLICY IF EXISTS "Sales and admins can insert quotation items" ON quotation_items;
DROP POLICY IF EXISTS "Sales and admins can update quotation items" ON quotation_items;
DROP POLICY IF EXISTS "Sales and admins can delete quotation items" ON quotation_items;

CREATE POLICY "Users can view quotation items"
ON quotation_items FOR SELECT
USING (
    quotation_id IN (
        SELECT id FROM public.quotations
        WHERE organization_id IN (SELECT get_user_organizations())
    )
);

CREATE POLICY "Sales and admins can insert quotation items"
ON quotation_items FOR INSERT
WITH CHECK (
    quotation_id IN (
        SELECT id FROM public.quotations
        WHERE get_user_org_role(organization_id) IN ('owner', 'admin', 'sales')
    )
);

CREATE POLICY "Sales and admins can update quotation items"
ON quotation_items FOR UPDATE
USING (
    quotation_id IN (
        SELECT id FROM public.quotations
        WHERE get_user_org_role(organization_id) IN ('owner', 'admin', 'sales')
    )
)
WITH CHECK (
    quotation_id IN (
        SELECT id FROM public.quotations
        WHERE get_user_org_role(organization_id) IN ('owner', 'admin', 'sales')
    )
);

CREATE POLICY "Sales and admins can delete quotation items"
ON quotation_items FOR DELETE
USING (
    quotation_id IN (
        SELECT id FROM public.quotations
        WHERE get_user_org_role(organization_id) IN ('owner', 'admin', 'sales')
    )
);

-- 9. Sales Orders & Items
DROP POLICY IF EXISTS "Users can view sales orders of their organization" ON sales_orders;
DROP POLICY IF EXISTS "Sales and admins can manage sales orders" ON sales_orders;
DROP POLICY IF EXISTS "Sales and admins can insert sales orders" ON sales_orders;
DROP POLICY IF EXISTS "Sales and admins can update sales orders" ON sales_orders;
DROP POLICY IF EXISTS "Sales and admins can delete sales orders" ON sales_orders;

CREATE POLICY "Users can view sales orders of their organization"
ON sales_orders FOR SELECT
USING (organization_id IN (SELECT get_user_organizations()));

CREATE POLICY "Sales and admins can insert sales orders"
ON sales_orders FOR INSERT
WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin', 'sales'));

CREATE POLICY "Sales and admins can update sales orders"
ON sales_orders FOR UPDATE
USING (get_user_org_role(organization_id) IN ('owner', 'admin', 'sales'))
WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin', 'sales'));

CREATE POLICY "Sales and admins can delete sales orders"
ON sales_orders FOR DELETE
USING (get_user_org_role(organization_id) IN ('owner', 'admin', 'sales'));

DROP POLICY IF EXISTS "Users can view sales order items" ON sales_order_items;
DROP POLICY IF EXISTS "Sales and admins can manage sales order items" ON sales_order_items;
DROP POLICY IF EXISTS "Sales and admins can insert sales order items" ON sales_order_items;
DROP POLICY IF EXISTS "Sales and admins can update sales order items" ON sales_order_items;
DROP POLICY IF EXISTS "Sales and admins can delete sales order items" ON sales_order_items;

CREATE POLICY "Users can view sales order items"
ON sales_order_items FOR SELECT
USING (
    sales_order_id IN (
        SELECT id FROM public.sales_orders
        WHERE organization_id IN (SELECT get_user_organizations())
    )
);

CREATE POLICY "Sales and admins can insert sales order items"
ON sales_order_items FOR INSERT
WITH CHECK (
    sales_order_id IN (
        SELECT id FROM public.sales_orders
        WHERE get_user_org_role(organization_id) IN ('owner', 'admin', 'sales')
    )
);

CREATE POLICY "Sales and admins can update sales order items"
ON sales_order_items FOR UPDATE
USING (
    sales_order_id IN (
        SELECT id FROM public.sales_orders
        WHERE get_user_org_role(organization_id) IN ('owner', 'admin', 'sales')
    )
)
WITH CHECK (
    sales_order_id IN (
        SELECT id FROM public.sales_orders
        WHERE get_user_org_role(organization_id) IN ('owner', 'admin', 'sales')
    )
);

CREATE POLICY "Sales and admins can delete sales order items"
ON sales_order_items FOR DELETE
USING (
    sales_order_id IN (
        SELECT id FROM public.sales_orders
        WHERE get_user_org_role(organization_id) IN ('owner', 'admin', 'sales')
    )
);

-- 10. Invoices & Items
DROP POLICY IF EXISTS "Users can view invoices of their organization" ON invoices;
DROP POLICY IF EXISTS "Accounts and admins can manage invoices" ON invoices;
DROP POLICY IF EXISTS "Accounts and admins can insert invoices" ON invoices;
DROP POLICY IF EXISTS "Accounts and admins can update invoices" ON invoices;
DROP POLICY IF EXISTS "Accounts and admins can delete invoices" ON invoices;

CREATE POLICY "Users can view invoices of their organization"
ON invoices FOR SELECT
USING (organization_id IN (SELECT get_user_organizations()));

CREATE POLICY "Accounts and admins can insert invoices"
ON invoices FOR INSERT
WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin', 'accounts'));

CREATE POLICY "Accounts and admins can update invoices"
ON invoices FOR UPDATE
USING (get_user_org_role(organization_id) IN ('owner', 'admin', 'accounts'))
WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin', 'accounts'));

CREATE POLICY "Accounts and admins can delete invoices"
ON invoices FOR DELETE
USING (get_user_org_role(organization_id) IN ('owner', 'admin', 'accounts'));

DROP POLICY IF EXISTS "Users can view invoice items" ON invoice_items;
DROP POLICY IF EXISTS "Accounts and admins can manage invoice items" ON invoice_items;
DROP POLICY IF EXISTS "Accounts and admins can insert invoice items" ON invoice_items;
DROP POLICY IF EXISTS "Accounts and admins can update invoice items" ON invoice_items;
DROP POLICY IF EXISTS "Accounts and admins can delete invoice items" ON invoice_items;

CREATE POLICY "Users can view invoice items"
ON invoice_items FOR SELECT
USING (
    invoice_id IN (
        SELECT id FROM public.invoices
        WHERE organization_id IN (SELECT get_user_organizations())
    )
);

CREATE POLICY "Accounts and admins can insert invoice items"
ON invoice_items FOR INSERT
WITH CHECK (
    invoice_id IN (
        SELECT id FROM public.invoices
        WHERE get_user_org_role(organization_id) IN ('owner', 'admin', 'accounts')
    )
);

CREATE POLICY "Accounts and admins can update invoice items"
ON invoice_items FOR UPDATE
USING (
    invoice_id IN (
        SELECT id FROM public.invoices
        WHERE get_user_org_role(organization_id) IN ('owner', 'admin', 'accounts')
    )
)
WITH CHECK (
    invoice_id IN (
        SELECT id FROM public.invoices
        WHERE get_user_org_role(organization_id) IN ('owner', 'admin', 'accounts')
    )
);

CREATE POLICY "Accounts and admins can delete invoice items"
ON invoice_items FOR DELETE
USING (
    invoice_id IN (
        SELECT id FROM public.invoices
        WHERE get_user_org_role(organization_id) IN ('owner', 'admin', 'accounts')
    )
);

-- 11. Payments & Allocations
DROP POLICY IF EXISTS "Users can view payments of their organization" ON payments;
DROP POLICY IF EXISTS "Accounts and admins can manage payments" ON payments;
DROP POLICY IF EXISTS "Accounts and admins can insert payments" ON payments;
DROP POLICY IF EXISTS "Accounts and admins can update payments" ON payments;
DROP POLICY IF EXISTS "Accounts and admins can delete payments" ON payments;

CREATE POLICY "Users can view payments of their organization"
ON payments FOR SELECT
USING (organization_id IN (SELECT get_user_organizations()));

CREATE POLICY "Accounts and admins can insert payments"
ON payments FOR INSERT
WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin', 'accounts'));

CREATE POLICY "Accounts and admins can update payments"
ON payments FOR UPDATE
USING (get_user_org_role(organization_id) IN ('owner', 'admin', 'accounts'))
WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin', 'accounts'));

CREATE POLICY "Accounts and admins can delete payments"
ON payments FOR DELETE
USING (get_user_org_role(organization_id) IN ('owner', 'admin', 'accounts'));

DROP POLICY IF EXISTS "Users can view payment allocations" ON payment_allocations;
DROP POLICY IF EXISTS "Accounts and admins can manage payment allocations" ON payment_allocations;
DROP POLICY IF EXISTS "Accounts and admins can insert payment allocations" ON payment_allocations;
DROP POLICY IF EXISTS "Accounts and admins can update payment allocations" ON payment_allocations;
DROP POLICY IF EXISTS "Accounts and admins can delete payment allocations" ON payment_allocations;

CREATE POLICY "Users can view payment allocations"
ON payment_allocations FOR SELECT
USING (
    payment_id IN (
        SELECT id FROM public.payments
        WHERE organization_id IN (SELECT get_user_organizations())
    )
);

CREATE POLICY "Accounts and admins can insert payment allocations"
ON payment_allocations FOR INSERT
WITH CHECK (
    payment_id IN (
        SELECT id FROM public.payments
        WHERE get_user_org_role(organization_id) IN ('owner', 'admin', 'accounts')
    )
);

CREATE POLICY "Accounts and admins can update payment allocations"
ON payment_allocations FOR UPDATE
USING (
    payment_id IN (
        SELECT id FROM public.payments
        WHERE get_user_org_role(organization_id) IN ('owner', 'admin', 'accounts')
    )
)
WITH CHECK (
    payment_id IN (
        SELECT id FROM public.payments
        WHERE get_user_org_role(organization_id) IN ('owner', 'admin', 'accounts')
    )
);

CREATE POLICY "Accounts and admins can delete payment allocations"
ON payment_allocations FOR DELETE
USING (
    payment_id IN (
        SELECT id FROM public.payments
        WHERE get_user_org_role(organization_id) IN ('owner', 'admin', 'accounts')
    )
);
