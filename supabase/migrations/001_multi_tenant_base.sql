-- ============================================================================
-- MIGRATION 001: Multi-tenant Base, Organizations, Memberships, & Audit Events
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Organizations (Tenants)
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    legal_name VARCHAR(255),
    gstin VARCHAR(15), -- 15-character Indian Goods & Services Tax Identification Number
    pan VARCHAR(10),
    phone VARCHAR(50),
    email VARCHAR(255),
    address_line1 TEXT,
    city VARCHAR(100),
    state VARCHAR(100),
    pincode VARCHAR(10),
    currency VARCHAR(3) DEFAULT 'INR',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Organization Memberships (User to Tenant relationship with RBAC)
CREATE TABLE IF NOT EXISTS memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('owner', 'admin', 'sales', 'inventory', 'accounts', 'viewer')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_user_id ON memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_org_role ON memberships(organization_id, role);

-- Audit Events (Immutable log)
CREATE TABLE IF NOT EXISTS audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    actor_id UUID,
    actor_email VARCHAR(255),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id UUID,
    details JSONB DEFAULT '{}'::jsonb,
    ip_address VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_events_org_created ON audit_events(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_entity ON audit_events(entity_type, entity_id);

-- Helper security function: Get current user's membership role in an organization
CREATE OR REPLACE FUNCTION get_user_org_role(p_org_id UUID)
RETURNS VARCHAR(50)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role VARCHAR(50);
BEGIN
    SELECT role INTO v_role
    FROM memberships
    WHERE organization_id = p_org_id
      AND user_id = auth.uid()
      AND is_active = TRUE;
    RETURN v_role;
END;
$$;

-- RLS Enforcement
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

-- Organizations Policies
CREATE POLICY "Users can view organizations they belong to"
ON organizations FOR SELECT
USING (
    id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND is_active = TRUE)
);

CREATE POLICY "Owners and admins can update their organization"
ON organizations FOR UPDATE
USING (
    get_user_org_role(id) IN ('owner', 'admin')
);

-- Memberships Policies
CREATE POLICY "Users can view memberships of their organizations"
ON memberships FOR SELECT
USING (
    organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND is_active = TRUE)
);

CREATE POLICY "Owners can manage organization memberships"
ON memberships FOR ALL
USING (
    get_user_org_role(organization_id) = 'owner'
);

-- Audit Events Policies (Read-only to members with elevated roles, insertable by system)
CREATE POLICY "Admins and owners can view audit logs"
ON audit_events FOR SELECT
USING (
    get_user_org_role(organization_id) IN ('owner', 'admin')
);

CREATE POLICY "Members can log audit events"
ON audit_events FOR INSERT
WITH CHECK (
    organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND is_active = TRUE)
);
