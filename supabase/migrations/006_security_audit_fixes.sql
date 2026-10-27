-- ============================================================================
-- MIGRATION 006: Security & Database Authorization Hardening
-- ============================================================================
-- Fixes:
-- 1. Eliminates recursive RLS policies on memberships table using SECURITY DEFINER
--    helper functions with search_path = public, pg_temp.
-- 2. Hardens privileged functions (get_product_stock, confirm_sales_order,
--    record_payment_and_allocate) with caller auth checks, cross-tenant ID
--    validation, search_path restrictions, and restricted execution grants.
-- 3. Enforces relational integrity across tenants with composite unique keys,
--    composite foreign keys, and validation triggers on line items & allocations.
-- 4. Updates RLS policies across all tables to enforce strict organization
--    scoping on SELECT and WITH CHECK clauses on INSERT/UPDATE/DELETE.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- PART 1: SECURE, NON-RECURSIVE MEMBERSHIP HELPER FUNCTIONS
-- ----------------------------------------------------------------------------

-- Returns set of organization IDs that current auth user belongs to
CREATE OR REPLACE FUNCTION get_user_organizations()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT organization_id
    FROM public.memberships
    WHERE user_id = auth.uid()
      AND is_active = TRUE;
$$;

REVOKE ALL ON FUNCTION get_user_organizations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_user_organizations() TO authenticated;

-- Returns caller's active role within a specific organization
CREATE OR REPLACE FUNCTION get_user_org_role(p_org_id UUID)
RETURNS VARCHAR(50)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT role
    FROM public.memberships
    WHERE organization_id = p_org_id
      AND user_id = auth.uid()
      AND is_active = TRUE
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION get_user_org_role(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_user_org_role(UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- PART 2: HARDENED ROW LEVEL SECURITY POLICIES
-- ----------------------------------------------------------------------------

-- Organizations policies
DROP POLICY IF EXISTS "Users can view organizations they belong to" ON organizations;
DROP POLICY IF EXISTS "Owners and admins can update their organization" ON organizations;

CREATE POLICY "Users can view organizations they belong to"
ON organizations FOR SELECT
USING (
    id IN (SELECT get_user_organizations())
);

CREATE POLICY "Owners and admins can update their organization"
ON organizations FOR UPDATE
USING (
    get_user_org_role(id) IN ('owner', 'admin')
)
WITH CHECK (
    get_user_org_role(id) IN ('owner', 'admin')
);

-- Memberships policies (Non-recursive)
DROP POLICY IF EXISTS "Users can view memberships of their organizations" ON memberships;
DROP POLICY IF EXISTS "Owners can manage organization memberships" ON memberships;
DROP POLICY IF EXISTS "Users can view own memberships" ON memberships;
DROP POLICY IF EXISTS "Users can view organization member list" ON memberships;

CREATE POLICY "Users can view own memberships"
ON memberships FOR SELECT
USING (
    user_id = auth.uid()
);

CREATE POLICY "Users can view organization member list"
ON memberships FOR SELECT
USING (
    organization_id IN (SELECT get_user_organizations())
);

CREATE POLICY "Owners can manage organization memberships"
ON memberships FOR ALL
USING (
    get_user_org_role(organization_id) = 'owner'
)
WITH CHECK (
    get_user_org_role(organization_id) = 'owner'
);

-- Audit Events policies
DROP POLICY IF EXISTS "Admins and owners can view audit logs" ON audit_events;
DROP POLICY IF EXISTS "Members can log audit events" ON audit_events;

CREATE POLICY "Admins and owners can view audit logs"
ON audit_events FOR SELECT
USING (
    get_user_org_role(organization_id) IN ('owner', 'admin')
);

CREATE POLICY "Members can log audit events"
ON audit_events FOR INSERT
WITH CHECK (
    organization_id IN (SELECT get_user_organizations())
);

-- Products policies
DROP POLICY IF EXISTS "Users can view products of their organization" ON products;
DROP POLICY IF EXISTS "Inventory and admins can manage products" ON products;

CREATE POLICY "Users can view products of their organization"
ON products FOR SELECT
USING (
    organization_id IN (SELECT get_user_organizations())
);

CREATE POLICY "Inventory and admins can manage products"
ON products FOR ALL
USING (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'inventory')
)
WITH CHECK (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'inventory')
);

-- Customers policies
DROP POLICY IF EXISTS "Users can view customers of their organization" ON customers;
DROP POLICY IF EXISTS "Sales, accounts and admins can manage customers" ON customers;

CREATE POLICY "Users can view customers of their organization"
ON customers FOR SELECT
USING (
    organization_id IN (SELECT get_user_organizations())
);

CREATE POLICY "Sales, accounts and admins can manage customers"
ON customers FOR ALL
USING (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'sales', 'accounts')
)
WITH CHECK (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'sales', 'accounts')
);

-- Suppliers policies
DROP POLICY IF EXISTS "Users can view suppliers of their organization" ON suppliers;
DROP POLICY IF EXISTS "Inventory, accounts and admins can manage suppliers" ON suppliers;

CREATE POLICY "Users can view suppliers of their organization"
ON suppliers FOR SELECT
USING (
    organization_id IN (SELECT get_user_organizations())
);

CREATE POLICY "Inventory, accounts and admins can manage suppliers"
ON suppliers FOR ALL
USING (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'inventory', 'accounts')
)
WITH CHECK (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'inventory', 'accounts')
);

-- Stock Movements policies
DROP POLICY IF EXISTS "Users can view stock movements of their organization" ON stock_movements;
DROP POLICY IF EXISTS "Inventory staff and admins can insert stock movements" ON stock_movements;

CREATE POLICY "Users can view stock movements of their organization"
ON stock_movements FOR SELECT
USING (
    organization_id IN (SELECT get_user_organizations())
);

CREATE POLICY "Inventory staff and admins can insert stock movements"
ON stock_movements FOR INSERT
WITH CHECK (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'inventory')
);

-- Quotations and Quotation Items policies
DROP POLICY IF EXISTS "Users can view quotations of their organization" ON quotations;
DROP POLICY IF EXISTS "Sales and admins can manage quotations" ON quotations;
DROP POLICY IF EXISTS "Users can view quotation items" ON quotation_items;
DROP POLICY IF EXISTS "Sales and admins can manage quotation items" ON quotation_items;

CREATE POLICY "Users can view quotations of their organization"
ON quotations FOR SELECT
USING (
    organization_id IN (SELECT get_user_organizations())
);

CREATE POLICY "Sales and admins can manage quotations"
ON quotations FOR ALL
USING (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'sales')
)
WITH CHECK (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'sales')
);

CREATE POLICY "Users can view quotation items"
ON quotation_items FOR SELECT
USING (
    quotation_id IN (
        SELECT id FROM public.quotations
        WHERE organization_id IN (SELECT get_user_organizations())
    )
);

CREATE POLICY "Sales and admins can manage quotation items"
ON quotation_items FOR ALL
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

-- Sales Orders and Sales Order Items policies
DROP POLICY IF EXISTS "Users can view sales orders of their organization" ON sales_orders;
DROP POLICY IF EXISTS "Sales and admins can manage sales orders" ON sales_orders;
DROP POLICY IF EXISTS "Users can view sales order items" ON sales_order_items;
DROP POLICY IF EXISTS "Sales and admins can manage sales order items" ON sales_order_items;

CREATE POLICY "Users can view sales orders of their organization"
ON sales_orders FOR SELECT
USING (
    organization_id IN (SELECT get_user_organizations())
);

CREATE POLICY "Sales and admins can manage sales orders"
ON sales_orders FOR ALL
USING (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'sales')
)
WITH CHECK (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'sales')
);

CREATE POLICY "Users can view sales order items"
ON sales_order_items FOR SELECT
USING (
    sales_order_id IN (
        SELECT id FROM public.sales_orders
        WHERE organization_id IN (SELECT get_user_organizations())
    )
);

CREATE POLICY "Sales and admins can manage sales order items"
ON sales_order_items FOR ALL
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

-- Invoices and Invoice Items policies
DROP POLICY IF EXISTS "Users can view invoices of their organization" ON invoices;
DROP POLICY IF EXISTS "Accounts and admins can manage invoices" ON invoices;
DROP POLICY IF EXISTS "Users can view invoice items" ON invoice_items;
DROP POLICY IF EXISTS "Accounts and admins can manage invoice items" ON invoice_items;

CREATE POLICY "Users can view invoices of their organization"
ON invoices FOR SELECT
USING (
    organization_id IN (SELECT get_user_organizations())
);

CREATE POLICY "Accounts and admins can manage invoices"
ON invoices FOR ALL
USING (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'accounts')
)
WITH CHECK (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'accounts')
);

CREATE POLICY "Users can view invoice items"
ON invoice_items FOR SELECT
USING (
    invoice_id IN (
        SELECT id FROM public.invoices
        WHERE organization_id IN (SELECT get_user_organizations())
    )
);

CREATE POLICY "Accounts and admins can manage invoice items"
ON invoice_items FOR ALL
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

-- Payments and Payment Allocations policies
DROP POLICY IF EXISTS "Users can view payments of their organization" ON payments;
DROP POLICY IF EXISTS "Accounts and admins can manage payments" ON payments;
DROP POLICY IF EXISTS "Users can view payment allocations" ON payment_allocations;
DROP POLICY IF EXISTS "Accounts and admins can manage payment allocations" ON payment_allocations;

CREATE POLICY "Users can view payments of their organization"
ON payments FOR SELECT
USING (
    organization_id IN (SELECT get_user_organizations())
);

CREATE POLICY "Accounts and admins can manage payments"
ON payments FOR ALL
USING (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'accounts')
)
WITH CHECK (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'accounts')
);

CREATE POLICY "Users can view payment allocations"
ON payment_allocations FOR SELECT
USING (
    payment_id IN (
        SELECT id FROM public.payments
        WHERE organization_id IN (SELECT get_user_organizations())
    )
);

CREATE POLICY "Accounts and admins can manage payment allocations"
ON payment_allocations FOR ALL
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

-- ----------------------------------------------------------------------------
-- PART 3: TENANT ISOLATION & COMPOSITE CONSTRAINTS
-- ----------------------------------------------------------------------------

-- Add composite unique constraints on parent entities (id, organization_id)
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

-- Enforce composite foreign keys on stock_movements
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_stock_movements_product_org') THEN
        ALTER TABLE stock_movements
            ADD CONSTRAINT fk_stock_movements_product_org
            FOREIGN KEY (product_id, organization_id)
            REFERENCES products(id, organization_id)
            ON DELETE RESTRICT;
    END IF;
END $$;

-- Enforce composite foreign keys on quotations
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_quotations_customer_org') THEN
        ALTER TABLE quotations
            ADD CONSTRAINT fk_quotations_customer_org
            FOREIGN KEY (customer_id, organization_id)
            REFERENCES customers(id, organization_id)
            ON DELETE RESTRICT;
    END IF;
END $$;

-- Enforce composite foreign keys on sales_orders
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sales_orders_customer_org') THEN
        ALTER TABLE sales_orders
            ADD CONSTRAINT fk_sales_orders_customer_org
            FOREIGN KEY (customer_id, organization_id)
            REFERENCES customers(id, organization_id)
            ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sales_orders_quotation_org') THEN
        ALTER TABLE sales_orders
            ADD CONSTRAINT fk_sales_orders_quotation_org
            FOREIGN KEY (quotation_id, organization_id)
            REFERENCES quotations(id, organization_id)
            ON DELETE SET NULL;
    END IF;
END $$;

-- Enforce composite foreign keys on invoices
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_invoices_customer_org') THEN
        ALTER TABLE invoices
            ADD CONSTRAINT fk_invoices_customer_org
            FOREIGN KEY (customer_id, organization_id)
            REFERENCES customers(id, organization_id)
            ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_invoices_sales_order_org') THEN
        ALTER TABLE invoices
            ADD CONSTRAINT fk_invoices_sales_order_org
            FOREIGN KEY (sales_order_id, organization_id)
            REFERENCES sales_orders(id, organization_id)
            ON DELETE SET NULL;
    END IF;
END $$;

-- Enforce composite foreign keys on payments
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_payments_customer_org') THEN
        ALTER TABLE payments
            ADD CONSTRAINT fk_payments_customer_org
            FOREIGN KEY (customer_id, organization_id)
            REFERENCES customers(id, organization_id)
            ON DELETE RESTRICT;
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- PART 4: RELATIONAL INTEGRITY TRIGGERS FOR CHILD ITEMS & ALLOCATIONS
-- ----------------------------------------------------------------------------

-- Validation Trigger: Quotation items must reference products from the same organization
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

DROP TRIGGER IF EXISTS check_quotation_item_org_trigger ON quotation_items;
CREATE TRIGGER check_quotation_item_org_trigger
BEFORE INSERT OR UPDATE ON quotation_items
FOR EACH ROW EXECUTE FUNCTION trg_check_quotation_item_org();

-- Validation Trigger: Sales order items must reference products from the same organization
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

DROP TRIGGER IF EXISTS check_sales_order_item_org_trigger ON sales_order_items;
CREATE TRIGGER check_sales_order_item_org_trigger
BEFORE INSERT OR UPDATE ON sales_order_items
FOR EACH ROW EXECUTE FUNCTION trg_check_sales_order_item_org();

-- Validation Trigger: Invoice items must reference products from the same organization
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

DROP TRIGGER IF EXISTS check_invoice_item_org_trigger ON invoice_items;
CREATE TRIGGER check_invoice_item_org_trigger
BEFORE INSERT OR UPDATE ON invoice_items
FOR EACH ROW EXECUTE FUNCTION trg_check_invoice_item_org();

-- Validation Trigger: Payment allocations must match both organization and customer
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
    -- 1. Authorization: Verify caller is authenticated and active member of p_org_id
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    v_user_role := get_user_org_role(p_org_id);
    IF v_user_role IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Caller is not a member of organization %', p_org_id;
    END IF;

    -- 2. Tenant verification: Product must belong to p_org_id
    SELECT EXISTS (
        SELECT 1 FROM public.products
        WHERE id = p_product_id AND organization_id = p_org_id
    ) INTO v_product_exists;

    IF NOT v_product_exists THEN
        RAISE EXCEPTION 'Product % not found in organization %', p_product_id, p_org_id;
    END IF;

    -- 3. Calculate stock strictly within tenant ledger
    SELECT COALESCE(SUM(quantity_change), 0)
    INTO v_total
    FROM public.stock_movements
    WHERE product_id = p_product_id
      AND organization_id = p_org_id;

    RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION get_product_stock(UUID, UUID) FROM PUBLIC;
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
BEGIN
    -- 1. Authorization: Verify caller has sales/admin/owner permissions
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    v_user_role := get_user_org_role(p_org_id);
    IF v_user_role NOT IN ('owner', 'admin', 'sales') THEN
        RAISE EXCEPTION 'Unauthorized: Insufficient role (%) to confirm orders in organization %', v_user_role, p_org_id;
    END IF;

    -- 2. Lock and verify the order strictly within organization
    SELECT status INTO v_order_status
    FROM public.sales_orders
    WHERE id = p_order_id AND organization_id = p_org_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sales order % not found in organization %', p_order_id, p_org_id;
    END IF;

    IF v_order_status != 'DRAFT' THEN
        RAISE EXCEPTION 'Order % cannot be confirmed because status is %', p_order_id, v_order_status;
    END IF;

    -- 3. Iterate over items, lock product records and check inventory balances strictly within p_org_id
    FOR v_item IN
        SELECT oi.product_id, oi.quantity, oi.product_name, oi.product_sku
        FROM public.sales_order_items oi
        JOIN public.sales_orders so ON so.id = oi.sales_order_id
        WHERE oi.sales_order_id = p_order_id AND so.organization_id = p_org_id
    LOOP
        -- Row lock on product strictly verifying organization ownership
        PERFORM id FROM public.products
        WHERE id = v_item.product_id AND organization_id = p_org_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Product % in order does not belong to organization %', v_item.product_id, p_org_id;
        END IF;

        -- Get current available stock
        v_available_stock := get_product_stock(v_item.product_id, p_org_id);

        IF v_available_stock < v_item.quantity THEN
            RAISE EXCEPTION 'Insufficient stock for product "%" (SKU: %). Available: %, Requested: %',
                v_item.product_name, v_item.product_sku, v_available_stock, v_item.quantity;
        END IF;

        -- 4. Record stock deduction movement
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
            auth.uid(),
            'Order confirmation deduction for ' || v_item.product_sku
        );
    END LOOP;

    -- 5. Mark order CONFIRMED scoped to organization
    UPDATE public.sales_orders
    SET status = 'CONFIRMED',
        confirmed_at = NOW(),
        confirmed_by = auth.uid(),
        updated_at = NOW()
    WHERE id = p_order_id AND organization_id = p_org_id;

    -- 6. Log audit event
    INSERT INTO public.audit_events (
        organization_id,
        actor_id,
        action,
        entity_type,
        entity_id,
        details
    ) VALUES (
        p_org_id,
        auth.uid(),
        'CONFIRM_ORDER',
        'SALES_ORDER',
        p_order_id,
        jsonb_build_object('order_id', p_order_id, 'previous_status', 'DRAFT', 'new_status', 'CONFIRMED')
    );

    RETURN jsonb_build_object('success', true, 'order_id', p_order_id, 'status', 'CONFIRMED');
END;
$$;

REVOKE ALL ON FUNCTION confirm_sales_order(UUID, UUID) FROM PUBLIC;
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
BEGIN
    -- 1. Authorization: Verify caller has accounts/admin/owner permissions
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    v_user_role := get_user_org_role(p_org_id);
    IF v_user_role NOT IN ('owner', 'admin', 'accounts') THEN
        RAISE EXCEPTION 'Unauthorized: Insufficient role (%) to record payments in organization %', v_user_role, p_org_id;
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Payment amount must be greater than zero';
    END IF;

    -- 2. Tenant verification: Customer must belong to p_org_id
    SELECT EXISTS (
        SELECT 1 FROM public.customers
        WHERE id = p_customer_id AND organization_id = p_org_id
    ) INTO v_customer_exists;

    IF NOT v_customer_exists THEN
        RAISE EXCEPTION 'Customer % not found in organization %', p_customer_id, p_org_id;
    END IF;

    -- Validate allocation amount if invoice specified
    IF p_invoice_id IS NOT NULL THEN
        IF p_allocated_amount <= 0 OR p_allocated_amount > p_amount THEN
            RAISE EXCEPTION 'Invalid allocation amount % for payment amount %', p_allocated_amount, p_amount;
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
        auth.uid()
    ) RETURNING id INTO v_payment_id;

    -- 3. If invoice allocation is provided, lock and verify invoice tenant and customer matching
    IF p_invoice_id IS NOT NULL THEN
        SELECT id, customer_id, total_amount, total_paid, status
        INTO v_inv
        FROM public.invoices
        WHERE id = p_invoice_id AND organization_id = p_org_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Invoice % not found in organization %', p_invoice_id, p_org_id;
        END IF;

        -- Verify customer matching: payment customer must match invoice customer
        IF v_inv.customer_id != p_customer_id THEN
            RAISE EXCEPTION 'Customer mismatch: Payment customer % does not match invoice customer %',
                p_customer_id, v_inv.customer_id;
        END IF;

        IF (v_inv.total_paid + p_allocated_amount) > v_inv.total_amount THEN
            RAISE EXCEPTION 'Allocation % exceeds remaining balance of % on invoice %',
                p_allocated_amount, (v_inv.total_amount - v_inv.total_paid), v_inv.id;
        END IF;

        -- Record allocation
        INSERT INTO public.payment_allocations (
            payment_id,
            invoice_id,
            amount_allocated
        ) VALUES (
            v_payment_id,
            p_invoice_id,
            p_allocated_amount
        );

        -- Update invoice total_paid and status
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
        auth.uid(),
        'RECORD_PAYMENT',
        'PAYMENT',
        v_payment_id,
        jsonb_build_object('payment_number', v_payment_num, 'amount', p_amount, 'invoice_id', p_invoice_id, 'allocated_amount', p_allocated_amount)
    );

    RETURN jsonb_build_object('success', true, 'payment_id', v_payment_id, 'payment_number', v_payment_num);
END;
$$;

REVOKE ALL ON FUNCTION record_payment_and_allocate(UUID, UUID, NUMERIC, VARCHAR, VARCHAR, DATE, TEXT, UUID, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_payment_and_allocate(UUID, UUID, NUMERIC, VARCHAR, VARCHAR, DATE, TEXT, UUID, NUMERIC) TO authenticated;
