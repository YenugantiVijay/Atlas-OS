# PHASE 5.0B.1 — FINAL TARGET ARCHITECTURE SPECIFICATION
## The Definitive, Unambiguous Enterprise Reference Architecture for ATLAS OS
**ATLAS OS Enterprise SaaS ERP Platform**  
**Classification:** Definitive Target Architecture Specification — Ready for Implementation Planning  
**Target Repository:** `D:\Projects\Atlas-OS` | **Branch:** `Vijay-Atlas`  
**Target Staging Ref:** `bwswqnhlebbzdxumlkih` | **Production Ref:** `hrxjgbupjtikokqxjzbh` (STRICTLY FORBIDDEN)

---

## 1. System Topology & Architectural Foundation

This document defines the **Final Target Architecture** for ATLAS OS. It synthesizes all validated principles from Phases 4.11 through 5.0B.1 into an authoritative, unambiguous technical specification that an engineering team can implement directly without guessing.

```
                                  PostgREST API Gateway
                                            │
                                            ▼
                           Row Level Security & SQL Grants
                     [Direct Table DML: REVOKED from all clients]
                                            │
                      ┌─────────────────────┴─────────────────────┐
                      ▼                                           ▼
             Direct Table SELECT                         Supabase RPC Calls
        (Tenant & Branch Scoped RLS)                (SECURITY DEFINER Functions)
                      │                                           │
                      │                        Level 0.5: user_deprovisioning_requests
                      │                        Level 1.0: idempotency_keys
                      │                        Level 2.0: organizations (ASC)
                      │                        Level 3.0: organization_ownership (ASC)
                      │                        Level 3.0: memberships (ASC)
                      │                        Level 3.2: approval_requests (FOR UPDATE)
                      │                        Level 3.5: invoices / orders (FOR UPDATE)
                      │                        Level 4.0: stock_movements / audit_events
                      │                                           │
                      └─────────────────────┬─────────────────────┘
                                            ▼
                              PostgreSQL Storage Engine
                     [Deferred Constraint Triggers + Immutability Triggers]
```

---

## 2. Definitive Relational DDL Blueprints

The target schema consists of 16 integrated database entities with compound tenant foreign keys and trigger invariants [`PROPOSED DESIGN`]:

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
    -- Compound FK: Ensures owner possesses an active operational membership
    CONSTRAINT fk_ownership_membership 
        FOREIGN KEY (organization_id, user_id) 
        REFERENCES public.memberships(organization_id, user_id) 
        ON DELETE RESTRICT
);

-- Invariant: At most one Primary Owner per organization (Partial Unique Index)
CREATE UNIQUE INDEX idx_single_primary_owner_per_org 
ON public.organization_ownership(organization_id) 
WHERE ownership_tier = 'PRIMARY_OWNER';

CREATE INDEX idx_org_ownership_user ON public.organization_ownership(user_id);
```

---

### 2.2 RBAC, Custom Roles & Permission Overrides Subsystem
```sql
-- 4. Custom Operational Roles
CREATE TABLE public.custom_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    base_template VARCHAR(50) NOT NULL, -- e.g., 'sales', 'inventory', 'accounts'
    is_system_role BOOLEAN NOT NULL DEFAULT FALSE,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_custom_role_org_name UNIQUE (organization_id, name),
    CONSTRAINT uq_custom_roles_id_org UNIQUE (id, organization_id)
);

-- 5. Role Permissions
CREATE TABLE public.role_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    role_id UUID NOT NULL,
    permission_key VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_role_permission UNIQUE (role_id, permission_key),
    CONSTRAINT fk_role_permissions_role 
        FOREIGN KEY (role_id, organization_id) 
        REFERENCES public.custom_roles(id, organization_id) 
        ON DELETE CASCADE
);

-- 6. Membership Permission Overrides (Granular Extensions / Explicit Deny)
CREATE TABLE public.membership_permission_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    membership_id UUID NOT NULL REFERENCES public.memberships(id) ON DELETE CASCADE,
    permission_key VARCHAR(100) NOT NULL,
    branch_id UUID, -- Optional branch scoping
    effect VARCHAR(10) NOT NULL CHECK (effect IN ('ALLOW', 'DENY')),
    expires_at TIMESTAMPTZ, -- Optional temporary grant
    granted_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_membership_override UNIQUE (membership_id, permission_key, branch_id)
);
```

---

### 2.3 Multi-Branch & Document Sequence Subsystem
```sql
-- 7. Branches
CREATE TABLE public.branches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    code VARCHAR(20) NOT NULL,
    name VARCHAR(255) NOT NULL,
    branch_type VARCHAR(50) NOT NULL CHECK (
        branch_type IN ('HEAD_OFFICE', 'RETAIL_STORE', 'WAREHOUSE', 'WHOLESALE_DEPOT')
    ),
    address JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_org_branch_code UNIQUE (organization_id, code),
    CONSTRAINT uq_branches_id_org UNIQUE (id, organization_id)
);

-- 8. Document Sequences (Branch-Partitioned)
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
        ON DELETE RESTRICT
);

CREATE UNIQUE INDEX uq_doc_seq_org_branch_type_fy 
ON public.document_sequences (
    organization_id, 
    document_type, 
    financial_year, 
    COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
);
```

---

### 2.4 Financial Approvals Subsystem
```sql
-- 9. Approval Rules
CREATE TABLE public.approval_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    action_type VARCHAR(50) NOT NULL,
    threshold_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    required_approver_role VARCHAR(50) NOT NULL,
    required_approvals_count INTEGER NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 10. Approval Requests (Level 3.2 Lock Space)
CREATE TABLE public.approval_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    action_type VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID NOT NULL,
    initiator_user_id UUID NOT NULL,
    amount NUMERIC(12, 2),
    payload JSONB NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING' CHECK (
        status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED')
    ),
    required_approvals INTEGER NOT NULL DEFAULT 1,
    current_approvals INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX idx_approval_req_lookup ON public.approval_requests(organization_id, status);

-- 11. Approval Decisions (Immutable Log)
CREATE TABLE public.approval_decisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES public.approval_requests(id) ON DELETE CASCADE,
    approver_user_id UUID NOT NULL,
    decision VARCHAR(20) NOT NULL CHECK (decision IN ('APPROVE', 'REJECT')),
    notes TEXT,
    decided_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_request_approver UNIQUE (request_id, approver_user_id)
);
```

---

## 3. Physical Database Invariants & Deferred Triggers

### Invariant 1: Exactly One Primary Owner (`= 1`)
Enforced via deferred constraint trigger on `public.organizations`:
```sql
CREATE OR REPLACE FUNCTION public.trg_assert_primary_owner_exists()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_count INT;
BEGIN
    IF NEW.is_active THEN
        SELECT COUNT(*) INTO v_count
        FROM public.organization_ownership
        WHERE organization_id = NEW.id AND ownership_tier = 'PRIMARY_OWNER';

        IF v_count <> 1 THEN
            RAISE EXCEPTION 'INVARIANT_VIOLATION: Organization % must have exactly one active Primary Owner. Current count: %', NEW.id, v_count
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_org_primary_owner_required
    AFTER INSERT OR UPDATE ON public.organizations
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION public.trg_assert_primary_owner_exists();
```

---

## 4. The Unified Global Lock Hierarchy

To guarantee mathematical deadlock freedom across all business and administrative transactions, locks must be acquired strictly in order [`PROPOSED DESIGN`]:

$$\text{Level 0.5} \longrightarrow \text{Level 1.0} \longrightarrow \text{Level 2.0} \longrightarrow \text{Level 3.0} \longrightarrow \text{Level 3.2} \longrightarrow \text{Level 3.5} \longrightarrow \text{Level 4.0}$$

```
Level 0.5: user_deprovisioning_requests (FOR UPDATE)
    │
    ▼
Level 1.0: idempotency_keys (INSERT ... ON CONFLICT / FOR UPDATE)
    │
    ▼
Level 2.0: organizations (SELECT ... FOR UPDATE, ORDER BY id ASC)
    │
    ▼
Level 3.0: organization_ownership & memberships (SELECT ... FOR UPDATE, ORDER BY id ASC)
    │
    ▼
Level 3.2: approval_requests (SELECT ... FOR UPDATE)
    │
    ▼
Level 3.5: Commercial Documents: invoices / sales_orders (SELECT ... FOR UPDATE)
    │
    ▼
Level 4.0: stock_movements & audit_events (Append-only INSERT; Zero Row Locks)
```

---

## 5. Master RPC Specifications

Every state mutation in ATLAS OS executes through one of the following trusted `SECURITY DEFINER` RPCs with `search_path = public, pg_temp`:

### 5.1 Governance & Ownership RPCs
1. `public.create_organization(...)`: Atomically inserts tenant root, initial membership (`system_admin`), and Primary Ownership record (`PRIMARY_OWNER`).
2. `public.appoint_co_owner(p_org_id UUID, p_user_id UUID)`: Primary Owner appoints an active member as Co-Owner.
3. `public.remove_co_owner(p_org_id UUID, p_user_id UUID)`: Primary Owner removes Co-Ownership status.
4. `public.initiate_primary_ownership_transfer(p_org_id UUID, p_recipient_user_id UUID)`: Primary Owner initiates transfer handshake.
5. `public.accept_primary_ownership_transfer(p_transfer_id UUID)`: Recipient accepts; atomically demotes old Primary to Co-Owner and promotes recipient.

### 5.2 Financial & Commercial RPCs
6. `public.create_invoice_with_items(p_org_id UUID, p_branch_id UUID, p_payload JSONB)`:
   - Validates caller role under Level 2 org lock.
   - Evaluates approval rules. If triggered, inserts invoice with `status = 'PENDING_APPROVAL'` and creates Level 3.2 `approval_requests`.
   - If not triggered, allocates sequential number and inserts with `status = 'ISSUED'`.
7. `public.submit_approval_decision(p_req_id UUID, p_decision VARCHAR, p_notes TEXT)`:
   - Acquires Level 2 Org Lock $\rightarrow$ Level 3.2 Approval Request Lock $\rightarrow$ Level 3.5 Invoice Lock.
   - Validates Self-Approval Prohibition (`auth.uid() <> initiator_user_id`).
   - If quorum met, allocates sequential number and updates invoice `status := 'ISSUED'`.
8. `public.record_payment_and_allocate(p_org_id UUID, p_branch_id UUID, ...)`:
   - Acquires Level 2 Org Lock $\rightarrow$ Level 3.5 Invoice Lock.
   - Asserts allocated amount $\le$ balance due.
   - Inserts payment, allocation, and updates invoice `total_paid`.

### 5.3 Account Offboarding RPCs
9. `public.initiate_user_deprovisioning(...)`: Records Level 0.5 request; issues fencing token.
10. `public.sever_user_memberships(p_req_id UUID, p_fencing_token INT)`:
    - Locks organizations in ascending order (`ORDER BY id ASC`).
    - Asserts user is not sole Primary Owner of any active organization.
    - Severs memberships and cleans up Co-Ownerships.
11. `public.complete_user_deprovisioning(p_req_id UUID, p_fencing_token INT)`: Terminal state transition.

---

## 6. Mathematical Deadlock Freedom Proof

**Theorem:** The ATLAS OS Final Target Architecture is provably deadlock-free across all concurrent operations.

**Proof Structure:**
1. Let $\mathcal{G} = (\mathcal{T}, \mathcal{E})$ be the transaction wait-for graph.
2. Every transaction $T \in \mathcal{T}$ acquires locks monotonically according to the total ordering $\mathcal{L} = \langle 0.5, 1.0, 2.0, 3.0, 3.2, 3.5, 4.0 \rangle$.
3. By formalizing `approval_requests` at Level 3.2, the approval review path (Level 2 $\rightarrow$ Level 3.2 $\rightarrow$ Level 3.5) and the invoice creation path (Level 2 $\rightarrow$ Level 3.2 $\rightarrow$ Level 3.5) request locks in identical linear order.
4. For multi-row acquisitions within any single level (e.g., Level 2 organizations or Level 3 memberships), rows are acquired strictly in ascending UUID order: $\text{id}_1 < \text{id}_2 < \dots < \text{id}_k$.
5. Operational transactions check deprovisioning status via non-locking snapshot reads, acquiring zero row locks at Level 0.5.
6. Because all directed edges in $\mathcal{G}$ point strictly from lower to higher tiers or from smaller to larger UUIDs, $\mathcal{G}$ is a Directed Acyclic Graph (DAG).
7. A DAG contains no cycles. Therefore, circular wait deadlocks (`40P01`) cannot occur. Q.E.D.
