# PHASE 5.0C.1 — CRITICAL CONTROL GAP REGISTER
## Deep Architectural Security Gaps, Concurrency Deadlock Vectors, and Missing Database Invariants
**ATLAS OS Multi-Tenant Enterprise SaaS ERP Platform**  
**Classification:** Database Architecture & Concurrency Gap Specification  
**Target Repository:** `D:\Projects\Atlas-OS` | **Branch:** `Vijay-Atlas`  
**Target Staging Ref:** `bwswqnhlebbzdxumlkih` | **Production Ref:** `hrxjgbupjtikokqxjzbh` (STRICTLY FORBIDDEN)

---

## 1. Executive Summary

This register exposes the critical technical and database-level control gaps identified during the adversarial audit of Phase 5.0C. 

These gaps represent real-world concurrency failure vectors, race conditions, and authorization bypasses that could emerge under high-volume multi-user retail workloads if not explicitly resolved in Migration 015.

Every finding provides:
- The exact concurrency or authorization failure mode.
- Concrete evidence from SQL mechanics and PostgreSQL query planner behavior.
- The precise database constraint, trigger, or DDL correction required.
- An implementation blocking assessment.

---

## 2. Critical Control Gap Register

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       CRITICAL CONTROL GAP REGISTER                                                    │
├─────────┬──────────┬─────────────────────────────┬────────────────────────────────┬────────────────────────────────────┤
│ Gap ID  │ Severity │ Architectural Domain        │ Description of Critical Gap    │ Blocker Status & Remediation       │
├─────────┼──────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────────────────┤
│ **GAP-01│ CRITICAL │ Concurrency / Lock Graph    │ Level 2 Intra-Tier Inversion:  │ IMPLEMENTATION BLOCKER             │
│         │          │ (Domain H Concurrency)      │ No lock acquisition sequence   │ Mandate Level 2.1 (`customers`)    │
│         │          │                             │ between `customers` & `products│ before Level 2.2 (`products`).     │
├─────────┼──────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────────────────┤
│ **GAP-02│ CRITICAL │ Ownership Recovery Race     │ Competing Recovery Claims:     │ IMPLEMENTATION BLOCKER             │
│         │          │ (Domain B PO-04 Quorum)     │ No unique constraint preventing│ Add partial unique index on        │
│         │          │                             │ multiple active recovery claims│ `recovery_requests(org_id)`.       │
├─────────┼──────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────────────────┤
│ **GAP-03│ HIGH     │ Multi-Branch Authorization  │ Branch RLS Omission:           │ IMPLEMENTATION BLOCKER             │
│         │          │ (Domain A & D RLS Policies) │ Operational RLS policies only  │ Add `branch_id` scoping to RLS     │
│         │          │                             │ filter `organization_id`.      │ operational policies in Mig 015.   │
├─────────┼──────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────────────────┤
│ **GAP-04│ HIGH     │ Ownership Invariant Race    │ Concurrent Deactivation Race:  │ IMPLEMENTATION BLOCKER             │
│         │          │ (Domain B Invariant DEC-11) │ Membership deactivation can    │ Mandate Level 1 org row lock on    │
│         │          │                             │ race with owner promotion.     │ `update_membership_status`.        │
├─────────┼──────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────────────────┤
│ **GAP-05│ MEDIUM   │ Document State Machine      │ Invalid Order Cancellation:    │ IMPLEMENTATION BLOCKER             │
│         │          │ (Domain E Sales Orders)     │ `PARTIALLY_FULFILLED` orders   │ Prohibit CANCELLED; mandate        │
│         │          │                             │ allowed to transition CANCELLED│ `CLOSED_PARTIALLY_FULFILLED`.      │
├─────────┼──────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────────────────┤
│ **GAP-06│ MEDIUM   │ Deprovisioning State Machine│ Dispute Freeze Dead-End:       │ ARCHITECTURE BLOCKER               │
│         │          │ (Domain G Deprovisioning)   │ `AUTH_LOCKED` state lacks      │ Add explicit transition:           │
│         │          │                             │ transition to `FRAUD_HELD`.    │ `AUTH_LOCKED --> FRAUD_HELD`.      │
└─────────┴──────────┴─────────────────────────────┴────────────────────────────────┴────────────────────────────────────┘
```

---

## 3. Detailed Forensic Analysis of Critical Gaps

### 3.1 GAP-01: Level 2 Intra-Tier Lock Inversion (Customers vs Products)
- **Affected Document:** `PHASE_5_0C_CONCURRENCY_AND_FAILURE_ANALYSIS.md` (Section 2 & 3).
- **The Gap:** The document establishes Level 2 as "Master Entity Resource Locks" containing both `products` and `customers`. However, it does not define which entity MUST be locked first when a transaction touches both.
- **Concurrence Deadlock Attack Vector:**
  - **Transaction 1 (`create_invoice_with_items`):** 
    1. Locks 10 products: `SELECT id FROM products WHERE id = ANY(...) ORDER BY id ASC FOR UPDATE;`
    2. Validates stock availability.
    3. Evaluates customer credit limit and locks customer: `SELECT id, credit_limit FROM customers WHERE id = p_customer_id FOR UPDATE;`
  - **Transaction 2 (`update_customer_contract_pricing`):**
    1. Locks customer row to update commercial terms: `SELECT id FROM customers WHERE id = p_customer_id FOR UPDATE;`
    2. Updates customer-specific SKU discount matrix, locking affected products: `SELECT id FROM products WHERE id = ANY(...) ORDER BY id ASC FOR UPDATE;`
  - **Result:** Transaction 1 holds `products` and waits for `customers`. Transaction 2 holds `customers` and waits for `products`. PostgreSQL detects a cycle and terminates one transaction with **SQLSTATE 40P01 (Deadlock Detected)**!
- **Mandatory Engineering Correction:**
  Subdivide Level 2 into explicit strictly-ordered sub-levels:
  - **Level 2.1 (Customer Master):** `SELECT ... FROM customers WHERE id = p_cust_id FOR UPDATE;`
  - **Level 2.2 (Product Catalog):** `SELECT ... FROM products WHERE id = ANY(...) ORDER BY id ASC FOR UPDATE;`
  `create_invoice_with_items` MUST acquire the customer lock (Level 2.1) **BEFORE** acquiring product stock locks (Level 2.2).
- **Blocker Status:** **IMPLEMENTATION BLOCKER** for RPC design.

---

### 3.2 GAP-02: Concurrent Competing Primary Owner Recovery Claims
- **Affected Document:** `PHASE_5_0C_MASTER_ARCHITECTURE_SPECIFICATION.md` (Section 3.4) and `PHASE_5_0C_STATE_MACHINE_AND_TRANSACTION_CATALOG.md`.
- **The Gap:** The schema specification for `public.recovery_requests` lacks a unique constraint preventing multiple active recovery claims for the same organization.
- **Split-Brain Attack Vector:**
  Suppose an organization has 4 active Co-Owners (A, B, C, D). Primary Owner is incapacitated.
  - Co-Owner A executes `initiate_coowner_recovery()`. Claim 1 is created.
    - Eligible voters for Claim 1: $\{B, C, D\}$ ($N=3$, Quorum required: $\lfloor 0.66 \times 3 \rfloor + 1 = 2$).
  - Simultaneously, Co-Owner B executes `initiate_coowner_recovery()`. Claim 2 is created.
    - Eligible voters for Claim 2: $\{A, C, D\}$ ($N=3$, Quorum required: $\lfloor 0.66 \times 3 \rfloor + 1 = 2$).
  - Co-Owner C votes for Claim 1, and Co-Owner D votes for Claim 1. Claim 1 reaches 2 votes $\to$ **APPROVED**.
  - Co-Owner A votes for Claim 2, and Co-Owner D votes for Claim 2. Claim 2 reaches 2 votes $\to$ **APPROVED**.
  - Both transactions commit, attempting to promote two different Primary Owners! Even if deferred trigger blocks the second commit, it creates massive race condition chaos and user confusion.
- **Mandatory Engineering Correction:**
  Migration 015 must enforce that at most ONE recovery request can be in an active state per organization:
  ```sql
  CREATE UNIQUE INDEX uq_single_active_recovery_claim 
  ON public.recovery_requests(organization_id) 
  WHERE status IN ('PENDING', 'VOTING_ACTIVE', 'IN_COOLING_PERIOD');
  ```
  Any attempt to initiate a second recovery claim while one is active will fail with SQLSTATE `23505 (Unique Violation)`.
- **Blocker Status:** **IMPLEMENTATION BLOCKER** for Recovery subsystem.

---

### 3.3 GAP-03: Branch Isolation Omission in Row Level Security (RLS)
- **Affected Document:** `PHASE_5_0C_SECURITY_AND_DATABASE_CONTROL_CATALOG.md` (SEC-01 & SEC-09).
- **The Gap:** The existing deployed RLS policies on tables `invoices`, `stock_movements`, `quotations`, and `sales_orders` (from Migrations `001`–`008` and untracked `014`) enforce:
  ```sql
  USING (organization_id IN (SELECT get_user_organizations()))
  ```
  They **DO NOT VERIFY `branch_id`**.
- **Authorization Bypass Vector:**
  If an enterprise retailer has Branch Mumbai and Branch Delhi:
  - Cashier 'Rajesh' is assigned exclusively to Branch Mumbai.
  - While Rajesh's UI frontend defaults to Branch Mumbai, Rajesh (or an attacker using Rajesh's JWT token) can forge an HTTP request to Supabase calling an operational RPC or direct select passing `branch_id = 'delhi-branch-uuid'`.
  - Because Delhi and Mumbai share the same `organization_id`, **PostgreSQL RLS permits the query**!
  - Cross-branch isolation currently relies entirely on frontend UI logic and procedural checks inside stored procedures.
- **Mandatory Engineering Correction:**
  In Migration 015, operational table RLS policies must enforce contextual branch scoping:
  ```sql
  CREATE POLICY rls_invoices_branch_isolation ON public.invoices
  FOR ALL TO authenticated
  USING (
      organization_id IN (SELECT get_user_organizations())
      AND (
          branch_id IS NULL
          OR user_has_global_org_access(organization_id)
          OR branch_id IN (SELECT get_user_assigned_branches(organization_id))
      )
  );
  ```
- **Blocker Status:** **IMPLEMENTATION BLOCKER** for multi-branch security.

---

### 3.4 GAP-04: Concurrent Membership Deactivation vs Primary Owner Promotion Race
- **Affected Document:** `PHASE_5_0C_MASTER_ARCHITECTURE_SPECIFICATION.md` (Section 3.2 & 3.3).
- **The Gap:** The deferred constraint trigger `trg_assert_primary_owner_exists` verifies that at transaction commit, an organization has exactly one Primary Owner.
  However, the membership deactivation guard trigger (`trg_prevent_primary_owner_deactivation`) executes as an **IMMEDIATE** trigger when a membership row is updated.
- **Phantom Owner Race Vector:**
  - Transaction 1: Transfers Primary Ownership to User B (`ownership_type = 'PRIMARY_OWNER'`).
  - Concurrent Transaction 2: Deactivates User B's membership (`status = 'DEACTIVATED'`).
  - In `READ COMMITTED` isolation, Transaction 2 does not see Transaction 1's uncommitted promotion of User B.
  - Transaction 2's deactivation guard checks if User B is currently `PRIMARY_OWNER` in committed rows. It returns `FALSE`.
  - Transaction 2 updates User B to `DEACTIVATED` and commits.
  - Transaction 1's deferred trigger runs at commit. It checks: Does an active row in `organization_ownership` exist for B? Yes. Commit succeeds!
  - **Result:** User B is the active Primary Owner in `organization_ownership`, but their underlying membership in `memberships` is `DEACTIVATED`!
- **Mandatory Engineering Correction:**
  Every stored procedure modifying `organization_ownership` OR `memberships` must acquire an explicit row lock on the parent `public.organizations` row as its very first statement:
  ```sql
  PERFORM id FROM public.organizations WHERE id = p_organization_id FOR UPDATE;
  ```
  This serializes all ownership and membership lifecycle mutations for that tenant, making phantom promotions impossible.
- **Blocker Status:** **IMPLEMENTATION BLOCKER** for Ownership & Membership DDL triggers.

---

### 3.5 GAP-05: Post-Fulfillment Sales Order Cancellation State Corruption
- **Affected Document:** `PHASE_5_0C_STATE_MACHINE_AND_TRANSACTION_CATALOG.md` (Section 2.2).
- **The Gap:** The Sales Order state machine allows an order in `PARTIALLY_FULFILLED` to transition directly to `CANCELLED`.
- **Financial Audit Divergence Vector:**
  - Order SO-100 is created for 100 units of switches.
  - 40 units are dispatched and invoiced under Invoice INV-001 (`status = 'ISSUED'`). SO-100 transitions to `PARTIALLY_FULFILLED`.
  - Customer decides they do not need the remaining 60 units.
  - Operator clicks "Cancel Order" in the UI.
  - State machine sets SO-100 to `CANCELLED`.
  - **Result:** Financial audit query finds an issued invoice (INV-001) linked to a `CANCELLED` sales order without any compensating Credit Note or cancellation record. This triggers statutory tax audit red flags during GSTR-1 reconciliation.
- **Mandatory Engineering Correction:**
  Prohibit `PARTIALLY_FULFILLED --> CANCELLED`. Replace with:
  `PARTIALLY_FULFILLED --> CLOSED_PARTIALLY_FULFILLED`
  A partial fulfillment can only close its remaining unfulfilled line balance. Issued lines remain tied to their tax invoices.
- **Blocker Status:** **IMPLEMENTATION BLOCKER** for Sales Order lifecycle engine.

---

### 3.6 GAP-06: Deprovisioning State Machine Dispute Freeze Dead-End
- **Affected Document:** `PHASE_5_0C_STATE_MACHINE_AND_TRANSACTION_CATALOG.md` (Section 2.6).
- **The Gap:** In the Deprovisioning state machine, the transition to `FRAUD_HELD` is only drawn from `INITIATED`.
- **Systemic Vulnerability:** In real-world enterprise takeovers, an attacker initiates deprovisioning, and the target user's auth is locked (`AUTH_LOCKED`) within seconds. If the victim calls compliance support while in `AUTH_LOCKED`, the state machine has no valid transition arrow from `AUTH_LOCKED` to `FRAUD_HELD`.
- **Mandatory Engineering Correction:** Add explicit transition:
  `AUTH_LOCKED --> FRAUD_HELD`
  Placing a hold while `AUTH_LOCKED` freezes the timer and blocks `MEMBERSHIPS_SEVERED` while keeping auth locked until investigation is resolved.
- **Blocker Status:** **ARCHITECTURE BLOCKER** for Deprovisioning RPC design.
