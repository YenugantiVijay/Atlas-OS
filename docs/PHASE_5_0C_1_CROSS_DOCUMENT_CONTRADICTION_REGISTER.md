# PHASE 5.0C.1 — CROSS-DOCUMENT CONTRADICTION REGISTER
## Comprehensive Audit of Inconsistencies, State Discrepancies, and Semantic Drift Across Architecture Phases
**ATLAS OS Multi-Tenant Enterprise SaaS ERP Platform**  
**Classification:** Adversarial Architectural Inconsistency Register  
**Target Repository:** `D:\Projects\Atlas-OS` | **Branch:** `Vijay-Atlas`  
**Target Staging Ref:** `bwswqnhlebbzdxumlkih` | **Production Ref:** `hrxjgbupjtikokqxjzbh` (STRICTLY FORBIDDEN)

---

## 1. Executive Summary

This register catalogs all technical discrepancies, cross-document contradictions, and subtle semantic drift identified across the Phase 5.0C architecture suite and prior baseline documents (Phases 5.0A, 5.0B, 5.0B.1, 5.0B.2, and local migrations `001`–`014`).

Each finding is classified by severity, evidence, systemic risk, required engineering correction, and implementation blocking status.

---

## 2. Inconsistency & Contradiction Register

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       CROSS-DOCUMENT CONTRADICTION REGISTER                                            │
├─────────┬──────────┬─────────────────────────────┬────────────────────────────────┬────────────────────────────────────┤
│ Item ID │ Severity │ Affected Documents          │ Nature of Contradiction        │ Blocker Status & Correction        │
├─────────┼──────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────────────────┤
│ **XDOC-1│ HIGH     │ 5.0C Master Spec Sec 5.2    │ Sequence Partitioning:         │ IMPLEMENTATION BLOCKER             │
│         │          │ vs Local Migration 010      │ Spec mandates UNIQUE NULLS     │ Migration 010 schema has standard  │
│         │          │ (`010_robust_document_...`) │ NOT DISTINCT (Postgres 15+),   │ UNIQUE constraint that fails on    │
│         │          │                             │ but Migration 010 has standard │ NULL branch_id in PG <=14. Replace │
│         │          │                             │ UNIQUE constraint on (org, doc)│ with explicit PG15+ syntax.        │
├─────────┼──────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────────────────┤
│ **XDOC-2│ HIGH     │ 5.0C State Machine Sec 2.2  │ Order Cancellation Conflict:   │ IMPLEMENTATION BLOCKER             │
│         │          │ vs 5.0C Master Spec Sec 7.2 │ 5.0C State Machine allows      │ Reconcile: Partially fulfilled     │
│         │          │                             │ cancelling PARTIALLY_FULFILLED │ orders cannot transition to        │
│         │          │                             │ orders, while Master Spec says │ CANCELLED; must transition to      │
│         │          │                             │ issued items are immutable.    │ CLOSED_PARTIALLY_FULFILLED.        │
├─────────┼──────────────────────────┼────────────────────────────────┬────────────────────────────────────┤
│ **XDOC-3│ HIGH     │ 5.0C Master Spec Sec 2.1    │ Direct DML Status Conflict:    │ NON-BLOCKER (Design vs Staging)    │
│         │          │ vs Local Migrations 001–008 │ Spec says direct DML is revoked│ Clarify that closed-door DML is a  │
│         │          │                             │ from authenticated, but local  │ target requirement for Migration   │
│         │          │                             │ migrations GRANT INSERT/UPDATE.│ 015, NOT an existing deployed state│
├─────────┼──────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────────────────┤
│ **XDOC-4│ MEDIUM   │ 5.0C Concurrency Sec 2      │ Lock Level Internal Inversion: │ IMPLEMENTATION BLOCKER             │
│         │          │ vs 5.0C State Machine Sec 3 │ Level 2 lumps `products` and   │ Subdivide Level 2 into 2.1         │
│         │          │                             │ `customers` together without an│ (`customers`) and 2.2 (`products`) │
│         │          │                             │ internal lock acquisition order│ to guarantee zero intra-tier races.│
├─────────┼──────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────────────────┤
│ **XDOC-5│ MEDIUM   │ 5.0C CA/Legal Register      │ Statutory Certainty Drift:     │ NON-BLOCKER (Documentation)        │
│         │          │ vs 5.0C Master Spec Sec 1   │ Master Spec declares immutabil.│ Align: Master Spec must explicitly │
│         │          │                             │ "under the CGST Act 2017",     │ reference CA review dependency     │
│         │          │                             │ while CA Register flags TAX-03 │ (`TAX-03`) instead of assertion.   │
│         │          │                             │ as pending CA sign-off.        │                                    │
├─────────┼──────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────────────────┤
│ **XDOC-6│ MEDIUM   │ 5.0C State Machine Sec 2.6  │ Dispute Hold Dead-End:         │ ARCHITECTURE BLOCKER               │
│         │          │ vs 5.0B.2.1 Deprovisioning  │ If dispute raised after state  │ Add transition from AUTH_LOCKED    │
│         │          │                             │ reaches AUTH_LOCKED, state     │ to FRAUD_HELD with explicit session│
│         │          │                             │ machine has no path to hold.   │ freeze rules.                      │
└─────────┴──────────┴─────────────────────────────┴────────────────────────────────┴────────────────────────────────────┘
```

---

## 3. Detailed Forensic Analysis of Contradictions

### 3.1 XDOC-01: Document Sequence Uniqueness Constraint Mismatch
- **Affected Documents:** `PHASE_5_0C_MASTER_ARCHITECTURE_SPECIFICATION.md` (Section 5.2) vs `supabase/migrations/010_robust_document_numbering_sequences.sql` (lines 14–26).
- **The Contradiction:**
  - In `010_robust_document_numbering_sequences.sql`:
    ```sql
    CONSTRAINT document_sequences_org_type_key UNIQUE (organization_id, document_type)
    ```
    The committed migration only supports **one central sequence per organization** and completely lacks a `branch_id` column!
  - In `PHASE_5_0C_MASTER_ARCHITECTURE_SPECIFICATION.md` Section 5.2:
    The architecture specifies multi-branch sequence partitioning using PostgreSQL 15+:
    ```sql
    CONSTRAINT uq_document_sequences_partition 
        UNIQUE NULLS NOT DISTINCT (organization_id, document_type, branch_id);
    ```
- **Systemic Risk:** The local migration schema in git does not support branches for document numbering. If code expects `branch_id` in `document_sequences` today, queries will fail with `column branch_id does not exist`.
- **Required Correction:** Formally catalog this in Migration 015 requirements: Migration 015 must execute `ALTER TABLE public.document_sequences ADD COLUMN branch_id UUID REFERENCES public.branches(id)`, drop the old constraint `document_sequences_org_type_key`, and apply the new `UNIQUE NULLS NOT DISTINCT` constraint.
- **Blocker Status:** **IMPLEMENTATION BLOCKER** for multi-branch document numbering.

---

### 3.2 XDOC-02: Order Cancellation vs Post-Issuance Financial Immutability
- **Affected Documents:** `PHASE_5_0C_STATE_MACHINE_AND_TRANSACTION_CATALOG.md` (Section 2.2) vs `PHASE_5_0C_MASTER_ARCHITECTURE_SPECIFICATION.md` (Section 7.2).
- **The Contradiction:**
  - In the Sales Order state machine diagram, an order in status `PARTIALLY_FULFILLED` is shown with a direct transition:
    `PARTIALLY_FULFILLED --> CANCELLED`
  - In Master Architecture Spec Section 7.2, it is strictly stated that issued invoices and stock deductions are permanently immutable and can only be reversed via Credit Notes and return stock movements.
- **Systemic Risk:** If a user cancels a `PARTIALLY_FULFILLED` order in the frontend, what happens to the goods already dispatched and the invoice already issued? If the order is marked `CANCELLED`, the system reports a cancelled sale, but accounting ledgers retain an active issued invoice, leading to financial and tax audit divergence!
- **Required Correction:** The state machine must prohibit transitioning a `PARTIALLY_FULFILLED` order to `CANCELLED`. Instead:
  - Already-fulfilled items remain in `FULFILLED` status tied to their issued invoices.
  - The remaining unfulfilled line balance is closed via status `CLOSED_PARTIALLY_FULFILLED`.
  - If the customer returns already-delivered items, a separate **Sales Return & Credit Note workflow** must be executed.
- **Blocker Status:** **IMPLEMENTATION BLOCKER** for Sales Order lifecycle engine.

---

### 3.3 XDOC-03: Direct DML Privilege Status (Deployed vs Specified)
- **Affected Documents:** `PHASE_5_0C_MASTER_ARCHITECTURE_SPECIFICATION.md` (Section 2.1) vs `supabase/migrations/001_multi_tenant_base.sql` to `008_fix_authorization_vulnerabilities_and_null_roles.sql`.
- **The Contradiction:**
  - Section 2.1 states: *"CLOSED-DOOR DATABASE PRIVILEGE MODEL: Direct INSERT, UPDATE, DELETE REVOKED on all operational tables for authenticated"*.
  - However, in committed migrations `001` through `008`, PostgreSQL permissions on `invoices`, `customers`, and `products` include standard grants to `authenticated`:
    `GRANT SELECT, INSERT, UPDATE ON public.invoices TO authenticated;`
- **Systemic Risk:** A reader could erroneously assume that direct REST access is currently blocked in the staging database. In reality, staging currently allows direct DML from authenticated users. Direct REST writes are NOT blocked until Migration 015 is applied!
- **Required Correction:** Clarify in the Master Spec that the closed-door privilege model is **SPECIFIED FOR MIGRATION 015**, and is not an existing deployed protection.
- **Blocker Status:** **NON-BLOCKER** (Specification clarification).

---

### 3.4 XDOC-04: Level 2 Intra-Tier Lock Inversion Vector
- **Affected Documents:** `PHASE_5_0C_CONCURRENCY_AND_FAILURE_ANALYSIS.md` (Section 2) vs `PHASE_5_0C_STATE_MACHINE_AND_TRANSACTION_CATALOG.md` (Section 3).
- **The Contradiction:**
  - The Concurrency Analysis lumps `products` and `customers` together under **LEVEL 2: Master Entity Resource Locks**.
  - In `create_invoice_with_items`, the transaction locks products first (for stock checking), then checks customer credit limit (locking customers).
  - In customer credit limit adjustments or wholesale agreement modifications, a stored procedure may lock the customer row first, then lock product catalog rows to update custom price tiers.
- **Systemic Risk:** Because Level 2 does not establish an internal lock acquisition sequence between `customers` and `products`, concurrent execution of invoicing and customer pricing updates will produce circular deadlocks (`SQLSTATE 40P01`).
- **Required Correction:** Formalize internal ordering within Level 2:
  - **Level 2.1:** `customers FOR UPDATE`
  - **Level 2.2:** `products ORDER BY id ASC FOR UPDATE`
- **Blocker Status:** **IMPLEMENTATION BLOCKER** for concurrency-safe RPC authoring.

---

### 3.5 XDOC-05: Statutory Tax Assertions vs External Review Dependency
- **Affected Documents:** `PHASE_5_0C_MASTER_ARCHITECTURE_SPECIFICATION.md` (Section 1) vs `PHASE_5_0C_CA_LEGAL_REVIEW_REGISTER.md` (Item TAX-03).
- **The Contradiction:**
  - Master Spec Section 1 declares invoice immutability as a confirmed statutory mandate *"under the Central Goods and Services Tax (CGST) Act 2017"*.
  - The CA/Legal Register lists Item `TAX-03` as `[PENDING CA SIGN-OFF]`.
- **Systemic Risk:** Presenting an architectural design decision as a certified statutory fact prior to receiving professional CA sign-off exposes the platform to compliance liability if tax authorities recognize pre-upload cancellation procedures.
- **Required Correction:** Soften Master Spec narrative to state that immutability is an "architectural security baseline aligned with proposed GST Rule 53 / Section 34 interpretations, subject to CA confirmation (`TAX-03`)."
- **Blocker Status:** **NON-BLOCKER** (Documentation alignment).

---

### 3.6 XDOC-06: Deprovisioning State Machine Dispute Dead-End
- **Affected Documents:** `PHASE_5_0C_STATE_MACHINE_AND_TRANSACTION_CATALOG.md` (Section 2.6) vs `PHASE_5_0B_2_1_CORRECTED_RETENTION_AND_PRIVACY_POLICY.md` (Section 3).
- **The Contradiction:**
  - In the 5.0C Deprovisioning state machine diagram, the transition `INITIATED --> FRAUD_HELD` is permitted.
  - However, once the workflow advances to `AUTH_LOCKED`, there is no transition arrow to `FRAUD_HELD`.
- **Systemic Risk:** In real-world enterprise takeovers, an attacker initiates deprovisioning, and the target user's auth is locked (`AUTH_LOCKED`) before the user or administrator notices. If the incumbent owner calls emergency support on Day 2 while in `AUTH_LOCKED`, the state machine lacks a valid transition to place the deprovisioning on fraud hold!
- **Required Correction:** Add explicit transition:
  `AUTH_LOCKED --> FRAUD_HELD`
  with explicit rules that placing a hold in `AUTH_LOCKED` leaves the auth session locked (preventing attacker access) while freezing the timer and blocking `MEMBERSHIPS_SEVERED`.
- **Blocker Status:** **ARCHITECTURE BLOCKER** for Deprovisioning RPC design.
