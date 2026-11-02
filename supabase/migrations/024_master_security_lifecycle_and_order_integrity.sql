-- ============================================================================
-- Migration 024: Master Security Lifecycle, Document Atomicity & Financial Integrity
-- ============================================================================
-- Purpose:
--   Resolves critical P0 & P1 vulnerabilities across sales orders, invoices,
--   quotations, payments, inventory aggregations, and tenant isolation:
--
--   1. P0 Sales Order Lifecycle Security:
--      - Eliminates direct client bypass of stock confirmation.
--      - Enforces that sales orders can only be inserted in 'DRAFT' status.
--      - Enforces that status transitions to 'CONFIRMED' must route strictly
--        through the authoritative `confirm_sales_order` transaction.
--      - Prevents mutation or deletion of confirmed or fulfilled sales orders.
--      - Restricts line item mutations to DRAFT orders only.
--
--   2. P0 Invoice Lifecycle Security:
--      - Eliminates client-side creation or direct update of 'ISSUED' invoices.
--      - Invoices can only be inserted directly in 'DRAFT' status.
--      - Issuing invoices requires the authoritative `create_invoice_atomic` RPC.
--      - Enforces strict immutability of financial totals, invoice numbers,
--        and line items on issued/paid invoices.
--      - Strictly prohibits deletion of statutory invoice records.
--
--   3. P1 Atomic Sales Order Creation:
--      - Replaces client-side multi-step insertion with single ACID transaction:
--        `public.create_sales_order_atomic(...)`.
--      - Guarantees complete rollback if any line item fails.
--      - Provides transaction-level request idempotency.
--
--   4. P1 Atomic Quotation Creation & Conversion:
--      - Provides single ACID transaction: `public.create_quotation_atomic(...)`.
--      - Provides race-free atomic quotation conversion:
--        `public.convert_quotation_atomic(...)` with FOR UPDATE locking,
--        duplicate-conversion prevention, and single-conversion invariant.
--
--   5. P1 Payment Idempotency:
--      - Introduces table `public.payment_idempotency`.
--      - Extends `record_payment_and_allocate` with optional `p_idempotency_key`.
--      - Prevents duplicate receipts and double-allocations on network retries.
--
--   6. P1 Inventory & Financial Aggregation:
--      - Introduces database functions `get_product_stock_levels` and
--        `get_dashboard_metrics` to eliminate unpaginated client reads.
--
--   7. Cloud Asset Persistence:
--      - Adds `logo_url` column to `public.organizations`.
--      - Adds `image_url` column to `public.products`.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Schema Extensions for Cloud Assets
-- ----------------------------------------------------------------------------
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS image_url TEXT;

-- ----------------------------------------------------------------------------
-- 2. Idempotency Tracking Tables
-- ----------------------------------------------------------------------------

-- 2A. Sales Order Creation Idempotency
CREATE TABLE IF NOT EXISTS public.sales_order_creation_idempotency (
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    idempotency_key UUID NOT NULL,
    user_id UUID NOT NULL,
    sales_order_id UUID NOT NULL REFERENCES public.sales_orders(id) ON DELETE CASCADE,
    request_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    PRIMARY KEY (organization_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_so_idempotency_lookup
    ON public.sales_order_creation_idempotency(organization_id, idempotency_key);

ALTER TABLE public.sales_order_creation_idempotency ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS so_idempotency_select ON public.sales_order_creation_idempotency;
CREATE POLICY so_idempotency_select ON public.sales_order_creation_idempotency
    FOR SELECT TO authenticated
    USING (public.can_read_organization_data(organization_id));

REVOKE ALL ON TABLE public.sales_order_creation_idempotency FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.sales_order_creation_idempotency FROM authenticated;
GRANT SELECT ON TABLE public.sales_order_creation_idempotency TO authenticated;
GRANT ALL ON TABLE public.sales_order_creation_idempotency TO service_role;

-- 2B. Quotation Creation Idempotency
CREATE TABLE IF NOT EXISTS public.quotation_creation_idempotency (
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    idempotency_key UUID NOT NULL,
    user_id UUID NOT NULL,
    quotation_id UUID NOT NULL REFERENCES public.quotations(id) ON DELETE CASCADE,
    request_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    PRIMARY KEY (organization_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_quot_idempotency_lookup
    ON public.quotation_creation_idempotency(organization_id, idempotency_key);

ALTER TABLE public.quotation_creation_idempotency ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quot_idempotency_select ON public.quotation_creation_idempotency;
CREATE POLICY quot_idempotency_select ON public.quotation_creation_idempotency
    FOR SELECT TO authenticated
    USING (public.can_read_organization_data(organization_id));

REVOKE ALL ON TABLE public.quotation_creation_idempotency FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.quotation_creation_idempotency FROM authenticated;
GRANT SELECT ON TABLE public.quotation_creation_idempotency TO authenticated;
GRANT ALL ON TABLE public.quotation_creation_idempotency TO service_role;

-- 2C. Payment Idempotency
CREATE TABLE IF NOT EXISTS public.payment_idempotency (
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    idempotency_key UUID NOT NULL,
    user_id UUID NOT NULL,
    payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
    request_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    PRIMARY KEY (organization_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_pay_idempotency_lookup
    ON public.payment_idempotency(organization_id, idempotency_key);

ALTER TABLE public.payment_idempotency ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_idempotency_select ON public.payment_idempotency;
CREATE POLICY payment_idempotency_select ON public.payment_idempotency
    FOR SELECT TO authenticated
    USING (public.can_read_organization_data(organization_id));

REVOKE ALL ON TABLE public.payment_idempotency FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.payment_idempotency FROM authenticated;
GRANT SELECT ON TABLE public.payment_idempotency TO authenticated;
GRANT ALL ON TABLE public.payment_idempotency TO service_role;

-- ----------------------------------------------------------------------------
-- 3. Sales Order Lifecycle & Immutability Trigger
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_sales_order_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_is_trusted BOOLEAN;
BEGIN
    v_is_trusted := (current_setting('app.authoritative_order_transition', true) = 'true');

    IF TG_OP = 'DELETE' THEN
        IF OLD.status != 'DRAFT' THEN
            RAISE EXCEPTION 'Cannot delete sales order with status "%". Only DRAFT sales orders can be deleted.', OLD.status
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.status != 'DRAFT' AND NOT v_is_trusted THEN
            RAISE EXCEPTION 'Direct insertion of sales order with status "%" is prohibited. Sales orders must start in DRAFT status.', NEW.status
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        -- Prevent changing organization ownership
        IF NEW.organization_id != OLD.organization_id THEN
            RAISE EXCEPTION 'Changing organization_id on sales orders is prohibited.'
                USING ERRCODE = 'check_violation';
        END IF;

        -- Guard protected transitions from DRAFT
        IF OLD.status = 'DRAFT' THEN
            IF NEW.status = 'CONFIRMED' AND NOT v_is_trusted THEN
                RAISE EXCEPTION 'Direct status transition to CONFIRMED is prohibited. Sales orders must be confirmed via confirm_sales_order().'
                    USING ERRCODE = 'check_violation';
            END IF;
            IF NEW.status = 'FULFILLED' AND NOT v_is_trusted THEN
                RAISE EXCEPTION 'Direct status transition to FULFILLED is prohibited. Sales orders must be fulfilled via create_invoice_atomic().'
                    USING ERRCODE = 'check_violation';
            END IF;
        END IF;

        -- Guard immutability of CONFIRMED or FULFILLED orders
        IF OLD.status IN ('CONFIRMED', 'FULFILLED') AND NOT v_is_trusted THEN
            IF NEW.status != OLD.status THEN
                RAISE EXCEPTION 'Direct status modification of % sales order is prohibited.', OLD.status
                    USING ERRCODE = 'check_violation';
            END IF;

            IF NEW.total_amount != OLD.total_amount OR
               NEW.subtotal != OLD.subtotal OR
               NEW.tax_amount != OLD.tax_amount OR
               NEW.customer_id != OLD.customer_id OR
               NEW.order_number != OLD.order_number THEN
                RAISE EXCEPTION 'Financial totals, customer, and order number of % sales order % are immutable.',
                    OLD.status, OLD.order_number
                    USING ERRCODE = 'check_violation';
            END IF;
        END IF;

        RETURN NEW;
    END IF;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sales_orders_enforce_lifecycle ON public.sales_orders;
CREATE TRIGGER trg_sales_orders_enforce_lifecycle
    BEFORE INSERT OR UPDATE OR DELETE ON public.sales_orders
    FOR EACH ROW EXECUTE FUNCTION public.trg_sales_order_lifecycle();

-- ----------------------------------------------------------------------------
-- 4. Sales Order Items Immutability Trigger
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_sales_order_items_enforce_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order_status VARCHAR(50);
    v_so_id UUID;
    v_is_trusted BOOLEAN;
BEGIN
    v_is_trusted := (current_setting('app.authoritative_order_transition', true) = 'true');

    IF TG_OP = 'DELETE' THEN
        v_so_id := OLD.sales_order_id;
    ELSE
        v_so_id := NEW.sales_order_id;
    END IF;

    SELECT status INTO v_order_status
    FROM public.sales_orders
    WHERE id = v_so_id;

    IF v_order_status IN ('CONFIRMED', 'FULFILLED') AND NOT v_is_trusted THEN
        RAISE EXCEPTION 'Cannot % line items on % sales order %', TG_OP, v_order_status, v_so_id
            USING ERRCODE = 'check_violation';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sales_order_items_enforce_parent_status ON public.sales_order_items;
CREATE TRIGGER trg_sales_order_items_enforce_parent_status
    BEFORE INSERT OR UPDATE OR DELETE ON public.sales_order_items
    FOR EACH ROW EXECUTE FUNCTION public.trg_sales_order_items_enforce_status();

-- ----------------------------------------------------------------------------
-- 5. Invoice Lifecycle & Statutory Immutability Trigger
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_invoice_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_is_inv_trusted BOOLEAN;
    v_is_pay_trusted BOOLEAN;
BEGIN
    v_is_inv_trusted := (current_setting('app.authoritative_invoice_transition', true) = 'true');
    v_is_pay_trusted := (current_setting('app.authoritative_payment_allocation', true) = 'true');

    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Deletion of statutory invoice records is strictly prohibited under financial regulations.'
            USING ERRCODE = 'check_violation';
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.status != 'DRAFT' AND NOT v_is_inv_trusted THEN
            RAISE EXCEPTION 'Direct insertion of invoice with status "%" is prohibited. Invoices must be issued via create_invoice_atomic().', NEW.status
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.organization_id != OLD.organization_id THEN
            RAISE EXCEPTION 'Changing organization_id on invoices is prohibited.'
                USING ERRCODE = 'check_violation';
        END IF;

        IF OLD.status = 'DRAFT' AND NEW.status != 'DRAFT' AND NOT v_is_inv_trusted THEN
            RAISE EXCEPTION 'Direct transition from DRAFT to % is prohibited. Invoices must be issued via create_invoice_atomic().', NEW.status
                USING ERRCODE = 'check_violation';
        END IF;

        IF OLD.status IN ('ISSUED', 'PAID') AND NOT v_is_inv_trusted THEN
            IF NEW.invoice_number != OLD.invoice_number OR
               NEW.customer_id != OLD.customer_id OR
               NEW.total_amount != OLD.total_amount OR
               NEW.subtotal != OLD.subtotal OR
               NEW.tax_amount != OLD.tax_amount THEN
                RAISE EXCEPTION 'Financial totals, customer, and invoice number of issued invoice % are immutable.',
                    OLD.invoice_number
                    USING ERRCODE = 'check_violation';
            END IF;

            -- Total paid balance mutations must be authorized by payment allocation RPC
            IF NEW.total_paid != OLD.total_paid AND NOT v_is_pay_trusted THEN
                RAISE EXCEPTION 'Direct modification of invoice paid balance is prohibited. Payments must be recorded via record_payment_and_allocate().'
                    USING ERRCODE = 'check_violation';
            END IF;
        END IF;

        RETURN NEW;
    END IF;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoices_enforce_lifecycle ON public.invoices;
CREATE TRIGGER trg_invoices_enforce_lifecycle
    BEFORE INSERT OR UPDATE OR DELETE ON public.invoices
    FOR EACH ROW EXECUTE FUNCTION public.trg_invoice_lifecycle();

-- ----------------------------------------------------------------------------
-- 6. Invoice Items Immutability Trigger
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_invoice_items_enforce_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_inv_status VARCHAR(50);
    v_inv_id UUID;
    v_is_trusted BOOLEAN;
BEGIN
    v_is_trusted := (current_setting('app.authoritative_invoice_transition', true) = 'true');

    IF TG_OP = 'DELETE' THEN
        v_inv_id := OLD.invoice_id;
    ELSE
        v_inv_id := NEW.invoice_id;
    END IF;

    SELECT status INTO v_inv_status
    FROM public.invoices
    WHERE id = v_inv_id;

    IF v_inv_status IN ('ISSUED', 'PAID') AND NOT v_is_trusted THEN
        RAISE EXCEPTION 'Cannot % line items on % invoice %', TG_OP, v_inv_status, v_inv_id
            USING ERRCODE = 'check_violation';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_items_enforce_parent_status ON public.invoice_items;
CREATE TRIGGER trg_invoice_items_enforce_parent_status
    BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_items
    FOR EACH ROW EXECUTE FUNCTION public.trg_invoice_items_enforce_status();

-- ----------------------------------------------------------------------------
-- 7. RLS Policy Hardening for Sales Orders and Invoices
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS sales_orders_insert ON public.sales_orders;
CREATE POLICY sales_orders_insert ON public.sales_orders
    FOR INSERT TO authenticated
    WITH CHECK (
        public.can_write_organization_operations(organization_id)
        AND public.user_has_org_role(organization_id, 'owner', 'admin', 'sales')
        AND status = 'DRAFT'
    );

DROP POLICY IF EXISTS sales_orders_update ON public.sales_orders;
CREATE POLICY sales_orders_update ON public.sales_orders
    FOR UPDATE TO authenticated
    USING (
        public.can_write_organization_operations(organization_id)
        AND public.user_has_org_role(organization_id, 'owner', 'admin', 'sales')
        AND status = 'DRAFT'
    )
    WITH CHECK (
        public.can_write_organization_operations(organization_id)
        AND public.user_has_org_role(organization_id, 'owner', 'admin', 'sales')
        AND status IN ('DRAFT', 'CANCELLED')
    );

DROP POLICY IF EXISTS invoices_insert ON public.invoices;
CREATE POLICY invoices_insert ON public.invoices
    FOR INSERT TO authenticated
    WITH CHECK (
        public.can_write_organization_operations(organization_id)
        AND public.user_has_org_role(organization_id, 'owner', 'admin', 'accounts')
        AND status = 'DRAFT'
    );

DROP POLICY IF EXISTS invoices_update ON public.invoices;
CREATE POLICY invoices_update ON public.invoices
    FOR UPDATE TO authenticated
    USING (
        public.can_write_organization_operations(organization_id)
        AND public.user_has_org_role(organization_id, 'owner', 'admin', 'accounts')
        AND status = 'DRAFT'
    )
    WITH CHECK (
        public.can_write_organization_operations(organization_id)
        AND public.user_has_org_role(organization_id, 'owner', 'admin', 'accounts')
        AND status = 'DRAFT'
    );

-- ----------------------------------------------------------------------------
-- 8. Authoritative confirm_sales_order Hardened with GUC Session Flag
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_sales_order(p_order_id UUID, p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
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
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'unauthorized';
    END IF;

    IF p_order_id IS NULL OR p_org_id IS NULL THEN
        RAISE EXCEPTION 'Invalid parameters: order_id and org_id are required'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    v_user_role := public.get_user_org_role(p_org_id);
    IF v_user_role IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Caller has no active membership in organization %', p_org_id
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF v_user_role NOT IN ('owner', 'admin', 'sales') THEN
        RAISE EXCEPTION 'Unauthorized: Caller has insufficient role (%) to confirm orders in organization %',
            v_user_role, p_org_id
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF NOT public.can_write_organization_operations(p_org_id) THEN
        RAISE EXCEPTION 'Operational write denied: Active subscription or trial required for organization %', p_org_id
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Lock and verify the order strictly within organization
    SELECT status INTO v_order_status
    FROM public.sales_orders
    WHERE id = p_order_id AND organization_id = p_org_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sales order % not found in organization %', p_order_id, p_org_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF v_order_status = 'CONFIRMED' THEN
        RETURN jsonb_build_object(
            'success', true,
            'order_id', p_order_id,
            'status', 'CONFIRMED',
            'idempotent_replay', true
        );
    END IF;

    IF v_order_status != 'DRAFT' THEN
        RAISE EXCEPTION 'Order % cannot be confirmed because status is % (expected DRAFT)', p_order_id, v_order_status
            USING ERRCODE = 'check_violation';
    END IF;

    SELECT COUNT(*) INTO v_item_count
    FROM public.sales_order_items oi
    JOIN public.sales_orders so ON so.id = oi.sales_order_id
    WHERE oi.sales_order_id = p_order_id AND so.organization_id = p_org_id;

    IF v_item_count = 0 THEN
        RAISE EXCEPTION 'Cannot confirm order %: Order has no line items', p_order_id
            USING ERRCODE = 'check_violation';
    END IF;

    -- Deterministic Ascending Lock Ordering (ORDER BY oi.product_id ASC)
    FOR v_item IN
        SELECT
            oi.product_id,
            SUM(oi.quantity)::INTEGER AS quantity,
            MAX(oi.product_name) AS product_name,
            MAX(oi.product_sku) AS product_sku
        FROM public.sales_order_items oi
        JOIN public.sales_orders so ON so.id = oi.sales_order_id
        WHERE oi.sales_order_id = p_order_id AND so.organization_id = p_org_id
        GROUP BY oi.product_id
        ORDER BY oi.product_id ASC
    LOOP
        IF v_item.quantity <= 0 THEN
            RAISE EXCEPTION 'Invalid item quantity % for product "%"', v_item.quantity, v_item.product_name
                USING ERRCODE = 'check_violation';
        END IF;

        PERFORM id FROM public.products
        WHERE id = v_item.product_id AND organization_id = p_org_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Product % in order does not belong to organization %', v_item.product_id, p_org_id
                USING ERRCODE = 'foreign_key_violation';
        END IF;

        v_available_stock := public.get_product_stock(v_item.product_id, p_org_id);

        IF v_available_stock < v_item.quantity THEN
            RAISE EXCEPTION 'Insufficient stock for product "%" (SKU: %). Available: %, Requested: %',
                v_item.product_name, v_item.product_sku, v_available_stock, v_item.quantity
                USING ERRCODE = 'check_violation';
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

    -- Set local transaction flag to permit status transition
    PERFORM set_config('app.authoritative_order_transition', 'true', true);

    UPDATE public.sales_orders
    SET status = 'CONFIRMED',
        confirmed_at = NOW(),
        confirmed_by = v_uid,
        updated_at = NOW()
    WHERE id = p_order_id AND organization_id = p_org_id;

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

    RETURN jsonb_build_object('success', true, 'order_id', p_order_id, 'status', 'CONFIRMED', 'idempotent_replay', false);
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_sales_order(UUID, UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_sales_order(UUID, UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- 9. Authoritative create_invoice_atomic Hardened with GUC Flags
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_invoice_atomic(
    p_org_id UUID,
    p_customer_id UUID,
    p_items JSONB,
    p_invoice_date DATE DEFAULT CURRENT_DATE,
    p_due_date DATE DEFAULT NULL,
    p_status VARCHAR DEFAULT 'ISSUED',
    p_notes TEXT DEFAULT NULL,
    p_sales_order_id UUID DEFAULT NULL,
    p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid UUID;
    v_user_role VARCHAR(50);
    v_customer_exists BOOLEAN;
    v_so_status VARCHAR(50);
    v_so_updated_count INTEGER;
    v_invoice_year INTEGER;
    v_invoice_number VARCHAR(100);
    v_invoice_id UUID;
    v_due_date DATE;
    v_status VARCHAR(50);
    v_request_hash TEXT;
    v_existing_inv_id UUID;
    v_existing_hash TEXT;
    v_existing_invoice JSONB;
    v_product_ids UUID[];
    v_locked_prod_count INTEGER;
    v_item JSONB;
    v_calc_item JSONB;
    v_item_prod_id UUID;
    v_item_qty INTEGER;
    v_item_price NUMERIC(12, 2);
    v_item_disc_pct NUMERIC(5, 2);
    v_item_tax_rate NUMERIC(5, 2);
    v_item_name VARCHAR(255);
    v_item_sku VARCHAR(100);
    v_item_hsn VARCHAR(20);
    v_item_uom VARCHAR(50);
    v_prod RECORD;
    v_gross NUMERIC(12, 2);
    v_disc NUMERIC(12, 2);
    v_taxable NUMERIC(12, 2);
    v_tax NUMERIC(12, 2);
    v_line_total NUMERIC(12, 2);
    v_subtotal NUMERIC(12, 2) := 0.00;
    v_discount_total NUMERIC(12, 2) := 0.00;
    v_tax_total NUMERIC(12, 2) := 0.00;
    v_grand_total NUMERIC(12, 2) := 0.00;
    v_item_count INTEGER := 0;
    v_calculated_items JSONB := '[]'::JSONB;
    v_line_item_id UUID;
BEGIN
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'unauthorized';
    END IF;

    IF p_org_id IS NULL OR p_customer_id IS NULL OR p_items IS NULL THEN
        RAISE EXCEPTION 'Invalid parameters: organization_id, customer_id, and items are required';
    END IF;

    IF jsonb_typeof(p_items) != 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Invoice must contain at least one line item';
    END IF;

    v_status := UPPER(TRIM(COALESCE(p_status, 'ISSUED')));
    IF v_status NOT IN ('DRAFT', 'ISSUED') THEN
        RAISE EXCEPTION 'Invalid invoice status: %. Must be DRAFT or ISSUED.', p_status;
    END IF;

    v_user_role := get_user_org_role(p_org_id);
    IF v_user_role IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Caller has no active membership in organization %', p_org_id;
    END IF;

    IF v_user_role NOT IN ('owner', 'admin', 'accounts') THEN
        RAISE EXCEPTION 'Unauthorized: Caller has insufficient role (%) to create invoices in organization %',
            v_user_role, p_org_id;
    END IF;

    IF NOT public.can_write_organization_operations(p_org_id) THEN
        RAISE EXCEPTION 'Operational write denied: Active subscription or trial required for organization %', p_org_id;
    END IF;

    -- Compute request hash for idempotency comparison
    v_request_hash := md5(
        p_org_id::TEXT || ':' ||
        p_customer_id::TEXT || ':' ||
        COALESCE(p_sales_order_id::TEXT, '') || ':' ||
        COALESCE(p_invoice_date::TEXT, '') || ':' ||
        v_status || ':' ||
        p_items::TEXT
    );

    IF p_idempotency_key IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtext('inv:' || p_org_id::TEXT || ':' || p_idempotency_key::TEXT));

        SELECT invoice_id, request_hash
          INTO v_existing_inv_id, v_existing_hash
          FROM public.invoice_creation_idempotency
         WHERE organization_id = p_org_id
           AND idempotency_key = p_idempotency_key;

        IF FOUND THEN
            IF v_existing_hash = v_request_hash THEN
                SELECT jsonb_build_object(
                    'id', inv.id,
                    'invoice_number', inv.invoice_number,
                    'organization_id', inv.organization_id,
                    'customer_id', inv.customer_id,
                    'sales_order_id', inv.sales_order_id,
                    'status', inv.status,
                    'invoice_date', inv.invoice_date,
                    'due_date', inv.due_date,
                    'subtotal', inv.subtotal,
                    'discount_amount', inv.discount_amount,
                    'tax_amount', inv.tax_amount,
                    'total_amount', inv.total_amount,
                    'total_paid', inv.total_paid,
                    'totals_version', inv.totals_version,
                    'notes', inv.notes,
                    'created_at', inv.created_at,
                    'updated_at', inv.updated_at,
                    'idempotent_replay', true,
                    'items', COALESCE(
                        (SELECT jsonb_agg(jsonb_build_object(
                            'id', ii.id,
                            'invoice_id', ii.invoice_id,
                            'product_id', ii.product_id,
                            'product_name', ii.product_name,
                            'product_sku', ii.product_sku,
                            'hsn_code', ii.hsn_code,
                            'uom', ii.uom,
                            'quantity', ii.quantity,
                            'unit_price', ii.unit_price,
                            'discount_percent', ii.discount_percent,
                            'tax_rate', ii.tax_rate,
                            'line_subtotal', ii.line_subtotal,
                            'line_tax', ii.line_tax,
                            'line_total', ii.line_total,
                            'document_discount_share', ii.document_discount_share
                        )) FROM public.invoice_items ii WHERE ii.invoice_id = inv.id),
                        '[]'::JSONB
                    )
                ) INTO v_existing_invoice
                FROM public.invoices inv
                WHERE inv.id = v_existing_inv_id;

                RETURN v_existing_invoice;
            ELSE
                RAISE EXCEPTION 'Idempotency key reused with different request parameters'
                    USING ERRCODE = 'unique_violation';
            END IF;
        END IF;
    END IF;

    -- Validate customer belongs to organization
    SELECT EXISTS (
        SELECT 1 FROM public.customers
        WHERE id = p_customer_id AND organization_id = p_org_id AND is_active = TRUE
    ) INTO v_customer_exists;

    IF NOT v_customer_exists THEN
        RAISE EXCEPTION 'Customer % not found or inactive in organization %', p_customer_id, p_org_id;
    END IF;

    -- Validate sales order if provided
    IF p_sales_order_id IS NOT NULL THEN
        SELECT status INTO v_so_status
        FROM public.sales_orders
        WHERE id = p_sales_order_id AND organization_id = p_org_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Sales order % not found in organization %', p_sales_order_id, p_org_id;
        END IF;

        IF v_so_status != 'CONFIRMED' THEN
            RAISE EXCEPTION 'Cannot create invoice from sales order %: order status is % (must be CONFIRMED)',
                p_sales_order_id, v_so_status;
        END IF;

        IF EXISTS (
            SELECT 1 FROM public.invoices
            WHERE sales_order_id = p_sales_order_id
              AND organization_id = p_org_id
              AND status != 'CANCELLED'
        ) THEN
            RAISE EXCEPTION 'Active invoice already exists for sales order % in organization %',
                p_sales_order_id, p_org_id
                USING ERRCODE = 'unique_violation';
        END IF;
    END IF;

    -- Collect and lock products in ascending ID order
    SELECT array_agg(DISTINCT (item->>'productId')::UUID ORDER BY (item->>'productId')::UUID ASC)
    INTO v_product_ids
    FROM jsonb_array_elements(p_items) AS item;

    IF v_product_ids IS NULL OR array_length(v_product_ids, 1) = 0 THEN
        SELECT array_agg(DISTINCT (item->>'product_id')::UUID ORDER BY (item->>'product_id')::UUID ASC)
        INTO v_product_ids
        FROM jsonb_array_elements(p_items) AS item;
    END IF;

    SELECT COUNT(*) INTO v_locked_prod_count
    FROM public.products
    WHERE id = ANY(v_product_ids) AND organization_id = p_org_id
    FOR UPDATE;

    IF v_locked_prod_count != array_length(v_product_ids, 1) THEN
        RAISE EXCEPTION 'One or more products in items do not belong to organization %', p_org_id;
    END IF;

    -- In-memory calculation of line items
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_item_count := v_item_count + 1;
        v_item_prod_id := COALESCE(
            (v_item->>'productId')::UUID,
            (v_item->>'product_id')::UUID
        );
        IF v_item_prod_id IS NULL THEN
            RAISE EXCEPTION 'Item % is missing required productId', v_item_count;
        END IF;

        v_item_qty := COALESCE(
            (v_item->>'quantity')::INTEGER,
            0
        );
        IF v_item_qty <= 0 THEN
            RAISE EXCEPTION 'Item % has invalid quantity: % (must be >= 1)', v_item_count, v_item_qty;
        END IF;

        SELECT id, name, sku, hsn_code, uom, selling_price, tax_rate, is_active
          INTO v_prod
          FROM public.products
         WHERE id = v_item_prod_id AND organization_id = p_org_id;

        IF NOT FOUND OR NOT v_prod.is_active THEN
            RAISE EXCEPTION 'Product % is not found or inactive in organization %', v_item_prod_id, p_org_id;
        END IF;

        v_item_price := COALESCE(
            (v_item->>'unitPrice')::NUMERIC(12, 2),
            (v_item->>'unit_price')::NUMERIC(12, 2),
            v_prod.selling_price
        );
        IF v_item_price < 0 THEN
            RAISE EXCEPTION 'Item % has invalid unit_price: % (must be >= 0)', v_item_count, v_item_price;
        END IF;

        v_item_disc_pct := COALESCE(
            (v_item->>'discountPercent')::NUMERIC(5, 2),
            (v_item->>'discount_percent')::NUMERIC(5, 2),
            0.00
        );
        IF v_item_disc_pct < 0 OR v_item_disc_pct > 100 THEN
            RAISE EXCEPTION 'Item % has invalid discount_percent: % (must be between 0 and 100)', v_item_count, v_item_disc_pct;
        END IF;

        v_item_tax_rate := COALESCE(
            (v_item->>'taxRate')::NUMERIC(5, 2),
            (v_item->>'tax_rate')::NUMERIC(5, 2),
            v_prod.tax_rate
        );
        IF v_item_tax_rate < 0 THEN
            RAISE EXCEPTION 'Item % has invalid tax_rate: % (must be >= 0)', v_item_count, v_item_tax_rate;
        END IF;

        v_item_name := COALESCE(v_item->>'productName', v_item->>'product_name', v_prod.name);
        v_item_sku := COALESCE(v_item->>'productSku', v_item->>'product_sku', v_prod.sku);
        v_item_hsn := COALESCE(v_item->>'hsnCode', v_item->>'hsn_code', v_prod.hsn_code);
        v_item_uom := COALESCE(v_item->>'uom', v_prod.uom);

        v_gross := ROUND(v_item_qty * v_item_price, 2);
        v_disc := ROUND(v_gross * (v_item_disc_pct / 100.0), 2);
        v_taxable := v_gross - v_disc;
        v_tax := ROUND(v_taxable * (v_item_tax_rate / 100.0), 2);
        v_line_total := v_taxable + v_tax;

        v_subtotal := v_subtotal + v_gross;
        v_discount_total := v_discount_total + v_disc;
        v_tax_total := v_tax_total + v_tax;
        v_grand_total := v_grand_total + v_line_total;

        v_line_item_id := gen_random_uuid();
        v_calculated_items := v_calculated_items || jsonb_build_array(jsonb_build_object(
            'id', v_line_item_id,
            'product_id', v_item_prod_id,
            'product_name', v_item_name,
            'product_sku', v_item_sku,
            'hsn_code', v_item_hsn,
            'uom', v_item_uom,
            'quantity', v_item_qty,
            'unit_price', v_item_price,
            'discount_percent', v_item_disc_pct,
            'tax_rate', v_item_tax_rate,
            'line_subtotal', v_taxable,
            'line_tax', v_tax,
            'line_total', v_line_total
        ));
    END LOOP;

    v_invoice_year := EXTRACT(YEAR FROM COALESCE(p_invoice_date, CURRENT_DATE))::INTEGER;
    v_invoice_number := public.internal_allocate_document_number(p_org_id, 'INVOICE', v_invoice_year);
    v_invoice_id := gen_random_uuid();
    v_due_date := COALESCE(p_due_date, p_invoice_date + INTERVAL '30 days');

    -- Set local transaction flags to authorize invoice and sales order transition
    PERFORM set_config('app.authoritative_invoice_transition', 'true', true);
    PERFORM set_config('app.authoritative_order_transition', 'true', true);

    -- Insert invoice header
    INSERT INTO public.invoices (
        id,
        organization_id,
        invoice_number,
        customer_id,
        sales_order_id,
        status,
        invoice_date,
        due_date,
        subtotal,
        discount_amount,
        tax_amount,
        total_amount,
        total_paid,
        totals_version,
        notes,
        created_by
    ) VALUES (
        v_invoice_id,
        p_org_id,
        v_invoice_number,
        p_customer_id,
        p_sales_order_id,
        'DRAFT',
        COALESCE(p_invoice_date, CURRENT_DATE),
        v_due_date,
        v_subtotal,
        v_discount_total,
        v_tax_total,
        v_grand_total,
        0.00,
        2,
        p_notes,
        v_uid
    );

    -- Insert line items
    FOR v_calc_item IN SELECT * FROM jsonb_array_elements(v_calculated_items)
    LOOP
        INSERT INTO public.invoice_items (
            id,
            invoice_id,
            product_id,
            product_name,
            product_sku,
            hsn_code,
            uom,
            quantity,
            unit_price,
            discount_percent,
            tax_rate,
            line_subtotal,
            line_tax,
            line_total,
            document_discount_share
        ) VALUES (
            (v_calc_item->>'id')::UUID,
            v_invoice_id,
            (v_calc_item->>'product_id')::UUID,
            v_calc_item->>'product_name',
            v_calc_item->>'product_sku',
            v_calc_item->>'hsn_code',
            v_calc_item->>'uom',
            (v_calc_item->>'quantity')::INTEGER,
            (v_calc_item->>'unit_price')::NUMERIC(12, 2),
            (v_calc_item->>'discount_percent')::NUMERIC(5, 2),
            (v_calc_item->>'tax_rate')::NUMERIC(5, 2),
            (v_calc_item->>'line_subtotal')::NUMERIC(12, 2),
            (v_calc_item->>'line_tax')::NUMERIC(12, 2),
            (v_calc_item->>'line_total')::NUMERIC(12, 2),
            0.00
        );
    END LOOP;

    -- Update to ISSUED if requested
    IF v_status = 'ISSUED' THEN
        UPDATE public.invoices
           SET status = 'ISSUED',
               updated_at = NOW()
         WHERE id = v_invoice_id;
    END IF;

    -- Update sales order to FULFILLED
    IF p_sales_order_id IS NOT NULL THEN
        UPDATE public.sales_orders
           SET status = 'FULFILLED',
               updated_at = NOW()
         WHERE id = p_sales_order_id
           AND organization_id = p_org_id;

        GET DIAGNOSTICS v_so_updated_count = ROW_COUNT;
        IF v_so_updated_count != 1 THEN
            RAISE EXCEPTION 'Failed to update sales order % status to FULFILLED', p_sales_order_id;
        END IF;
    END IF;

    -- Record idempotency mapping
    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO public.invoice_creation_idempotency (
            organization_id,
            idempotency_key,
            user_id,
            invoice_id,
            request_hash
        ) VALUES (
            p_org_id,
            p_idempotency_key,
            v_uid,
            v_invoice_id,
            v_request_hash
        );
    END IF;

    -- Audit event
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
        'CREATE_INVOICE',
        'INVOICE',
        v_invoice_id,
        jsonb_build_object(
            'invoice_number', v_invoice_number,
            'status', v_status,
            'customer_id', p_customer_id,
            'sales_order_id', p_sales_order_id,
            'total_amount', v_grand_total,
            'item_count', v_item_count
        )
    );

    RETURN jsonb_build_object(
        'id', v_invoice_id,
        'invoice_number', v_invoice_number,
        'organization_id', p_org_id,
        'customer_id', p_customer_id,
        'sales_order_id', p_sales_order_id,
        'status', v_status,
        'invoice_date', p_invoice_date,
        'due_date', v_due_date,
        'subtotal', v_subtotal,
        'discount_amount', v_discount_total,
        'tax_amount', v_tax_total,
        'total_amount', v_grand_total,
        'total_paid', 0.00,
        'totals_version', 2,
        'notes', p_notes,
        'idempotent_replay', false,
        'items', v_calculated_items
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_invoice_atomic(UUID, UUID, JSONB, DATE, DATE, VARCHAR, TEXT, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_invoice_atomic(UUID, UUID, JSONB, DATE, DATE, VARCHAR, TEXT, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_invoice_atomic(UUID, UUID, JSONB, DATE, DATE, VARCHAR, TEXT, UUID, UUID) TO service_role;

-- ----------------------------------------------------------------------------
-- 10. Authoritative create_sales_order_atomic RPC
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_sales_order_atomic(
    p_org_id UUID,
    p_customer_id UUID,
    p_order_date DATE DEFAULT CURRENT_DATE,
    p_items JSONB DEFAULT '[]'::JSONB,
    p_notes TEXT DEFAULT NULL,
    p_quotation_id UUID DEFAULT NULL,
    p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid UUID;
    v_user_role VARCHAR(50);
    v_customer_exists BOOLEAN;
    v_order_year INTEGER;
    v_order_number VARCHAR(100);
    v_order_id UUID;
    v_request_hash TEXT;
    v_existing_so_id UUID;
    v_existing_hash TEXT;
    v_existing_order JSONB;
    v_product_ids UUID[];
    v_locked_prod_count INTEGER;
    v_item JSONB;
    v_calc_item JSONB;
    v_item_prod_id UUID;
    v_item_qty INTEGER;
    v_item_price NUMERIC(12, 2);
    v_item_disc_pct NUMERIC(5, 2);
    v_item_tax_rate NUMERIC(5, 2);
    v_item_name VARCHAR(255);
    v_item_sku VARCHAR(100);
    v_item_uom VARCHAR(50);
    v_prod RECORD;
    v_gross NUMERIC(12, 2);
    v_disc NUMERIC(12, 2);
    v_taxable NUMERIC(12, 2);
    v_tax NUMERIC(12, 2);
    v_line_total NUMERIC(12, 2);
    v_subtotal NUMERIC(12, 2) := 0.00;
    v_discount_total NUMERIC(12, 2) := 0.00;
    v_tax_total NUMERIC(12, 2) := 0.00;
    v_grand_total NUMERIC(12, 2) := 0.00;
    v_item_count INTEGER := 0;
    v_calculated_items JSONB := '[]'::JSONB;
    v_line_item_id UUID;
BEGIN
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'unauthorized';
    END IF;

    IF p_org_id IS NULL OR p_customer_id IS NULL OR p_items IS NULL THEN
        RAISE EXCEPTION 'Invalid parameters: organization_id, customer_id, and items are required';
    END IF;

    IF jsonb_typeof(p_items) != 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Sales order must contain at least one line item';
    END IF;

    v_user_role := get_user_org_role(p_org_id);
    IF v_user_role IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Caller has no active membership in organization %', p_org_id;
    END IF;

    IF v_user_role NOT IN ('owner', 'admin', 'sales') THEN
        RAISE EXCEPTION 'Unauthorized: Caller has insufficient role (%) to create sales orders in organization %',
            v_user_role, p_org_id;
    END IF;

    IF NOT public.can_write_organization_operations(p_org_id) THEN
        RAISE EXCEPTION 'Operational write denied: Active subscription or trial required for organization %', p_org_id;
    END IF;

    v_request_hash := md5(
        p_org_id::TEXT || ':' ||
        p_customer_id::TEXT || ':' ||
        COALESCE(p_quotation_id::TEXT, '') || ':' ||
        COALESCE(p_order_date::TEXT, '') || ':' ||
        p_items::TEXT
    );

    IF p_idempotency_key IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtext('so_create:' || p_org_id::TEXT || ':' || p_idempotency_key::TEXT));

        SELECT sales_order_id, request_hash
          INTO v_existing_so_id, v_existing_hash
          FROM public.sales_order_creation_idempotency
         WHERE organization_id = p_org_id
           AND idempotency_key = p_idempotency_key;

        IF FOUND THEN
            IF v_existing_hash = v_request_hash THEN
                SELECT jsonb_build_object(
                    'id', so.id,
                    'order_number', so.order_number,
                    'organization_id', so.organization_id,
                    'customer_id', so.customer_id,
                    'quotation_id', so.quotation_id,
                    'status', so.status,
                    'order_date', so.order_date,
                    'subtotal', so.subtotal,
                    'discount_amount', so.discount_amount,
                    'tax_amount', so.tax_amount,
                    'total_amount', so.total_amount,
                    'totals_version', so.totals_version,
                    'notes', so.notes,
                    'created_at', so.created_at,
                    'updated_at', so.updated_at,
                    'idempotent_replay', true,
                    'items', COALESCE(
                        (SELECT jsonb_agg(jsonb_build_object(
                            'id', soi.id,
                            'sales_order_id', soi.sales_order_id,
                            'product_id', soi.product_id,
                            'product_name', soi.product_name,
                            'product_sku', soi.product_sku,
                            'uom', soi.uom,
                            'quantity', soi.quantity,
                            'unit_price', soi.unit_price,
                            'discount_percent', soi.discount_percent,
                            'tax_rate', soi.tax_rate,
                            'line_subtotal', soi.line_subtotal,
                            'line_tax', soi.line_tax,
                            'line_total', soi.line_total,
                            'document_discount_share', soi.document_discount_share
                        )) FROM public.sales_order_items soi WHERE soi.sales_order_id = so.id),
                        '[]'::JSONB
                    )
                ) INTO v_existing_order
                FROM public.sales_orders so
                WHERE so.id = v_existing_so_id;

                RETURN v_existing_order;
            ELSE
                RAISE EXCEPTION 'Idempotency key reused with different request parameters'
                    USING ERRCODE = 'unique_violation';
            END IF;
        END IF;
    END IF;

    -- Validate customer belongs to organization and is active
    SELECT EXISTS (
        SELECT 1 FROM public.customers
        WHERE id = p_customer_id AND organization_id = p_org_id AND is_active = TRUE
    ) INTO v_customer_exists;

    IF NOT v_customer_exists THEN
        RAISE EXCEPTION 'Customer % not found or inactive in organization %', p_customer_id, p_org_id;
    END IF;

    -- Validate quotation if specified
    IF p_quotation_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.quotations
            WHERE id = p_quotation_id AND organization_id = p_org_id
        ) THEN
            RAISE EXCEPTION 'Quotation % not found in organization %', p_quotation_id, p_org_id;
        END IF;
    END IF;

    -- Collect and lock products in ascending ID order
    SELECT array_agg(DISTINCT (item->>'productId')::UUID ORDER BY (item->>'productId')::UUID ASC)
    INTO v_product_ids
    FROM jsonb_array_elements(p_items) AS item;

    IF v_product_ids IS NULL OR array_length(v_product_ids, 1) = 0 THEN
        SELECT array_agg(DISTINCT (item->>'product_id')::UUID ORDER BY (item->>'product_id')::UUID ASC)
        INTO v_product_ids
        FROM jsonb_array_elements(p_items) AS item;
    END IF;

    SELECT COUNT(*) INTO v_locked_prod_count
    FROM public.products
    WHERE id = ANY(v_product_ids) AND organization_id = p_org_id
    FOR UPDATE;

    IF v_locked_prod_count != array_length(v_product_ids, 1) THEN
        RAISE EXCEPTION 'One or more products in items do not belong to organization %', p_org_id;
    END IF;

    -- Compute line item calculations
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_item_count := v_item_count + 1;
        v_item_prod_id := COALESCE(
            (v_item->>'productId')::UUID,
            (v_item->>'product_id')::UUID
        );
        IF v_item_prod_id IS NULL THEN
            RAISE EXCEPTION 'Item % is missing required productId', v_item_count;
        END IF;

        v_item_qty := COALESCE((v_item->>'quantity')::INTEGER, 0);
        IF v_item_qty <= 0 THEN
            RAISE EXCEPTION 'Item % has invalid quantity: % (must be >= 1)', v_item_count, v_item_qty;
        END IF;

        SELECT id, name, sku, uom, selling_price, tax_rate, is_active
          INTO v_prod
          FROM public.products
         WHERE id = v_item_prod_id AND organization_id = p_org_id;

        IF NOT FOUND OR NOT v_prod.is_active THEN
            RAISE EXCEPTION 'Product % is not found or inactive in organization %', v_item_prod_id, p_org_id;
        END IF;

        v_item_price := COALESCE(
            (v_item->>'unitPrice')::NUMERIC(12, 2),
            (v_item->>'unit_price')::NUMERIC(12, 2),
            v_prod.selling_price
        );
        IF v_item_price < 0 THEN
            RAISE EXCEPTION 'Item % has invalid unit_price: % (must be >= 0)', v_item_count, v_item_price;
        END IF;

        v_item_disc_pct := COALESCE(
            (v_item->>'discountPercent')::NUMERIC(5, 2),
            (v_item->>'discount_percent')::NUMERIC(5, 2),
            0.00
        );
        IF v_item_disc_pct < 0 OR v_item_disc_pct > 100 THEN
            RAISE EXCEPTION 'Item % has invalid discount_percent: % (must be between 0 and 100)', v_item_count, v_item_disc_pct;
        END IF;

        v_item_tax_rate := COALESCE(
            (v_item->>'taxRate')::NUMERIC(5, 2),
            (v_item->>'tax_rate')::NUMERIC(5, 2),
            v_prod.tax_rate
        );
        IF v_item_tax_rate < 0 THEN
            RAISE EXCEPTION 'Item % has invalid tax_rate: % (must be >= 0)', v_item_count, v_item_tax_rate;
        END IF;

        v_item_name := COALESCE(v_item->>'productName', v_item->>'product_name', v_prod.name);
        v_item_sku := COALESCE(v_item->>'productSku', v_item->>'product_sku', v_prod.sku);
        v_item_uom := COALESCE(v_item->>'uom', v_prod.uom);

        v_gross := ROUND(v_item_qty * v_item_price, 2);
        v_disc := ROUND(v_gross * (v_item_disc_pct / 100.0), 2);
        v_taxable := v_gross - v_disc;
        v_tax := ROUND(v_taxable * (v_item_tax_rate / 100.0), 2);
        v_line_total := v_taxable + v_tax;

        v_subtotal := v_subtotal + v_gross;
        v_discount_total := v_discount_total + v_disc;
        v_tax_total := v_tax_total + v_tax;
        v_grand_total := v_grand_total + v_line_total;

        v_line_item_id := gen_random_uuid();
        v_calculated_items := v_calculated_items || jsonb_build_array(jsonb_build_object(
            'id', v_line_item_id,
            'product_id', v_item_prod_id,
            'product_name', v_item_name,
            'product_sku', v_item_sku,
            'uom', v_item_uom,
            'quantity', v_item_qty,
            'unit_price', v_item_price,
            'discount_percent', v_item_disc_pct,
            'tax_rate', v_item_tax_rate,
            'line_subtotal', v_taxable,
            'line_tax', v_tax,
            'line_total', v_line_total
        ));
    END LOOP;

    v_order_year := EXTRACT(YEAR FROM COALESCE(p_order_date, CURRENT_DATE))::INTEGER;
    v_order_number := public.internal_allocate_document_number(p_org_id, 'SALES_ORDER', v_order_year);
    v_order_id := gen_random_uuid();

    -- Set local transaction flag to authorize insertion
    PERFORM set_config('app.authoritative_order_transition', 'true', true);

    INSERT INTO public.sales_orders (
        id,
        organization_id,
        order_number,
        customer_id,
        quotation_id,
        status,
        order_date,
        subtotal,
        discount_amount,
        tax_amount,
        total_amount,
        totals_version,
        notes,
        created_by
    ) VALUES (
        v_order_id,
        p_org_id,
        v_order_number,
        p_customer_id,
        p_quotation_id,
        'DRAFT',
        COALESCE(p_order_date, CURRENT_DATE),
        v_subtotal,
        v_discount_total,
        v_tax_total,
        v_grand_total,
        2,
        p_notes,
        v_uid
    );

    FOR v_calc_item IN SELECT * FROM jsonb_array_elements(v_calculated_items)
    LOOP
        INSERT INTO public.sales_order_items (
            id,
            sales_order_id,
            product_id,
            product_name,
            product_sku,
            uom,
            quantity,
            unit_price,
            discount_percent,
            tax_rate,
            line_subtotal,
            line_tax,
            line_total,
            document_discount_share
        ) VALUES (
            (v_calc_item->>'id')::UUID,
            v_order_id,
            (v_calc_item->>'product_id')::UUID,
            v_calc_item->>'product_name',
            v_calc_item->>'product_sku',
            v_calc_item->>'uom',
            (v_calc_item->>'quantity')::INTEGER,
            (v_calc_item->>'unit_price')::NUMERIC(12, 2),
            (v_calc_item->>'discount_percent')::NUMERIC(5, 2),
            (v_calc_item->>'tax_rate')::NUMERIC(5, 2),
            (v_calc_item->>'line_subtotal')::NUMERIC(12, 2),
            (v_calc_item->>'line_tax')::NUMERIC(12, 2),
            (v_calc_item->>'line_total')::NUMERIC(12, 2),
            0.00
        );
    END LOOP;

    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO public.sales_order_creation_idempotency (
            organization_id,
            idempotency_key,
            user_id,
            sales_order_id,
            request_hash
        ) VALUES (
            p_org_id,
            p_idempotency_key,
            v_uid,
            v_order_id,
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
        'CREATE_SALES_ORDER',
        'SALES_ORDER',
        v_order_id,
        jsonb_build_object(
            'order_number', v_order_number,
            'status', 'DRAFT',
            'customer_id', p_customer_id,
            'total_amount', v_grand_total,
            'item_count', v_item_count
        )
    );

    RETURN jsonb_build_object(
        'id', v_order_id,
        'order_number', v_order_number,
        'organization_id', p_org_id,
        'customer_id', p_customer_id,
        'quotation_id', p_quotation_id,
        'status', 'DRAFT',
        'order_date', COALESCE(p_order_date, CURRENT_DATE),
        'subtotal', v_subtotal,
        'discount_amount', v_discount_total,
        'tax_amount', v_tax_total,
        'total_amount', v_grand_total,
        'totals_version', 2,
        'notes', p_notes,
        'idempotent_replay', false,
        'items', v_calculated_items
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_sales_order_atomic(UUID, UUID, DATE, JSONB, TEXT, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sales_order_atomic(UUID, UUID, DATE, JSONB, TEXT, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_sales_order_atomic(UUID, UUID, DATE, JSONB, TEXT, UUID, UUID) TO service_role;

-- ----------------------------------------------------------------------------
-- 11. Authoritative create_quotation_atomic RPC
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_quotation_atomic(
    p_org_id UUID,
    p_customer_id UUID,
    p_valid_until DATE,
    p_items JSONB DEFAULT '[]'::JSONB,
    p_notes TEXT DEFAULT NULL,
    p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid UUID;
    v_user_role VARCHAR(50);
    v_customer_exists BOOLEAN;
    v_quot_year INTEGER;
    v_quot_number VARCHAR(100);
    v_quot_id UUID;
    v_request_hash TEXT;
    v_existing_q_id UUID;
    v_existing_hash TEXT;
    v_existing_quot JSONB;
    v_product_ids UUID[];
    v_locked_prod_count INTEGER;
    v_item JSONB;
    v_calc_item JSONB;
    v_item_prod_id UUID;
    v_item_qty INTEGER;
    v_item_price NUMERIC(12, 2);
    v_item_disc_pct NUMERIC(5, 2);
    v_item_tax_rate NUMERIC(5, 2);
    v_item_name VARCHAR(255);
    v_item_sku VARCHAR(100);
    v_item_uom VARCHAR(50);
    v_prod RECORD;
    v_gross NUMERIC(12, 2);
    v_disc NUMERIC(12, 2);
    v_taxable NUMERIC(12, 2);
    v_tax NUMERIC(12, 2);
    v_line_total NUMERIC(12, 2);
    v_subtotal NUMERIC(12, 2) := 0.00;
    v_discount_total NUMERIC(12, 2) := 0.00;
    v_tax_total NUMERIC(12, 2) := 0.00;
    v_grand_total NUMERIC(12, 2) := 0.00;
    v_item_count INTEGER := 0;
    v_calculated_items JSONB := '[]'::JSONB;
    v_line_item_id UUID;
BEGIN
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'unauthorized';
    END IF;

    IF p_org_id IS NULL OR p_customer_id IS NULL OR p_items IS NULL THEN
        RAISE EXCEPTION 'Invalid parameters: organization_id, customer_id, and items are required';
    END IF;

    IF jsonb_typeof(p_items) != 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Quotation must contain at least one line item';
    END IF;

    v_user_role := get_user_org_role(p_org_id);
    IF v_user_role IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Caller has no active membership in organization %', p_org_id;
    END IF;

    IF v_user_role NOT IN ('owner', 'admin', 'sales') THEN
        RAISE EXCEPTION 'Unauthorized: Caller has insufficient role (%) to create quotations in organization %',
            v_user_role, p_org_id;
    END IF;

    IF NOT public.can_write_organization_operations(p_org_id) THEN
        RAISE EXCEPTION 'Operational write denied: Active subscription or trial required for organization %', p_org_id;
    END IF;

    v_request_hash := md5(
        p_org_id::TEXT || ':' ||
        p_customer_id::TEXT || ':' ||
        COALESCE(p_valid_until::TEXT, '') || ':' ||
        p_items::TEXT
    );

    IF p_idempotency_key IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtext('quot_create:' || p_org_id::TEXT || ':' || p_idempotency_key::TEXT));

        SELECT quotation_id, request_hash
          INTO v_existing_q_id, v_existing_hash
          FROM public.quotation_creation_idempotency
         WHERE organization_id = p_org_id
           AND idempotency_key = p_idempotency_key;

        IF FOUND THEN
            IF v_existing_hash = v_request_hash THEN
                SELECT jsonb_build_object(
                    'id', q.id,
                    'quotation_number', q.quotation_number,
                    'organization_id', q.organization_id,
                    'customer_id', q.customer_id,
                    'status', q.status,
                    'valid_until', q.valid_until,
                    'subtotal', q.subtotal,
                    'discount_amount', q.discount_amount,
                    'tax_amount', q.tax_amount,
                    'total_amount', q.total_amount,
                    'totals_version', q.totals_version,
                    'notes', q.notes,
                    'created_at', q.created_at,
                    'updated_at', q.updated_at,
                    'idempotent_replay', true,
                    'items', COALESCE(
                        (SELECT jsonb_agg(jsonb_build_object(
                            'id', qi.id,
                            'quotation_id', qi.quotation_id,
                            'product_id', qi.product_id,
                            'product_name', qi.product_name,
                            'product_sku', qi.product_sku,
                            'uom', qi.uom,
                            'quantity', qi.quantity,
                            'unit_price', qi.unit_price,
                            'discount_percent', qi.discount_percent,
                            'tax_rate', qi.tax_rate,
                            'line_subtotal', qi.line_subtotal,
                            'line_tax', qi.line_tax,
                            'line_total', qi.line_total,
                            'document_discount_share', qi.document_discount_share
                        )) FROM public.quotation_items qi WHERE qi.quotation_id = q.id),
                        '[]'::JSONB
                    )
                ) INTO v_existing_quot
                FROM public.quotations q
                WHERE q.id = v_existing_q_id;

                RETURN v_existing_quot;
            ELSE
                RAISE EXCEPTION 'Idempotency key reused with different request parameters'
                    USING ERRCODE = 'unique_violation';
            END IF;
        END IF;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.customers
        WHERE id = p_customer_id AND organization_id = p_org_id AND is_active = TRUE
    ) INTO v_customer_exists;

    IF NOT v_customer_exists THEN
        RAISE EXCEPTION 'Customer % not found or inactive in organization %', p_customer_id, p_org_id;
    END IF;

    SELECT array_agg(DISTINCT (item->>'productId')::UUID ORDER BY (item->>'productId')::UUID ASC)
    INTO v_product_ids
    FROM jsonb_array_elements(p_items) AS item;

    IF v_product_ids IS NULL OR array_length(v_product_ids, 1) = 0 THEN
        SELECT array_agg(DISTINCT (item->>'product_id')::UUID ORDER BY (item->>'product_id')::UUID ASC)
        INTO v_product_ids
        FROM jsonb_array_elements(p_items) AS item;
    END IF;

    SELECT COUNT(*) INTO v_locked_prod_count
    FROM public.products
    WHERE id = ANY(v_product_ids) AND organization_id = p_org_id
    FOR UPDATE;

    IF v_locked_prod_count != array_length(v_product_ids, 1) THEN
        RAISE EXCEPTION 'One or more products in items do not belong to organization %', p_org_id;
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_item_count := v_item_count + 1;
        v_item_prod_id := COALESCE(
            (v_item->>'productId')::UUID,
            (v_item->>'product_id')::UUID
        );
        IF v_item_prod_id IS NULL THEN
            RAISE EXCEPTION 'Item % is missing required productId', v_item_count;
        END IF;

        v_item_qty := COALESCE((v_item->>'quantity')::INTEGER, 0);
        IF v_item_qty <= 0 THEN
            RAISE EXCEPTION 'Item % has invalid quantity: % (must be >= 1)', v_item_count, v_item_qty;
        END IF;

        SELECT id, name, sku, uom, selling_price, tax_rate, is_active
          INTO v_prod
          FROM public.products
         WHERE id = v_item_prod_id AND organization_id = p_org_id;

        IF NOT FOUND OR NOT v_prod.is_active THEN
            RAISE EXCEPTION 'Product % is not found or inactive in organization %', v_item_prod_id, p_org_id;
        END IF;

        v_item_price := COALESCE(
            (v_item->>'unitPrice')::NUMERIC(12, 2),
            (v_item->>'unit_price')::NUMERIC(12, 2),
            v_prod.selling_price
        );
        IF v_item_price < 0 THEN
            RAISE EXCEPTION 'Item % has invalid unit_price: % (must be >= 0)', v_item_count, v_item_price;
        END IF;

        v_item_disc_pct := COALESCE(
            (v_item->>'discountPercent')::NUMERIC(5, 2),
            (v_item->>'discount_percent')::NUMERIC(5, 2),
            0.00
        );
        IF v_item_disc_pct < 0 OR v_item_disc_pct > 100 THEN
            RAISE EXCEPTION 'Item % has invalid discount_percent: % (must be between 0 and 100)', v_item_count, v_item_disc_pct;
        END IF;

        v_item_tax_rate := COALESCE(
            (v_item->>'taxRate')::NUMERIC(5, 2),
            (v_item->>'tax_rate')::NUMERIC(5, 2),
            v_prod.tax_rate
        );
        IF v_item_tax_rate < 0 THEN
            RAISE EXCEPTION 'Item % has invalid tax_rate: % (must be >= 0)', v_item_count, v_item_tax_rate;
        END IF;

        v_item_name := COALESCE(v_item->>'productName', v_item->>'product_name', v_prod.name);
        v_item_sku := COALESCE(v_item->>'productSku', v_item->>'product_sku', v_prod.sku);
        v_item_uom := COALESCE(v_item->>'uom', v_prod.uom);

        v_gross := ROUND(v_item_qty * v_item_price, 2);
        v_disc := ROUND(v_gross * (v_item_disc_pct / 100.0), 2);
        v_taxable := v_gross - v_disc;
        v_tax := ROUND(v_taxable * (v_item_tax_rate / 100.0), 2);
        v_line_total := v_taxable + v_tax;

        v_subtotal := v_subtotal + v_gross;
        v_discount_total := v_discount_total + v_disc;
        v_tax_total := v_tax_total + v_tax;
        v_grand_total := v_grand_total + v_line_total;

        v_line_item_id := gen_random_uuid();
        v_calculated_items := v_calculated_items || jsonb_build_array(jsonb_build_object(
            'id', v_line_item_id,
            'product_id', v_item_prod_id,
            'product_name', v_item_name,
            'product_sku', v_item_sku,
            'uom', v_item_uom,
            'quantity', v_item_qty,
            'unit_price', v_item_price,
            'discount_percent', v_item_disc_pct,
            'tax_rate', v_item_tax_rate,
            'line_subtotal', v_taxable,
            'line_tax', v_tax,
            'line_total', v_line_total
        ));
    END LOOP;

    v_quot_year := EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER;
    v_quot_number := public.internal_allocate_document_number(p_org_id, 'QUOTATION', v_quot_year);
    v_quot_id := gen_random_uuid();

    INSERT INTO public.quotations (
        id,
        organization_id,
        quotation_number,
        customer_id,
        status,
        valid_until,
        subtotal,
        discount_amount,
        tax_amount,
        total_amount,
        totals_version,
        notes,
        created_by
    ) VALUES (
        v_quot_id,
        p_org_id,
        v_quot_number,
        p_customer_id,
        'DRAFT',
        COALESCE(p_valid_until, CURRENT_DATE + INTERVAL '15 days'),
        v_subtotal,
        v_discount_total,
        v_tax_total,
        v_grand_total,
        2,
        p_notes,
        v_uid
    );

    FOR v_calc_item IN SELECT * FROM jsonb_array_elements(v_calculated_items)
    LOOP
        INSERT INTO public.quotation_items (
            id,
            quotation_id,
            product_id,
            product_name,
            product_sku,
            uom,
            quantity,
            unit_price,
            discount_percent,
            tax_rate,
            line_subtotal,
            line_tax,
            line_total,
            document_discount_share
        ) VALUES (
            (v_calc_item->>'id')::UUID,
            v_quot_id,
            (v_calc_item->>'product_id')::UUID,
            v_calc_item->>'product_name',
            v_calc_item->>'product_sku',
            v_calc_item->>'uom',
            (v_calc_item->>'quantity')::INTEGER,
            (v_calc_item->>'unit_price')::NUMERIC(12, 2),
            (v_calc_item->>'discount_percent')::NUMERIC(5, 2),
            (v_calc_item->>'tax_rate')::NUMERIC(5, 2),
            (v_calc_item->>'line_subtotal')::NUMERIC(12, 2),
            (v_calc_item->>'line_tax')::NUMERIC(12, 2),
            (v_calc_item->>'line_total')::NUMERIC(12, 2),
            0.00
        );
    END LOOP;

    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO public.quotation_creation_idempotency (
            organization_id,
            idempotency_key,
            user_id,
            quotation_id,
            request_hash
        ) VALUES (
            p_org_id,
            p_idempotency_key,
            v_uid,
            v_quot_id,
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
        'CREATE_QUOTATION',
        'QUOTATION',
        v_quot_id,
        jsonb_build_object(
            'quotation_number', v_quot_number,
            'status', 'DRAFT',
            'customer_id', p_customer_id,
            'total_amount', v_grand_total,
            'item_count', v_item_count
        )
    );

    RETURN jsonb_build_object(
        'id', v_quot_id,
        'quotation_number', v_quot_number,
        'organization_id', p_org_id,
        'customer_id', p_customer_id,
        'status', 'DRAFT',
        'valid_until', COALESCE(p_valid_until, CURRENT_DATE + INTERVAL '15 days'),
        'subtotal', v_subtotal,
        'discount_amount', v_discount_total,
        'tax_amount', v_tax_total,
        'total_amount', v_grand_total,
        'totals_version', 2,
        'notes', p_notes,
        'idempotent_replay', false,
        'items', v_calculated_items
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_quotation_atomic(UUID, UUID, DATE, JSONB, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_quotation_atomic(UUID, UUID, DATE, JSONB, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_quotation_atomic(UUID, UUID, DATE, JSONB, TEXT, UUID) TO service_role;

-- ----------------------------------------------------------------------------
-- 12. Authoritative convert_quotation_atomic RPC (Single Conversion Invariant)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.convert_quotation_atomic(
    p_org_id UUID,
    p_quotation_id UUID,
    p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid UUID;
    v_user_role VARCHAR(50);
    v_quot RECORD;
    v_existing_so_id UUID;
    v_order_id UUID;
    v_order_number VARCHAR(100);
    v_order_year INTEGER;
    v_qi RECORD;
    v_item_count INTEGER := 0;
    v_order_json JSONB;
BEGIN
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'unauthorized';
    END IF;

    IF p_org_id IS NULL OR p_quotation_id IS NULL THEN
        RAISE EXCEPTION 'Invalid parameters: organization_id and quotation_id are required';
    END IF;

    v_user_role := get_user_org_role(p_org_id);
    IF v_user_role IS NULL OR v_user_role NOT IN ('owner', 'admin', 'sales') THEN
        RAISE EXCEPTION 'Unauthorized: Caller has insufficient role to convert quotations in organization %', p_org_id;
    END IF;

    IF NOT public.can_write_organization_operations(p_org_id) THEN
        RAISE EXCEPTION 'Operational write denied: Active subscription or trial required for organization %', p_org_id;
    END IF;

    -- Serialize concurrent conversions of the same quotation via transaction advisory lock
    PERFORM pg_advisory_xact_lock(hashtext('quot_convert:' || p_org_id::TEXT || ':' || p_quotation_id::TEXT));

    -- Lock the quotation record FOR UPDATE
    SELECT * INTO v_quot
    FROM public.quotations
    WHERE id = p_quotation_id AND organization_id = p_org_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Quotation % not found in organization %', p_quotation_id, p_org_id;
    END IF;

    -- Check if already converted
    SELECT id INTO v_existing_so_id
    FROM public.sales_orders
    WHERE quotation_id = p_quotation_id AND organization_id = p_org_id
    LIMIT 1;

    IF v_existing_so_id IS NOT NULL OR v_quot.status = 'CONVERTED' THEN
        -- If already converted and order exists, return the existing order safely
        IF v_existing_so_id IS NOT NULL THEN
            SELECT jsonb_build_object(
                'id', so.id,
                'order_number', so.order_number,
                'organization_id', so.organization_id,
                'customer_id', so.customer_id,
                'quotation_id', so.quotation_id,
                'status', so.status,
                'order_date', so.order_date,
                'subtotal', so.subtotal,
                'discount_amount', so.discount_amount,
                'tax_amount', so.tax_amount,
                'total_amount', so.total_amount,
                'totals_version', so.totals_version,
                'notes', so.notes,
                'created_at', so.created_at,
                'updated_at', so.updated_at,
                'idempotent_replay', true,
                'items', COALESCE(
                    (SELECT jsonb_agg(jsonb_build_object(
                        'id', soi.id,
                        'sales_order_id', soi.sales_order_id,
                        'product_id', soi.product_id,
                        'product_name', soi.product_name,
                        'product_sku', soi.product_sku,
                        'uom', soi.uom,
                        'quantity', soi.quantity,
                        'unit_price', soi.unit_price,
                        'discount_percent', soi.discount_percent,
                        'tax_rate', soi.tax_rate,
                        'line_subtotal', soi.line_subtotal,
                        'line_tax', soi.line_tax,
                        'line_total', soi.line_total,
                        'document_discount_share', soi.document_discount_share
                    )) FROM public.sales_order_items soi WHERE soi.sales_order_id = so.id),
                    '[]'::JSONB
                )
            ) INTO v_order_json
            FROM public.sales_orders so
            WHERE so.id = v_existing_so_id;

            RETURN v_order_json;
        END IF;

        RAISE EXCEPTION 'Quotation % has already been converted', v_quot.quotation_number;
    END IF;

    -- Verify quotation has items
    SELECT COUNT(*) INTO v_item_count
    FROM public.quotation_items
    WHERE quotation_id = p_quotation_id;

    IF v_item_count = 0 THEN
        RAISE EXCEPTION 'Cannot convert quotation %: quotation has zero line items', v_quot.quotation_number;
    END IF;

    -- Allocate sales order number
    v_order_year := EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER;
    v_order_number := public.internal_allocate_document_number(p_org_id, 'SALES_ORDER', v_order_year);
    v_order_id := gen_random_uuid();

    -- Set local transaction flag to authorize insertion
    PERFORM set_config('app.authoritative_order_transition', 'true', true);

    INSERT INTO public.sales_orders (
        id,
        organization_id,
        order_number,
        customer_id,
        quotation_id,
        status,
        order_date,
        subtotal,
        discount_amount,
        tax_amount,
        total_amount,
        totals_version,
        notes,
        created_by
    ) VALUES (
        v_order_id,
        p_org_id,
        v_order_number,
        v_quot.customer_id,
        p_quotation_id,
        'DRAFT',
        CURRENT_DATE,
        v_quot.subtotal,
        v_quot.discount_amount,
        v_quot.tax_amount,
        v_quot.total_amount,
        v_quot.totals_version,
        COALESCE(v_quot.notes, 'Converted from Quotation ' || v_quot.quotation_number),
        v_uid
    );

    FOR v_qi IN
        SELECT * FROM public.quotation_items
        WHERE quotation_id = p_quotation_id
        ORDER BY id ASC
    LOOP
        INSERT INTO public.sales_order_items (
            sales_order_id,
            product_id,
            product_name,
            product_sku,
            uom,
            quantity,
            unit_price,
            discount_percent,
            tax_rate,
            line_subtotal,
            line_tax,
            line_total,
            document_discount_share
        ) VALUES (
            v_order_id,
            v_qi.product_id,
            v_qi.product_name,
            v_qi.product_sku,
            v_qi.uom,
            v_qi.quantity,
            v_qi.unit_price,
            v_qi.discount_percent,
            v_qi.tax_rate,
            v_qi.line_subtotal,
            v_qi.line_tax,
            v_qi.line_total,
            v_qi.document_discount_share
        );
    END LOOP;

    -- Transition quotation status to CONVERTED
    UPDATE public.quotations
       SET status = 'CONVERTED',
           updated_at = NOW()
     WHERE id = p_quotation_id;

    -- Record idempotency if key was provided
    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO public.sales_order_creation_idempotency (
            organization_id,
            idempotency_key,
            user_id,
            sales_order_id,
            request_hash
        ) VALUES (
            p_org_id,
            p_idempotency_key,
            v_uid,
            v_order_id,
            'convert:' || p_quotation_id::TEXT
        );
    END IF;

    -- Audit log
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
        'CONVERT_QUOTATION',
        'QUOTATION',
        p_quotation_id,
        jsonb_build_object(
            'quotation_number', v_quot.quotation_number,
            'sales_order_id', v_order_id,
            'order_number', v_order_number
        )
    );

    SELECT jsonb_build_object(
        'id', so.id,
        'order_number', so.order_number,
        'organization_id', so.organization_id,
        'customer_id', so.customer_id,
        'quotation_id', so.quotation_id,
        'status', so.status,
        'order_date', so.order_date,
        'subtotal', so.subtotal,
        'discount_amount', so.discount_amount,
        'tax_amount', so.tax_amount,
        'total_amount', so.total_amount,
        'totals_version', so.totals_version,
        'notes', so.notes,
        'created_at', so.created_at,
        'updated_at', so.updated_at,
        'idempotent_replay', false,
        'items', COALESCE(
            (SELECT jsonb_agg(jsonb_build_object(
                'id', soi.id,
                'sales_order_id', soi.sales_order_id,
                'product_id', soi.product_id,
                'product_name', soi.product_name,
                'product_sku', soi.product_sku,
                'uom', soi.uom,
                'quantity', soi.quantity,
                'unit_price', soi.unit_price,
                'discount_percent', soi.discount_percent,
                'tax_rate', soi.tax_rate,
                'line_subtotal', soi.line_subtotal,
                'line_tax', soi.line_tax,
                'line_total', soi.line_total,
                'document_discount_share', soi.document_discount_share
            )) FROM public.sales_order_items soi WHERE soi.sales_order_id = so.id),
            '[]'::JSONB
        )
    ) INTO v_order_json
    FROM public.sales_orders so
    WHERE so.id = v_order_id;

    RETURN v_order_json;
END;
$$;

REVOKE ALL ON FUNCTION public.convert_quotation_atomic(UUID, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.convert_quotation_atomic(UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.convert_quotation_atomic(UUID, UUID, UUID) TO service_role;

-- ----------------------------------------------------------------------------
-- 13. Authoritative record_payment_and_allocate with Durable Idempotency
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
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF p_org_id IS NULL OR p_customer_id IS NULL OR p_amount IS NULL OR p_payment_method IS NULL THEN
        RAISE EXCEPTION 'Invalid parameters: organization_id, customer_id, amount, and payment_method are required';
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Payment amount must be greater than zero (received %)', p_amount;
    END IF;

    IF p_payment_method NOT IN ('CASH', 'UPI', 'NEFT', 'RTGS', 'CHEQUE', 'BANK_TRANSFER') THEN
        RAISE EXCEPTION 'Invalid payment method: %. Allowed methods: CASH, UPI, NEFT, RTGS, CHEQUE, BANK_TRANSFER', p_payment_method;
    END IF;

    v_user_role := get_user_org_role(p_org_id);
    IF v_user_role IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Caller has no active membership in organization %', p_org_id;
    END IF;

    IF v_user_role NOT IN ('owner', 'admin', 'accounts') THEN
        RAISE EXCEPTION 'Unauthorized: Caller has insufficient role (%) to record payments in organization %',
            v_user_role, p_org_id;
    END IF;

    IF NOT public.can_write_organization_operations(p_org_id) THEN
        RAISE EXCEPTION 'Operational write denied: Active subscription or trial required for organization %', p_org_id;
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
        RAISE EXCEPTION 'Customer % not found or inactive in organization %', p_customer_id, p_org_id;
    END IF;

    -- Validate allocation bounds if invoice specified
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
                p_allocated_amount, (v_inv.total_amount - v_inv.total_paid), v_inv.total_amount, v_inv.total_paid, p_invoice_id;
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
            organization_id,
            payment_id,
            invoice_id,
            amount_allocated
        ) VALUES (
            p_org_id,
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
-- 14. Authoritative create_product_atomic Supporting Image URL
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_product_atomic(
    p_org_id UUID,
    p_sku VARCHAR(100),
    p_name VARCHAR(255),
    p_category VARCHAR(100),
    p_uom VARCHAR(50) DEFAULT 'Nos',
    p_purchase_cost NUMERIC(12, 2) DEFAULT 0.00,
    p_selling_price NUMERIC(12, 2) DEFAULT 0.00,
    p_tax_rate NUMERIC(5, 2) DEFAULT 18.00,
    p_opening_stock INTEGER DEFAULT 0,
    p_brand VARCHAR(100) DEFAULT NULL,
    p_description TEXT DEFAULT NULL,
    p_hsn_code VARCHAR(20) DEFAULT NULL,
    p_reorder_threshold INTEGER DEFAULT 10,
    p_notes TEXT DEFAULT NULL,
    p_image_url TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid UUID;
    v_user_role VARCHAR(50);
    v_product_id UUID;
    v_sku_clean VARCHAR(100);
    v_name_clean VARCHAR(255);
BEGIN
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'unauthorized';
    END IF;

    IF p_org_id IS NULL OR p_sku IS NULL OR p_name IS NULL OR p_category IS NULL THEN
        RAISE EXCEPTION 'Invalid parameters: organization_id, sku, name, and category are required'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    v_sku_clean := UPPER(TRIM(p_sku));
    v_name_clean := TRIM(p_name);

    IF length(v_sku_clean) = 0 OR length(v_name_clean) = 0 THEN
        RAISE EXCEPTION 'SKU and product name cannot be blank'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF p_purchase_cost < 0 OR p_selling_price < 0 OR p_tax_rate < 0 THEN
        RAISE EXCEPTION 'Prices, costs, and tax rates cannot be negative'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF p_opening_stock < 0 THEN
        RAISE EXCEPTION 'Opening stock cannot be negative (received %)', p_opening_stock
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    v_user_role := public.get_user_org_role(p_org_id);
    IF v_user_role IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Caller has no active membership in organization %', p_org_id
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF v_user_role NOT IN ('owner', 'admin', 'inventory') THEN
        RAISE EXCEPTION 'Unauthorized: Caller has insufficient role (%) to create products in organization %',
            v_user_role, p_org_id
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF NOT public.can_write_organization_operations(p_org_id) THEN
        RAISE EXCEPTION 'Operational write denied: Active subscription or trial required for organization %', p_org_id
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    v_product_id := gen_random_uuid();

    INSERT INTO public.products (
        id,
        organization_id,
        sku,
        name,
        brand,
        category,
        description,
        uom,
        purchase_cost,
        selling_price,
        tax_rate,
        hsn_code,
        reorder_threshold,
        is_active,
        image_url
    ) VALUES (
        v_product_id,
        p_org_id,
        v_sku_clean,
        v_name_clean,
        TRIM(p_brand),
        TRIM(p_category),
        TRIM(p_description),
        COALESCE(TRIM(p_uom), 'Nos'),
        p_purchase_cost,
        p_selling_price,
        p_tax_rate,
        TRIM(p_hsn_code),
        COALESCE(p_reorder_threshold, 10),
        TRUE,
        p_image_url
    );

    IF p_opening_stock > 0 THEN
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
            v_product_id,
            p_opening_stock,
            'OPENING_STOCK',
            'PRODUCT_INIT',
            v_product_id,
            v_uid,
            COALESCE(TRIM(p_notes), 'Initial opening stock registered during product creation')
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
        'CREATE_PRODUCT',
        'PRODUCT',
        v_product_id,
        jsonb_build_object(
            'sku', v_sku_clean,
            'name', v_name_clean,
            'opening_stock', p_opening_stock,
            'purchase_cost', p_purchase_cost,
            'selling_price', p_selling_price
        )
    );

    RETURN jsonb_build_object(
        'id', v_product_id,
        'sku', v_sku_clean,
        'name', v_name_clean,
        'organization_id', p_org_id,
        'current_stock', p_opening_stock,
        'purchase_cost', p_purchase_cost,
        'selling_price', p_selling_price,
        'tax_rate', p_tax_rate,
        'uom', COALESCE(TRIM(p_uom), 'Nos'),
        'image_url', p_image_url
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_product_atomic(UUID, VARCHAR, VARCHAR, VARCHAR, VARCHAR, NUMERIC, NUMERIC, NUMERIC, INTEGER, VARCHAR, TEXT, VARCHAR, INTEGER, TEXT, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_product_atomic(UUID, VARCHAR, VARCHAR, VARCHAR, VARCHAR, NUMERIC, NUMERIC, NUMERIC, INTEGER, VARCHAR, TEXT, VARCHAR, INTEGER, TEXT, TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 15. Authoritative Stock Aggregation RPC
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_product_stock_levels(p_org_id UUID)
RETURNS TABLE (
    product_id UUID,
    current_stock NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT
        p.id AS product_id,
        COALESCE(SUM(sm.quantity_change), 0)::NUMERIC AS current_stock
    FROM public.products p
    LEFT JOIN public.stock_movements sm
        ON sm.product_id = p.id
       AND sm.organization_id = p.organization_id
    WHERE p.organization_id = p_org_id
      AND public.can_read_organization_data(p_org_id)
    GROUP BY p.id;
$$;

REVOKE ALL ON FUNCTION public.get_product_stock_levels(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_product_stock_levels(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_product_stock_levels(UUID) TO service_role;

-- ----------------------------------------------------------------------------
-- 16. Authoritative Dashboard Metrics RPC
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
BEGIN
    IF NOT public.can_read_organization_data(p_org_id) THEN
        RAISE EXCEPTION 'Access denied: Caller cannot read organization data'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- 1. Today's confirmed sales
    SELECT COALESCE(SUM(total_amount), 0.00)
    INTO v_today_sales
    FROM public.sales_orders
    WHERE organization_id = p_org_id
      AND order_date = p_today
      AND status IN ('CONFIRMED', 'FULFILLED');

    -- 2. Total sales orders count
    SELECT COUNT(*)
    INTO v_orders_count
    FROM public.sales_orders
    WHERE organization_id = p_org_id;

    -- 3. Receivables & overdue invoices
    SELECT
        COALESCE(SUM(GREATEST(0, total_amount - total_paid)), 0.00),
        COUNT(*) FILTER (WHERE due_date < p_today AND (total_amount - total_paid) > 0)
    INTO v_total_receivables, v_overdue_count
    FROM public.invoices
    WHERE organization_id = p_org_id
      AND status NOT IN ('CANCELLED', 'PAID');

    -- 4. Inventory stock levels, valuation & low-stock count
    WITH stock_agg AS (
        SELECT
            p.id,
            p.purchase_cost,
            p.reorder_threshold,
            p.is_active,
            COALESCE(SUM(sm.quantity_change), 0) AS on_hand
        FROM public.products p
        LEFT JOIN public.stock_movements sm
            ON sm.product_id = p.id
           AND sm.organization_id = p.organization_id
        WHERE p.organization_id = p_org_id
        GROUP BY p.id, p.purchase_cost, p.reorder_threshold, p.is_active
    )
    SELECT
        COUNT(*) FILTER (WHERE is_active = TRUE AND on_hand <= reorder_threshold),
        COALESCE(SUM(on_hand * purchase_cost), 0.00)
    INTO v_low_stock_count, v_total_stock_value
    FROM stock_agg;

    RETURN jsonb_build_object(
        'today_sales', v_today_sales,
        'orders_count', v_orders_count,
        'total_receivables', v_total_receivables,
        'overdue_invoices_count', v_overdue_count,
        'low_stock_items_count', v_low_stock_count,
        'total_stock_value', v_total_stock_value
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_dashboard_metrics(UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_metrics(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_metrics(UUID, DATE) TO service_role;
