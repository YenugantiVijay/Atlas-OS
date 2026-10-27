-- ============================================================================
-- MIGRATION 004: Quotations, Sales Orders, & Atomic Order Confirmation RPC
-- ============================================================================

-- Quotations
CREATE TABLE IF NOT EXISTS quotations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    quotation_number VARCHAR(100) NOT NULL,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    status VARCHAR(50) NOT NULL DEFAULT 'DRAFT' CHECK (
        status IN ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CONVERTED')
    ),
    valid_until DATE NOT NULL,
    subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    notes TEXT,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(organization_id, quotation_number)
);

CREATE INDEX IF NOT EXISTS idx_quotations_org_customer ON quotations(organization_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_quotations_org_status ON quotations(organization_id, status);

-- Quotation Line Items
CREATE TABLE IF NOT EXISTS quotation_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quotation_id UUID NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    product_name VARCHAR(255) NOT NULL, -- Commercial snapshot
    product_sku VARCHAR(100) NOT NULL,  -- Commercial snapshot
    uom VARCHAR(50) NOT NULL DEFAULT 'Nos',
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
    discount_percent NUMERIC(5, 2) NOT NULL DEFAULT 0.00 CHECK (discount_percent >= 0 AND discount_percent <= 100),
    tax_rate NUMERIC(5, 2) NOT NULL DEFAULT 18.00 CHECK (tax_rate >= 0),
    line_subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    line_tax NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    line_total NUMERIC(12, 2) NOT NULL DEFAULT 0.00
);

CREATE INDEX IF NOT EXISTS idx_quotation_items_qid ON quotation_items(quotation_id);

-- Sales Orders
CREATE TABLE IF NOT EXISTS sales_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    order_number VARCHAR(100) NOT NULL,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    quotation_id UUID REFERENCES quotations(id) ON DELETE SET NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'DRAFT' CHECK (
        status IN ('DRAFT', 'CONFIRMED', 'FULFILLED', 'CANCELLED')
    ),
    order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    notes TEXT,
    created_by UUID,
    confirmed_at TIMESTAMPTZ,
    confirmed_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(organization_id, order_number)
);

CREATE INDEX IF NOT EXISTS idx_sales_orders_org_customer ON sales_orders(organization_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_orders_org_status ON sales_orders(organization_id, status);

-- Sales Order Line Items
CREATE TABLE IF NOT EXISTS sales_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sales_order_id UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    product_name VARCHAR(255) NOT NULL, -- Commercial snapshot
    product_sku VARCHAR(100) NOT NULL,  -- Commercial snapshot
    uom VARCHAR(50) NOT NULL DEFAULT 'Nos',
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
    discount_percent NUMERIC(5, 2) NOT NULL DEFAULT 0.00 CHECK (discount_percent >= 0 AND discount_percent <= 100),
    tax_rate NUMERIC(5, 2) NOT NULL DEFAULT 18.00 CHECK (tax_rate >= 0),
    line_subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    line_tax NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    line_total NUMERIC(12, 2) NOT NULL DEFAULT 0.00
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON sales_order_items(sales_order_id);

-- RLS Enforcement
ALTER TABLE quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_order_items ENABLE ROW LEVEL SECURITY;

-- Quotations Policies
CREATE POLICY "Users can view quotations of their organization"
ON quotations FOR SELECT
USING (
    organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND is_active = TRUE)
);

CREATE POLICY "Sales and admins can manage quotations"
ON quotations FOR ALL
USING (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'sales')
);

CREATE POLICY "Users can view quotation items"
ON quotation_items FOR SELECT
USING (
    quotation_id IN (
        SELECT id FROM quotations WHERE organization_id IN (
            SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND is_active = TRUE
        )
    )
);

CREATE POLICY "Sales and admins can manage quotation items"
ON quotation_items FOR ALL
USING (
    quotation_id IN (
        SELECT id FROM quotations WHERE get_user_org_role(organization_id) IN ('owner', 'admin', 'sales')
    )
);

-- Sales Orders Policies
CREATE POLICY "Users can view sales orders of their organization"
ON sales_orders FOR SELECT
USING (
    organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND is_active = TRUE)
);

CREATE POLICY "Sales and admins can manage sales orders"
ON sales_orders FOR ALL
USING (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'sales')
);

CREATE POLICY "Users can view sales order items"
ON sales_order_items FOR SELECT
USING (
    sales_order_id IN (
        SELECT id FROM sales_orders WHERE organization_id IN (
            SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND is_active = TRUE
        )
    )
);

CREATE POLICY "Sales and admins can manage sales order items"
ON sales_order_items FOR ALL
USING (
    sales_order_id IN (
        SELECT id FROM sales_orders WHERE get_user_org_role(organization_id) IN ('owner', 'admin', 'sales')
    )
);

-- ============================================================================
-- ATOMIC ORDER CONFIRMATION RPC
-- Enforces permissions, locks stock, prevents overselling, writes movements,
-- and updates status inside a single ACID database transaction.
-- ============================================================================
CREATE OR REPLACE FUNCTION confirm_sales_order(p_order_id UUID, p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_role VARCHAR(50);
    v_order_status VARCHAR(50);
    v_item RECORD;
    v_available_stock INTEGER;
BEGIN
    -- 1. Verify caller permission
    v_user_role := get_user_org_role(p_org_id);
    IF v_user_role NOT IN ('owner', 'admin', 'sales') THEN
        RAISE EXCEPTION 'Unauthorized: Caller has insufficient role (%) to confirm orders', v_user_role;
    END IF;

    -- 2. Lock and verify the order
    SELECT status INTO v_order_status
    FROM sales_orders
    WHERE id = p_order_id AND organization_id = p_org_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sales order % not found in organization %', p_order_id, p_org_id;
    END IF;

    IF v_order_status != 'DRAFT' THEN
        RAISE EXCEPTION 'Order % cannot be confirmed because status is %', p_order_id, v_order_status;
    END IF;

    -- 3. Iterate over items, lock product records and check inventory balances
    FOR v_item IN
        SELECT oi.product_id, oi.quantity, oi.product_name, oi.product_sku
        FROM sales_order_items oi
        WHERE oi.sales_order_id = p_order_id
    LOOP
        -- Row lock on product to serialize concurrent orders
        PERFORM id FROM products WHERE id = v_item.product_id FOR UPDATE;

        -- Get current available stock
        v_available_stock := get_product_stock(v_item.product_id, p_org_id);

        IF v_available_stock < v_item.quantity THEN
            RAISE EXCEPTION 'Insufficient stock for product "%" (SKU: %). Available: %, Requested: %',
                v_item.product_name, v_item.product_sku, v_available_stock, v_item.quantity;
        END IF;

        -- 4. Record stock deduction movement
        INSERT INTO stock_movements (
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

    -- 5. Mark order CONFIRMED
    UPDATE sales_orders
    SET status = 'CONFIRMED',
        confirmed_at = NOW(),
        confirmed_by = auth.uid(),
        updated_at = NOW()
    WHERE id = p_order_id;

    -- 6. Log audit event
    INSERT INTO audit_events (
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
