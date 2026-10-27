-- ============================================================================
-- MIGRATION 003: Inventory Ledger & Stock Movement System
-- ============================================================================

CREATE TABLE IF NOT EXISTS stock_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity_change INTEGER NOT NULL, -- Negative for deductions, positive for additions
    movement_type VARCHAR(50) NOT NULL CHECK (
        movement_type IN (
            'OPENING_STOCK',
            'GOODS_RECEIVED',
            'SALES_DISPATCH',
            'RETURN_INWARD',
            'ADJUSTMENT',
            'REVERSAL'
        )
    ),
    reference_type VARCHAR(50), -- e.g. 'SALES_ORDER', 'PURCHASE_RECEIPT', 'MANUAL_ADJUSTMENT'
    reference_id UUID,
    actor_id UUID,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_org_product ON stock_movements(organization_id, product_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_created ON stock_movements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_ref ON stock_movements(reference_type, reference_id);

-- Current Product Stock Calculation Function
CREATE OR REPLACE FUNCTION get_product_stock(p_product_id UUID, p_org_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_total INTEGER;
BEGIN
    SELECT COALESCE(SUM(quantity_change), 0)
    INTO v_total
    FROM stock_movements
    WHERE product_id = p_product_id
      AND organization_id = p_org_id;

    RETURN v_total;
END;
$$;

-- RLS Enforcement
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view stock movements of their organization"
ON stock_movements FOR SELECT
USING (
    organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND is_active = TRUE)
);

CREATE POLICY "Inventory staff and admins can insert stock movements"
ON stock_movements FOR INSERT
WITH CHECK (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'inventory')
);
