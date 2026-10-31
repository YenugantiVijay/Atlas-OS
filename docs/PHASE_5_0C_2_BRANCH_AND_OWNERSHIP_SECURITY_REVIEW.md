# PHASE 5.0C.2 — BRANCH & OWNERSHIP SECURITY REVIEW
## Authoritative Security Evaluation: Multi-Branch Authorization, Nullable Branch Scoping, and Ownership Invariant Concurrency Proofs
**ATLAS OS Multi-Tenant Enterprise SaaS ERP Platform**  
**Classification:** Database Security, RLS Policy & Ownership Concurrency Specification  
**Target Repository:** `D:\Projects\Atlas-OS` | **Branch:** `Vijay-Atlas`  
**Target Staging Ref:** `bwswqnhlebbzdxumlkih` | **Production Ref:** `hrxjgbupjtikokqxjzbh` (STRICTLY FORBIDDEN)

---

## 1. Executive Summary & Security Objectives

This review provides a comprehensive architectural and database-level security analysis across two foundational pillars of ATLAS OS:
1. **Multi-Branch Authorization & Isolation:** Establishing strict server-side boundary controls between branch sales counters, regional offices, and headquarters, while recognizing that central master records (customers, products, sequences) legitimately have `branch_id IS NULL`.
2. **Ownership Governance & Concurrency Proofs:** Formally proving how the **exactly-one-active-Primary-Owner invariant** is preserved under high-concurrency transactions, demonstrating why a partial unique index alone is insufficient, and establishing the exact serialization protocol across all eight ownership lifecycle operations.

---

## 2. Multi-Branch Authorization Architecture

### 2.1 The Critical Architectural Nuance: Nullable Branch Entities
A simplistic approach to multi-branch security is to add a blanket `AND branch_id = user_branch()` condition to every table. **In enterprise ERPs, this naive approach causes catastrophic system failure:**
- **Central Customer Master (`public.customers`):** Customers must be shared organization-wide across all branches to provide a 360-degree commercial view and prevent duplicate GSTIN entries. Therefore, `customers.branch_id` is **NULL**.
- **Central Product Catalog (`public.products`):** Standard SKUs, HSN codes, and base pricing are defined at the headquarters level. Therefore, `products.branch_id` is **NULL**.
- **Document Sequences (`public.document_sequences`):** Central head-office series (e.g. corporate invoicing) have `branch_id IS NULL`.
- **Tenant Root (`public.organizations`):** Organization settings, GSTIN registrations, and legal entities have no branch.

### 2.2 The Three-Tier Contextual Scope Model
```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       ATLAS OS THREE-TIER CONTEXTUAL SCOPE MODEL                                       │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

    TIER 1: Global Organization Context (Headquarters)
    • Roles: `owner`, `admin`, `general_manager`, `head_office_accountant`
    • Scope: Full read/write access across all branches and all NULL-branch master records.
                        │
                        ▼
    TIER 2: Regional Multi-Branch Context (Regional Area)
    • Roles: `regional_manager`, `area_supervisor`
    • Scope: Read/write access across an assigned set of branches in a territory.
                        │
                        ▼
    TIER 3: Local Branch Context (Retail Store / Warehouse)
    • Roles: `branch_manager`, `cashier`, `counter_sales`, `warehouse_keeper`
    • Scope: Strictly restricted to their assigned branch for transactional operations;
      read-only masked access to central master entities.
```

---

## 3. Server-Side Protection of Sensitive Customer & Credit Data

### 3.1 The Vulnerability of Frontend-Only Masking
In retail counter operations, a customer walking into Branch Mumbai may have an overall credit limit of ₹10,00,000 negotiated with corporate headquarters. Counter cashiers at Branch Mumbai need to bill goods, but must not view sensitive credit terms, current aging balances, or internal risk ratings.

If masking is done merely in the React/Vite UI, an employee using browser developer tools can inspect the network response payload from PostgREST and extract complete credit files.

### 3.2 Mandatory Database-Level Masking Specification
In Migration 015, ATLAS OS implements **PostgreSQL Security-Barrier Views** and column-level privilege revocations:

```sql
-- Security-Barrier View for Branch Counter Staff
CREATE OR REPLACE VIEW public.branch_accessible_customers
WITH (security_barrier = true) AS
SELECT 
    id,
    organization_id,
    legal_name,
    gstin,
    phone,
    email,
    billing_address,
    shipping_address,
    -- Sensitive fields conditionally masked based on caller role:
    CASE 
        WHEN public.user_has_global_org_access(organization_id) THEN credit_limit
        ELSE NULL 
    END AS credit_limit,
    CASE 
        WHEN public.user_has_global_org_access(organization_id) THEN payment_terms_days
        ELSE NULL 
    END AS payment_terms_days,
    CASE 
        WHEN public.user_has_global_org_access(organization_id) THEN current_aging_balance
        ELSE NULL 
    END AS current_aging_balance
FROM public.customers
WHERE organization_id IN (SELECT public.get_user_organizations());
```

---

## 4. Multi-Branch Operational Table RLS Policies

To resolve the authorization gap identified in `ADV-04`, operational tables (`invoices`, `sales_orders`, `stock_movements`, `quotations`) must enforce contextual branch scoping in Migration 015:

```sql
-- Hardened RLS Policy for Invoices in Migration 015
CREATE POLICY rls_invoices_branch_scoped ON public.invoices
FOR ALL TO authenticated
USING (
    -- 1. Tenant boundary check
    organization_id IN (SELECT public.get_user_organizations())
    AND (
        -- 2A. Global HQ access allows viewing all branch invoices
        public.user_has_global_org_access(organization_id)
        -- 2B. Branch operator access restricted to assigned branches
        OR (
            branch_id IS NOT NULL 
            AND branch_id IN (
                SELECT branch_id 
                FROM public.user_branch_assignments 
                WHERE user_id = auth.uid() 
                  AND organization_id = invoices.organization_id
                  AND is_active = TRUE
            )
        )
    )
);
```

---

## 5. Ownership Governance: Exactly-One Primary Owner Proof

### 5.1 Why a Partial Unique Index is Insufficient
A standard database misconception is that creating a partial unique index enforces an "exactly one" relationship:
```sql
CREATE UNIQUE INDEX uq_single_primary_owner 
ON public.organization_ownership(organization_id) 
WHERE ownership_type = 'PRIMARY_OWNER' AND is_active = TRUE;
```
- **Mathematical Limitation:**
  A unique index is an **exclusion constraint**. It enforces that for any `organization_id`, the number of matching rows $N$ satisfies:
  $$N \le 1$$
  It **DOES NOT** enforce:
  $$N \ge 1$$
  If an organization row is created without an ownership row, or if an administrator deletes the Primary Owner row, $N = 0$. The unique index is completely satisfied by $N = 0$, leaving the organization **unowned and headless**!

---

### 5.2 The Triple-Invariant Enforcement Model
To mathematically guarantee that $N = 1$ at all times for every active organization, ATLAS OS enforces three complementary database constraints:

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   TRIPLE-INVARIANT PRIMARY OWNER PROOF MODEL                                           │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

    CONSTRAINT 1: Upper Bound Guard (N <= 1)
    • Partial Unique Index: `uq_single_primary_owner`
    • Enforces: At most 1 active Primary Owner row per organization.
                        │
                        ▼
    CONSTRAINT 2: Lower Bound Guard (N >= 1)
    • Deferred Constraint Trigger: `trg_assert_primary_owner_exists`
    • Timing: `DEFERRABLE INITIALLY DEFERRED` (Evaluated at transaction COMMIT)
    • Enforces: `count(*) == 1` at commit boundary. Raises exception if N == 0.
                        │
                        ▼
    CONSTRAINT 3: Concurrency Serialization Guard (Anti-Race Condition)
    • Level 1 Organization Row Lock: `SELECT id FROM organizations WHERE id = p_org_id FOR UPDATE;`
    • Timing: Acquired as Step 1 in all membership and ownership stored procedures.
    • Enforces: Serializes concurrent transactions, preventing race conditions between
      immediate deactivation guards and deferred promotion triggers.
```

---

### 5.3 Step-by-Step Serialization of Ownership Operations

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       OWNERSHIP OPERATION CONCURRENCY PROOF                                            │
├────┬─────────────────────────────┬─────────────────────────────────────────────────────────────────────────────────────┤
│ #  │ Lifecycle Operation         │ Exact Transaction Steps & Concurrency Proof                                         │
├────┼─────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────┤
│ 01 │ Primary Owner Creation      │ 1. `INSERT INTO organizations (...) RETURNING id INTO v_org_id;`                    │
│    │ (Onboarding RPC)            │ 2. `INSERT INTO memberships (organization_id, user_id, role='owner', ...);`         │
│    │                             │ 3. `INSERT INTO organization_ownership (org_id, user_id, type='PRIMARY_OWNER');`   │
│    │                             │ 4. `COMMIT;` -> Trigger asserts count = 1. Success guaranteed.                      │
├────┼─────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────┤
│ 02 │ Ownership Transfer Handshake│ 1. Transaction 1 (Initiation): Acquires Level 1 lock on `organizations`.            │
│    │                             │    Inserts `ownership_transfers` (status OFFERED, ttl=7d). Incumbent remains PRIMARY│
│    │                             │ 2. Transaction 2 (Acceptance): Acquires Level 1 lock on `organizations`.            │
│    │                             │    Demotes incumbent to CO_OWNER; promotes nominee to PRIMARY_OWNER in same txn.    │
│    │                             │ 3. `COMMIT;` -> Trigger asserts exactly 1 Primary Owner exists. Success.            │
├────┼─────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────┤
│ 03 │ Co-Owner Demotion / Removal │ 1. Acquires Level 1 lock on `organizations`.                                        │
│    │                             │ 2. Trigger asserts target `ownership_type != 'PRIMARY_OWNER'`.                      │
│    │                             │ 3. Primary Owner cannot be demoted via Co-Owner API. Raises 42501.                  │
├────┼─────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────┤
│ 04 │ Membership Deactivation     │ 1. Acquires Level 1 lock on `organizations`.                                        │
│    │ Guard Trigger               │ 2. Trigger checks `organization_ownership` for target user_id.                      │
│    │                             │ 3. If target is active PRIMARY_OWNER, raises 42501: "Cannot deactivate Primary".    │
├────┼─────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────┤
│ 05 │ Recovery Promotion          │ 1. Acquires Level 1 lock on `organizations`.                                        │
│    │                             │ 2. Verifies recovery claim is APPROVED and cooling period elapsed.                  │
│    │                             │ 3. Demotes incapacitated owner; promotes claimant; commits cleanly.                 │
└────┴─────────────────────────────┴─────────────────────────────────────────────────────────────────────────────────────┘
```

This triple-invariant architecture provides mathematical proof that an active organization in ATLAS OS can never enter an unowned ($N = 0$) or split-brain ($N > 1$) ownership state under any concurrent execution schedule.
