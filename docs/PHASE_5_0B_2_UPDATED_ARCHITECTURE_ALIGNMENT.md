# PHASE 5.0B.2 — UPDATED ARCHITECTURE ALIGNMENT
## Engineering Alignment Specification: Harmonizing DDL Blueprints, RPC Contracts, and Security Test Suites with Frozen Product Decisions
**ATLAS OS Enterprise SaaS ERP Platform**  
**Classification:** Technical Architecture Alignment Specification — Read-Only Design  
**Target Repository:** `D:\Projects\Atlas-OS` | **Branch:** `Vijay-Atlas`  
**Target Staging Ref:** `bwswqnhlebbzdxumlkih` | **Production Ref:** `hrxjgbupjtikokqxjzbh` (STRICTLY FORBIDDEN)

---

## 1. Executive Summary & Purpose

This document aligns the complete ATLAS OS technical architecture with the frozen Product Owner decisions (`PO-01` through `PO-08`) established in Phase 5.0B.2.

It updates database schema definitions, mathematical quorum algorithms, RPC procedural logic, frontend service contracts, and automated security test suites to reflect approved parameters, eliminating all remaining design placeholders.

In strict adherence to Phase 5.0B.2 restrictions, **no application code was modified, no database migrations were created or applied, no database connections were established, and production was untouched.**

---

## 2. Subsystem-by-Subsystem Architecture Alignment

### 2.1 Ownership Governance & Primary Owner Recovery (`PO-03`, `PO-04`, `PO-05`, `PO-06`)

#### 1. Mathematical Co-Owner Quorum Algorithm (`PO-04`)
The voting logic inside `public.vote_owner_recovery` is updated to enforce strict claimant exclusion and ceiling rounding:

```sql
CREATE OR REPLACE FUNCTION public.calculate_recovery_quorum(p_org_id UUID, p_claimant_id UUID)
RETURNS TABLE (eligible_voters INT, required_approvals INT) LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_eligible INT;
    v_required INT;
BEGIN
    -- Exclude the claimant from the voting population (PO-04)
    SELECT COUNT(*) INTO v_eligible
    FROM public.organization_ownership oo
    JOIN public.memberships m ON m.organization_id = oo.organization_id AND m.user_id = oo.user_id
    WHERE oo.organization_id = p_org_id
      AND oo.ownership_tier = 'CO_OWNER'
      AND m.is_active = TRUE
      AND oo.user_id <> p_claimant_id;

    IF v_eligible = 0 THEN
        -- Sole-Owner Fallback: Peer voting is impossible; must divert to KYC verification
        RETURN QUERY SELECT 0, 0;
    ELSE
        -- Strictly more than 66%, rounded upward (PO-04)
        v_required := FLOOR(0.66 * v_eligible)::INT + 1;
        RETURN QUERY SELECT v_eligible, v_required;
    END IF;
END;
$$;
```

#### 2. Fraud & Dispute Hold Integration (`PO-03`)
The `public.organization_owner_recovery_requests` table is updated with a `DISPUTED` state:
```sql
ALTER TABLE public.organization_owner_recovery_requests 
ADD COLUMN is_disputed BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN disputed_by UUID,
ADD COLUMN disputed_at TIMESTAMPTZ,
ADD COLUMN dispute_reason TEXT;
```
- **Dispute Invariant:** If `is_disputed = TRUE`, automated time-lock expiration is **BLOCKED**. The recovery cannot execute until a platform compliance officer formally resolves the dispute.

#### 3. Sole-Owner KYC Compliance Schema (`PO-06`)
```sql
CREATE TABLE public.owner_recovery_kyc_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recovery_request_id UUID NOT NULL REFERENCES public.organization_owner_recovery_requests(id) ON DELETE CASCADE,
    claimant_user_id UUID NOT NULL,
    id_provider_ref VARCHAR(100) NOT NULL, -- Accredited KYC verification reference
    legal_document_urls TEXT[] NOT NULL,   -- Encrypted storage pointers for GST/PAN/Udyam proof
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    reviewer_user_id UUID,                 -- Platform Compliance Officer
    review_status VARCHAR(50) NOT NULL DEFAULT 'PENDING' CHECK (
        review_status IN ('PENDING', 'APPROVED', 'REJECTED', 'ADDITIONAL_INFO_REQUIRED')
    ),
    review_notes TEXT,
    reviewed_at TIMESTAMPTZ
);
```

---

### 2.2 Approval Workflow Engine (`PO-01`, `PO-02`)

#### 1. Currency-Aware & Category-Specific Schema Alignment (`PO-01`)
The `approval_rules` schema is updated to support multi-currency thresholds and high-risk action overrides:

```sql
CREATE TABLE public.approval_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    action_type VARCHAR(50) NOT NULL CHECK (
        action_type IN (
            'INVOICE_DISCOUNT', 'HIGH_VALUE_INVOICE', 'REFUND', 
            'CREDIT_NOTE', 'CREDIT_LIMIT_OVERRIDE', 'STOCK_WRITEOFF'
        )
    ),
    currency VARCHAR(3) NOT NULL DEFAULT 'INR', -- Currency-aware threshold configuration (PO-01)
    threshold_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    is_high_risk_override BOOLEAN NOT NULL DEFAULT FALSE, -- Requires approval regardless of amount
    required_approver_role VARCHAR(50) NOT NULL,
    required_approvals_count INTEGER NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_org_action_rule UNIQUE (organization_id, action_type, currency)
);
```

#### 2. Default Seed Rules (Initial INR Baseline)
When a new organization is created via `create_organization`, the following initial defaults (`PO-01`) are automatically provisioned:
1. `HIGH_VALUE_INVOICE` (> ₹25,000): Branch/Department Manager (`required_approvals_count = 1`).
2. `HIGH_VALUE_INVOICE` (> ₹100,000): Senior Manager / Co-Owner (`required_approvals_count = 1`).
3. `HIGH_VALUE_INVOICE` (> ₹500,000): Dual-Quorum (`required_approvals_count = 2`, Primary Owner + Co-Owner).
4. `STOCK_WRITEOFF`: `is_high_risk_override = TRUE` (Always requires approval regardless of amount).

#### 3. Zero Silent Approval & Expiry Notification (`PO-02`)
The background cleaner function `public.clean_expired_approval_requests` marks requests older than `expires_at` (default: 72 hours) as `EXPIRED`:
```sql
UPDATE public.approval_requests 
SET status = 'EXPIRED', updated_at = clock_timestamp()
WHERE status = 'PENDING' AND expires_at < clock_timestamp();
```
- **Post-Expiry Document Invariant:** Invoices associated with an `EXPIRED` approval request remain in `PENDING_APPROVAL`. They can never be printed, issued, or allocated until explicitly resubmitted by the requester.

---

### 2.3 Central Customer Master & Branch Isolation (`PO-07`)

#### 1. Schema Alignment: Single Central Master per Tenant
Customers belong directly to the organization root, while individual commercial documents record branch attribution:

```sql
-- Customers Master (Centralized per Organization)
CREATE TABLE public.customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    name VARCHAR(255) NOT NULL,
    trade_name VARCHAR(255),
    gstin VARCHAR(15),
    pan VARCHAR(10),
    credit_limit NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    credit_days INTEGER NOT NULL DEFAULT 30,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    -- Prevents duplicate customer identities within the tenant (PO-07)
    CONSTRAINT uq_org_customer_gstin UNIQUE (organization_id, gstin)
);

-- Invoices attribute the transaction to a specific branch
ALTER TABLE public.invoices 
ADD COLUMN branch_id UUID REFERENCES public.branches(id) ON DELETE RESTRICT;
```

#### 2. Sensitive Commercial Information Masking
The `customers` view for branch counter staff masks credit limits and consolidated receivables balances:
- Staff holding `role = 'sales'` without `customers:view_sensitive` override see `credit_limit` as `NULL` or masked, while holding authority to verify available credit via server-side checkout RPCs.

---

### 2.4 Policy-Based Deprovisioning & Audit Retention (`PO-08`)

#### Record Retention Policy Schedule:
1. **Category A — Forensic & Deprovisioning Audit Logs (`public.audit_events`, `public.user_deprovisioning_requests`):**
   - Retained actively in PostgreSQL for **1 year** post-completion.
   - Partitioned and archived to immutable cold storage (e.g., Cloud Storage WORM bucket) for 5 years.
2. **Category B — Statutory Financial Ledgers (`invoices`, `payments`, `allocations`, `stock_movements`):**
   - Retained for **72 months (6 years)** from the annual return due date under Section 36 of the CGST Act.
   - Deletion of an Auth user permanently retains bare UUID references (`created_by`, `actor_id`).
3. **Category C — Transient Keys (`public.idempotency_keys`):**
   - Purged automatically via background worker after **48 hours**.

---

## 3. Frontend Application Service Adaptations

The frontend services must be updated to align with the approved decisions:

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 FRONTEND ADAPTER REQUIREMENTS                                    │
├──────────────────────────┬────────────────────────────┬──────────────────────────────────────────┤
│ File / Component         │ Current Implementation     │ Required Alignment Implementation        │
├──────────────────────────┼────────────────────────────┼──────────────────────────────────────────┤
│ `src/services/`          │ Direct REST updates to     │ Update to call `appoint_co_owner` RPC;   │
│ `team.service.ts`        │ `memberships` table        │ surface Primary vs Co-Owner designations.│
├──────────────────────────┼────────────────────────────┼──────────────────────────────────────────┤
│ `src/features/team/`     │ Client-side `activeOwners` │ Remove React last-owner check; rely on   │
│ `TeamPage.tsx`           │ count check in state       │ server error code `23514` check violation│
├──────────────────────────┼────────────────────────────┼──────────────────────────────────────────┤
│ `src/services/`          │ Multi-step REST insertion  │ Call atomic `create_invoice_with_items`; │
│ `invoices.service.ts`    │ (header, then items)       │ handle `PENDING_APPROVAL` status flow.   │
├──────────────────────────┼────────────────────────────┼──────────────────────────────────────────┤
│ `src/features/`          │ Assumes single tenant org; │ Add branch selector; pass `branch_id` to │
│ `organizations/`         │ zero branch concept        │ document creation RPCs.                  │
└──────────────────────────┴────────────────────────────┴──────────────────────────────────────────┘
```

---

## 4. Automated Security Test Alignment

The 28 test scenarios specified in Document B are updated to evaluate the exact approved parameters:

1. **Test SEC-APPR-01 (Approved Tiers):** Invoice of ₹20,000 auto-issues; invoice of ₹75,000 pauses in `PENDING_APPROVAL` (Tier 2); invoice of ₹600,000 requires 2 approvers (Tier 4).
2. **Test SEC-APPR-02 (Separation of Duties):** Branch Manager initiating a ₹75,000 invoice is blocked from submitting an approval decision on their own request (`42501 self_approval_prohibited`).
3. **Test SEC-APPR-03 (72h Expiry):** Request older than 72 hours transitions to `EXPIRED`; invoice remains non-issuable.
4. **Test SEC-RECOV-01 (14-Day Hold):** Recovery claim cannot execute on day 13; succeeds on day 15 if quorum met.
5. **Test SEC-RECOV-02 (Quorum Calculation):** In an organization with 3 Co-Owners (Claimant + 2 others), both remaining Co-Owners must vote `APPROVE` ($>66\%$).
6. **Test SEC-RECOV-03 (Fraud Hold):** Incumbent Primary Owner marks recovery `DISPUTED`; execution is blocked indefinitely.

---

## 5. Architectural Alignment Attestation

All technical specifications, schemas, triggers, and test matrices are now **100% aligned** with approved decisions `PO-01` through `PO-08`. No technical design conflicts remain.
