-- ============================================================================
-- MIGRATION 005: Invoices, Payments, & Atomic Payment Allocation RPC
-- ============================================================================

-- Invoices
CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    invoice_number VARCHAR(100) NOT NULL,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    sales_order_id UUID REFERENCES sales_orders(id) ON DELETE SET NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'DRAFT' CHECK (
        status IN ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED')
    ),
    invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date DATE NOT NULL,
    subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    total_paid NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    notes TEXT,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(organization_id, invoice_number)
);

CREATE INDEX IF NOT EXISTS idx_invoices_org_customer ON invoices(organization_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_org_status ON invoices(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices(organization_id, due_date);

-- Invoice Line Items
CREATE TABLE IF NOT EXISTS invoice_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id) ON DELETE RESTRICT,
    product_name VARCHAR(255) NOT NULL,
    product_sku VARCHAR(100) NOT NULL,
    hsn_code VARCHAR(20),
    uom VARCHAR(50) NOT NULL DEFAULT 'Nos',
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
    discount_percent NUMERIC(5, 2) NOT NULL DEFAULT 0.00 CHECK (discount_percent >= 0 AND discount_percent <= 100),
    tax_rate NUMERIC(5, 2) NOT NULL DEFAULT 18.00 CHECK (tax_rate >= 0),
    line_subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    line_tax NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    line_total NUMERIC(12, 2) NOT NULL DEFAULT 0.00
);

CREATE INDEX IF NOT EXISTS idx_invoice_items_inv_id ON invoice_items(invoice_id);

-- Payments
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    payment_number VARCHAR(100) NOT NULL,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    payment_method VARCHAR(50) NOT NULL CHECK (
        payment_method IN ('CASH', 'UPI', 'NEFT', 'RTGS', 'CHEQUE', 'BANK_TRANSFER')
    ),
    reference_number VARCHAR(100), -- UPI txn id, UTR number, Cheque number
    payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    notes TEXT,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(organization_id, payment_number)
);

CREATE INDEX IF NOT EXISTS idx_payments_org_customer ON payments(organization_id, customer_id);

-- Payment Allocations
CREATE TABLE IF NOT EXISTS payment_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    amount_allocated NUMERIC(12, 2) NOT NULL CHECK (amount_allocated > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_allocations_inv ON payment_allocations(invoice_id);

-- RLS Enforcement
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_allocations ENABLE ROW LEVEL SECURITY;

-- Invoices Policies
CREATE POLICY "Users can view invoices of their organization"
ON invoices FOR SELECT
USING (
    organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND is_active = TRUE)
);

CREATE POLICY "Accounts and admins can manage invoices"
ON invoices FOR ALL
USING (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'accounts')
);

CREATE POLICY "Users can view invoice items"
ON invoice_items FOR SELECT
USING (
    invoice_id IN (
        SELECT id FROM invoices WHERE organization_id IN (
            SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND is_active = TRUE
        )
    )
);

CREATE POLICY "Accounts and admins can manage invoice items"
ON invoice_items FOR ALL
USING (
    invoice_id IN (
        SELECT id FROM invoices WHERE get_user_org_role(organization_id) IN ('owner', 'admin', 'accounts')
    )
);

-- Payments Policies
CREATE POLICY "Users can view payments of their organization"
ON payments FOR SELECT
USING (
    organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND is_active = TRUE)
);

CREATE POLICY "Accounts and admins can manage payments"
ON payments FOR ALL
USING (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'accounts')
);

CREATE POLICY "Users can view payment allocations"
ON payment_allocations FOR SELECT
USING (
    payment_id IN (
        SELECT id FROM payments WHERE organization_id IN (
            SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND is_active = TRUE
        )
    )
);

CREATE POLICY "Accounts and admins can manage payment allocations"
ON payment_allocations FOR ALL
USING (
    payment_id IN (
        SELECT id FROM payments WHERE get_user_org_role(organization_id) IN ('owner', 'admin', 'accounts')
    )
);

-- ============================================================================
-- ATOMIC PAYMENT RECORDING & ALLOCATION RPC
-- Records payment and updates affected invoices in one transaction.
-- ============================================================================
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
SET search_path = public
AS $$
DECLARE
    v_user_role VARCHAR(50);
    v_payment_id UUID;
    v_inv RECORD;
    v_new_paid NUMERIC(12, 2);
    v_new_status VARCHAR(50);
    v_payment_num VARCHAR(100);
BEGIN
    -- 1. Verify permissions
    v_user_role := get_user_org_role(p_org_id);
    IF v_user_role NOT IN ('owner', 'admin', 'accounts') THEN
        RAISE EXCEPTION 'Unauthorized: Caller has insufficient role (%) to record payments', v_user_role;
    END IF;

    IF p_amount <= 0 OR p_allocated_amount <= 0 OR p_allocated_amount > p_amount THEN
        RAISE EXCEPTION 'Invalid payment or allocation amount';
    END IF;

    -- Generate payment number
    v_payment_num := 'PAY-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');

    -- Insert Payment
    INSERT INTO payments (
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

    -- If invoice allocation is provided
    IF p_invoice_id IS NOT NULL THEN
        SELECT id, total_amount, total_paid, status
        INTO v_inv
        FROM invoices
        WHERE id = p_invoice_id AND organization_id = p_org_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Invoice % not found in organization %', p_invoice_id, p_org_id;
        END IF;

        IF (v_inv.total_paid + p_allocated_amount) > v_inv.total_amount THEN
            RAISE EXCEPTION 'Allocation % exceeds remaining balance of % on invoice %',
                p_allocated_amount, (v_inv.total_amount - v_inv.total_paid), v_inv.id;
        END IF;

        -- Record allocation
        INSERT INTO payment_allocations (
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

        UPDATE invoices
        SET total_paid = v_new_paid,
            status = v_new_status,
            updated_at = NOW()
        WHERE id = p_invoice_id;
    END IF;

    -- Audit log
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
        'RECORD_PAYMENT',
        'PAYMENT',
        v_payment_id,
        jsonb_build_object('payment_number', v_payment_num, 'amount', p_amount, 'invoice_id', p_invoice_id)
    );

    RETURN jsonb_build_object('success', true, 'payment_id', v_payment_id, 'payment_number', v_payment_num);
END;
$$;
