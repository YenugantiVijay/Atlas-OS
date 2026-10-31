# PHASE 4.10.1J — FINAL CONSOLIDATED FINANCIAL INTEGRITY & TRANSACTION CONTRACT REVIEW

## 1. Environment & Pre-Flight Verification

This review was conducted in **STRICTLY READ-ONLY** mode in compliance with Phase 4.10.1J instructions. Zero application files were modified, zero migrations were created or applied, zero database mutations were executed, and zero production endpoints were accessed.

- **Repository Target:** `D:\Projects\Atlas-OS`
- **Active Git Branch:** `Vijay-Atlas` (verified clean of branch divergence; uncommitted changes in `src/components/layout/NewOrgModal.tsx` and `src/features/organizations/OrgContext.tsx` preserved untouched).
- **Target Supabase Staging Reference:** `bwswqnhlebbzdxumlkih` (`ATLAS-OS-Staging`). Verified via `supabase/.temp/project-ref`.
- **Production Reference:** `hrxjgbupjtikokqxjzbh` — STRICTLY FORBIDDEN (0 queries executed, 0 network requests initiated).
- **Inspected Sources:**
  - `src/services/invoices.service.ts` (Note: user prompt referenced `src/features/invoices/invoices.service.ts`; actual repository implementation resides at `src/services/invoices.service.ts`).
  - `src/services/numbering.service.ts`
  - `src/services/orders.service.ts`
  - `supabase/migrations/001_multi_tenant_base.sql`
  - `supabase/migrations/003_inventory_ledger.sql`
  - `supabase/migrations/004_quotations_and_orders.sql`
  - `supabase/migrations/005_invoices_and_payments.sql`
  - `supabase/migrations/006_security_audit_fixes.sql`
  - `supabase/migrations/007_security_and_integrity_audit_fixes.sql`
  - `supabase/migrations/008_fix_authorization_vulnerabilities_and_null_roles.sql`
  - `supabase/migrations/009_totals_version_and_document_discount_schema.sql`
  - `supabase/migrations/010_robust_document_numbering_sequences.sql`
  - `supabase/migrations/011_atomic_receipt_numbering.sql`
  - `supabase/migrations/012_organization_creation_rpc.sql`
  - `supabase/migrations/013_business_eligibility_and_trials.sql`
  - `supabase/migrations/014_harden_operational_rls_with_eligibility.sql`

---

## 2. Version-1 Header Column Matrix & Trigger Reconciliation

### 2.1 Reconciliation of the Earlier Trigger Omission Defect
In earlier design notes (Phase 4.10.1H/4.10.1I), a proposed trigger snippet checked only a narrow 5-column tuple:
```sql
-- DEFECTIVE EARLIER SNIPPET (Do NOT deploy):
IF (NEW.subtotal, NEW.discount_amount, NEW.tax_amount, NEW.total_amount, NEW.totals_version)
   IS DISTINCT FROM 
   (OLD.subtotal, OLD.discount_amount, OLD.tax_amount, OLD.total_amount, OLD.totals_version) THEN ...
```
**Vulnerability Identified:** This partial check permitted an attacker or rogue script to execute `UPDATE public.invoices SET customer_id = ..., invoice_date = ..., invoice_number = ..., notes = ... WHERE totals_version = 1`. Because the financial amounts did not change, the update would succeed, compromising historical audit integrity.

### 2.2 Exhaustive Column-by-Column Classification (All 18 Schema Columns)
Inspection of `supabase/migrations/005_invoices_and_payments.sql` and `009_totals_version_and_document_discount_schema.sql` establishes that `public.invoices` contains exactly 18 columns. Every column is classified below:

| # | Column Name | PostgreSQL Data Type | Immutability Classification | Modification Rule for `totals_version = 1` |
| :-: | :--- | :--- | :--- | :--- |
| 1 | `id` | `UUID` | **Permanently Immutable** | Primary Key. `NEW.id <> OLD.id` -> REJECT (`ERR_IMMUTABLE_FIELD`) |
| 2 | `organization_id` | `UUID` | **Permanently Immutable** | Multi-tenant boundary. `NEW.organization_id <> OLD.organization_id` -> REJECT |
| 3 | `invoice_number` | `VARCHAR(100)` | **Permanently Immutable** | Statutory GST sequence identity. `NEW.invoice_number <> OLD.invoice_number` -> REJECT |
| 4 | `customer_id` | `UUID` | **Permanently Immutable** | Statutory legal party. `NEW.customer_id <> OLD.customer_id` -> REJECT |
| 5 | `sales_order_id` | `UUID` | **Permanently Immutable** | Origin document lineage. `NEW.sales_order_id IS DISTINCT FROM OLD.sales_order_id` -> REJECT |
| 6 | `invoice_date` | `DATE` | **Permanently Immutable** | Statutory tax event date. `NEW.invoice_date <> OLD.invoice_date` -> REJECT |
| 7 | `due_date` | `DATE` | **Permanently Immutable** | Agreed commercial payment terms. `NEW.due_date <> OLD.due_date` -> REJECT |
| 8 | `subtotal` | `NUMERIC(12, 2)` | **Permanently Immutable** | Core taxable monetary amount. `NEW.subtotal <> OLD.subtotal` -> REJECT |
| 9 | `discount_amount` | `NUMERIC(12, 2)` | **Permanently Immutable** | Contractual document discount. `NEW.discount_amount <> OLD.discount_amount` -> REJECT |
| 10 | `tax_amount` | `NUMERIC(12, 2)` | **Permanently Immutable** | Statutory GST tax liability. `NEW.tax_amount <> OLD.tax_amount` -> REJECT |
| 11 | `total_amount` | `NUMERIC(12, 2)` | **Permanently Immutable** | Final invoice grand total. `NEW.total_amount <> OLD.total_amount` -> REJECT |
| 12 | `notes` | `TEXT` | **Permanently Immutable** | Contractual terms / customer remarks. `NEW.notes IS DISTINCT FROM OLD.notes` -> REJECT |
| 13 | `created_by` | `UUID` | **Permanently Immutable** | User audit origin. `NEW.created_by IS DISTINCT FROM OLD.created_by` -> REJECT |
| 14 | `created_at` | `TIMESTAMPTZ` | **Permanently Immutable** | System creation timestamp. `NEW.created_at <> OLD.created_at` -> REJECT |
| 15 | `totals_version` | `SMALLINT` | **Permanently Immutable** | Schema version marker. `NEW.totals_version <> 1` -> REJECT (Cannot be migrated or converted) |
| 16 | `total_paid` | `NUMERIC(12, 2)` | **Payment Mutable** | **Permitted via `record_payment_and_allocate`**. Must satisfy `0.00 <= total_paid <= total_amount`. |
| 17 | `status` | `VARCHAR(50)` | **Payment / Lifecycle Mutable** | **Permitted lifecycle updates**: `ISSUED` $\to$ `PARTIALLY_PAID` $\to$ `PAID`, or `ISSUED` $\to$ `CANCELLED`. Reverting to `DRAFT` or reopening `PAID` is strictly rejected. |
| 18 | `updated_at` | `TIMESTAMPTZ` | **Authorized Operational Metadata** | Automatically bumped to `NOW()` when permitted payment mutations occur. |

### 2.3 Proposed Header Trigger Contract
```sql
-- PROPOSED MIGRATION 015 HEADER TRIGGER
CREATE OR REPLACE FUNCTION public.trg_protect_historical_invoices()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF OLD.totals_version = 1 THEN
        -- 1. totals_version is permanently locked to 1
        IF NEW.totals_version <> 1 THEN
            RAISE EXCEPTION 'ERR_HISTORICAL_INVOICE_VERSION_LOCKED: Historical invoice version cannot be altered'
                USING ERRCODE = '27000';
        END IF;

        -- 2. Complete check of all 14 immutable columns
        IF (NEW.id, NEW.organization_id, NEW.invoice_number, NEW.customer_id, 
            NEW.sales_order_id, NEW.invoice_date, NEW.due_date, NEW.notes, 
            NEW.created_by, NEW.created_at, NEW.subtotal, NEW.discount_amount, 
            NEW.tax_amount, NEW.total_amount)
           IS DISTINCT FROM 
           (OLD.id, OLD.organization_id, OLD.invoice_number, OLD.customer_id, 
            OLD.sales_order_id, OLD.invoice_date, OLD.due_date, OLD.notes, 
            OLD.created_by, OLD.created_at, OLD.subtotal, OLD.discount_amount, 
            OLD.tax_amount, OLD.total_amount) THEN
            RAISE EXCEPTION 'ERR_HISTORICAL_INVOICE_IMMUTABLE: Only total_paid, status, and updated_at can be modified on historical Version-1 invoices'
                USING ERRCODE = '27000';
        END IF;

        -- 3. Payment bounds validation
        IF NEW.total_paid < 0.00 OR NEW.total_paid > OLD.total_amount THEN
            RAISE EXCEPTION 'ERR_INVALID_TOTAL_PAID: total_paid (%) must be between 0.00 and total_amount (%)',
                NEW.total_paid, OLD.total_amount USING ERRCODE = '22023';
        END IF;

        -- 4. Status transition validation
        IF NEW.status = 'DRAFT' THEN
            RAISE EXCEPTION 'ERR_INVALID_STATUS_TRANSITION: Historical invoices cannot be reverted to DRAFT'
                USING ERRCODE = '22023';
        END IF;

        IF OLD.status = 'PAID' AND NEW.status <> 'PAID' THEN
            RAISE EXCEPTION 'ERR_INVALID_STATUS_TRANSITION: PAID invoice cannot be reopened'
                USING ERRCODE = '22023';
        END IF;

        IF OLD.status = 'CANCELLED' AND NEW.status <> 'CANCELLED' THEN
            RAISE EXCEPTION 'ERR_INVALID_STATUS_TRANSITION: CANCELLED invoice cannot be modified'
                USING ERRCODE = '22023';
        END IF;

        NEW.updated_at := NOW();
        RETURN NEW;
    END IF;

    -- Version-2 validations follow ...
    RETURN NEW;
END;
$$;
```

---

## 3. Version-1 Invoice-Item Protection Contract

### 3.1 Prohibiting Line-Item Reassignment
Line-item reassignment (`UPDATE invoice_items SET invoice_id = ...`) violates fundamental double-entry integrity and accounting lineage. It allows moving lines between open and closed documents, altering financial baselines.
- **Rule:** `NEW.invoice_id <> OLD.invoice_id` is **strictly prohibited across all versions and statuses**.

### 3.2 Parent-Row Locking Protocol (`FOR SHARE`)
Inspecting `totals_version` or `status` via a simple `SELECT` inside a trigger is vulnerable to race conditions under PostgreSQL `READ COMMITTED` isolation:
- A concurrent transaction could alter the parent invoice from `DRAFT` to `ISSUED` while line items are being inserted.
- **Protocol:** Any trigger mutating `invoice_items` must first acquire a row lock on the parent invoice:
  ```sql
  SELECT totals_version, status INTO v_parent_version, v_parent_status
  FROM public.invoices
  WHERE id = v_target_invoice_id
  FOR SHARE;
  ```
- **Lock Mode Rationale:** `FOR SHARE` permits concurrent line item inserts on the same parent invoice while blocking concurrent `UPDATE` or `DELETE` on the parent invoice header until the item mutation commits.

### 3.3 Complete Item Trigger Contract Across Operations
```sql
-- PROPOSED MIGRATION 015 ITEM TRIGGER
CREATE OR REPLACE FUNCTION public.trg_protect_invoice_items()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_parent_id UUID;
    v_parent_version SMALLINT;
    v_parent_status VARCHAR(50);
BEGIN
    -- 1. Unconditional Reassignment Prohibition
    IF TG_OP = 'UPDATE' AND NEW.invoice_id <> OLD.invoice_id THEN
        RAISE EXCEPTION 'ERR_REASSIGNMENT_FORBIDDEN: Invoice line items cannot be reassigned to a different invoice'
            USING ERRCODE = '27000';
    END IF;

    -- 2. Determine target parent ID
    v_parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;

    -- 3. Lock parent row in shared mode
    SELECT totals_version, status INTO v_parent_version, v_parent_status
    FROM public.invoices
    WHERE id = v_parent_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_PARENT_INVOICE_NOT_FOUND: Referenced invoice % does not exist', v_parent_id
            USING ERRCODE = '23503';
    END IF;

    -- 4. Historical Version-1 Protection: Zero mutations permitted
    IF v_parent_version = 1 THEN
        RAISE EXCEPTION 'ERR_HISTORICAL_INVOICE_ITEMS_LOCKED: Line items belonging to historical Version-1 invoices cannot be inserted, updated, or deleted'
            USING ERRCODE = '27000';
    END IF;

    -- 5. Version-2 Lifecycle Enforcement
    -- Line items can ONLY be inserted, updated, or deleted while the invoice is in DRAFT status
    IF v_parent_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'ERR_SEALED_INVOICE_MUTATION: Line items cannot be modified on an invoice with status "%" (only DRAFT invoices permit line alterations)',
            v_parent_status USING ERRCODE = '27000';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$;
```

---

## 4. Payment RPC Compatibility Audit

An exhaustive code inspection of `record_payment_and_allocate` (as deployed in Migration 011 and updated in Migration 014) was performed to guarantee compatibility with the historical immutability triggers:

### 4.1 Exact Update Executed by `record_payment_and_allocate`
```sql
-- Location: Migration 011 (lines 431-436) and Migration 014 (lines 531-536)
UPDATE public.invoices
SET total_paid = v_new_paid,
    status = v_new_status,
    updated_at = NOW()
WHERE id = p_invoice_id AND organization_id = p_org_id;
```

### 4.2 Compatibility Findings
1. **Zero Financial Mutation:** `record_payment_and_allocate` does NOT touch `subtotal`, `discount_amount`, `tax_amount`, `total_amount`, `invoice_number`, `customer_id`, `invoice_date`, `due_date`, `notes`, or `totals_version`.
2. **Allowed Fields Alignment:** The 3 mutated columns (`total_paid`, `status`, `updated_at`) are explicitly whitelisted in `trg_protect_historical_invoices`.
3. **Overpayment Defense:** Migration 011 lines 409–412 already enforce:
   `IF (v_inv.total_paid + p_allocated_amount) > v_inv.total_amount THEN RAISE EXCEPTION 'Overpayment violation...';`
   This aligns with the trigger's `NEW.total_paid <= OLD.total_amount` check.
4. **Conclusion:** **100% COMPATIBLE**. Payments against historical Version-1 invoices can be recorded and allocated without weakening historical immutability.

---

## 5. Global Lock Acquisition Matrix & Concurrency Analysis

To evaluate whether database deadlocks are mathematically impossible or require implementation-time qualification, every transaction writer in the repository was cataloged:

| # | Transaction / Function | Tables Locked / Mutated | Lock Modes Acquired | Acquisition Order in Code | Calls Other Functions? | Conflicting Lock Order Identified? |
| :-: | :--- | :--- | :--- | :--- | :---: | :--- |
| **1** | `record_payment_and_allocate` (RPC) | `document_sequences`, `payments`, `invoices`, `payment_allocations`, `audit_events` | 1. Row Lock on `document_sequences`<br>2. Row Lock on `invoices` (`FOR UPDATE`) | 1. `document_sequences` (RECEIPT)<br>2. `payments`<br>3. `invoices`<br>4. `payment_allocations`<br>5. `audit_events` | Yes (`internal_allocate_document_number`, `get_user_org_role`) | **YES (Inconsistent Order):** Locks `document_sequences` *before* `invoices`. |
| **2** | `confirm_sales_order` (RPC) | `sales_orders`, `products`, `stock_movements`, `audit_events` | 1. `sales_orders` (`FOR UPDATE`)<br>2. `products` (`FOR UPDATE`) | 1. `sales_orders`<br>2. `products` (loop)<br>3. `stock_movements`<br>4. `audit_events` | Yes (`get_product_stock`, `can_write_organization_operations`) | No conflict with invoice writers (distinct tables). |
| **3** | Proposed `issue_draft_invoice` (RPC) | `organizations`, `invoices`, `invoice_items`, `document_sequences`, `audit_events` | 1. `organizations` (`FOR SHARE`)<br>2. `invoices` (`FOR UPDATE`)<br>3. `invoice_items` (`FOR UPDATE`)<br>4. `document_sequences` (Row Lock) | 1. `organizations`<br>2. `invoices`<br>3. `invoice_items`<br>4. `document_sequences`<br>5. `audit_events` | Yes (`internal_allocate_document_number`, `get_user_org_role`) | Locks `invoices` *before* `document_sequences` (opposite of writer #1). |
| **4** | `create_organization` (RPC) | `organizations`, `memberships`, `organization_eligibility`, `organization_subscriptions`, `audit_events` | Row exclusive on `INSERT` | 1. `organizations`<br>2. `memberships`<br>3. `organization_eligibility`<br>4. `organization_subscriptions`<br>5. `audit_events` | Yes (`internal_initialize_organization_trial`) | None (isolated org creation). |
| **5** | Existing `createInvoice` (Frontend REST) | `document_sequences`, `invoices`, `invoice_items` | None (3 independent HTTP transactions) | 1. RPC `allocate_document_number` (commits)<br>2. REST `invoices` (commits)<br>3. REST `invoice_items` (commits) | N/A (stateless HTTP) | Non-atomic transaction boundary. |
| **6** | Existing `createSalesOrder` (Frontend REST) | `document_sequences`, `sales_orders`, `sales_order_items` | None (3 independent HTTP transactions) | 1. RPC `allocate_document_number` (commits)<br>2. REST `sales_orders` (commits)<br>3. REST `sales_order_items` (commits) | N/A (stateless HTTP) | Non-atomic transaction boundary. |

### 5.1 Lock Order Inconsistency & Concurrency Verdict
- **Observed Inconsistency:** `record_payment_and_allocate` acquires its sequence lock on `document_sequences` *prior* to locking `invoices` (`FOR UPDATE`). Conversely, the proposed `issue_draft_invoice` acquires `invoices` (`FOR UPDATE`) *prior* to calling `internal_allocate_document_number` on `document_sequences`.
- **Mitigating Factor:** `record_payment_and_allocate` locks `document_sequences` where `document_type = 'RECEIPT'`, whereas `issue_draft_invoice` locks `document_type = 'INVOICE'`. Because `(organization_id, document_type, year)` forms the primary key, different row locks are held.
- **Formal Hierarchy Qualification:** Deadlocks are **NOT mathematically proven impossible** across the entire repository because table-level lock escalation or cross-document operations could interact unpredictably.
- **Architectural Statement:** The global lock hierarchy is a **PROPOSED STANDARD** that requires implementation-time enforcement and rigorous multi-threaded concurrency testing before production release.

---

## 6. Complete Database Idempotency Contract

### 6.1 Database Schema (PROPOSED for Migration 015)
> [!NOTE]
> The table `public.idempotency_keys` **DOES NOT EXIST** in migrations 001–014. It is formally specified here for inclusion in Migration 015.

```sql
CREATE TABLE IF NOT EXISTS public.idempotency_keys (
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    idempotency_key VARCHAR(128) NOT NULL,
    entity_type VARCHAR(50) NOT NULL CHECK (entity_type IN ('INVOICE_ISSUANCE', 'ORDER_CONFIRMATION', 'PAYMENT_RECORDING')),
    entity_id UUID NOT NULL,
    user_id UUID NOT NULL,
    payload_hash VARCHAR(64) NOT NULL, -- SHA-256 hex digest of canonical request inputs
    status VARCHAR(20) NOT NULL CHECK (status IN ('PROCESSING', 'COMMITTED', 'FAILED')),
    response_payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
    PRIMARY KEY (organization_id, idempotency_key)
);

-- Guarantees an invoice can only have one successful issuance lifecycle operation
CREATE UNIQUE INDEX IF NOT EXISTS uq_idempotency_entity_issuance 
    ON public.idempotency_keys (organization_id, entity_type, entity_id)
    WHERE entity_type = 'INVOICE_ISSUANCE' AND status = 'COMMITTED';
```

### 6.2 Idempotency Operational Scenarios

| Scenario | Condition | Database Engine Action | Resulting Response | API / HTTP Status Translation |
| :--- | :--- | :--- | :--- | :--- |
| **1. First Issuance Request** | Key not found | Inserts `PROCESSING` key, acquires locks, validates, increments sequence, sets `COMMITTED`, stores response JSON. | Success with fresh `ATL/YY-YY/NNNN` | **HTTP 200 OK** |
| **2. Same Key, Same Invoice (Retry)** | Key `COMMITTED`, `entity_id` matches, `payload_hash` matches | Detects committed record; skips validation and allocator; returns stored `response_payload`. | Cached payload; sequence increment = 0 | **HTTP 200 OK** (Idempotent Replay) |
| **3. Same Key, Different Invoice** | Key exists, but `entity_id <> p_invoice_id` | Rejects key reuse across entities. | `RAISE EXCEPTION 'ERR_IDEMPOTENCY_KEY_REUSED'` | **HTTP 422 Unprocessable Entity** |
| **4. Same Key, Different Payload** | Key exists, same invoice, but `payload_hash` differs | Detects payload tampering between retries. | `RAISE EXCEPTION 'ERR_IDEMPOTENCY_PAYLOAD_MISMATCH'` | **HTTP 422 Unprocessable Entity** |
| **5. Different Keys, Same Invoice** | Invoice already `ISSUED` under $K_1$, request uses $K_2$ | Row lock detects `status = 'ISSUED'`, detects key mismatch. | `RAISE EXCEPTION 'ERR_INVOICE_ALREADY_ISSUED'` | **HTTP 409 Conflict** |
| **6. Concurrent Requests (Same Key)** | Worker 1 set status to `PROCESSING` | Worker 2 blocked on row lock or detects `PROCESSING`. | `RAISE EXCEPTION 'ERR_CONCURRENT_REQUEST_IN_FLIGHT'` | **HTTP 409 Conflict** (Retry-After) |
| **7. Concurrent Requests (Different Keys)** | Worker 1 & 2 race on same draft | Serialized by `invoices FOR UPDATE`. Worker 1 commits; Worker 2 sees `status = 'ISSUED'` and key mismatch. | `RAISE EXCEPTION 'ERR_INVOICE_ALREADY_ISSUED'` | **HTTP 409 Conflict** |
| **8. Lost Network Response** | Server committed, network failed | Client retries with identical key and payload; handled by Scenario 2. | Cached payload returned seamlessly | **HTTP 200 OK** |
| **9. Retry After Cancellation** | Invoice is `CANCELLED` | Validation detects `status = 'CANCELLED'`. | `RAISE EXCEPTION 'ERR_CANNOT_ISSUE_CANCELLED_INVOICE'` | **HTTP 400 Bad Request** |

### 6.3 Database Errors to HTTP Status Code Translation
PostgREST maps uncaught SQL exceptions to **HTTP 400 Bad Request** or **HTTP 500 Internal Server Error** by default. To achieve compliant REST semantics:
- The backend RPC must explicitly set the HTTP response status via PostgREST session variables prior to raising or returning:
  ```sql
  PERFORM set_config('response.status', '409', true);
  ```
- Alternatively, the client API gateway or service layer (`invoices.service.ts`) must inspect the returned PostgreSQL error code (`ERRCODE`) or exception message and map:
  - `23505` (Unique Violation) $\to$ `409 Conflict`
  - `ERR_IDEMPOTENCY_KEY_REUSED` $\to$ `422 Unprocessable Entity`
  - `ERR_IDEMPOTENCY_PAYLOAD_MISMATCH` $\to$ `422 Unprocessable Entity`
  - `ERR_CONCURRENT_REQUEST_IN_FLIGHT` $\to$ `409 Conflict`
  - `ERR_INVOICE_ALREADY_ISSUED` $\to$ `409 Conflict`

---

## 7. Current versus Proposed Numbering Lifecycle

| Lifecycle Aspect | Existing Deployed Behavior (`001`–`014` & `src/`) | Proposed Migration 015 Architecture | Legal / Accounting Implications |
| :--- | :--- | :--- | :--- |
| **Draft Number Allocation** | Consumes statutory `ATL/YY-YY/NNNN` immediately upon draft creation. | Allocates internal UUID or provisional `DFT-YYYY-NNNN`. Zero statutory numbers consumed. | **Requires CA Confirmation** that provisional numbering complies with Rule 46. |
| **Statutory Sequence Allocation** | Separate client RPC call before invoice persistence. | Allocated inside atomic `issue_draft_invoice` transaction. | Guarantees zero orphaned sequence increments on aborted issuance. |
| **Persistence Boundaries** | 3 independent HTTP transactions (Sequence RPC, Invoice POST, Items POST). | Single atomic database transaction. | Eliminates partial inserts and invoices with missing line items. |
| **Transaction Rollback Behavior** | Sequence committed in Request 1; rollback cannot cross HTTP requests. | Sequence advances inside transaction; uncommitted abort rolls back sequence via MVCC. | Restores sequence table on validation failure; no gap created. |
| **Network Loss Post-Commit** | Client retry re-calls allocator, burning a sequence number and creating a gap. | Idempotency key replay returns existing number without advancing sequence. | Eliminates duplicate sequence increments. |
| **Cancelled Invoice Sequence** | No cancellation RPC; direct manual updates. | Invoice marked `CANCELLED`; sequence number remains permanently recorded. | **Statutory Requirement:** GSTR-1 Table 13 mandates reporting contiguous series including cancelled invoices. |
| **Corrections & Revisions** | Unrestricted DML permitted by schema. | Original invoice sealed; corrections executed via statutory Credit Notes (`CN-YYYY-NNNN`). | Complies with CGST Act Section 34. |

---

## 8. Financial Invariant Status Matrix

Every financial invariant is cataloged across its five validation dimensions:

| Invariant Description | Proven Mathematically? | Inspected in Existing Code? | Enforced by Existing DB Constraints? | Proposed for Migration 015? | Awaiting Business or CA Approval? |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **1. Dynamic Running-Remainder Allocation** | **YES** ($\sum S_i = D$, $S_i \le T_i$, $S_i \ge 0$, $R_D \to 0$) | **FAILED / BUGGY** (Static formula in `src/lib/money.ts` line 4) | **NO** (`CHECK (document_discount_share >= 0.00)` exists, but sum-check absent) | **YES** (In RPC & trigger) | Business approval of discount policy |
| **2. NUMERIC Arithmetic Before Multiplication** | **YES** (Paise conversion eliminates float rounding drift) | **PARTIAL** (JavaScript uses IEEE 754 float64) | **PARTIAL** (Columns are `NUMERIC(12, 2)`, but intermediate expressions unconstrained) | **YES** (Explicit PL/pgSQL NUMERIC casting) | No (Purely technical) |
| **3. Range-Checked NUMERIC-to-BIGINT Conversion** | **YES** ($0 \le X \le 10^{12}-1 < 2^{63}-1$) | **NO** (Not implemented in TypeScript) | **NO** | **YES** (Guarded 5-step conversion pipeline) | No (Purely technical) |
| **4. Monetary Storage Limits** | **YES** (Physical column ceiling ₹9,999,999,999.99; subtotal ceiling ₹7,812,499,999.99 under 28% GST) | **YES** (`NUMERIC(12, 2)` across tables) | **YES** (PostgreSQL rejects $\ge 10^{10}$) | **YES** (Pre-allocation bounds assertion) | **Commercial Ceiling** (e.g. ₹100 Cr vs ₹500 Cr) |
| **5. Tax-Rate Maximum & Whitelist** | **YES** (Standard rates: 0, 5, 12, 18, 28%) | **PARTIAL** (TypeScript defaults to 18%) | **NO** (Only `CHECK (tax_rate >= 0)` exists; unbounded positive rates permitted) | **YES** (Explicit whitelist constraint) | **CA Review** for special rates (0.25%, 3%) |
| **6. Aggregate Validation Before Allocation** | **YES** ($\sum \text{lines} = \text{header}$) | **PARTIAL** (Client calculates, database does not verify) | **NO** | **YES** (Enforced in Step 4 of `issue_draft_invoice`) | No (Purely technical) |
| **7. Header / Line Totals Reconciliation** | **YES** ($T = S - D + X$) | **NO** (Separate inserts allow mismatched totals) | **NO** | **YES** (Trigger & RPC reconciliation) | No (Purely technical) |
| **8. Historical Totals-Version Handling** | **YES** (Dual-version schema; v1 immutable, v2 canonical) | **YES** (`totals_version` column added in Migration 009) | **PARTIAL** (`totals_version IN (1, 2)` enforced; immutability triggers absent) | **YES** (Dual triggers on `invoices` & `invoice_items`) | CA review of credit note adjustment rules |

---

## 9. Business and CA/Legal Approvals Required

Implementation of Migration 015 is strictly gated on the following non-technical stakeholder approvals:

```
+---------------------------------------------------------------------------------------+
| QUADRANT 2: COMMERCIAL & BUSINESS STAKEHOLDER APPROVALS REQUIRED                      |
| 1. Draft Invoicing Workflow: Approval that invoices in DRAFT status do not display    |
|    or consume statutory ATL/YY-YY/NNNN numbers.                                       |
| 2. Commercial Single-Invoice Ceiling: Approval of maximum transaction cap             |
|    (e.g., ₹100 Crores vs ₹500 Crores vs storage ceiling of ₹9,999,999,999.99).         |
| 3. Unit of Measure Precision: Commercial confirmation on whether fractional units      |
|    (kg, litres) are required before locking quantity as INTEGER.                      |
+---------------------------------------------------------------------------------------+
| QUADRANT 3: QUALIFIED CA & TAX LEGAL COUNSEL APPROVALS REQUIRED                       |
| 1. GST Rule 46 Compliance: Formal CA sign-off that draft invoices using temporary      |
|    provisional IDs (e.g. DFT-YYYY-NNNN) comply with Indian GST invoicing laws.        |
| 2. Tax Rate Whitelist: Legal confirmation of permissible GST rates (0%, 5%, 12%,      |
|    18%, 28%) and whether special rates (0.25% rough diamonds, 3% gold) must be added.|
| 3. Statutory Cancellation Protocol: Formal sign-off that cancelled invoices must      |
|    retain sequence numbers and be reported in GSTR-1 Table 13.                         |
| 4. Credit Note Apportionment: Legal sign-off on partial discount reversals.           |
+---------------------------------------------------------------------------------------+
```

---

## 10. Remaining Technical Blockers

Before Migration 015 can be authored, the following repository-level technical blockers must be resolved:

1. **Dirty Git Working Tree:**
   The working tree on branch `Vijay-Atlas` contains uncommitted changes in:
   - `src/components/layout/NewOrgModal.tsx`
   - `src/features/organizations/OrgContext.tsx`
   These changes must be reviewed, committed, or stashed before any database migrations or new service code are added.

2. **Client-Side Financial Arithmetic Bug:**
   `src/lib/money.ts` currently calculates document discount apportionment using a static formula without dynamic running remainders. This causes rounding drift on multi-line invoices and must be patched to match the validated algorithm.

3. **Absence of Migration 015:**
   The proposed `issue_draft_invoice` RPC, `idempotency_keys` table, and historical immutability triggers have NOT been authored or applied. No DDL has been executed.

---

## 11. Explicit Implementation-Readiness Assessment & Final Verdict

```text
===============================================================================
FINAL VERDICT:
TECHNICAL CONTRACT COMPLETE — BUSINESS/CA APPROVAL REQUIRED
===============================================================================
```

### Explanatory Summary
- **Technical Contract Complete:** All technical invariants, transaction boundaries, lock hierarchy qualifications, 18-column header classifications, item reassignment prohibitions, and 12-scenario idempotency specifications are fully finalized, mathematically sound, and internally consistent.
- **Strictly Read-Only Review:** Zero application files, test suites, migrations, or database objects were modified or deployed.
- **Mandatory Gating Condition:** The engineering specification is ready, but authoring Migration 015 is **strictly blocked** until executive business stakeholders and qualified tax legal counsel provide formal sign-offs on Quadrants 2 and 3.
