-- ============================================================================
-- MIGRATION 002: Products, Customers, & Suppliers for Electrical Distribution
-- ============================================================================

-- Products Table
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    sku VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    brand VARCHAR(100),
    category VARCHAR(100) NOT NULL,
    description TEXT,
    uom VARCHAR(50) NOT NULL DEFAULT 'Nos', -- Nos, Meters, Coils, Boxes, Sets
    purchase_cost NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (purchase_cost >= 0),
    selling_price NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (selling_price >= 0),
    tax_rate NUMERIC(5, 2) NOT NULL DEFAULT 18.00 CHECK (tax_rate >= 0), -- GST rate (e.g. 18.00%)
    hsn_code VARCHAR(20), -- e.g., 8544 for insulated wire/cable, 8536 for switches/relays
    reorder_threshold INTEGER NOT NULL DEFAULT 10 CHECK (reorder_threshold >= 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(organization_id, sku)
);

CREATE INDEX IF NOT EXISTS idx_products_org_category ON products(organization_id, category);
CREATE INDEX IF NOT EXISTS idx_products_org_active ON products(organization_id, is_active);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(organization_id, sku);

-- Customers Table
CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    name VARCHAR(255) NOT NULL,
    company_name VARCHAR(255),
    phone VARCHAR(50),
    email VARCHAR(255),
    billing_address TEXT,
    delivery_address TEXT,
    gstin VARCHAR(15),
    pan VARCHAR(10),
    credit_limit NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (credit_limit >= 0),
    credit_days INTEGER NOT NULL DEFAULT 30 CHECK (credit_days >= 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_org_name ON customers(organization_id, name);
CREATE INDEX IF NOT EXISTS idx_customers_org_active ON customers(organization_id, is_active);

-- Suppliers Table
CREATE TABLE IF NOT EXISTS suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    name VARCHAR(255) NOT NULL,
    company_name VARCHAR(255),
    contact_person VARCHAR(100),
    phone VARCHAR(50),
    email VARCHAR(255),
    address TEXT,
    gstin VARCHAR(15),
    pan VARCHAR(10),
    payment_terms TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_suppliers_org_name ON suppliers(organization_id, name);

-- RLS Enforcement
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

-- Products Policies
CREATE POLICY "Users can view products of their organization"
ON products FOR SELECT
USING (
    organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND is_active = TRUE)
);

CREATE POLICY "Inventory and admins can manage products"
ON products FOR ALL
USING (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'inventory')
);

-- Customers Policies
CREATE POLICY "Users can view customers of their organization"
ON customers FOR SELECT
USING (
    organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND is_active = TRUE)
);

CREATE POLICY "Sales, accounts and admins can manage customers"
ON customers FOR ALL
USING (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'sales', 'accounts')
);

-- Suppliers Policies
CREATE POLICY "Users can view suppliers of their organization"
ON suppliers FOR SELECT
USING (
    organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND is_active = TRUE)
);

CREATE POLICY "Inventory, accounts and admins can manage suppliers"
ON suppliers FOR ALL
USING (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'inventory', 'accounts')
);
