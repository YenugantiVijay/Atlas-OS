# PHASE 5.0C.2 — LOCK GRAPH & CONCURRENCY REVIEW
## Authoritative Lock Graph, Real Code Inversion Audits, Multi-Row Ordering Standards, and Concurrency Test Specifications
**ATLAS OS Multi-Tenant Enterprise SaaS ERP Platform**  
**Classification:** Database Lock Graph, Concurrency Analysis & Runtime Stress Specifications  
**Target Repository:** `D:\Projects\Atlas-OS` | **Branch:** `Vijay-Atlas`  
**Target Staging Ref:** `bwswqnhlebbzdxumlkih` | **Production Ref:** `hrxjgbupjtikokqxjzbh` (STRICTLY FORBIDDEN)

---

## 1. Executive Summary & Verification Mandate

In PostgreSQL multi-tenant database applications, theoretical lock ordering models frequently fail in production due to:
- Unordered cursor loops iterating through rows in arbitrary physical table scan order.
- Inversion of locks between nested helper functions and caller procedures.
- Implicit foreign-key locks taken by PostgreSQL during parent key checks.
- Granularity omissions within lock levels (intra-tier inversions).

This document presents the **Complete Source-Derived Lock Graph for ATLAS OS**, documents **two verified lock inversions discovered in committed migration SQL**, formalizes the **subdivided 6-level lock hierarchy**, and establishes the **mandatory runtime concurrency stress-test specification**.

---

## 2. Source-Derived Complete Lock Graph

The diagram below synthesizes every table, lock level, and lock mode across all existing and planned stored procedures:

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       ATLAS OS COMPLETE LOCK ORDERING GRAPH                                            │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

    [ LEVEL 1: Root Organization Lock ]
    `SELECT id FROM public.organizations WHERE id = p_org_id FOR UPDATE;`
    (Mode: RowExclusiveLock / FOR UPDATE)
    • Serializes: Organization onboarding, ownership transfers, Co-Owner management,
      membership status mutations, organization closure, tenant-wide settings changes.
                        │
                        ▼
    [ LEVEL 2.1: Customer Master Lock ]
    `SELECT id, credit_limit FROM public.customers WHERE id = p_customer_id FOR UPDATE;`
    (Mode: RowExclusiveLock / FOR UPDATE)
    • Serializes: Customer credit limit changes, payment allocations, invoice customer balance checks.
                        │
                        ▼
    [ LEVEL 2.2: Product Inventory Catalog Locks ]
    `SELECT id FROM public.products WHERE id = ANY(p_product_ids) ORDER BY id ASC FOR UPDATE;`
    (Mode: RowExclusiveLock / FOR UPDATE — MANDATORY PRIMARY KEY ASCENDING SORT)
    • Serializes: Stock deductions, order confirmations, inventory write-offs, SKU transfers.
                        │
                        ▼
    [ LEVEL 3.2: Governance & Approval Workflow Locks ]
    `SELECT id FROM public.approval_requests WHERE id = p_request_id FOR UPDATE;`
    (Mode: RowExclusiveLock / FOR UPDATE)
    • Serializes: Approval decisions, dual-approver quorum signing, request expirations.
                        │
                        ▼
    [ LEVEL 3.5: Operational Financial Ledger Locks ]
    `SELECT id, total_amount, total_paid FROM public.invoices WHERE id = p_inv_id FOR UPDATE;`
    `SELECT id FROM public.sales_orders WHERE id = p_order_id FOR UPDATE;`
    (Mode: RowExclusiveLock / FOR UPDATE)
    • Serializes: Order fulfillment, invoice status transitions, payment allocation balance updates.
                        │
                        ▼
    [ LEVEL 4: Document Sequence Allocator Lock ]
    `INSERT INTO public.document_sequences ... ON CONFLICT DO UPDATE RETURNING ...;`
    (Mode: RowExclusiveLock on sequence row)
    • Serializes: Gapless sequence number allocation for INVOICE, RECEIPT, SO, QT.
    • CRITICAL RULE: Held for microseconds at the VERY END of transactions immediately before COMMIT.
                        │
                        ▼
    [ LEVEL 5: Audit Event Append-Only Stream ]
    `INSERT INTO public.audit_events (...) VALUES (...);`
    (Mode: RowExclusiveLock on new append-only row; ZERO locks on historical rows)
```

---

## 3. Real Lock Inversions Discovered in Committed Code

### 3.1 Defect 1: Unordered Cursor Loop Deadlock in `confirm_sales_order`
- **Location:** `supabase/migrations/008_fix_authorization_vulnerabilities_and_null_roles.sql` (lines 144–156).
- **Inspected Code:**
  ```sql
  FOR v_item IN
      SELECT oi.product_id, oi.quantity, oi.product_name, oi.product_sku
      FROM public.sales_order_items oi
      JOIN public.sales_orders so ON so.id = oi.sales_order_id
      WHERE oi.sales_order_id = p_order_id AND so.organization_id = p_org_id
  LOOP
      ...
      PERFORM id FROM public.products
      WHERE id = v_item.product_id AND organization_id = p_org_id
      FOR UPDATE;
  ```
- **Concurrency Defect:** The `SELECT oi.product_id ...` query has **NO `ORDER BY` CLAUSE**! Rows are retrieved in physical disk block order.
- **Deadlock Attack Vector:**
  - Order 1 contains Line 1 (Wire, UUID `...111`) and Line 2 (Switch, UUID `...999`).
  - Order 2 contains Line 1 (Switch, UUID `...999`) and Line 2 (Wire, UUID `...111`).
  - If Cashier 1 confirms Order 1 and Cashier 2 confirms Order 2 concurrently:
    - Worker 1 locks Wire (`...111`), then attempts to lock Switch (`...999`).
    - Worker 2 locks Switch (`...999`), then attempts to lock Wire (`...111`).
    - **Deadlock occurs!** PostgreSQL aborts one transaction with SQLSTATE `40P01`.
- **Mandatory Correction for Migration 015:**
  The cursor query must enforce deterministic primary key ordering:
  ```sql
  FOR v_item IN
      SELECT oi.product_id, oi.quantity, oi.product_name, oi.product_sku
      FROM public.sales_order_items oi
      JOIN public.sales_orders so ON so.id = oi.sales_order_id
      WHERE oi.sales_order_id = p_order_id AND so.organization_id = p_org_id
      ORDER BY oi.product_id ASC  -- MANDATORY DETERMINISTIC SORT
  LOOP
  ```

---

### 3.2 Defect 2: Premature Sequence Allocation in `record_payment_and_allocate`
- **Location:** `supabase/migrations/011_atomic_receipt_numbering.sql` (lines 363 vs 394).
- **Inspected Code:**
  - **Line 363:** `v_payment_num := public.internal_allocate_document_number(p_org_id, 'RECEIPT', ...);` $\implies$ Acquires Level 4 Sequence Lock!
  - **Line 394:** `SELECT ... FROM public.invoices WHERE id = p_invoice_id ... FOR UPDATE;` $\implies$ Acquires Level 3.5 Invoice Lock!
- **Concurrency Defect:** Level 4 is acquired **BEFORE** Level 3.5.
- **Systemic Concurrency Risks:**
  1. **Lock Bottleneck:** The row lock on `document_sequences` (for `RECEIPT`) is held while waiting for the invoice row lock. If another transaction holds the invoice lock, all receipt allocations across the entire organization stall!
  2. **Sequence Gapping on Validation Failure:** If the invoice allocation validation fails at line 409 (e.g. overpayment error), the transaction rolls back, burning an official receipt number and creating a statutory sequence gap!
- **Mandatory Correction for Migration 015:**
  Reorder execution inside `record_payment_and_allocate`:
  1. Lock and validate `customers` (Level 2.1).
  2. Lock and validate `invoices` (Level 3.5).
  3. Validate allocation bounds.
  4. **Only after all validations pass**, allocate the receipt sequence number (Level 4) immediately prior to `INSERT INTO payments` and `COMMIT`.

---

## 4. Multi-Row Deterministic Sorting Specification

To prevent multi-row deadlocks across all array-based stored procedures in ATLAS OS:

```sql
-- CANONICAL DDL PATTERN: Deterministic Bulk Lock Acquisition
CREATE OR REPLACE FUNCTION public.lock_products_deterministically(
    p_org_id UUID,
    p_product_ids UUID[]
)
RETURNS VOID AS $$
BEGIN
    PERFORM id 
    FROM public.products 
    WHERE id = ANY(p_product_ids) 
      AND organization_id = p_org_id
    ORDER BY id ASC  -- STRICT DETERMINISTIC ASCENDING SORT
    FOR UPDATE;
END;
$$ LANGUAGE plpgsql;
```

---

## 5. Foreign Key Implicit Lock Analysis in PostgreSQL

In PostgreSQL, inserting or updating rows in child tables acquires implicit locks on referenced parent tables:
- **Child Insert (`invoice_items` referencing `invoices`):**
  PostgreSQL acquires a `KEY SHARE` lock on the referenced parent row in `invoices`. `KEY SHARE` is compatible with `FOR UPDATE` and `FOR SHARE`, but conflicts with `UPDATE` on primary/unique keys of the parent row.
- **Parent Key Mutation Danger:**
  If an administrative transaction updates `organizations.id` or `customers.id`, PostgreSQL upgrades locks to `SHARE ROW EXCLUSIVE`, conflicting with all concurrent child inserts!
- **The Defense:** All primary keys in ATLAS OS are immutable UUIDs generated via `gen_random_uuid()`. Primary keys are **NEVER UPDATED**, eliminating parent key escalation deadlocks.

---

## 6. Tier 2 Runtime Concurrency Stress Test Specification

Static inspection can identify obvious inversions, but **cannot prove deadlock freedom under distributed runtime loads**. 

Prior to production sign-off, the following automated multi-connection stress test suite must be executed against the staging environment:

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       TIER 2 RUNTIME CONCURRENCY STRESS SUITE                                          │
├────┬─────────────────────────────┬────────────────────────────────────┬────────────────────────────────────────────────┤
│ #  │ Test Workload Scenario      │ Worker Concurrency & Iterations    │ Strict Pass Criteria (Zero Tolerance)          │
├────┼─────────────────────────────┼────────────────────────────────────┼────────────────────────────────────────────────┤
│ 01 │ High-Contention Counter     │ 25 concurrent connections billing   │ • Zero deadlocks (PostgreSQL 40P01 = 0).       │
│    │ Sales on Overlapping SKUs   │ 5 overlapping products for 500 txns│ • Final stock movements sum matches exactly.   │
│    │                             │ simultaneously.                    │ • 100% clean commits or graceful retries.      │
├────┼─────────────────────────────┼────────────────────────────────────┼────────────────────────────────────────────────┤
│ 02 │ Concurrent Invoicing vs     │ 10 workers confirming orders while │ • Zero deadlocks (PostgreSQL 40P01 = 0).       │
│    │ Customer Credit Updates     │ 5 workers adjust customer credit.  │ • Customer balance matches ledger exactly.     │
├────┼─────────────────────────────┼────────────────────────────────────┼────────────────────────────────────────────────┤
│ 03 │ Interleaved Receipt Number  │ 20 concurrent connections recording│ • Zero sequence gaps in receipt numbers.       │
│    │ Allocations & Payments      │ payments against same invoice.     │ • Zero overpayment (invoice balance >= 0.00).  │
├────┼─────────────────────────────┼────────────────────────────────────┼────────────────────────────────────────────────┤
│ 04 │ Parallel Dual Approver      │ 2 authorized approvers submitting  │ • Exactly 2 signatures recorded in decisions.  │
│    │ Quorum Signing Stress       │ signatures at identical millisecond│ • Zero race-condition overwrite.               │
└────┴─────────────────────────────┴────────────────────────────────────┴────────────────────────────────────────────────┘
```
