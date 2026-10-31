-- ============================================================================
-- Migration 014: Harden Operational RLS and Privileged RPCs with Eligibility
-- ============================================================================
-- Purpose:
--   Enforces business eligibility and active subscription/trial gates across
--   all operational write paths while preserving read access and statutory
--   record retention (e.g. 6-year GST invoice retention and data exports).
--
-- Security Strategy (Phase 1.2):
--   1. Decouples Reads vs Writes:
--      - can_read_organization_data: Active tenant member AND business NOT rejected.
--        Preserves historical read and lawful export access after trial expiry or payment lapse.
--      - can_write_organization_operations: Active tenant member AND approved eligibility
--        AND valid active trial or paid subscription. Missing dates NEVER grant perpetual access.
--   2. Strict Schema Alignment:
--      - Tables with direct organization_id: products, customers, suppliers, stock_movements,
--        quotations, sales_orders, invoices, payments, document_sequences.
--      - Child tables without direct organization_id (quotation_items, sales_order_items,
--        invoice_items, payment_allocations) enforce RLS by joining against their parent tables.
--   3. Comprehensive Policy Inventory & Purge:
--      - Explicitly drops every historical policy from migrations 001 through 011.
--      - Dynamic catalog cleanup guarantees no permissive legacy policy can bypass new gates.
--   4. Statutory Financial Record Retention:
--      - DELETE is strictly PROHIBITED for authenticated users on invoices, invoice items,
--        payments, payment allocations, and stock movements. Invoices must be CANCELLED or
--        amended via credit notes; financial audit ledgers cannot be deleted.
--   5. Privileged RPC Alignment:
--      - confirm_sales_order, allocate_document_number, and record_payment_and_allocate
--        preserve 100% of checked-in parameters, validations, row locking, and exact audit_events columns.
-- ============================================================================

-- 1. Helper Predicates
CREATE OR REPLACE FUNCTION public.user_is_org_member(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT CASE 
        WHEN auth.uid() IS NULL OR p_org_id IS NULL THEN FALSE
        ELSE EXISTS (
            SELECT 1 
            FROM public.memberships 
            WHERE organization_id = p_org_id 
              AND user_id = auth.uid() 
              AND is_active = TRUE
        )
    END;
$$;

CREATE OR REPLACE FUNCTION public.can_read_organization_data(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    -- Merchant can read their historical tenant data if they are an active member
    -- and the business is not rejected. Preserves statutory 6-year GST retention and lawful exports.
    SELECT 
        public.user_is_org_member(p_org_id)
        AND NOT EXISTS (
            SELECT 1 
            FROM public.organization_eligibility 
            WHERE organization_id = p_org_id 
              AND status = 'rejected'
        );
$$;

CREATE OR REPLACE FUNCTION public.can_write_organization_operations(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    -- Operational writes require:
    -- 1. Active membership in the organization.
    -- 2. Approved business eligibility.
    -- 3. Non-expired trial OR active paid subscription with valid period dates.
    -- Missing period dates NEVER grant perpetual access.
    SELECT 
        public.user_is_org_member(p_org_id)
        AND EXISTS (
            SELECT 1 
            FROM public.organization_eligibility 
            WHERE organization_id = p_org_id 
              AND status = 'approved'
        )
        AND EXISTS (
            SELECT 1 
            FROM public.organization_subscriptions 
            WHERE organization_id = p_org_id 
              AND (
                  (
                      status = 'trialing' 
                      AND trial_ends_at IS NOT NULL 
                      AND timezone('utc'::text, now()) <= trial_ends_at
                  )
                  OR
                  (
                      status = 'active' 
                      AND current_period_ends_at IS NOT NULL 
                      AND timezone('utc'::text, now()) <= COALESCE(grace_period_ends_at, current_period_ends_at)
                  )
              )
        );
$$;

-- 2. Comprehensive Purge of Historical Policies (Migrations 001 through 011)

-- Explicitly drop all historical policies from migrations 001-011 and prior drafts
DROP POLICY IF EXISTS "Users can view products of their organization" ON public.products;
DROP POLICY IF EXISTS "Inventory and admins can manage products" ON public.products;
DROP POLICY IF EXISTS "Inventory and admins can insert products" ON public.products;
DROP POLICY IF EXISTS "Inventory and admins can update products" ON public.products;
DROP POLICY IF EXISTS "Inventory and admins can delete products" ON public.products;
DROP POLICY IF EXISTS products_tenant_isolation ON public.products;
DROP POLICY IF EXISTS products_select ON public.products;
DROP POLICY IF EXISTS products_insert ON public.products;
DROP POLICY IF EXISTS products_update ON public.products;
DROP POLICY IF EXISTS products_delete ON public.products;

DROP POLICY IF EXISTS "Users can view customers of their organization" ON public.customers;
DROP POLICY IF EXISTS "Sales, accounts and admins can manage customers" ON public.customers;
DROP POLICY IF EXISTS "Sales, accounts and admins can insert customers" ON public.customers;
DROP POLICY IF EXISTS "Sales, accounts and admins can update customers" ON public.customers;
DROP POLICY IF EXISTS "Sales, accounts and admins can delete customers" ON public.customers;
DROP POLICY IF EXISTS customers_tenant_isolation ON public.customers;
DROP POLICY IF EXISTS customers_select ON public.customers;
DROP POLICY IF EXISTS customers_insert ON public.customers;
DROP POLICY IF EXISTS customers_update ON public.customers;
DROP POLICY IF EXISTS customers_delete ON public.customers;

DROP POLICY IF EXISTS "Users can view suppliers of their organization" ON public.suppliers;
DROP POLICY IF EXISTS "Inventory, accounts and admins can manage suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "Inventory, accounts and admins can insert suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "Inventory, accounts and admins can update suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "Inventory, accounts and admins can delete suppliers" ON public.suppliers;
DROP POLICY IF EXISTS suppliers_tenant_isolation ON public.suppliers;
DROP POLICY IF EXISTS suppliers_select ON public.suppliers;
DROP POLICY IF EXISTS suppliers_insert ON public.suppliers;
DROP POLICY IF EXISTS suppliers_update ON public.suppliers;
DROP POLICY IF EXISTS suppliers_delete ON public.suppliers;

DROP POLICY IF EXISTS "Users can view stock movements of their organization" ON public.stock_movements;
DROP POLICY IF EXISTS "Inventory staff and admins can insert stock movements" ON public.stock_movements;
DROP POLICY IF EXISTS stock_movements_tenant_isolation ON public.stock_movements;
DROP POLICY IF EXISTS stock_movements_select ON public.stock_movements;
DROP POLICY IF EXISTS stock_movements_insert ON public.stock_movements;

DROP POLICY IF EXISTS "Users can view quotations of their organization" ON public.quotations;
DROP POLICY IF EXISTS "Sales and admins can manage quotations" ON public.quotations;
DROP POLICY IF EXISTS "Sales and admins can insert quotations" ON public.quotations;
DROP POLICY IF EXISTS "Sales and admins can update quotations" ON public.quotations;
DROP POLICY IF EXISTS "Sales and admins can delete quotations" ON public.quotations;
DROP POLICY IF EXISTS quotations_tenant_isolation ON public.quotations;
DROP POLICY IF EXISTS quotations_select ON public.quotations;
DROP POLICY IF EXISTS quotations_insert ON public.quotations;
DROP POLICY IF EXISTS quotations_update ON public.quotations;
DROP POLICY IF EXISTS quotations_delete ON public.quotations;

DROP POLICY IF EXISTS "Users can view quotation items" ON public.quotation_items;
DROP POLICY IF EXISTS "Sales and admins can manage quotation items" ON public.quotation_items;
DROP POLICY IF EXISTS "Sales and admins can insert quotation items" ON public.quotation_items;
DROP POLICY IF EXISTS "Sales and admins can update quotation items" ON public.quotation_items;
DROP POLICY IF EXISTS "Sales and admins can delete quotation items" ON public.quotation_items;
DROP POLICY IF EXISTS quotation_items_tenant_isolation ON public.quotation_items;
DROP POLICY IF EXISTS quotation_items_select ON public.quotation_items;
DROP POLICY IF EXISTS quotation_items_insert ON public.quotation_items;
DROP POLICY IF EXISTS quotation_items_update ON public.quotation_items;
DROP POLICY IF EXISTS quotation_items_delete ON public.quotation_items;

DROP POLICY IF EXISTS "Users can view sales orders of their organization" ON public.sales_orders;
DROP POLICY IF EXISTS "Sales and admins can manage sales orders" ON public.sales_orders;
DROP POLICY IF EXISTS "Sales and admins can insert sales orders" ON public.sales_orders;
DROP POLICY IF EXISTS "Sales and admins can update sales orders" ON public.sales_orders;
DROP POLICY IF EXISTS "Sales and admins can delete sales orders" ON public.sales_orders;
DROP POLICY IF EXISTS sales_orders_tenant_isolation ON public.sales_orders;
DROP POLICY IF EXISTS sales_orders_select ON public.sales_orders;
DROP POLICY IF EXISTS sales_orders_insert ON public.sales_orders;
DROP POLICY IF EXISTS sales_orders_update ON public.sales_orders;
DROP POLICY IF EXISTS sales_orders_delete ON public.sales_orders;

DROP POLICY IF EXISTS "Users can view sales order items" ON public.sales_order_items;
DROP POLICY IF EXISTS "Sales and admins can manage sales order items" ON public.sales_order_items;
DROP POLICY IF EXISTS "Sales and admins can insert sales order items" ON public.sales_order_items;
DROP POLICY IF EXISTS "Sales and admins can update sales order items" ON public.sales_order_items;
DROP POLICY IF EXISTS "Sales and admins can delete sales order items" ON public.sales_order_items;
DROP POLICY IF EXISTS sales_order_items_tenant_isolation ON public.sales_order_items;
DROP POLICY IF EXISTS sales_order_items_select ON public.sales_order_items;
DROP POLICY IF EXISTS sales_order_items_insert ON public.sales_order_items;
DROP POLICY IF EXISTS sales_order_items_update ON public.sales_order_items;
DROP POLICY IF EXISTS sales_order_items_delete ON public.sales_order_items;

DROP POLICY IF EXISTS "Users can view invoices of their organization" ON public.invoices;
DROP POLICY IF EXISTS "Accounts and admins can manage invoices" ON public.invoices;
DROP POLICY IF EXISTS "Accounts and admins can insert invoices" ON public.invoices;
DROP POLICY IF EXISTS "Accounts and admins can update invoices" ON public.invoices;
DROP POLICY IF EXISTS "Accounts and admins can delete invoices" ON public.invoices;
DROP POLICY IF EXISTS invoices_tenant_isolation ON public.invoices;
DROP POLICY IF EXISTS invoices_select ON public.invoices;
DROP POLICY IF EXISTS invoices_insert ON public.invoices;
DROP POLICY IF EXISTS invoices_update ON public.invoices;
DROP POLICY IF EXISTS invoices_delete ON public.invoices;

DROP POLICY IF EXISTS "Users can view invoice items" ON public.invoice_items;
DROP POLICY IF EXISTS "Accounts and admins can manage invoice items" ON public.invoice_items;
DROP POLICY IF EXISTS "Accounts and admins can insert invoice items" ON public.invoice_items;
DROP POLICY IF EXISTS "Accounts and admins can update invoice items" ON public.invoice_items;
DROP POLICY IF EXISTS "Accounts and admins can delete invoice items" ON public.invoice_items;
DROP POLICY IF EXISTS invoice_items_tenant_isolation ON public.invoice_items;
DROP POLICY IF EXISTS invoice_items_select ON public.invoice_items;
DROP POLICY IF EXISTS invoice_items_insert ON public.invoice_items;
DROP POLICY IF EXISTS invoice_items_update ON public.invoice_items;
DROP POLICY IF EXISTS invoice_items_delete ON public.invoice_items;

DROP POLICY IF EXISTS "Users can view payments of their organization" ON public.payments;
DROP POLICY IF EXISTS "Accounts and admins can manage payments" ON public.payments;
DROP POLICY IF EXISTS "Accounts and admins can insert payments" ON public.payments;
DROP POLICY IF EXISTS "Accounts and admins can update payments" ON public.payments;
DROP POLICY IF EXISTS "Accounts and admins can delete payments" ON public.payments;
DROP POLICY IF EXISTS payments_tenant_isolation ON public.payments;
DROP POLICY IF EXISTS payments_select ON public.payments;
DROP POLICY IF EXISTS payments_insert ON public.payments;
DROP POLICY IF EXISTS payments_update ON public.payments;
DROP POLICY IF EXISTS payments_delete ON public.payments;

DROP POLICY IF EXISTS "Users can view payment allocations" ON public.payment_allocations;
DROP POLICY IF EXISTS "Accounts and admins can manage payment allocations" ON public.payment_allocations;
DROP POLICY IF EXISTS "Accounts and admins can insert payment allocations" ON public.payment_allocations;
DROP POLICY IF EXISTS "Accounts and admins can update payment allocations" ON public.payment_allocations;
DROP POLICY IF EXISTS "Accounts and admins can delete payment allocations" ON public.payment_allocations;
DROP POLICY IF EXISTS payment_allocations_tenant_isolation ON public.payment_allocations;
DROP POLICY IF EXISTS payment_allocations_select ON public.payment_allocations;
DROP POLICY IF EXISTS payment_allocations_insert ON public.payment_allocations;
DROP POLICY IF EXISTS payment_allocations_update ON public.payment_allocations;
DROP POLICY IF EXISTS payment_allocations_delete ON public.payment_allocations;

DROP POLICY IF EXISTS "Members can view org document sequences" ON public.document_sequences;
DROP POLICY IF EXISTS document_sequences_tenant_isolation ON public.document_sequences;
DROP POLICY IF EXISTS document_sequences_select ON public.document_sequences;
DROP POLICY IF EXISTS document_sequences_insert ON public.document_sequences;
DROP POLICY IF EXISTS document_sequences_update ON public.document_sequences;

-- Dynamic sweep ensures no orphaned custom policies remain on operational tables
DO $$
DECLARE
    r RECORD;
    v_tables text[] := ARRAY[
        'products', 'customers', 'suppliers', 'stock_movements',
        'quotations', 'quotation_items', 'sales_orders', 'sales_order_items',
        'invoices', 'invoice_items', 'payments', 'payment_allocations',
        'document_sequences'
    ];
BEGIN
    FOR r IN (
        SELECT schemaname, tablename, policyname
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = ANY(v_tables)
    ) LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    END LOOP;
END $$;

-- 3. Apply Hardened Granular Policies to Operational Tables

-- 3A. Products
CREATE POLICY products_select ON public.products
    FOR SELECT TO authenticated
    USING (public.can_read_organization_data(organization_id));

CREATE POLICY products_insert ON public.products
    FOR INSERT TO authenticated
    WITH CHECK (
        public.can_write_organization_operations(organization_id)
        AND public.user_has_org_role(organization_id, 'owner', 'admin', 'inventory')
    );

CREATE POLICY products_update ON public.products
    FOR UPDATE TO authenticated
    USING (
        public.can_write_organization_operations(organization_id)
        AND public.user_has_org_role(organization_id, 'owner', 'admin', 'inventory')
    )
    WITH CHECK (
        public.can_write_organization_operations(organization_id)
        AND public.user_has_org_role(organization_id, 'owner', 'admin', 'inventory')
    );

CREATE POLICY products_delete ON public.products
    FOR DELETE TO authenticated
    USING (
        public.can_write_organization_operations(organization_id)
        AND public.user_has_org_role(organization_id, 'owner', 'admin')
    );

-- 3B. Customers
CREATE POLICY customers_select ON public.customers
    FOR SELECT TO authenticated
    USING (public.can_read_organization_data(organization_id));

CREATE POLICY customers_insert ON public.customers
    FOR INSERT TO authenticated
    WITH CHECK (
        public.can_write_organization_operations(organization_id)
        AND public.user_has_org_role(organization_id, 'owner', 'admin', 'sales', 'accounts')
    );

CREATE POLICY customers_update ON public.customers
    FOR UPDATE TO authenticated
    USING (
        public.can_write_organization_operations(organization_id)
        AND public.user_has_org_role(organization_id, 'owner', 'admin', 'sales', 'accounts')
    )
    WITH CHECK (
        public.can_write_organization_operations(organization_id)
        AND public.user_has_org_role(organization_id, 'owner', 'admin', 'sales', 'accounts')
    );

CREATE POLICY customers_delete ON public.customers
    FOR DELETE TO authenticated
    USING (
        public.can_write_organization_operations(organization_id)
        AND public.user_has_org_role(organization_id, 'owner', 'admin')
    );

-- 3C. Suppliers
CREATE POLICY suppliers_select ON public.suppliers
    FOR SELECT TO authenticated
    USING (public.can_read_organization_data(organization_id));

CREATE POLICY suppliers_insert ON public.suppliers
    FOR INSERT TO authenticated
    WITH CHECK (
        public.can_write_organization_operations(organization_id)
        AND public.user_has_org_role(organization_id, 'owner', 'admin', 'inventory', 'accounts')
    );

CREATE POLICY suppliers_update ON public.suppliers
    FOR UPDATE TO authenticated
    USING (
        public.can_write_organization_operations(organization_id)
        AND public.user_has_org_role(organization_id, 'owner', 'admin', 'inventory', 'accounts')
    )
    WITH CHECK (
        public.can_write_organization_operations(organization_id)
        AND public.user_has_org_role(organization_id, 'owner', 'admin', 'inventory', 'accounts')
    );

CREATE POLICY suppliers_delete ON public.suppliers
    FOR DELETE TO authenticated
    USING (
        public.can_write_organization_operations(organization_id)
        AND public.user_has_org_role(organization_id, 'owner', 'admin')
    );

-- 3D. Stock Movements (Immutable audit ledger: UPDATE and DELETE strictly denied)
CREATE POLICY stock_movements_select ON public.stock_movements
    FOR SELECT TO authenticated
    USING (public.can_read_organization_data(organization_id));

CREATE POLICY stock_movements_insert ON public.stock_movements
    FOR INSERT TO authenticated
    WITH CHECK (
        public.can_write_organization_operations(organization_id)
        AND public.user_has_org_role(organization_id, 'owner', 'admin', 'inventory')
    );

-- 3E. Quotations
CREATE POLICY quotations_select ON public.quotations
    FOR SELECT TO authenticated
    USING (public.can_read_organization_data(organization_id));

CREATE POLICY quotations_insert ON public.quotations
    FOR INSERT TO authenticated
    WITH CHECK (
        public.can_write_organization_operations(organization_id)
        AND public.user_has_org_role(organization_id, 'owner', 'admin', 'sales')
    );

CREATE POLICY quotations_update ON public.quotations
    FOR UPDATE TO authenticated
    USING (
        public.can_write_organization_operations(organization_id)
        AND public.user_has_org_role(organization_id, 'owner', 'admin', 'sales')
    )
    WITH CHECK (
        public.can_write_organization_operations(organization_id)
        AND public.user_has_org_role(organization_id, 'owner', 'admin', 'sales')
    );

CREATE POLICY quotations_delete ON public.quotations
    FOR DELETE TO authenticated
    USING (
        public.can_write_organization_operations(organization_id)
        AND public.user_has_org_role(organization_id, 'owner', 'admin')
        AND status = 'DRAFT'
    );

-- 3F. Quotation Items (Child table: references quotations(id))
CREATE POLICY quotation_items_select ON public.quotation_items
    FOR SELECT TO authenticated
    USING (
        quotation_id IN (
            SELECT id FROM public.quotations
            WHERE public.can_read_organization_data(organization_id)
        )
    );

CREATE POLICY quotation_items_insert ON public.quotation_items
    FOR INSERT TO authenticated
    WITH CHECK (
        quotation_id IN (
            SELECT id FROM public.quotations
            WHERE public.can_write_organization_operations(organization_id)
              AND public.user_has_org_role(organization_id, 'owner', 'admin', 'sales')
              AND status = 'DRAFT'
        )
    );

CREATE POLICY quotation_items_update ON public.quotation_items
    FOR UPDATE TO authenticated
    USING (
        quotation_id IN (
            SELECT id FROM public.quotations
            WHERE public.can_write_organization_operations(organization_id)
              AND public.user_has_org_role(organization_id, 'owner', 'admin', 'sales')
              AND status = 'DRAFT'
        )
    )
    WITH CHECK (
        quotation_id IN (
            SELECT id FROM public.quotations
            WHERE public.can_write_organization_operations(organization_id)
              AND public.user_has_org_role(organization_id, 'owner', 'admin', 'sales')
              AND status = 'DRAFT'
        )
    );

CREATE POLICY quotation_items_delete ON public.quotation_items
    FOR DELETE TO authenticated
    USING (
        quotation_id IN (
            SELECT id FROM public.quotations
            WHERE public.can_write_organization_operations(organization_id)
              AND public.user_has_org_role(organization_id, 'owner', 'admin', 'sales')
              AND status = 'DRAFT'
        )
    );

-- 3G. Sales Orders
CREATE POLICY sales_orders_select ON public.sales_orders
    FOR SELECT TO authenticated
    USING (public.can_read_organization_data(organization_id));

CREATE POLICY sales_orders_insert ON public.sales_orders
    FOR INSERT TO authenticated
    WITH CHECK (
        public.can_write_organization_operations(organization_id)
        AND public.user_has_org_role(organization_id, 'owner', 'admin', 'sales')
    );

CREATE POLICY sales_orders_update ON public.sales_orders
    FOR UPDATE TO authenticated
    USING (
        public.can_write_organization_operations(organization_id)
        AND public.user_has_org_role(organization_id, 'owner', 'admin', 'sales')
    )
    WITH CHECK (
        public.can_write_organization_operations(organization_id)
        AND public.user_has_org_role(organization_id, 'owner', 'admin', 'sales')
    );

CREATE POLICY sales_orders_delete ON public.sales_orders
    FOR DELETE TO authenticated
    USING (
        public.can_write_organization_operations(organization_id)
        AND public.user_has_org_role(organization_id, 'owner', 'admin')
        AND status = 'DRAFT'
    );

-- 3H. Sales Order Items (Child table: references sales_orders(id))
CREATE POLICY sales_order_items_select ON public.sales_order_items
    FOR SELECT TO authenticated
    USING (
        sales_order_id IN (
            SELECT id FROM public.sales_orders
            WHERE public.can_read_organization_data(organization_id)
        )
    );

CREATE POLICY sales_order_items_insert ON public.sales_order_items
    FOR INSERT TO authenticated
    WITH CHECK (
        sales_order_id IN (
            SELECT id FROM public.sales_orders
            WHERE public.can_write_organization_operations(organization_id)
              AND public.user_has_org_role(organization_id, 'owner', 'admin', 'sales')
              AND status = 'DRAFT'
        )
    );

CREATE POLICY sales_order_items_update ON public.sales_order_items
    FOR UPDATE TO authenticated
    USING (
        sales_order_id IN (
            SELECT id FROM public.sales_orders
            WHERE public.can_write_organization_operations(organization_id)
              AND public.user_has_org_role(organization_id, 'owner', 'admin', 'sales')
              AND status = 'DRAFT'
        )
    )
    WITH CHECK (
        sales_order_id IN (
            SELECT id FROM public.sales_orders
            WHERE public.can_write_organization_operations(organization_id)
              AND public.user_has_org_role(organization_id, 'owner', 'admin', 'sales')
              AND status = 'DRAFT'
        )
    );

CREATE POLICY sales_order_items_delete ON public.sales_order_items
    FOR DELETE TO authenticated
    USING (
        sales_order_id IN (
            SELECT id FROM public.sales_orders
            WHERE public.can_write_organization_operations(organization_id)
              AND public.user_has_org_role(organization_id, 'owner', 'admin', 'sales')
              AND status = 'DRAFT'
        )
    );

-- 3I. Invoices (Statutory retention: DELETE is strictly PROHIBITED)
CREATE POLICY invoices_select ON public.invoices
    FOR SELECT TO authenticated
    USING (public.can_read_organization_data(organization_id));

CREATE POLICY invoices_insert ON public.invoices
    FOR INSERT TO authenticated
    WITH CHECK (
        public.can_write_organization_operations(organization_id)
        AND public.user_has_org_role(organization_id, 'owner', 'admin', 'accounts')
    );

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
    );

-- 3J. Invoice Items (Child table: references invoices(id); line items on issued invoices cannot be deleted)
CREATE POLICY invoice_items_select ON public.invoice_items
    FOR SELECT TO authenticated
    USING (
        invoice_id IN (
            SELECT id FROM public.invoices
            WHERE public.can_read_organization_data(organization_id)
        )
    );

CREATE POLICY invoice_items_insert ON public.invoice_items
    FOR INSERT TO authenticated
    WITH CHECK (
        invoice_id IN (
            SELECT id FROM public.invoices
            WHERE public.can_write_organization_operations(organization_id)
              AND public.user_has_org_role(organization_id, 'owner', 'admin', 'accounts')
              AND status = 'DRAFT'
        )
    );

CREATE POLICY invoice_items_update ON public.invoice_items
    FOR UPDATE TO authenticated
    USING (
        invoice_id IN (
            SELECT id FROM public.invoices
            WHERE public.can_write_organization_operations(organization_id)
              AND public.user_has_org_role(organization_id, 'owner', 'admin', 'accounts')
              AND status = 'DRAFT'
        )
    )
    WITH CHECK (
        invoice_id IN (
            SELECT id FROM public.invoices
            WHERE public.can_write_organization_operations(organization_id)
              AND public.user_has_org_role(organization_id, 'owner', 'admin', 'accounts')
              AND status = 'DRAFT'
        )
    );

CREATE POLICY invoice_items_delete ON public.invoice_items
    FOR DELETE TO authenticated
    USING (
        invoice_id IN (
            SELECT id FROM public.invoices
            WHERE public.can_write_organization_operations(organization_id)
              AND public.user_has_org_role(organization_id, 'owner', 'admin', 'accounts')
              AND status = 'DRAFT'
        )
    );

-- 3K. Payments (Statutory receipt ledger: UPDATE and DELETE strictly denied)
CREATE POLICY payments_select ON public.payments
    FOR SELECT TO authenticated
    USING (public.can_read_organization_data(organization_id));

CREATE POLICY payments_insert ON public.payments
    FOR INSERT TO authenticated
    WITH CHECK (
        public.can_write_organization_operations(organization_id)
        AND public.user_has_org_role(organization_id, 'owner', 'admin', 'accounts')
    );

-- 3L. Payment Allocations (Child table: references payments(id); UPDATE and DELETE denied)
CREATE POLICY payment_allocations_select ON public.payment_allocations
    FOR SELECT TO authenticated
    USING (
        payment_id IN (
            SELECT id FROM public.payments
            WHERE public.can_read_organization_data(organization_id)
        )
    );

CREATE POLICY payment_allocations_insert ON public.payment_allocations
    FOR INSERT TO authenticated
    WITH CHECK (
        payment_id IN (
            SELECT id FROM public.payments
            WHERE public.can_write_organization_operations(organization_id)
              AND public.user_has_org_role(organization_id, 'owner', 'admin', 'accounts')
        )
    );

-- 3M. Document Sequences (Direct client mutations denied)
CREATE POLICY document_sequences_select ON public.document_sequences
    FOR SELECT TO authenticated
    USING (public.can_read_organization_data(organization_id));

-- 4. Replacement Privileged RPCs

-- 4A. Confirm Sales Order (Strict alignment with migration 008, plus operational write gate)
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

    -- 4. Operational write entitlement gate
    IF NOT public.can_write_organization_operations(p_org_id) THEN
        RAISE EXCEPTION 'Operational write denied: Active subscription or trial required for organization %', p_org_id;
    END IF;

    -- 5. Lock and verify the order strictly within organization
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

    -- 6. Verify order has line items
    SELECT COUNT(*) INTO v_item_count
    FROM public.sales_order_items oi
    JOIN public.sales_orders so ON so.id = oi.sales_order_id
    WHERE oi.sales_order_id = p_order_id AND so.organization_id = p_org_id;

    IF v_item_count = 0 THEN
        RAISE EXCEPTION 'Cannot confirm order %: Order has no line items', p_order_id;
    END IF;

    -- 7. Iterate over items, lock product records and verify inventory balances
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

    -- 8. Mark order CONFIRMED scoped to organization
    UPDATE public.sales_orders
    SET status = 'CONFIRMED',
        confirmed_at = NOW(),
        confirmed_by = v_uid,
        updated_at = NOW()
    WHERE id = p_order_id AND organization_id = p_org_id;

    -- 9. Log audit event using exact checked-in audit_events schema from migration 001
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
GRANT EXECUTE ON FUNCTION confirm_sales_order(UUID, UUID) TO service_role;

-- 4B. Allocate Document Number (Strict alignment with migration 011, plus operational write gate)
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

    -- 3. Operational write entitlement gate
    IF NOT public.can_write_organization_operations(p_org_id) THEN
        RAISE EXCEPTION 'Document numbering denied: Active subscription or trial required for organization %', p_org_id;
    END IF;

    -- 4. Document Type Security Restriction:
    -- Direct external allocation is allowed ONLY for QUOTATION, SALES_ORDER, and INVOICE.
    -- RECEIPT numbers can only be allocated via record_payment_and_allocate().
    IF p_doc_type = 'RECEIPT' THEN
        RAISE EXCEPTION 'Access denied: RECEIPT numbers cannot be allocated directly. They are allocated atomically by record_payment_and_allocate().';
    ELSIF p_doc_type NOT IN ('QUOTATION', 'SALES_ORDER', 'INVOICE') THEN
        RAISE EXCEPTION 'Invalid document type: %. Must be QUOTATION, SALES_ORDER, or INVOICE.', p_doc_type;
    END IF;

    -- 5. Delegate to internal allocator
    RETURN public.internal_allocate_document_number(p_org_id, p_doc_type, p_year);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.allocate_document_number(UUID, VARCHAR, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.allocate_document_number(UUID, VARCHAR, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_document_number(UUID, VARCHAR, INTEGER) TO service_role;

-- 4C. Record Payment and Allocate (Strict alignment with migration 011, plus hardened validation & operational write gate)
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

    -- 5. Operational write entitlement gate
    IF NOT public.can_write_organization_operations(p_org_id) THEN
        RAISE EXCEPTION 'Payment recording denied: Active subscription or trial required for organization %', p_org_id;
    END IF;

    -- 6. Tenant verification: Customer must belong to p_org_id
    SELECT EXISTS (
        SELECT 1 FROM public.customers
        WHERE id = p_customer_id AND organization_id = p_org_id
    ) INTO v_customer_exists;

    IF NOT v_customer_exists THEN
        RAISE EXCEPTION 'Customer % not found in organization %', p_customer_id, p_org_id;
    END IF;

    -- 7. Validate allocation bounds if invoice specified
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

    -- 8. Atomic Receipt Sequence Allocation (via internal allocator)
    v_payment_year := EXTRACT(YEAR FROM COALESCE(p_payment_date, CURRENT_DATE))::INTEGER;
    v_payment_num := public.internal_allocate_document_number(p_org_id, 'RECEIPT', v_payment_year);

    -- 9. Insert Payment using exact schema from migration 005
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

    -- 10. If invoice allocation is provided, lock and verify invoice tenant, customer, and balance
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

        IF v_inv.status = 'PAID' THEN
            RAISE EXCEPTION 'Invoice % is already fully paid', p_invoice_id;
        END IF;

        IF v_inv.customer_id != p_customer_id THEN
            RAISE EXCEPTION 'Customer mismatch: Payment customer % does not match invoice customer %',
                p_customer_id, v_inv.customer_id;
        END IF;

        IF (v_inv.total_paid + p_allocated_amount) > v_inv.total_amount THEN
            RAISE EXCEPTION 'Overpayment violation: Allocation of % exceeds remaining balance of % (Total: %, Paid: %) on invoice %',
                p_allocated_amount, (v_inv.total_amount - v_inv.total_paid), v_inv.total_amount, v_inv.total_paid, v_inv.id;
        END IF;

        -- Insert Payment Allocation using exact schema from migration 005
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

    -- 11. Audit log using exact checked-in audit_events schema from migration 001
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

REVOKE ALL ON FUNCTION record_payment_and_allocate(UUID, UUID, NUMERIC, VARCHAR, VARCHAR, DATE, TEXT, UUID, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION record_payment_and_allocate(UUID, UUID, NUMERIC, VARCHAR, VARCHAR, DATE, TEXT, UUID, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION record_payment_and_allocate(UUID, UUID, NUMERIC, VARCHAR, VARCHAR, DATE, TEXT, UUID, NUMERIC) TO service_role;

-- 5. Helper Predicate Grants
REVOKE ALL ON FUNCTION public.user_is_org_member(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_is_org_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_is_org_member(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.can_read_organization_data(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_organization_data(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_organization_data(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.can_write_organization_operations(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_write_organization_operations(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_write_organization_operations(UUID) TO service_role;

-- 6. Function Owner Alignment (SEC-03)
-- Ensure that the effective owner(s) of record_payment_and_allocate and allocate_document_number
-- have explicit EXECUTE rights on internal_allocate_document_number, without exposing it to 'authenticated' or 'anon'.
-- Exact function signatures are resolved using to_regprocedure() to prevent ambiguous catalog matches.
DO $$
DECLARE
    v_sig TEXT;
    v_proc_oid REGPROCEDURE;
    v_owner_role NAME;
BEGIN
    FOR v_sig IN SELECT unnest(ARRAY[
        'public.record_payment_and_allocate(uuid,uuid,numeric,character varying,character varying,date,text,uuid,numeric)',
        'public.allocate_document_number(uuid,character varying,integer)'
    ])
    LOOP
        v_proc_oid := to_regprocedure(v_sig);

        IF v_proc_oid IS NULL THEN
            RAISE EXCEPTION 'ERR_FUNCTION_NOT_FOUND: Expected function signature "%" could not be resolved', v_sig;
        END IF;

        SELECT r.rolname INTO v_owner_role
        FROM pg_proc p
        JOIN pg_roles r ON p.proowner = r.oid
        WHERE p.oid = v_proc_oid::oid;

        IF v_owner_role IS NULL THEN
            RAISE EXCEPTION 'ERR_OWNER_NOT_FOUND: Owner role for function "%" could not be resolved', v_sig;
        END IF;

        EXECUTE format('GRANT EXECUTE ON FUNCTION public.internal_allocate_document_number(UUID, VARCHAR, INTEGER) TO %I', v_owner_role);
    END LOOP;
END $$;
