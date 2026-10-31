# PHASE 4.10.2A — DEADLOCK CYCLE VERIFICATION & LOCK AUDIT CORRECTION

## 1. Verified Environment & Read-Only Pre-Flight Verification

This audit review is conducted in **STRICTLY READ-ONLY** mode. No code, migrations, tests, configuration, or database objects were modified. The dirty working tree is preserved.

- **Repository Target:** `D:\Projects\Atlas-OS`
- **Active Git Branch:** `Vijay-Atlas` (verified clean of divergence; uncommitted changes in `src/components/layout/NewOrgModal.tsx` and `src/features/organizations/OrgContext.tsx` preserved untouched).
- **Target Supabase Staging Reference:** `bwswqnhlebbzdxumlkih` (`ATLAS-OS-Staging`). Verified via `supabase/.temp/project-ref`.
- **Production Reference:** `hrxjgbupjtikokqxjzbh` — STRICTLY FORBIDDEN (0 queries executed, 0 network requests initiated).
- **Audit Scope:** Systematic verification of Findings F-01 through F-07 from `docs/PHASE_4_10_2_GLOBAL_LOCK_ORDERING_AUDIT.md`. Reconciling deployed database functions against proposed/future architectural specifications.

---

## 2. Existing Deployed vs. Proposed Future Transaction Paths

A rigorous audit requires strictly separating code currently deployed in PostgreSQL migrations `001`–`014` from proposed architectural designs that have not yet been authored or deployed.

| Transaction Path | Architecture Layer | Current Deployment Status | Implementation Mechanism | Concurrency Characteristics |
| :--- | :--- | :--- | :--- | :--- |
| **`confirm_sales_order`** | Database Stored Function | **DEPLOYED** (Migrations 004, 006, 007, 008, 014) | `SECURITY DEFINER` PL/pgSQL function | Locks order row `FOR UPDATE`, then loops through items locking `products FOR UPDATE`. |
| **`record_payment_and_allocate`** | Database Stored Function | **DEPLOYED** (Migrations 005, 006, 007, 008, 011, 014) | `SECURITY DEFINER` PL/pgSQL function | Allocates `RECEIPT` sequence via internal upsert, then locks `invoices FOR UPDATE`. |
| **`create_organization`** | Database Stored Function | **DEPLOYED** (Migration 012) | `SECURITY DEFINER` PL/pgSQL function | Single-row inserts into `organizations`, `memberships`, `subscriptions`. |
| **Eligibility Functions** | Database Stored Function | **DEPLOYED** (Migration 013) | `SECURITY DEFINER` PL/pgSQL function | Modifies `organization_eligibility` and audit tables. |
| **Direct Invoice-Item Writes** | Frontend Service | **DEPLOYED** (`src/services/invoices.service.ts`) | Direct PostgREST REST DML (`.insert()`) | Uncoordinated client insert; no parent row lock. |
| **Proposed `issue_draft_invoice`** | Future Architecture | **NOT DEPLOYED / PROPOSED ONLY** | Future Migration 015 Specification | Proposed atomic RPC locking `organizations`, `invoices`, `invoice_items`, `document_sequences`. |
| **Proposed `trg_protect_invoice_items`** | Future Architecture | **NOT DEPLOYED / PROPOSED ONLY** | Future Migration 015 Specification | Proposed trigger locking parent invoice `FOR SHARE` on item mutations. |
| **Proposed Item Mutation RPCs** | Future Architecture | **NOT DEPLOYED / PROPOSED ONLY** | Future Migration 015 Specification | Proposed stored functions to encapsulate line item updates. |

---

## 3. Corrected Classifications (Findings F-01 through F-07)

The previous audit in Phase 4.10.2 conflated proposed architectural risks with existing deployed deadlocks. The corrected classification matrix is established below:

| Finding ID | Title | Previous Phase 4.10.2 Classification | Corrected Phase 4.10.2A Classification | Nature of Conflict | Justification for Correction |
| :-: | :--- | :-: | :-: | :--- | :--- |
| **F-01** | Unordered Product Locking in `confirm_sales_order` | CONFIRMED CRITICAL | **CONFIRMED DEADLOCK** | **Existing Deployed Conflict** | Deployed in Migration 014. Multi-row cursor lacks `ORDER BY`. Two concurrent orders sharing products in opposite orders will deterministically deadlock. |
| **F-02** | Invoice Item DML vs. Issuance Inversion | CONFIRMED HIGH | **PLAUSIBLE PROPOSED ARCHITECTURE RISK** | **Design Conflict in Proposed Spec** | `issue_draft_invoice` and `trg_protect_invoice_items` **do not exist** in the deployed database. The cycle exists ONLY if the proposed trigger is deployed while direct client REST DML remains permitted. |
| **F-03** | Sequence vs. Invoice Ordering in Payment Allocation | PLAUSIBLE HIGH | **NO DEMONSTRATED DEADLOCK** | **Disjoint Row Keys** | Sequence row keys are partitioned by `document_type`. `record_payment_and_allocate` locks `'RECEIPT'`; invoice issuance locks `'INVOICE'`. Because physical rows are distinct, no circular wait exists. |
| **F-04** | Membership Lock Ordering | PLAUSIBLE HIGH | **NO DEMONSTRATED DEADLOCK** | **Single-Row Writes** | All existing membership operations are single-row updates by PK (`id`). No multi-row locks exist. No ownership transfer RPC exists in the repository. |
| **F-05** | Non-Atomic Multi-Request Workflows | MEDIUM | **DATA INTEGRITY & SEQUENCE GAP RISK** | **Architectural Fragility** | Not a deadlock. Independent HTTP requests commit sequences prior to document persistence, creating audit gaps on failure. |
| **F-06** | Unlocked Cross-Tenant Trigger Lookups | MEDIUM | **CONCURRENCY RACE / DIRTY READ RISK** | **Isolation Boundary Risk** | Not a deadlock. Unlocked `SELECT` inside triggers can observe unrepeatable reads under `READ COMMITTED`. |
| **F-07** | Absence of Lock Timeouts | LOW | **OPERATIONAL SAFEGUARD DEFICIENCY** | **Operational Hardening** | Not a deadlock. Lack of `lock_timeout = '5s'` allows slow or deadlocked transactions to hold locks until statement timeout. |

---

## 4. Forensic Deep Dive & Concrete Lock Schedules

### 4.1 Finding F-01: `confirm_sales_order` Multi-Product Row Locking

#### Technical Source Evidence
File: `supabase/migrations/014_harden_operational_rls_with_eligibility.sql`, lines 716–735:
```sql
-- 7. Iterate over items, lock product records and verify inventory balances
FOR v_item IN
    SELECT oi.product_id, oi.quantity, oi.product_name, oi.product_sku
    FROM public.sales_order_items oi
    JOIN public.sales_orders so ON so.id = oi.sales_order_id
    WHERE oi.sales_order_id = p_order_id AND so.organization_id = p_org_id
LOOP
    IF v_item.quantity <= 0 THEN
        RAISE EXCEPTION 'Invalid item quantity % for product "%"', v_item.quantity, v_item.product_name;
    END IF;

    PERFORM id FROM public.products
    WHERE id = v_item.product_id AND organization_id = p_org_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product % in order does not belong to organization %', v_item.product_id, p_org_id;
    END IF;
    ...
```

#### Detailed Questions Answered:
1. **Is the cursor's iteration order guaranteed?**
   **NO.** In PostgreSQL, a `SELECT` query lacking an explicit `ORDER BY` clause produces an undefined, non-deterministic row stream. The order in which rows are visited depends on insertion order, heap vacuuming, page reorganization, and query planner index selection.
2. **Can the query plan change that order?**
   **YES.** Even with an identical query plan, **different sales orders created by different users in the frontend will insert line items in arbitrary order**. Order 1 may have line 1 = Product A and line 2 = Product B; Order 2 may have line 1 = Product B and line 2 = Product A.
3. **Can two concurrent orders lock the same products in opposite orders?**
   **YES.** This is standard commercial behavior where multiple orders contain overlapping inventory items in different cart line positions.
4. **Are product locks acquired one at a time or in bulk?**
   They are acquired **one at a time sequentially inside the loop** (`PERFORM ... FOR UPDATE`). Lock $A$ is held while the loop attempts to acquire Lock $B$.
5. **Concrete Two-Transaction Deadlock Schedule:**

```text
========================================================================================================================
DEADLOCK SCHEDULE: confirm_sales_order CONCURRENT MULTI-PRODUCT CONTENTION
========================================================================================================================
Initial State:
  - Product A (UUID: '00000000-0000-0000-0000-00000000000A', Stock: 10)
  - Product B (UUID: '00000000-0000-0000-0000-00000000000B', Stock: 10)
  - Sales Order 1: Line 1 = Product A (qty: 2), Line 2 = Product B (qty: 3)
  - Sales Order 2: Line 1 = Product B (qty: 1), Line 2 = Product A (qty: 4)

Timeline:
  Time   Transaction 1 (Confirming Order 1)                Transaction 2 (Confirming Order 2)
  ----   ---------------------------------------------    ---------------------------------------------
  T1     BEGIN;                                           BEGIN;
  T2     SELECT ... FROM sales_orders WHERE id='SO-1'     .
         FOR UPDATE; (Holds lock on SO-1)                 .
  T3     .                                                SELECT ... FROM sales_orders WHERE id='SO-2'
         .                                                FOR UPDATE; (Holds lock on SO-2)
  T4     Enters Loop, Iteration 1:                        .
         PERFORM FROM products WHERE id='Prod-A'          .
         FOR UPDATE;                                      .
         --> GRANTED: Holds ExclusiveLock on Prod-A       .
  T5     .                                                Enters Loop, Iteration 1:
         .                                                PERFORM FROM products WHERE id='Prod-B'
         .                                                FOR UPDATE;
         .                                                --> GRANTED: Holds ExclusiveLock on Prod-B
  T6     Enters Loop, Iteration 2:                        .
         PERFORM FROM products WHERE id='Prod-B'          .
         FOR UPDATE;                                      .
         --> BLOCKS: Waiting for ExclusiveLock on Prod-B  .
             (held by Transaction 2)                      .
  T7     .                                                Enters Loop, Iteration 2:
         .                                                PERFORM FROM products WHERE id='Prod-A'
         .                                                FOR UPDATE;
         .                                                --> BLOCKS: Waiting for ExclusiveLock on Prod-A
         .                                                    (held by Transaction 1)
  T8     *** DEADLOCK DETECTED BY POSTGRESQL ***          *** WAITING ON T1 ***
         Process T1 waits for ExclusiveLock on Prod-B;
         Process T2 waits for ExclusiveLock on Prod-A.
  T9     ERROR 40P01: deadlock detected                   --> UNBLOCKS after T1 abort
         STATEMENT: confirm_sales_order(...)              Transaction 2 completes and commits.
         ROLLBACK;
========================================================================================================================
```

- **Classification:** **CONFIRMED DEADLOCK**.
- **Safest Deterministic Locking Implementation:**
  Append an explicit sort order to the cursor query in `confirm_sales_order`:
  ```sql
  FOR v_item IN
      SELECT oi.product_id, oi.quantity, oi.product_name, oi.product_sku
      FROM public.sales_order_items oi
      JOIN public.sales_orders so ON so.id = oi.sales_order_id
      WHERE oi.sales_order_id = p_order_id AND so.organization_id = p_org_id
      ORDER BY oi.product_id ASC
  LOOP
  ```
  Sorting by `product_id ASC` guarantees that every concurrent order acquires product locks in identical global order ($A \to B \to C$), mathematically eliminating circular wait conditions.

---

### 4.2 Finding F-02: Invoice Item DML and Issuance

#### Separation of Deployed vs. Proposed Architecture
1. **Existing Deployed System:**
   - Invoices are created directly as `status = 'ISSUED'` via client REST (`invoicesService.createInvoice`).
   - Line items are inserted directly via client REST (`supabase.from('invoice_items').insert(lineItemPayload)`).
   - The deployed trigger on `invoice_items` is `trg_check_invoice_item_org` (Migration 006/007).
   - `trg_check_invoice_item_org` executes an unlocked `SELECT`:
     `SELECT organization_id INTO v_invoice_org_id FROM public.invoices WHERE id = NEW.invoice_id;`
   - **Crucial Fact:** In the deployed database, **NO parent row lock (`FOR SHARE` or `FOR UPDATE`) is acquired by any item trigger**, and **NO `issue_draft_invoice` function exists**.
   - **Conclusion:** There is **ZERO deadlock in the deployed database** between invoice items and invoice issuance.

2. **The Proposed Architecture Conflict:**
   The conflict identified in Phase 4.10.2 was between two **PROPOSED** features:
   - Feature 1: Proposed `issue_draft_invoice` RPC, which locks `invoices(inv_id) FOR UPDATE` and then locks child items `invoice_items FOR UPDATE`.
   - Feature 2: Proposed trigger `trg_protect_invoice_items`, which executes `SELECT ... FROM invoices WHERE id = invoice_id FOR SHARE`.
   - **PostgreSQL Execution Order:**
     When an `UPDATE public.invoice_items SET quantity = 10 WHERE id = 'item-1'` statement executes:
     1. PostgreSQL locates the row `item-1`.
     2. PostgreSQL acquires an exclusive row lock (`FOR UPDATE`) on `item-1` in the heap.
     3. PostgreSQL fires the `BEFORE UPDATE` trigger.
     4. Inside the trigger, `SELECT ... FOR SHARE` attempts to lock `invoices(inv_id)`.
   - **The Cycle (Hypothetical):**
     If $T_1$ (`issue_draft_invoice`) locks `invoices` first, then $T_2$ (direct update) locks `item-1` and waits for `invoices`, while $T_1$ attempts to lock `item-1` and waits for $T_2$.
   - **Lock Schedule:**

```text
========================================================================================================================
HYPOTHETICAL DEADLOCK SCHEDULE: PROPOSED issue_draft_invoice VS PROPOSED trg_protect_invoice_items
(Note: Does NOT exist in deployed code; arises ONLY under uncorrected Migration 015 design)
========================================================================================================================
  Time   Transaction 1 (Proposed issue_draft_invoice)     Transaction 2 (Direct REST UPDATE invoice_items)
  ----   ---------------------------------------------    ------------------------------------------------
  T1     BEGIN;                                           BEGIN;
  T2     SELECT ... FROM invoices WHERE id='INV-1'        .
         FOR UPDATE;                                      .
         --> GRANTED: Holds ExclusiveLock on INV-1        .
  T3     .                                                UPDATE invoice_items SET quantity=5 WHERE id='ITM-1';
         .                                                --> PostgreSQL engine locks ITM-1 (ExclusiveLock)
         .                                                --> Engine invokes BEFORE UPDATE trigger
  T4     Attempting Step 4:                               Trigger executes:
         PERFORM FROM invoice_items WHERE invoice_id='INV-1' SELECT ... FROM invoices WHERE id='INV-1' FOR SHARE;
         FOR UPDATE;                                      --> BLOCKS: Waiting on INV-1 (ExclusiveLock held by T1)
         --> BLOCKS: Waiting on ITM-1 (held by T2)        .
  T5     *** DEADLOCK DETECTED BY POSTGRESQL ***          *** WAITING ON T1 ***
         T1 waits for ITM-1; T2 waits for INV-1.
========================================================================================================================
```

- **Classification:** **PLAUSIBLE PROPOSED ARCHITECTURE RISK** (NOT an existing confirmed deadlock).
- **Is Prohibiting Direct Client DML Necessary?**
  **YES.** Because PostgreSQL's relational engine always acquires the row-level lock on the target table *before* executing `BEFORE ROW` triggers, it is impossible for a trigger alone to lock the parent before the child.
  To eliminate this cycle in Migration 015:
  1. Revoke direct `UPDATE` and `DELETE` on `public.invoice_items` from `authenticated`.
  2. Require all line item modifications to go through a dedicated RPC (`update_draft_invoice_item`) that explicitly executes `SELECT ... FROM invoices WHERE id = p_invoice_id FOR SHARE` **prior** to executing `UPDATE invoice_items`.

---

### 4.3 Finding F-03: Payment and Document Sequence Ordering

#### Detailed Technical Verification
Let's inspect the actual implementation in `supabase/migrations/014_harden_operational_rls_with_eligibility.sql`:
- **Line 945–947:**
  ```sql
  v_payment_year := EXTRACT(YEAR FROM COALESCE(p_payment_date, CURRENT_DATE))::INTEGER;
  v_payment_num := public.internal_allocate_document_number(p_org_id, 'RECEIPT', v_payment_year);
  ```
- **Line 978–981:**
  ```sql
  SELECT id, customer_id, total_amount, total_paid, status
  INTO v_inv
  FROM public.invoices
  WHERE id = p_invoice_id AND organization_id = p_org_id
  FOR UPDATE;
  ```

#### Answers to Safety Verification Questions:
1. **What is the exact sequence row key used for RECEIPT?**
   Primary Key: `(organization_id = p_org_id, document_type = 'RECEIPT', year = v_payment_year)`.
2. **What is the exact sequence row key proposed for INVOICE?**
   Primary Key: `(organization_id = p_org_id, document_type = 'INVOICE', year = v_invoice_year)`.
3. **Can those keys ever refer to the same physical row?**
   **NO.** In PostgreSQL, primary key constraints enforce tuple uniqueness across all composite columns. `'RECEIPT'` and `'INVOICE'` are distinct string constants. They are stored as completely distinct tuples on disk.
4. **Does a shared organization, invoice, or sequence create a circular wait?**
   Let's trace:
   - $T_1$ (`record_payment_and_allocate`) acquires row lock on `document_sequences(org_id, 'RECEIPT', year)`.
   - $T_1$ attempts to lock `invoices(inv_id) FOR UPDATE`.
   - If $T_2$ (`issue_draft_invoice`) holds `invoices(inv_id) FOR UPDATE`:
     - $T_1$ blocks waiting for `invoices(inv_id)`.
     - $T_2$ proceeds to allocate an invoice number: it calls `internal_allocate_document_number(org_id, 'INVOICE', year)`.
     - $T_2$ requests a row lock on `document_sequences(org_id, 'INVOICE', year)`.
     - Is `document_sequences(org_id, 'INVOICE', year)` held by $T_1$? **NO!** $T_1$ holds only `'RECEIPT'`.
     - $T_2$ acquires the lock on `'INVOICE'` immediately, completes, commits, and releases `invoices(inv_id)`.
     - $T_1$ unblocks, acquires `invoices(inv_id)`, completes, and commits.
   - **Result:** **ZERO DEADLOCK.** There is no circular wait.
5. **Should the invoice lock be moved before receipt allocation?**
   Moving the lock is **NOT required for deadlock prevention**, because no deadlock exists. However, moving the lock is recommended purely as a **business validation optimization** (checking invoice existence, customer match, and non-cancelled status before burning CPU on sequence increment and payment insertion).
- **Classification:** **NO DEMONSTRATED DEADLOCK**.

---

### 4.4 Finding F-04: Membership Lock Ordering

#### Detailed Source Verification
A complete codebase search for writes to `memberships` reveals:
1. `supabase/migrations/012_organization_creation_rpc.sql`, line 62:
   `INSERT INTO public.memberships (organization_id, user_id, role, is_active)`
   (Single row insert on organization creation).
2. `src/services/team.service.ts`, line 65:
   `supabase.from('memberships').update({ role: newRole }).eq('id', memberId).eq('organization_id', orgId)`
   (Single row update by primary key `id`).
3. `src/services/team.service.ts`, line 113:
   `supabase.from('memberships').update({ is_active: isActive }).eq('id', memberId).eq('organization_id', orgId)`
   (Single row update by primary key `id`).

#### Answers to Safety Verification Questions:
1. **Are there transactions that lock multiple membership rows?**
   **NO.** Every existing writer mutates exactly one membership row.
2. **Can ownership transfer and membership updates overlap?**
   There is **NO ownership transfer function in the entire codebase**. Ownership is assigned only once during organization creation.
3. **Does an organization-row lock serialize all relevant operations?**
   In `create_organization`, the organization row is inserted first, followed by the membership row.
4. **Is there any demonstrated deadlock?**
   **NO.** A single-row update cannot form a circular wait with another single-row update on a different row.
- **Classification:** **NO DEMONSTRATED DEADLOCK**.

---

### 4.5 Findings F-05 through F-07: Reclassification

1. **Finding F-05: Non-Atomic Multi-Request Workflows (`createInvoice`, `createSalesOrder`)**
   - *Previous Classification:* MEDIUM Deadlock Risk.
   - *Corrected Classification:* **DATA INTEGRITY & STATUTORY SEQUENCE GAP RISK** (Zero deadlock involvement).
   - *Analysis:* Executing sequence allocation via RPC followed by invoice and item inserts across independent HTTP requests is an architectural flaw because failed inserts leave permanently burned sequence numbers. However, because each HTTP request executes in its own independent PostgreSQL transaction and commits immediately, no locks are held across requests. Thus, no cross-request database deadlocks can occur.

2. **Finding F-06: Unlocked Cross-Tenant Trigger Lookups (`trg_check_invoice_item_org`)**
   - *Previous Classification:* MEDIUM Deadlock Risk.
   - *Corrected Classification:* **CONCURRENCY RACE / READ COMMITTED ANOMALY** (Zero deadlock involvement).
   - *Analysis:* `trg_check_invoice_item_org` executes `SELECT organization_id FROM invoices WHERE id = NEW.invoice_id;` without `FOR SHARE`. This does not cause deadlocks, but under `READ COMMITTED`, concurrent transactions could alter the parent invoice between check and commit.

3. **Finding F-07: Lock Timeout Recommendations**
   - *Previous Classification:* LOW Deadlock Finding.
   - *Corrected Classification:* **OPERATIONAL SAFEGUARD / SYSTEM HARDENING** (Zero deadlock involvement).
   - *Analysis:* Setting `SET LOCAL lock_timeout = '5s'` is a resilience measure preventing queries from waiting indefinitely under lock contention. Deadlocks themselves are detected and aborted by PostgreSQL's `deadlock_timeout` detector (default 1s).

---

## 5. Corrected Remediation Recommendations

Based on the verified findings, the required corrections are prioritized:

### 1. Priority 1 (Immediate Fix in Deployed Code): `confirm_sales_order` Cursor Ordering
- **Problem:** Unsorted iteration causes confirmed deadlocks under concurrent order confirmation on shared products.
- **Correction:** Modify `confirm_sales_order` in Migration 015 to add `ORDER BY oi.product_id ASC` to the cursor query:
  ```sql
  FOR v_item IN
      SELECT oi.product_id, oi.quantity, oi.product_name, oi.product_sku
      FROM public.sales_order_items oi
      JOIN public.sales_orders so ON so.id = oi.sales_order_id
      WHERE oi.sales_order_id = p_order_id AND so.organization_id = p_org_id
      ORDER BY oi.product_id ASC
  LOOP
  ```

### 2. Priority 2 (Migration 015 Architecture Design): Line Item RPC Encapsulation
- **Problem:** If `trg_protect_invoice_items` is added while direct REST updates are permitted, direct updates lock child tuples before the trigger can lock the parent, deadlocking with `issue_draft_invoice`.
- **Correction:**
  - Revoke direct `UPDATE` and `DELETE` on `public.invoice_items` for `authenticated`.
  - Introduce `update_draft_invoice_item` RPC which executes `SELECT ... FROM invoices WHERE id = p_invoice_id FOR SHARE` **before** executing `UPDATE invoice_items`.

### 3. Priority 3 (Integrity Optimization): Pre-Check Invoice in `record_payment_and_allocate`
- **Problem:** Sequence number and payment record are generated before verifying invoice customer matching and overpayment bounds.
- **Correction:** Re-order statements in `record_payment_and_allocate` to lock and validate `invoices` before invoking `internal_allocate_document_number`.

---

## 6. Remaining Unknowns and Evidence Limitations

1. **Unexecuted Staging Concurrency Runs:** In compliance with strict read-only execution instructions, the concrete deadlock schedule for `confirm_sales_order` was proven via formal relational lock analysis, query AST inspection, and PostgreSQL lock manager semantics without executing mutating concurrent SQL against the staging database.
2. **Third-Party Supabase Auth Interactions:** `auth.users` row locks during user authentication or token refreshes were not evaluated and are assumed isolated by Supabase's internal auth engine.
3. **Dirty Git Working Tree:** Branch `Vijay-Atlas` retains uncommitted working tree modifications in `src/components/layout/NewOrgModal.tsx` and `src/features/organizations/OrgContext.tsx`.

---

## 7. Final Architecture Verdict

```text
===============================================================================
FINAL VERDICT:
CONFIRMED DEADLOCKS — REMEDIATION REQUIRED
===============================================================================
```

### Explanatory Summary
- **Why This Verdict:**
  1. **One Deployed Confirmed Deadlock (F-01):** `confirm_sales_order` in deployed migrations (`004` through `014`) acquires row locks on products in arbitrary order, producing confirmed deadlocks under concurrent confirmation of multi-item sales orders sharing inventory.
  2. **Corrections Established:** Findings F-02, F-03, and F-04 from the previous audit were investigated and corrected: F-02 is a proposed architecture risk (not deployed), F-03 involves completely disjoint sequence row keys (no deadlock), and F-04 involves single-row writes (no deadlock).
- **Mandatory Action:** Remediate F-01 by adding `ORDER BY oi.product_id ASC` and incorporate the RPC encapsulation for F-02 in the specification for Migration 015 before scheduling concurrency verification. Zero application code or database objects were modified during this audit.
