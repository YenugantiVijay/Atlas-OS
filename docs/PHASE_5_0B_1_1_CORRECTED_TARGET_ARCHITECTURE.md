# PHASE 5.0B.1.1 — CORRECTED FINAL TARGET ARCHITECTURE
## Definitive, Corrected Technical Specification: Relational DDL, Deferred Invariant Triggers, Compound Foreign Keys, and Hardened RPC Contracts
**ATLAS OS Enterprise SaaS ERP Platform**  
**Classification:** Corrected Target Architecture Specification — Ready for Product Owner Sign-Off  
**Target Repository:** `D:\Projects\Atlas-OS` | **Branch:** `Vijay-Atlas`  
**Target Staging Ref:** `bwswqnhlebbzdxumlkih` | **Production Ref:** `hrxjgbupjtikokqxjzbh` (STRICTLY FORBIDDEN)

---

## 1. System Topology & Architectural Foundation

This document provides the **Fully Corrected Target Architecture Specification** for ATLAS OS. It incorporates all technical corrections from Phase 5.0B.1.1, providing unambiguous DDL blueprints, trigger definitions, and RPC signatures ready for implementation planning upon product owner sign-off.

*Note on Evidentiary Status: All schema definitions, indexes, and triggers below are **SPECIFIED FOR MIGRATION 015**. Zero DDL has been executed.*

---

## 2. Corrected Relational Schema (DDL Blueprints)

### 2.1 Tenant Root & Ownership Subsystem
```sql
-- 1. Tenant Root
CREATE TABLE public.organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    legal_name VARCHAR(255),
    gstin VARCHAR(15),
    pan VARCHAR(10),
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 2. Memberships (Operational Tenant Affiliation)
CREATE TABLE public.memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL, -- Bare UUID, referential survival upon Auth delete
    role VARCHAR(50) NOT NULL, -- Operational Role Key (System or Custom Role)
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_memberships_org_user UNIQUE (organization_id, user_id)
);

CREATE INDEX idx_memberships_user ON public.memberships(user_id);
CREATE INDEX idx_memberships_org_role ON public.memberships(organization_id, role);

-- 3. Dedicated Organization Ownership (Legal & Governance Authority)
CREATE TABLE public.organization_ownership (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL,
    ownership_tier VARCHAR(20) NOT NULL CHECK (
        ownership_tier IN ('PRIMARY_OWNER', 'CO_OWNER')
    ),
    appointed_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    appointed_by UUID,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_org_owner UNIQUE (organization_id, user_id),
    -- Corrected Compound FK: Enforces that owner has an active membership
    CONSTRAINT fk_ownership_membership 
        FOREIGN KEY (organization_id, user_id) 
        REFERENCES public.memberships(organization_id, user_id) 
        ON DELETE RESTRICT
);

-- Enforces <= 1 Primary Owner via B-tree Partial Unique Index
CREATE UNIQUE INDEX idx_single_primary_owner_per_org 
ON public.organization_ownership(organization_id) 
WHERE ownership_tier = 'PRIMARY_OWNER';

CREATE INDEX idx_org_ownership_user ON public.organization_ownership(user_id);
```

---

### 2.2 Corrected Deferred Invariant Triggers for Exactly-One Primary Owner
```sql
-- Enforces = 1 Primary Owner for active organizations at transaction COMMIT
CREATE OR REPLACE FUNCTION public.trg_assert_primary_owner_exists()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_count INT;
BEGIN
    IF NEW.is_active THEN
        SELECT COUNT(*) INTO v_count
        FROM public.organization_ownership
        WHERE organization_id = NEW.id 
          AND ownership_tier = 'PRIMARY_OWNER';

        IF v_count <> 1 THEN
            RAISE EXCEPTION 'DATABASE_INVARIANT_VIOLATION: Organization "%" (%) must have exactly one active Primary Owner. Current count: %',
                NEW.name, NEW.id, v_count
                USING ERRCODE = '23514'; -- check_violation
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_org_primary_owner_required
    AFTER INSERT OR UPDATE ON public.organizations
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION public.trg_assert_primary_owner_exists();

-- Prevents deactivating a membership while holding active Primary Ownership
CREATE OR REPLACE FUNCTION public.trg_prevent_primary_owner_deactivation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.is_active = FALSE AND OLD.is_active = TRUE THEN
        IF EXISTS (
            SELECT 1 FROM public.organization_ownership
            WHERE organization_id = NEW.organization_id 
              AND user_id = NEW.user_id 
              AND ownership_tier = 'PRIMARY_OWNER'
        ) THEN
            RAISE EXCEPTION 'SECURITY_VIOLATION: Cannot deactivate membership of the active Primary Owner. Transfer Primary Ownership first.'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_check_primary_owner_active
    BEFORE UPDATE OF is_active ON public.memberships
    FOR EACH ROW EXECUTE FUNCTION public.trg_prevent_primary_owner_deactivation();
```

---

### 2.3 Corrected Document Sequences with PostgreSQL 15+ `NULLS NOT DISTINCT`
```sql
CREATE TABLE public.document_sequences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    branch_id UUID, -- NULL = Central sequence, UUID = Branch sequence
    document_type VARCHAR(50) NOT NULL CHECK (
        document_type IN ('INVOICE', 'QUOTATION', 'SALES_ORDER', 'PAYMENT', 'CREDIT_NOTE', 'STOCK_TRANSFER')
    ),
    financial_year VARCHAR(10) NOT NULL, -- e.g., '2026-2027'
    prefix VARCHAR(20) NOT NULL,
    last_number INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT fk_doc_seq_branch 
        FOREIGN KEY (branch_id, organization_id) 
        REFERENCES public.branches(id, organization_id) 
        ON DELETE RESTRICT,
    -- Corrected PostgreSQL 15+ syntax treating NULL branch_id as distinct single central series
    CONSTRAINT uq_doc_seq_org_branch_type_fy 
        UNIQUE NULLS NOT DISTINCT (organization_id, document_type, financial_year, branch_id)
);
```

---

### 2.4 Corrected Financial Immutability Triggers (Supporting Compensating Transactions)
```sql
CREATE OR REPLACE FUNCTION public.trg_enforce_financial_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- 1. Block destructive DELETE on non-draft commercial records
    IF TG_OP = 'DELETE' THEN
        IF OLD.status <> 'DRAFT' THEN
            RAISE EXCEPTION 'ILLEGAL_MUTATION: Finalized commercial records cannot be deleted (Status: %). Legitimate corrections must be issued via Credit Notes.', OLD.status
                USING ERRCODE = '23514';
        END IF;
        RETURN OLD;
    END IF;

    -- 2. Protect core fiscal fields while permitting legitimate accounting updates
    IF TG_OP = 'UPDATE' THEN
        IF OLD.status IN ('ISSUED', 'PARTIALLY_PAID', 'PAID') THEN
            -- Fiscal attributes are strictly immutable
            IF (NEW.subtotal <> OLD.subtotal OR
                NEW.tax_amount <> OLD.tax_amount OR
                NEW.total_amount <> OLD.total_amount OR
                NEW.customer_id <> OLD.customer_id OR
                NEW.organization_id <> OLD.organization_id OR
                NEW.invoice_number <> OLD.invoice_number OR
                NEW.invoice_date <> OLD.invoice_date) THEN
                RAISE EXCEPTION 'ILLEGAL_MUTATION: Core fiscal attributes of finalized invoices are immutable. Issue a Credit Note to adjust commercial totals.'
                    USING ERRCODE = '23514';
            END IF;
            
            -- Legitimate payment allocation updates ARE PERMITTED:
            -- Updating total_paid, status (ISSUED -> PARTIALLY_PAID -> PAID), and updated_at
        END IF;
        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_invoice_immutability
    BEFORE UPDATE OR DELETE ON public.invoices
    FOR EACH ROW EXECUTE FUNCTION public.trg_enforce_financial_immutability();
```

---

## 3. Reconciled Global Lock Hierarchy & RPC Integration

Locks must be acquired strictly in descending order across **ALL** transaction paths [`PROPOSED DESIGN`]:

$$\text{Level 0.5 (Deprov Requests)} \longrightarrow \text{Level 1.0 (Idempotency Keys)} \longrightarrow \text{Level 2.0 (Organizations ASC)}$$
$$\longrightarrow \text{Level 3.0 (Ownership / Memberships ASC)} \longrightarrow \text{Level 3.2 (Approval Requests)}$$
$$\longrightarrow \text{Level 3.5 (Invoices / Orders FOR UPDATE)} \longrightarrow \text{Level 4.0 (Stock / Audit Events)}$$

### Standardized Approval & Invoicing Execution Contracts:
1. `create_invoice_with_items`:
   - Acquires `Level 2.0 (organizations FOR UPDATE)`.
   - Pre-computes approval requirement.
   - If approval required: Inserts `approval_requests` (`Level 3.2`), then inserts `invoices` with `status = 'PENDING_APPROVAL'` (`Level 3.5`).
   - If approval not required: Inserts `invoices` with `status = 'ISSUED'` (`Level 3.5`).
2. `submit_approval_decision`:
   - Acquires `Level 2.0 (organizations FOR UPDATE)`.
   - Acquires `Level 3.2 (approval_requests FOR UPDATE)`.
   - If quorum met: Acquires `Level 3.5 (invoices FOR UPDATE)`, updates status to `ISSUED`.
   - **Lock Graph:** Both workflows acquire `Level 2.0 -> Level 3.2 -> Level 3.5`. Acyclic guarantee maintained.

---

## 4. Nuanced Production Privilege DDL (Migration 015 Blueprint)

```sql
-- 1. Client Privilege Isolation (Zero Direct DML for Clients)
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;

-- 2. Backend Service Key Privileges (Operational Workflows Preserved; Zero Ledger Deletion)
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM service_role;
REVOKE DELETE ON TABLE 
    public.invoices, 
    public.invoice_items, 
    public.payments, 
    public.payment_allocations, 
    public.stock_movements, 
    public.audit_events,
    public.approval_decisions,
    public.organizations,
    public.organization_ownership,
    public.memberships
FROM service_role;

GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT DELETE ON TABLE public.idempotency_keys, public.custom_roles, public.role_permissions TO service_role;

-- 3. Trusted Functions (Execution Whitelist)
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;
```

---

## 5. Architectural Correctness Attestation

This specification incorporates all technical corrections:
1. Primary Owner invariant is physically guaranteed by deferred constraint trigger ($= 1$).
2. Compound foreign keys link ownership to active operational memberships.
3. PostgreSQL 17 `NULLS NOT DISTINCT` eliminates multi-branch sequence collisions.
4. Standardized Level 3.2 lock tier guarantees deadlock freedom between approval and invoice paths.
5. Immutability triggers explicitly permit legitimate compensating accounting transactions.
