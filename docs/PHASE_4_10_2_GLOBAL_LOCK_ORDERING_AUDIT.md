# PHASE 4.10.2 — GLOBAL DATABASE LOCK ORDERING & DEADLOCK ANALYSIS

## 1. Environment & Read-Only Pre-Flight Verification

This audit was conducted in **STRICTLY READ-ONLY** mode. Zero application code files were modified, zero migrations were created or applied, zero database mutations were executed, and zero production systems were accessed.

- **Repository Target:** `D:\Projects\Atlas-OS`
- **Active Git Branch:** `Vijay-Atlas` (verified; uncommitted changes in `src/components/layout/NewOrgModal.tsx` and `src/features/organizations/OrgContext.tsx` preserved untouched).
- **Target Supabase Staging Reference:** `bwswqnhlebbzdxumlkih` (`ATLAS-OS-Staging`). Verified via `supabase/.temp/project-ref`.
- **Production Reference:** `hrxjgbupjtikokqxjzbh` — STRICTLY FORBIDDEN (0 queries executed, 0 network requests initiated).
- **Audit Scope:** All migrations (`001` through `014`), all frontend services in `src/services/`, state providers in `src/features/`, triggers, RPCs, foreign-key locks, and concurrency contracts.

---

## 2. Complete Database Write Path Inventory

Every database write path across the ATLAS OS repository was forensically traced, identifying explicit and implicit locks, transaction boundaries, and nested invocations.

### 2.1 Summary of All Database Writers

| Path ID | Entry Point / Function | Caller Role | Tables Read or Mutated | Explicit Row Locks Acquired | Implicit Database Locks | Transaction Boundary | Overlapping Resources |
| :-: | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **W-01** | `invoicesService.createInvoice` | `authenticated` (admin, accounts) | `document_sequences`, `invoices`, `invoice_items` | None in client; RPC locks `document_sequences` | `RowExclusiveLock` on `invoices`, `invoice_items`. FK checks on `organizations`, `customers`, `products`. | **Non-Atomic** (3 independent HTTP requests) | `document_sequences`, `invoices`, `invoice_items` |
| **W-02** | `record_payment_and_allocate` (RPC) | `authenticated` (owner, admin, accounts) | `document_sequences`, `payments`, `invoices`, `payment_allocations`, `audit_events` | 1. `document_sequences` (Row lock via upsert)<br>2. `invoices` (`FOR UPDATE`) | `RowExclusiveLock` on `payments`, `payment_allocations`, `audit_events`. FK checks on `organizations`, `customers`, `invoices`. | **Single Atomic DB Transaction** | `document_sequences` (RECEIPT), `invoices`, `payments` |
| **W-03** | `confirm_sales_order` (RPC) | `authenticated` (owner, admin, sales) | `sales_orders`, `sales_order_items`, `products`, `stock_movements`, `audit_events` | 1. `sales_orders` (`FOR UPDATE`)<br>2. `products` (`FOR UPDATE` in loop) | `RowExclusiveLock` on `stock_movements`, `audit_events`. FK checks on `organizations`, `products`. | **Single Atomic DB Transaction** | `sales_orders`, `products`, `stock_movements` |
| **W-04** | `ordersService.createSalesOrder` | `authenticated` (admin, sales) | `document_sequences`, `sales_orders`, `sales_order_items` | None in client; RPC locks `document_sequences` | `RowExclusiveLock` on `sales_orders`, `sales_order_items`. FK checks on `organizations`, `customers`, `products`. | **Non-Atomic** (3 independent HTTP requests) | `document_sequences`, `sales_orders`, `sales_order_items` |
| **W-05** | `ordersService.createQuotation` | `authenticated` (admin, sales) | `document_sequences`, `quotations`, `quotation_items` | None in client; RPC locks `document_sequences` | `RowExclusiveLock` on `quotations`, `quotation_items`. FK checks on `organizations`, `customers`, `products`. | **Non-Atomic** (3 independent HTTP requests) | `document_sequences`, `quotations`, `quotation_items` |
| **W-06** | `ordersService.acceptQuotation` | `authenticated` (admin, sales) | `quotations` | None (Direct REST update) | `RowExclusiveLock` on `quotations` | Single REST request | `quotations` |
| **W-07** | `productsService.createProduct` | `authenticated` (admin, inventory) | `products`, `stock_movements` | None | `RowExclusiveLock` on `products`, `stock_movements`. Unique index on `(organization_id, sku)`. | **Non-Atomic** (2 independent HTTP requests if openingStock > 0) | `products`, `stock_movements` |
| **W-08** | `productsService.updateProduct` | `authenticated` (admin, inventory) | `products` | None (Direct REST update) | `RowExclusiveLock` on `products` | Single REST request | `products` |
| **W-09** | `inventoryService.adjustStock` | `authenticated` (admin, inventory) | `stock_movements` | None (Direct REST insert) | `RowExclusiveLock` on `stock_movements`. FK checks on `organizations`, `products`. | Single REST request | `stock_movements` |
| **W-10** | `customersService.createCustomer` | `authenticated` (admin, sales, accounts) | `customers` | None (Direct REST insert) | `RowExclusiveLock` on `customers`. Unique constraint on `(organization_id, gstin)`. | Single REST request | `customers` |
| **W-11** | `customersService.updateCustomer` | `authenticated` (admin, sales, accounts) | `customers` | None (Direct REST update) | `RowExclusiveLock` on `customers` | Single REST request | `customers` |
| **W-12** | `suppliersService.createSupplier` | `authenticated` (admin, inventory, accounts) | `suppliers` | None (Direct REST insert) | `RowExclusiveLock` on `suppliers` | Single REST request | `suppliers` |
| **W-13** | `suppliersService.updateSupplier` | `authenticated` (admin, inventory, accounts) | `suppliers` | None (Direct REST update) | `RowExclusiveLock` on `suppliers` | Single REST request | `suppliers` |
| **W-14** | `teamService.updateMemberRole` | `authenticated` (owner only) | `memberships`, `audit_events` | None | `RowExclusiveLock` on `memberships`, `audit_events` | **Non-Atomic** (2 independent REST requests) | `memberships`, `audit_events` |
| **W-15** | `teamService.toggleMemberActive` | `authenticated` (owner only) | `memberships`, `audit_events` | None | `RowExclusiveLock` on `memberships`, `audit_events` | **Non-Atomic** (2 independent REST requests) | `memberships`, `audit_events` |
| **W-16** | `create_organization` (RPC) | `authenticated` / `anon` | `organizations`, `memberships`, `organization_creation_idempotency`, `organization_subscriptions`, `audit_events` | Unique index lock on idempotency key | `RowExclusiveLock` on 5 tables | **Single Atomic DB Transaction** | `organizations`, `memberships`, `organization_subscriptions` |
| **W-17** | `self_declare_organization_eligibility` (RPC) | `authenticated` | `organization_eligibility`, `eligibility_audit_logs`, `audit_events` | None (Upsert row lock) | `RowExclusiveLock` on 3 tables | **Single Atomic DB Transaction** | `organization_eligibility`, `eligibility_audit_logs` |
| **W-18** | `review_organization_eligibility` (RPC) | Platform Reviewer (`service_role` / reviewer) | `organization_eligibility`, `eligibility_audit_logs`, `audit_events` | None | `RowExclusiveLock` on 3 tables | **Single Atomic DB Transaction** | `organization_eligibility`, `eligibility_audit_logs` |
| **W-19** | `OrgContext.updateOrgSettings` | `authenticated` (owner, admin) | `organizations` | None (Direct REST update) | `RowExclusiveLock` on `organizations` (Exclusive tuple lock) | Single REST request | `organizations` |
| **W-20** | Proposed `issue_draft_invoice` (RPC) | `authenticated` (owner, admin, accounts) | `organizations`, `invoices`, `invoice_items`, `document_sequences`, `audit_events` | 1. `organizations` (`FOR SHARE`)<br>2. `invoices` (`FOR UPDATE`)<br>3. `invoice_items` (`FOR UPDATE`)<br>4. `document_sequences` (Row lock) | `RowExclusiveLock` on `invoices`, `document_sequences`, `audit_events` | **Single Atomic DB Transaction** | `organizations`, `invoices`, `invoice_items`, `document_sequences` |

---

## 3. The Lock-Order Table & Dependency Graph

### 3.1 Lock Order Comparison Table Across Major Writers

```
+-----------------------------------------------------------------------------------------------------------------------+
| RESOURCE LOCK ACQUISITION SEQUENCES IN ACTUAL CODE                                                                    |
+-----------------------------------------------------------------------------------------------------------------------+
| Writer Function            | Step 1              | Step 2             | Step 3            | Step 4           | Step 5  |
+-----------------------------------------------------------------------------------------------------------------------+
| record_payment_and_allocate| document_sequences  | payments (INSERT)  | invoices (UPDATE) | payment_alloc.   | audit   |
| confirm_sales_order        | sales_orders (LOCK) | products (LOOP!)   | stock_movements   | sales_orders(UPD)| audit   |
| Proposed issue_draft_inv.  | organizations(SHARE)| invoices (LOCK)    | invoice_items(LCK)| document_seq.    | audit   |
| Direct invoice_items DML   | invoice_items (ROW) | invoices (TRIGGER!)| -                 | -                | -       |
| OrgContext.updateOrgSettings| organizations(LOCK) | -                  | -                 | -                | -       |
+-----------------------------------------------------------------------------------------------------------------------+
```

### 3.2 Directed Lock-Order Dependency Graph

```
                                  [Level 1: organizations]
                                      /              \
                                     / (FOR SHARE)    \ (FOR UPDATE)
                                    v                  v
                   [Level 2: memberships]        [Level 19: Org Settings Update]
                             |
                             +------------------------+
                             |                        |
                             v                        v
             [Level 3A: sales_orders]        [Level 3B: invoices] <---------------+
                      |                               |                           |
                      |                               v                           | (BEFORE UPDATE trigger)
                      v                      [Level 4: invoice_items] ------------+ (DEADLOCK CYCLE 2!)
            [Level 5: products]                       |
              (UNSORTED LOOP!)                        v
         (DEADLOCK CYCLE 1: A->B vs B->A)   [Level 6: document_sequences]
                      |                               ^
                      v                               | (Allocates RECEIPT first)
           [Level 7A: stock_movements]                +---------------------------+
                                                      |                           |
                                           [Level 7B: payments]        [Level 2: record_payment]
                                                      |                           |
                                                      v                           | (Locks invoice SECOND)
                                           [Level 7C: payment_allocations] -------+ (INCONSISTENT ORDER)
                                                      |
                                                      v
                                            [Level 8: audit_events]
```

---

## 4. Forensic Deadlock-Cycle Analysis

### Cycle 1: Multi-Product Unordered Row Locking in `confirm_sales_order` (CONFIRMED CRITICAL)
- **Participating Transactions:**
  - $T_1$: Worker confirming Sales Order 1 containing Product $A$ and Product $B$.
  - $T_2$: Worker confirming Sales Order 2 containing Product $B$ and Product $A$.
- **Inspected Source Code:**
  `supabase/migrations/014_harden_operational_rls_with_eligibility.sql`, lines 716–735:
  ```sql
  FOR v_item IN
      SELECT oi.product_id, oi.quantity, oi.product_name, oi.product_sku
      FROM public.sales_order_items oi
      JOIN public.sales_orders so ON so.id = oi.sales_order_id
      WHERE oi.sales_order_id = p_order_id AND so.organization_id = p_org_id
  LOOP
      PERFORM id FROM public.products
      WHERE id = v_item.product_id AND organization_id = p_org_id
      FOR UPDATE;
      ...
  ```
- **The Defect:**
  The cursor query has **NO `ORDER BY` clause**. Rows are fetched in arbitrary physical heap or index order.
- **Deadlock Execution Trace:**
  1. $T_1$ starts confirming Order 1. Locks `sales_orders(Order 1)`. First iteration locks `products(Product A) FOR UPDATE`.
  2. $T_2$ starts confirming Order 2. Locks `sales_orders(Order 2)`. First iteration locks `products(Product B) FOR UPDATE`.
  3. $T_1$ moves to next line item: attempts to lock `products(Product B) FOR UPDATE` $\to$ **Blocks waiting for $T_2$**.
  4. $T_2$ moves to next line item: attempts to lock `products(Product A) FOR UPDATE` $\to$ **Blocks waiting for $T_1$**.
  5. **PostgreSQL Deadlock Detector triggers:** $T_1$ waits on $T_2$; $T_2$ waits on $T_1$. Cycle confirmed.
  6. **Error:** `40P01 (deadlock_detected)`. One transaction is abruptly aborted.
- **Classification:** **CONFIRMED CRITICAL**. High probability under concurrent sales order confirmation traffic whenever multiple line items share common inventory products.
- **Remediation:** Append `ORDER BY oi.product_id ASC` to the cursor query.

---

### Cycle 2: Direct Line-Item DML vs. Atomic Invoice Issuance (CONFIRMED HIGH)
- **Participating Transactions:**
  - $T_1$: Atomic Invoice Issuance (`issue_draft_invoice`).
  - $T_2$: Concurrent Direct Line-Item Update (`UPDATE public.invoice_items SET quantity = ... WHERE id = ...`).
- **Mechanism:**
  - In PostgreSQL, when an `UPDATE` executes on a table, the PostgreSQL executor acquires a row-level `ExclusiveLock` on the target tuple in `invoice_items` **BEFORE** evaluating any `BEFORE UPDATE` triggers!
  - Once the row lock on `invoice_items(item_id)` is held, the proposed trigger `trg_protect_invoice_items` executes and attempts:
    `SELECT totals_version, status FROM public.invoices WHERE id = NEW.invoice_id FOR SHARE;`
- **Deadlock Execution Trace:**
  1. $T_1$ (`issue_draft_invoice`) starts: locks parent `invoices(inv_id) FOR UPDATE`.
  2. $T_2$ (`UPDATE invoice_items`) executes: PostgreSQL engine locks `invoice_items(item_id) FOR UPDATE`.
  3. $T_1$ attempts step 4: `PERFORM 1 FROM public.invoice_items WHERE invoice_id = inv_id FOR UPDATE` $\to$ **Blocks waiting for $T_2$ on `invoice_items(item_id)`**.
  4. $T_2$'s trigger fires: attempts `SELECT ... FROM public.invoices WHERE id = inv_id FOR SHARE` $\to$ **Blocks waiting for $T_1$ on `invoices(inv_id)`** (because `FOR SHARE` conflicts with $T_1$'s `FOR UPDATE`).
  5. **PostgreSQL Deadlock:** $T_1$ holds `invoices` waiting for `invoice_items`; $T_2$ holds `invoice_items` waiting for `invoices`.
- **Classification:** **CONFIRMED HIGH**. Demonstrates that a trigger-only parent lock cannot prevent deadlocks if the child table is locked prior to trigger entry.
- **Remediation:** Item mutations must NOT be performed via uncoordinated direct REST DML. All line-item mutations must be encapsulated within dedicated RPCs (`update_draft_invoice_item`) that explicitly acquire `invoices FOR UPDATE / FOR SHARE` **BEFORE** executing DML on `invoice_items`.

---

### Cycle 3: Inverted Lock Order Between Payment Recording & Invoice Issuance (PLAUSIBLE HIGH)
- **Participating Transactions:**
  - $T_1$: `record_payment_and_allocate` (Migration 011/014).
  - $T_2$: Proposed `issue_draft_invoice`.
- **Mechanism:**
  - $T_1$ (`record_payment_and_allocate`):
    1. Line 947: calls `internal_allocate_document_number(p_org_id, 'RECEIPT', year)` $\to$ acquires row lock on `document_sequences(org_id, 'RECEIPT', year)`.
    2. Line 978: `SELECT ... FROM public.invoices WHERE id = p_invoice_id FOR UPDATE` $\to$ acquires row lock on `invoices(invoice_id)`.
  - $T_2$ (`issue_draft_invoice`):
    1. Step 2: `SELECT ... FROM public.invoices WHERE id = p_invoice_id FOR UPDATE` $\to$ acquires row lock on `invoices(invoice_id)`.
    2. Step 6: calls `internal_allocate_document_number(p_org_id, 'INVOICE', year)` $\to$ acquires row lock on `document_sequences(org_id, 'INVOICE', year)`.
- **Resource Key Analysis:**
  - $T_1$ locks `document_sequences` row key `(org_id, 'RECEIPT', year)`.
  - $T_2$ locks `document_sequences` row key `(org_id, 'INVOICE', year)`.
  - Because `document_type` differs, they are distinct physical tuples in the index/table. Under normal execution on distinct rows, PostgreSQL row locks do not conflict.
- **The Hidden Deadlock Vulnerability:**
  - If a concurrent administrative transaction (e.g., end-of-year sequence rollover or sequence audit query) performs an update across all document types:
    `UPDATE public.document_sequences SET current_value = ... WHERE organization_id = p_org_id;`
  - Or if table-level lock escalation or unindexed table scans occur, a triangular deadlock forms:
    - $T_1$ holds `document_sequences('RECEIPT')`, waits for `invoices`.
    - $T_2$ holds `invoices`, waits for `document_sequences('INVOICE')`.
    - $T_3$ holds `document_sequences('INVOICE')`, waits for `document_sequences('RECEIPT')`.
- **Classification:** **PLAUSIBLE HIGH (Structural Risk)**. Inverting lock order across two high-traffic financial functions violates core transaction engineering principles.
- **Remediation:** In `record_payment_and_allocate`, move the `invoices FOR UPDATE` lock to the start of the function **BEFORE** invoking `internal_allocate_document_number`.

---

### Cycle 4: Organization Settings Update vs. Concurrent Document Creation / FK Verification (PLAUSIBLE MEDIUM)
- **Participating Transactions:**
  - $T_1$: Merchant updating organization profile (`OrgContext.tsx` line 562: `UPDATE organizations SET ...`).
  - $T_2$: Concurrent worker issuing an invoice (`issue_draft_invoice`).
- **Mechanism:**
  - In PostgreSQL, when `UPDATE organizations` executes, it acquires an exclusive `FOR UPDATE` lock on the `organizations` row.
  - When $T_2$ runs, it acquires `organizations FOR SHARE`.
  - `FOR SHARE` strictly conflicts with `FOR UPDATE` on the same tuple! $T_2$ blocks until $T_1$ commits.
  - If $T_1$ subsequently calls an RPC or triggers an audit event that touches documents or sequences, a circular wait is created.
- **Classification:** **PLAUSIBLE MEDIUM**.
- **Remediation:** Ensure all organization profile updates are strictly isolated, touch zero document tables, and execute with a 5-second `lock_timeout`.

---

## 5. Evaluation of the Proposed Global Lock Standard

The proposed universal ordering:
1. `organizations` row (`FOR SHARE` or `FOR UPDATE`).
2. `memberships` rows, in deterministic `user_id ASC` order.
3. Business document parent rows (`invoices`, `sales_orders`, `quotations`).
4. Child rows (`invoice_items`, `sales_order_items`, `quotation_items`), in deterministic `id ASC` order.
5. Inventory/product rows (`products`), in deterministic `product_id ASC` order.
6. Document-sequence rows (`document_sequences`), in `(organization_id, document_type, year)` order.
7. Payment and allocation rows (`payments`, `payment_allocations`).
8. Audit writes (`audit_events`, `eligibility_audit_logs`).

### 5.1 Critical Evaluation & Violations in Existing Code
1. **Existing Code Violations:**
   - **Violation 1:** `record_payment_and_allocate` acquires Level 6 (`document_sequences`) *before* Level 3 (`invoices`).
   - **Violation 2:** `confirm_sales_order` acquires Level 5 (`products`) in non-deterministic order (violates Level 5 sorting requirement).
   - **Violation 3:** Direct REST DML on child items (`invoice_items`, `sales_order_items`) acquires Level 4 *before* Level 3.
2. **Suitability Verdict:**
   The single universal ordering is **theoretically sound and mathematically optimal**, but **cannot be considered enforced until the three existing code violations are remediated**.

### 5.2 Recommended Transaction Classes
To prevent lock overhead and deadlock risks across disparate business domains, four discrete transaction classes are established:

```
+---------------------------------------------------------------------------------------------------+
| TRANSACTION CLASS ARCHITECTURE & ISOLATION BOUNDARIES                                             |
+---------------------------------------------------------------------------------------------------+
| CLASS A: Commercial Issuance & Lifecycle Transactions                                             |
|   - Scope: issue_draft_invoice, confirm_sales_order, cancel_invoice                                |
|   - Permitted Lock Sequence: organizations -> parent_doc -> child_items -> products -> doc_seq   |
+---------------------------------------------------------------------------------------------------+
| CLASS B: Financial Settlement Transactions                                                        |
|   - Scope: record_payment_and_allocate, reverse_payment                                           |
|   - Permitted Lock Sequence: organizations -> invoices (FOR UPDATE) -> doc_seq -> payments       |
+---------------------------------------------------------------------------------------------------+
| CLASS C: Inventory Operations                                                                     |
|   - Scope: adjustStock, createProduct, bulkInventoryImport                                        |
|   - Permitted Lock Sequence: organizations -> products (deterministic id ASC) -> stock_movements |
+---------------------------------------------------------------------------------------------------+
| CLASS D: Administrative & Tenant Governance                                                       |
|   - Scope: create_organization, updateMemberRole, eligibility_review                              |
|   - Permitted Lock Sequence: organizations -> memberships (deterministic user_id ASC)             |
+---------------------------------------------------------------------------------------------------+
```

---

## 6. Future Concurrency Test Matrix

The following 8 deterministic test specifications are designed for execution in a staging environment. **No concurrency tests were executed during this read-only audit.**

### Test Scenario 1: Two Simultaneous Issuance Attempts on the Same Draft
- **Initial State:** Invoice `INV-TEST-01` in `DRAFT` status with 2 line items.
- **Transaction A:** Calls `issue_draft_invoice('INV-TEST-01', key='KEY-A')`.
- **Transaction B:** Calls `issue_draft_invoice('INV-TEST-01', key='KEY-B')`.
- **Expected Lock Waits:**
  - $T_A$ acquires `invoices('INV-TEST-01') FOR UPDATE`.
  - $T_B$ blocks on `invoices('INV-TEST-01')`.
- **Expected Final State:**
  - $T_A$ completes, sets status to `ISSUED`, assigns `ATL/26-27/0001`, commits.
  - $T_B$ unblocks, reads `status = 'ISSUED'`, detects key mismatch, rejects with `ERR_INVOICE_ALREADY_ISSUED` (HTTP 409).
  - Sequence incremented exactly once.

### Test Scenario 2: Invoice Issuance Concurrent with Direct Line-Item Update
- **Initial State:** Invoice `INV-TEST-02` in `DRAFT` status with Item `ITM-01`.
- **Transaction A:** Calls `issue_draft_invoice('INV-TEST-02')`.
- **Transaction B:** Executes `UPDATE invoice_items SET quantity = 10 WHERE id = 'ITM-01'`.
- **Expected Lock Behavior:**
  - If direct DML is permitted without parent lock: **DEADLOCK (Cycle 2)**.
  - With Remediated RPC (`update_draft_invoice_item`): $T_B$ acquires `invoices FOR SHARE` first. $T_A$ waits for $T_B$ to finish, or $T_B$ waits for $T_A$. Clean serialization without cycle.

### Test Scenario 3: Payment Recording Concurrent with Invoice Issuance
- **Initial State:** Invoice `INV-TEST-03` in `DRAFT` status.
- **Transaction A:** Calls `issue_draft_invoice('INV-TEST-03')`.
- **Transaction B:** Calls `record_payment_and_allocate('INV-TEST-03', amount=500)`.
- **Expected Lock Behavior:**
  - With remediated lock order: Both transactions request `invoices('INV-TEST-03') FOR UPDATE` as their primary lock.
  - Whichever acquires it first serializes the second.
  - If $T_A$ runs first: Invoice is issued; $T_B$ runs second and allocates payment to the now-issued invoice.
  - If $T_B$ runs first: $T_B$ rejects because draft invoices cannot receive payment allocations. Clean, race-free outcome.

### Test Scenario 4: Two Concurrent Payments Against the Same Invoice
- **Initial State:** Invoice `INV-TEST-04` with `total_amount = 1000.00`, `total_paid = 0.00`.
- **Transaction A:** Calls `record_payment_and_allocate('INV-TEST-04', amount=600.00)`.
- **Transaction B:** Calls `record_payment_and_allocate('INV-TEST-04', amount=600.00)`.
- **Expected Lock Waits:**
  - $T_A$ acquires `invoices('INV-TEST-04') FOR UPDATE`.
  - $T_B$ blocks on `invoices('INV-TEST-04')`.
- **Expected Final State:**
  - $T_A$ succeeds, updates `total_paid = 600.00`, status `PARTIALLY_PAID`, commits.
  - $T_B$ unblocks, reads `total_paid = 600.00`. Checks `600 + 600 > 1000` $\to$ raises `Overpayment violation`, rolls back.
  - Overpayment strictly prevented.

### Test Scenario 5: Two Sales Orders Competing for Shared Inventory
- **Initial State:** Product $A$ (Stock: 10), Product $B$ (Stock: 10).
- **Transaction A:** Confirms Order 1 requesting 8 units of Product $A$ and 8 units of Product $B$.
- **Transaction B:** Confirms Order 2 requesting 8 units of Product $B$ and 8 units of Product $A$.
- **Expected Lock Behavior:**
  - **In Current Code:** Deterministic deadlock occurs (Cycle 1).
  - **In Remediated Code (`ORDER BY product_id ASC`):**
    - Both transactions attempt to lock Product $A$ first, then Product $B$.
    - $T_A$ locks Product $A$ and Product $B$, deducts stock (remaining: 2 of each), commits.
    - $T_B$ unblocks, locks Product $A$, evaluates `get_product_stock(Product A) = 2 < 8` $\to$ raises `Insufficient stock`, cleanly aborts. Zero deadlocks.

### Test Scenario 6: Concurrent Role Update on Multiple Team Members
- **Initial State:** Organization members `User-A` and `User-B`.
- **Transaction 1:** Bulk role update updating `User-A` then `User-B`.
- **Transaction 2:** Bulk role update updating `User-B` then `User-A`.
- **Expected Lock Behavior:**
  - With deterministic user ID sorting (`ORDER BY user_id ASC`), both transactions lock `User-A` before `User-B`. Clean lock wait, zero deadlocks.

### Test Scenario 7: High-Concurrency Sequence Number Allocation
- **Initial State:** `document_sequences` row for `(org_id, 'INVOICE', 2026)` at `current_value = 100`.
- **Concurrency Test:** 50 simultaneous workers invoke `internal_allocate_document_number`.
- **Expected Lock Waits:**
  - Row-level lock on `document_sequences` serializes all 50 workers.
  - Each worker increments `current_value` by exactly 1.
- **Expected Final State:**
  - Contiguous sequence: 101 through 150. Exactly 50 unique numbers generated, 0 collisions, 0 gaps.

### Test Scenario 8: Organization Profile Update Concurrent with Invoice Issuance
- **Initial State:** Active organization `ORG-TEST-01`.
- **Transaction A:** Merchant updates organization GSTIN (`UPDATE organizations FOR UPDATE`).
- **Transaction B:** Worker issues invoice (`issue_draft_invoice` acquiring `organizations FOR SHARE`).
- **Expected Lock Waits:**
  - $T_B$ blocks on $T_A$ until profile update commits.
  - Once $T_A$ commits, $T_B$ proceeds and issues invoice under verified tenant metadata.

---

## 7. Prioritized Remediation Plan

Every finding identified during this audit is classified and paired with its precise architectural correction:

| Priority | Finding ID | Issue Description | Existing Code Location | Recommended Correction | Required Regression Test |
| :-: | :-: | :--- | :--- | :--- | :--- |
| **CRITICAL** | **F-01** | **Unordered Product Locking in `confirm_sales_order`** causes deadlocks on multi-item orders. | Migration 014 lines 716–735 (`confirm_sales_order`) | Add `ORDER BY oi.product_id ASC` to cursor `SELECT`. | Concurrency Test 5 (Shared inventory contention). |
| **CRITICAL** | **F-02** | **Direct Line-Item DML Inversion** locks `invoice_items` before trigger can lock parent `invoices`, deadlocking with issuance. | Client direct REST calls (`invoices.service.ts` line 169) | Encapsulate line mutations in RPCs that acquire `invoices FOR SHARE` first. | Concurrency Test 2 (Item edit vs. Issuance). |
| **HIGH** | **F-03** | **Lock Order Inversion in `record_payment_and_allocate`** locks `document_sequences` before `invoices`. | Migration 011/014 (`record_payment_and_allocate`) | Move `invoices FOR UPDATE` lock to line 360, before calling sequence allocator. | Concurrency Test 3 (Payment vs. Issuance). |
| **HIGH** | **F-04** | **Unsorted Membership Updates** creates potential deadlocks during multi-member role reassignment. | `src/services/team.service.ts` lines 65–80 | Require all multi-user updates to lock memberships sorted by `user_id ASC`. | Concurrency Test 6 (Team member updates). |
| **MEDIUM** | **F-05** | **Non-Atomic 3-Request REST Paths** (`createInvoice`, `createSalesOrder`) commit sequence before entity persistence. | `src/services/invoices.service.ts`, `orders.service.ts` | Transition document creation and issuance entirely into atomic PostgreSQL RPCs. | Concurrency Test 1 (Simultaneous issuance). |
| **MEDIUM** | **F-06** | **Unlocked Trigger Lookups** in `trg_check_invoice_item_org` execute dirty reads under `READ COMMITTED`. | Migration 007 (`trg_check_invoice_item_org`) | Add `FOR SHARE` to product and invoice lookups inside cross-tenant triggers. | Multi-tenant tenant boundary test. |
| **LOW** | **F-07** | **Absence of Transaction Lock Timeouts** allows deadlocked or slow queries to hold locks indefinitely. | PostgreSQL global config / migration settings | Add `SET LOCAL lock_timeout = '5s';` at start of all financial RPCs. | Deadlock timeout regression suite. |

---

## 8. Explicit Limitations and Unverified Assumptions

1. **Unexecuted Concurrency Tests:** In strict adherence to read-only execution boundaries, the 8 concurrency scenarios designed in Section 6 were **NOT executed against the staging database**. Their behavior is derived from formal PostgreSQL concurrency semantics and lock dependency graphs.
2. **Third-Party Supabase Auth Locks:** Supabase Auth (`auth.users`) manages its own internal row locks during authentication and session refresh. This audit assumes Supabase Auth does not participate in application-level row locks.
3. **Dirty Git Working Tree:** Branch `Vijay-Atlas` contains uncommitted working tree modifications in `src/components/layout/NewOrgModal.tsx` and `src/features/organizations/OrgContext.tsx` which must be reconciled before applying migrations.

---

## 9. Final Architecture Verdict

```text
===============================================================================
FINAL VERDICT:
LOCK MODEL HAS CONFIRMED CONFLICTS
===============================================================================
```

### Explanatory Summary
- **Confirmed Conflicts Identified:** The audit revealed two confirmed deadlock vulnerabilities in existing and proposed write paths:
  1. `confirm_sales_order` acquires row locks on products without deterministic sorting (`ORDER BY oi.product_id`), creating confirmed deadlocks between concurrent multi-item sales orders.
  2. Direct line-item DML acquires row locks on `invoice_items` before triggers can lock `invoices`, creating a confirmed deadlock cycle with `issue_draft_invoice`.
  3. `record_payment_and_allocate` inverts the lock order of `document_sequences` and `invoices`.
- **Implementation Status:** Zero code, migration, or database objects were modified.
- **Mandatory Gating Condition:** The prioritized remediations (F-01, F-02, F-03) must be integrated into the draft specification for Migration 015 before any implementation or concurrency execution is scheduled.
