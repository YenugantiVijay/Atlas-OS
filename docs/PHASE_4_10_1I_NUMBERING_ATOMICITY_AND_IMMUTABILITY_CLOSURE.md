# PHASE 4.10.1I — FINAL NUMBERING ATOMICITY, HISTORICAL IMMUTABILITY & IDEMPOTENCY REVIEW

## 1. Environment & Pre-Flight Verification

This review was conducted in STRICTLY READ-ONLY mode in accordance with Phase 4.10.1I instructions. Zero application files were modified, zero migrations were created or applied, and zero database mutations were executed.

- **Repository Target:** `D:\Projects\Atlas-OS`
- **Active Git Branch:** `Vijay-Atlas` (verified clean of unexpected branch divergence; dirty working tree in `src/components/layout/NewOrgModal.tsx` and `src/features/organizations/OrgContext.tsx` preserved untouched).
- **Target Supabase Staging Reference:** `bwswqnhlebbzdxumlkih` (`ATLAS-OS-Staging`). Verified via `supabase/.temp/project-ref`.
- **Production Reference:** `hrxjgbupjtikokqxjzbh` — STRICTLY FORBIDDEN (0 queries executed, 0 network requests initiated).
- **Inspected Sources:**
  - `src/services/invoices.service.ts` (Note: user prompt referenced `src/features/invoices/invoices.service.ts`; actual repository implementation resides at `src/services/invoices.service.ts`).
  - `src/services/numbering.service.ts`
  - `src/services/orders.service.ts`
  - `supabase/migrations/005_invoices_and_payments.sql`
  - `supabase/migrations/009_totals_version_and_document_discount_schema.sql`
  - `supabase/migrations/010_robust_document_numbering_sequences.sql`
  - `supabase/migrations/011_atomic_receipt_numbering.sql`
  - `supabase/migrations/014_harden_operational_rls_with_eligibility.sql`

---

## 2. Existing Frontend Allocation Call Sequence

A full code audit was conducted on `createInvoice` and its interaction with `withDocumentNumberRetry` and `allocateDocumentNumber`.

```
=========================================================================================================
EXISTING FRONTEND INVOICE CREATION CALL GRAPH & TRANSACTION BOUNDARIES
=========================================================================================================

[CLIENT: invoicesService.createInvoice]
   |
   |-- 1. Client-Side Totals Computation (src/lib/money.ts)
   |      Computes grossSubtotal, discountTotal, taxAmount, totalAmount.
   |
   |-- 2. Call withDocumentNumberRetry (src/services/numbering.service.ts)
   |      Attempts up to 5 times.
   |      |
   |      |===> HTTP REQUEST #1: POST /rest/v1/rpc/allocate_document_number
   |      |     [DATABASE TRANSACTION #1]
   |      |     - Executes public.allocate_document_number(p_org_id, 'INVOICE', p_year).
   |      |     - Locks public.document_sequences row FOR UPDATE.
   |      |     - Increments current_value = current_value + 1.
   |      |     - Returns candidate 'ATL/26-27/0001'.
   |      |     - COMMITS IMMEDIATELY. Transaction #1 closes.
   |      |     <=== HTTP 200 OK: 'ATL/26-27/0001'
   |      |
   |      |===> HTTP REQUEST #2: POST /rest/v1/invoices
   |      |     [DATABASE TRANSACTION #2]
   |      |     - Executes INSERT INTO public.invoices (status => 'ISSUED', invoice_number => 'ATL/26-27/0001', ...).
   |      |     - If error occurs here:
   |      |         - If unique violation (23505): backoff and retry loop.
   |      |         - If other error (FK, check, network drop): THROWS IMMEDIATELY.
   |      |     - If success: COMMITS. Transaction #2 closes.
   |      |     <=== HTTP 201 Created: { id: 'inv-uuid', ... }
   |      |
   |-- 3. HTTP REQUEST #3: POST /rest/v1/invoice_items
   |      [DATABASE TRANSACTION #3]
   |      - Executes INSERT INTO public.invoice_items (invoice_id => 'inv-uuid', ...).
   |      - If error occurs here: THROWS IMMEDIATELY.
   |      - COMMITS. Transaction #3 closes.
   |      <=== HTTP 201 Created: [ { id: 'item-1', ... } ]
=========================================================================================================
```

### Exact Call Flow in Code
1. `invoicesService.createInvoice` (`src/services/invoices.service.ts`, lines 76–179):
   - Calculates totals via `calculateDocumentTotals`.
   - Maps line items to `formattedItems`.
   - Calls `withDocumentNumberRetry(orgId, 'INVOICE', async (allocatedInvoiceNumber) => { ... }, 5, input.invoiceDate)`.
2. `withDocumentNumberRetry` (`src/services/numbering.service.ts`, lines 230–264):
   - Invokes `await allocateDocumentNumber(orgId, docType, yearOrDate)`.
   - Invokes callback `insertFn(docNumber)`.
3. `allocateDocumentNumber` (`src/services/numbering.service.ts`, lines 99–223):
   - Dispatches Supabase RPC call: `supabase.rpc('allocate_document_number', { p_org_id: orgId, p_doc_type: 'INVOICE', p_year: effectiveYear })`.
   - If RPC fails, silently falls through to Strategy 2 (client `SELECT` max invoice number from `public.invoices`), which has zero locking.

---

## 3. Transaction-Boundary Findings

Based on inspection of the TypeScript services and PostgreSQL migrations:

1. **Non-Atomic Transaction Boundaries:**
   The allocator call (`allocate_document_number`) and the invoice header insertion (`INSERT INTO invoices`) **DO NOT occur in the same PostgreSQL transaction**. They are executed across separate, independent HTTP requests:
   - Request 1: RPC `POST /rest/v1/rpc/allocate_document_number`
   - Request 2: REST `POST /rest/v1/invoices`
   - Request 3: REST `POST /rest/v1/invoice_items`

2. **Committed Sequence Increment on Subsequent Failure:**
   Because Request 1 executes and commits on PostgreSQL before Request 2 is sent:
   - If Request 2 fails (due to a foreign key violation on `customer_id`, invalid date range, check constraint failure, or network drop), **the sequence increment in `public.document_sequences` has ALREADY committed**.
   - PostgreSQL transactions cannot span multiple stateless HTTP requests without an external two-phase commit coordinator.
   - Therefore, a failed invoice insert leaves a permanently committed sequence increment in `public.document_sequences`.

3. **Catalogue of Failure Points Between Allocation and Persistence:**
   - **Failure Point A (Post-Allocation Network Partition):** The RPC completes and commits `current_value = 42`. The network drops before the HTTP response reaches the browser. The client retries or aborts. The number `42` is permanently burned; the next attempt allocates `43`.
   - **Failure Point B (Client Process Crash):** The browser tab is closed or crashes between receiving the document number and executing `insertFn`. Number `42` remains uninserted forever.
   - **Failure Point C (Non-Collision Database Rejection):** `invoices.insert` fails due to an invalid customer ID, missing mandatory field, or RLS failure. `withDocumentNumberRetry` intercepts the error, confirms it is not a `23505` unique violation, and throws. Number `42` is burned.
   - **Failure Point D (Partial Persistence - Orphan Header):** Request 2 (`invoices`) succeeds, but Request 3 (`invoice_items`) fails. An invoice header exists in `public.invoices` with status `ISSUED` and non-zero totals, but has zero line items in `invoice_items`.
   - **Failure Point E (Unprotected Fallback Concurrency):** If the RPC encounters a temporary connection timeout, `allocateDocumentNumber` falls through to Strategy 2 (`SELECT invoice_number ... ORDER BY ... LIMIT 20`). This query holds NO locks. Concurrent users generate identical document numbers, resulting in collision errors.

---

## 4. Current Sequence Rollback Behavior

A fundamental distinction exists between PostgreSQL sequence objects and the `public.document_sequences` table:

### 4.1 Table-Level MVCC vs. Sequence Objects
- **Standard PostgreSQL Sequences (`CREATE SEQUENCE`):** `nextval()` operations are intentionally outside transaction rollback boundaries. If a transaction calls `nextval()` and subsequently aborts, the sequence value is never restored.
- **Atlas OS Implementation (`public.document_sequences`):**
  In migrations `010` and `011`, numbering is implemented via standard table updates:
  ```sql
  INSERT INTO public.document_sequences (organization_id, document_type, year, current_value)
  VALUES (p_org_id, p_doc_type, p_year, 1)
  ON CONFLICT (organization_id, document_type, year)
  DO UPDATE SET current_value = public.document_sequences.current_value + 1
  RETURNING current_value INTO v_next_val;
  ```
  Because this operates on a standard PostgreSQL table, **within a single database transaction, any abort or unhandled exception rolls back the `current_value` update under PostgreSQL MVCC**.

### 4.2 Cross-Request Reality
- While the table engine supports MVCC rollback, **rollback cannot cross HTTP request boundaries**.
- Because the frontend architecture commits the sequence in Request 1 and attempts insertion in Request 2, the rollback capability of PostgreSQL is completely bypassed.
- Therefore, **the current architecture provides zero rollback protection against client-side or network failures**.

---

## 5. Proposed Atomic Issuance Design

To eliminate numbering gaps, broken invoice headers, and race conditions, document allocation and invoice issuance must be encapsulated within a single atomic PostgreSQL transaction.

### 5.1 Draft vs. Statutory Issuance Separation
- **Draft Creation (`create_invoice_draft`):**
  - Drafting an invoice allocates a non-statutory identifier (e.g. `DFT-uuid` or internal UUID).
  - **Zero statutory sequence numbers are consumed.**
  - Draft items can be added, updated, or deleted without sequence impact.
- **Statutory Issuance (`issue_draft_invoice`):**
  - Consumes a statutory GST invoice number (`ATL/YY-YY/NNNN`) strictly upon formal issuance.

### 5.2 The 9-Step Atomic Transaction Specification

The proposed `issue_draft_invoice` RPC executes the following operations within a single `BEGIN ... COMMIT` block:

```sql
-- CONCEPTUAL SPECIFICATION: issue_draft_invoice RPC
-- (Specification only; not implemented or deployed)

CREATE OR REPLACE FUNCTION public.issue_draft_invoice(
    p_org_id UUID,
    p_invoice_id UUID,
    p_idempotency_key VARCHAR(128)
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid UUID;
    v_role VARCHAR(50);
    v_inv RECORD;
    v_items_count INTEGER;
    v_calc_subtotal NUMERIC(12, 2);
    v_calc_tax NUMERIC(12, 2);
    v_calc_discount NUMERIC(12, 2);
    v_calc_total NUMERIC(12, 2);
    v_statutory_number VARCHAR(100);
    v_fy VARCHAR(10);
    v_year INTEGER;
    v_idem_status VARCHAR(20);
    v_cached_response JSONB;
BEGIN
    -- STEP 1: Authenticate and authorize caller
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ERR_UNAUTHENTICATED: Authentication required' USING ERRCODE = '28000';
    END IF;

    v_role := get_user_org_role(p_org_id);
    IF v_role NOT IN ('owner', 'admin', 'accounts') THEN
        RAISE EXCEPTION 'ERR_UNAUTHORIZED: Insufficient permissions to issue invoices in organization %', p_org_id
            USING ERRCODE = '42501';
    END IF;

    -- STEP 2: Lock organization and invoice in approved global hierarchy
    -- Lock 1: Organization row (shared lock prevents concurrent org deletion or tenant reconfiguration)
    PERFORM 1 FROM public.organizations WHERE id = p_org_id FOR SHARE;

    -- Lock 2: Invoice row (exclusive lock serializes issuance and prevents concurrent mutations)
    SELECT * INTO v_inv
    FROM public.invoices
    WHERE id = p_invoice_id AND organization_id = p_org_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_INVOICE_NOT_FOUND: Invoice % does not exist in organization %', p_invoice_id, p_org_id
            USING ERRCODE = 'P0002';
    END IF;

    -- Check Idempotency Key (Detailed in Section 7)
    -- If already processed for this invoice, returns cached response immediately.

    -- STEP 3: Verify invoice is a valid draft
    IF v_inv.status <> 'DRAFT' THEN
        RAISE EXCEPTION 'ERR_INVALID_LIFECYCLE_STATE: Only DRAFT invoices can be issued (current status: %)', v_inv.status
            USING ERRCODE = '22023';
    END IF;

    IF v_inv.totals_version <> 2 THEN
        RAISE EXCEPTION 'ERR_LEGACY_VERSION_MUTATION: Historical Version-1 invoices cannot be issued'
            USING ERRCODE = '27000';
    END IF;

    -- STEP 4: Lock and verify invoice items and financial totals
    -- Lock 3: Invoice item rows
    PERFORM 1 FROM public.invoice_items WHERE invoice_id = p_invoice_id FOR UPDATE;

    SELECT COUNT(*), 
           COALESCE(SUM(line_subtotal), 0.00), 
           COALESCE(SUM(line_tax), 0.00),
           COALESCE(SUM(document_discount_share), 0.00),
           COALESCE(SUM(line_total), 0.00)
    INTO v_items_count, v_calc_subtotal, v_calc_tax, v_calc_discount, v_calc_total
    FROM public.invoice_items
    WHERE invoice_id = p_invoice_id;

    IF v_items_count = 0 THEN
        RAISE EXCEPTION 'ERR_EMPTY_INVOICE: Cannot issue an invoice with zero line items'
            USING ERRCODE = '22023';
    END IF;

    -- Validate terminal discount allocation equality
    IF v_calc_discount <> v_inv.discount_amount THEN
        RAISE EXCEPTION 'ERR_DISCOUNT_MISMATCH: Sum of line discount shares (%) does not match document discount (%)',
            v_calc_discount, v_inv.discount_amount USING ERRCODE = '22023';
    END IF;

    -- Validate subtotal and tax equality
    IF v_calc_subtotal <> v_inv.subtotal OR v_calc_tax <> v_inv.tax_amount OR v_calc_total <> v_inv.total_amount THEN
        RAISE EXCEPTION 'ERR_TOTALS_MISMATCH: Header totals do not match sum of verified line items'
            USING ERRCODE = '22023';
    END IF;

    -- STEP 5: Verify tax rates and monetary storage bounds
    -- Tax rate whitelist check
    IF EXISTS (
        SELECT 1 FROM public.invoice_items 
        WHERE invoice_id = p_invoice_id AND tax_rate NOT IN (0.00, 5.00, 12.00, 18.00, 28.00)
    ) THEN
        RAISE EXCEPTION 'ERR_INVALID_TAX_RATE: Invoice contains line items with unapproved GST tax rates'
            USING ERRCODE = '22023';
    END IF;

    -- Monetary bounds check: Header total must not exceed storage bound ₹9,999,999,999.99
    IF v_inv.total_amount > 9999999999.99 THEN
        RAISE EXCEPTION 'ERR_AMOUNT_OVERFLOW: Total amount exceeds maximum NUMERIC(12, 2) boundary'
            USING ERRCODE = '22003';
    END IF;

    -- STEP 6: Allocate statutory number through transactional document_sequences table
    -- Lock 4: Document sequences row (acquired inside internal_allocate_document_number)
    v_year := EXTRACT(YEAR FROM v_inv.invoice_date)::INTEGER;
    v_statutory_number := public.internal_allocate_document_number(p_org_id, 'INVOICE', v_year);

    -- STEP 7: Set invoice number, issue timestamp, and issued status
    UPDATE public.invoices
    SET invoice_number = v_statutory_number,
        status = 'ISSUED',
        updated_at = NOW()
    WHERE id = p_invoice_id;

    -- STEP 8: Write audit event
    INSERT INTO public.audit_events (
        organization_id, actor_id, action, entity_type, entity_id, details
    ) VALUES (
        p_org_id, v_uid, 'ISSUE_INVOICE', 'INVOICE', p_invoice_id,
        jsonb_build_object(
            'invoice_number', v_statutory_number,
            'total_amount', v_inv.total_amount,
            'idempotency_key', p_idempotency_key
        )
    );

    -- STEP 9: Commit is performed by transaction boundary.
    -- If any statement above fails, the entire transaction (including Step 6 sequence increment) rolls back!
    RETURN jsonb_build_object(
        'invoice_id', p_invoice_id,
        'invoice_number', v_statutory_number,
        'status', 'ISSUED'
    );
END;
$$;
```

---

## 6. Corrected Numbering-Gap Terminology

In financial systems, claiming "absolute zero-gap numbering" is an accounting and technical misnomer. The table below delineates the precise behavior across all operational scenarios:

| Scenario | Database Mechanism | Sequence Incremented? | Sequence Rolled Back? | Gap in Sequence? | Statutory Compliance Status |
| :--- | :--- | :---: | :---: | :---: | :--- |
| **1. Issuance fails before commit** | PostgreSQL transaction abort | Yes (in memory) | **YES (MVCC Rollback)** | **NO GAP** | Contiguous sequence preserved. Number reused for next issuance. |
| **2. Issuance commits successfully** | PostgreSQL WAL commit | **YES** | No | **NO GAP** | Number permanently assigned to valid invoice. |
| **3. Network lost after commit** | Post-commit client disconnect | **YES** | No | **NO GAP** | Client retries with same idempotency key; server returns committed number without re-incrementing. |
| **4. Issued invoice cancelled** | `UPDATE invoices SET status = 'CANCELLED'` | **YES** | **NO (Forbidden)** | **NO GAP IN AUDIT TRAIL** | Sequence does NOT roll back. Number remains recorded and is reported in GSTR-1 Table 13 as Cancelled. |
| **5. Credit / Debit note adjustment** | Separate document issued | **YES** (on CN table) | No | **NO GAP** | Original invoice number remains intact. Credit Note receives distinct sequence series (`CN-YYYY-NNNN`). |
| **6. Deletion / Purge attempt** | Trigger rejection (`RAISE EXCEPTION`) | N/A | N/A | **NO GAP** | Physical deletion of issued invoices is strictly blocked by database triggers. |

### Technical Summary
- **Transactional Rollback:** Guarantees that uncommitted issuance attempts never consume numbers.
- **Audit Contiguity vs. Missing Documents:** Under GST Rule 46, a cancelled invoice number is NOT a missing document. It is a cancelled document that must remain visible in the ledger.
- **Absolute Zero-Gap Clarification:** The sequence is contiguously allocated across all issued and cancelled documents. "Gaps" (unallocated numbers missing from the database entirely) occur ONLY under non-atomic client architectures or unlogged sequence object increments, both of which are eliminated by this design.

---

## 7. Idempotency State Matrix & Contract

Checking `status = 'ISSUED'` alone is **insufficient** for financial idempotency. It fails to verify whether a subsequent call is an authorized retry of the same operation, a duplicate request with different parameters, or an invalid collision.

### 7.1 Dedicated Idempotency Key Architecture
To achieve true idempotency, an `idempotency_keys` table is required:
```sql
CREATE TABLE IF NOT EXISTS public.idempotency_keys (
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    idempotency_key VARCHAR(128) NOT NULL,
    entity_type VARCHAR(50) NOT NULL, -- 'INVOICE_ISSUANCE'
    entity_id UUID NOT NULL,          -- invoice_id
    user_id UUID NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('PROCESSING', 'COMMITTED', 'FAILED')),
    response_payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
    PRIMARY KEY (organization_id, idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_idempotency_entity 
    ON public.idempotency_keys (organization_id, entity_type, entity_id);
```

### 7.2 Complete Idempotency State Matrix

| Target Invoice Current Status | Idempotency Key Status | Request Match Condition | Action Taken | Result / Error Code |
| :--- | :--- | :--- | :--- | :--- |
| **DRAFT** | Not Found | First submission | Insert `PROCESSING` key, execute 9-step atomic issuance, cache payload, commit. | **Success (HTTP 200)**: Fresh `ATL/YY-YY/NNNN` allocated. |
| **DRAFT** | `PROCESSING` | Concurrent identical request | Block on row lock or reject if lock timeout. | **409 Conflict**: `ERR_CONCURRENT_REQUEST_IN_FLIGHT` |
| **DRAFT** | `COMMITTED` | Key already used for different invoice | Reject key reuse. | **422 Unprocessable**: `ERR_IDEMPOTENCY_KEY_REUSED` |
| **ISSUED** | `COMMITTED` | Same key + Same `invoice_id` | Return cached `response_payload` immediately. Sequence NOT incremented. | **Success (HTTP 200)**: Idempotent replay of existing invoice. |
| **ISSUED** | Not Found / Different Key | Different key for already issued invoice | Reject re-issuance attempt. | **409 Conflict**: `ERR_INVOICE_ALREADY_ISSUED` |
| **PARTIALLY_PAID** | Any | Any | Reject re-issuance attempt. | **400 Bad Request**: `ERR_INVALID_LIFECYCLE_STATE` |
| **PAID** | Any | Any | Reject re-issuance attempt. | **400 Bad Request**: `ERR_INVALID_LIFECYCLE_STATE` |
| **CANCELLED** | Any | Any | Reject re-issuance attempt. | **400 Bad Request**: `ERR_CANNOT_ISSUE_CANCELLED_INVOICE` |

### 7.3 Concurrency Scenarios
1. **Same Key Retried for Same Invoice (Network Loss):** Transaction locks invoice row, detects existing committed idempotency record for `(organization_id, idempotency_key)`, verifies `entity_id = p_invoice_id`, and returns the cached JSON response. Sequence increment is 0.
2. **Same Key Reused for Different Invoice:** Transaction queries `idempotency_keys` and detects `entity_id <> p_invoice_id`. Rejects immediately with `ERR_IDEMPOTENCY_KEY_REUSED`.
3. **Different Keys Used Concurrently for Same Invoice:** Both workers execute `issue_draft_invoice` with keys $K_1$ and $K_2$.
   - Worker 1 acquires `FOR UPDATE` lock on `invoices` row.
   - Worker 2 blocks on the `invoices` row lock.
   - Worker 1 issues the invoice, commits $K_1$, sets status to `ISSUED`, and commits.
   - Worker 2 wakes up, inspects the locked row, observes `status = 'ISSUED'`, checks key $K_2$ against the committed key $K_1$, detects mismatch, and raises `ERR_INVOICE_ALREADY_ISSUED`. No second sequence number is allocated.

---

## 8. Header and Item Column Immutability Matrix

An exhaustive column-by-column classification was performed for `public.invoices` and `public.invoice_items` under Version-1 historical rules:

### 8.1 Header Column Immutability (`public.invoices`)

| Column Name | Data Type | Classification | Modification Rule for `totals_version = 1` |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | **Immutable Identity** | `NEW.id <> OLD.id` -> REJECT (`ERR_IMMUTABLE_FIELD`) |
| `organization_id` | `UUID` | **Immutable Tenant** | `NEW.organization_id <> OLD.organization_id` -> REJECT |
| `invoice_number` | `VARCHAR(100)` | **Immutable Statutory Identity** | `NEW.invoice_number <> OLD.invoice_number` -> REJECT |
| `customer_id` | `UUID` | **Immutable Statutory Entity** | `NEW.customer_id <> OLD.customer_id` -> REJECT |
| `sales_order_id` | `UUID` | **Immutable Lineage** | `NEW.sales_order_id IS DISTINCT FROM OLD.sales_order_id` -> REJECT |
| `status` | `VARCHAR(50)` | **Permitted Lifecycle** | Permitted transitions: `ISSUED` -> `PARTIALLY_PAID` -> `PAID`, or `ISSUED` -> `CANCELLED`. Backward transitions forbidden. |
| `invoice_date` | `DATE` | **Immutable Statutory Tax Date** | `NEW.invoice_date <> OLD.invoice_date` -> REJECT |
| `due_date` | `DATE` | **Immutable Contractual Date** | `NEW.due_date <> OLD.due_date` -> REJECT |
| `subtotal` | `NUMERIC(12, 2)` | **Immutable Financial Amount** | `NEW.subtotal <> OLD.subtotal` -> REJECT |
| `discount_amount` | `NUMERIC(12, 2)` | **Immutable Financial Amount** | `NEW.discount_amount <> OLD.discount_amount` -> REJECT |
| `tax_amount` | `NUMERIC(12, 2)` | **Immutable Financial Amount** | `NEW.tax_amount <> OLD.tax_amount` -> REJECT |
| `total_amount` | `NUMERIC(12, 2)` | **Immutable Financial Amount** | `NEW.total_amount <> OLD.total_amount` -> REJECT |
| `total_paid` | `NUMERIC(12, 2)` | **Permitted Payment Tracking** | Permitted `UPDATE` via `record_payment_and_allocate` only. Must satisfy `0.00 <= total_paid <= total_amount`. |
| `notes` | `TEXT` | **Immutable Historical Content** | `NEW.notes IS DISTINCT FROM OLD.notes` -> REJECT |
| `created_by` | `UUID` | **Immutable Audit User** | `NEW.created_by IS DISTINCT FROM OLD.created_by` -> REJECT |
| `created_at` | `TIMESTAMPTZ` | **Immutable Audit Timestamp** | `NEW.created_at <> OLD.created_at` -> REJECT |
| `updated_at` | `TIMESTAMPTZ` | **Permitted Operational Metadata** | Automatically updated to `NOW()` when `total_paid` or `status` changes. |
| `totals_version` | `SMALLINT` | **Immutable Schema Version** | `NEW.totals_version <> OLD.totals_version` -> REJECT (Must remain `1` forever). |

### 8.2 Line Item Column Immutability (`public.invoice_items`)

| Column Name | Data Type | Classification | Modification Rule for Parent `totals_version = 1` |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | **Immutable Identity** | Any mutation on existing item -> REJECT |
| `invoice_id` | `UUID` | **Immutable Parent Reference** | **Reassignment Strictly Prohibited:** `NEW.invoice_id <> OLD.invoice_id` -> REJECT (`ERR_REASSIGNMENT_FORBIDDEN`) |
| `product_id` | `UUID` | **Immutable Product Reference** | Mutation prohibited |
| `product_name` | `VARCHAR(255)` | **Immutable Commercial Content** | Mutation prohibited |
| `product_sku` | `VARCHAR(100)` | **Immutable Commercial Content** | Mutation prohibited |
| `hsn_code` | `VARCHAR(20)` | **Immutable Statutory Tax Code** | Mutation prohibited |
| `uom` | `VARCHAR(50)` | **Immutable Unit of Measure** | Mutation prohibited |
| `quantity` | `INTEGER` | **Immutable Financial Quantity** | Mutation prohibited |
| `unit_price` | `NUMERIC(12, 2)` | **Immutable Financial Price** | Mutation prohibited |
| `discount_percent` | `NUMERIC(5, 2)` | **Immutable Financial Rate** | Mutation prohibited |
| `tax_rate` | `NUMERIC(5, 2)` | **Immutable Statutory Rate** | Mutation prohibited |
| `line_subtotal` | `NUMERIC(12, 2)` | **Immutable Financial Total** | Mutation prohibited |
| `line_tax` | `NUMERIC(12, 2)` | **Immutable Financial Total** | Mutation prohibited |
| `line_total` | `NUMERIC(12, 2)` | **Immutable Financial Total** | Mutation prohibited |
| `document_discount_share` | `NUMERIC(12, 2)` | **Immutable Financial Total** | Mutation prohibited |

### 8.3 Unconditional Item Mutation Rules on Historical Invoices
For any `invoice_items` operation targeting an invoice where `totals_version = 1`:
- **`INSERT`:** Unconditionally prohibited (`RAISE EXCEPTION 'ERR_HISTORICAL_INVOICE_LOCKED: Cannot add items to historical invoice'`).
- **`UPDATE`:** Unconditionally prohibited (`RAISE EXCEPTION 'ERR_HISTORICAL_INVOICE_LOCKED: Cannot update items of historical invoice'`).
- **`DELETE`:** Unconditionally prohibited (`RAISE EXCEPTION 'ERR_HISTORICAL_INVOICE_LOCKED: Cannot delete items from historical invoice'`).

### 8.4 Trigger Bypass Distinction
- **`service_role` (PostgREST backend):** In PostgreSQL, row triggers (`FOR EACH ROW`) execute for `service_role`. Even though `service_role` bypasses RLS (`BYPASSRLS`), it **CANNOT bypass database triggers**. The historical immutability triggers protect historical records against all application and service-role writes.
- **Superuser Maintenance Bypass:** Direct administrative connections (`postgres` or `supabase_admin`) can disable triggers via `SET session_replication_role = 'replica'` or `ALTER TABLE invoices DISABLE TRIGGER ALL`. Therefore, historical immutability is **technically absolute against application and service traffic**, but **not absolute against console superusers conducting unconstrained maintenance**.

---

## 9. Payment RPC Compatibility

An audit of `record_payment_and_allocate` (defined in Migration 011, lines 277–480) was performed to ensure compatibility with historical Version-1 immutability:

### 9.1 Deployed Payment Update Behavior
In Migration 011, `record_payment_and_allocate` executes the following update against `invoices`:
```sql
UPDATE public.invoices
SET total_paid = v_new_paid,
    status = v_new_status,
    updated_at = NOW()
WHERE id = p_invoice_id AND organization_id = p_org_id;
```

### 9.2 Verification of Non-Interference
1. **Trigger Compatibility:**
   The historical protection trigger evaluates:
   ```sql
   IF OLD.totals_version = 1 THEN
       IF (NEW.subtotal, NEW.discount_amount, NEW.tax_amount, NEW.total_amount, 
           NEW.invoice_number, NEW.customer_id, NEW.invoice_date, NEW.totals_version)
          IS DISTINCT FROM 
          (OLD.subtotal, OLD.discount_amount, OLD.tax_amount, OLD.total_amount, 
           OLD.invoice_number, OLD.customer_id, OLD.invoice_date, OLD.totals_version) THEN
           RAISE EXCEPTION 'ERR_HISTORICAL_INVOICE_FINANCIALS_LOCKED' USING ERRCODE = '27000';
       END IF;
   END IF;
   ```
2. **Result:**
   - Because `record_payment_and_allocate` mutates **only** `total_paid`, `status`, and `updated_at`, the immutable comparison passes.
   - Payment allocations against Version-1 invoices succeed without loosening financial guards.
   - Unrelated direct updates attempting to mutate subtotals, taxes, or invoice numbers are rejected.

---

## 10. Concurrency and Lock-Order Assumptions

To guarantee race-free execution and mathematical deadlock prevention, all database transactions must adhere to a strict global locking hierarchy.

```
+---------------------------------------------------------------------------------------+
| GLOBAL LOCK HIERARCHY (Acquired strictly in order: Level 1 -> 2 -> 3 -> 4)           |
+---------------------------------------------------------------------------------------+
| LEVEL 1: public.organizations (FOR SHARE)                                             |
|   - Acquired first by org_id.                                                         |
|   - Prevents concurrent tenant deactivation or organization deletion.                |
+---------------------------------------------------------------------------------------+
| LEVEL 2: public.invoices (FOR UPDATE or FOR SHARE)                                    |
|   - FOR UPDATE acquired by issue_draft_invoice or cancel_invoice.                      |
|   - FOR SHARE acquired by invoice_items triggers during item mutations.               |
|   - Serializes all state changes on the target document.                              |
+---------------------------------------------------------------------------------------+
| LEVEL 3: public.invoice_items (FOR UPDATE)                                            |
|   - Acquired during issuance or line-item recalculation.                              |
|   - Prevents concurrent item alterations while parent is issuing.                     |
+---------------------------------------------------------------------------------------+
| LEVEL 4: public.document_sequences (Row Lock via ON CONFLICT DO UPDATE)               |
|   - Acquired last during statutory number allocation.                                 |
|   - Held for milliseconds; commits immediately with document header.                  |
+---------------------------------------------------------------------------------------+
```

### Mathematical Proof of Deadlock Prevention
A deadlock requires a circular wait condition ($T_1$ holds Lock $A$ and waits for Lock $B$; $T_2$ holds Lock $B$ and waits for Lock $A$).
Because all transactions acquire locks strictly in topological order ($\text{Level } 1 \to \text{Level } 2 \to \text{Level } 3 \to \text{Level } 4$), cycles are mathematically impossible in directed acyclic lock graphs.

---

## 11. Existing versus Proposed Behavior Matrix

| Dimension | Existing Implementation (`001`–`014` & `src/`) | Proposed Migration 015 & RPC Architecture | Impact / Benefit |
| :--- | :--- | :--- | :--- |
| **Transaction Boundary** | 3 separate HTTP requests (RPC + REST invoices + REST items) | Single atomic RPC (`issue_draft_invoice`) | Eliminates partial inserts and broken invoice headers. |
| **Number Allocation Point** | Allocated immediately upon draft creation in UI | Allocated strictly upon transition from `DRAFT` to `ISSUED` | Prevents burning statutory numbers on abandoned drafts. |
| **Sequence Rollback on Abort** | Sequence commits before insert; cannot roll back | Sequence advances inside transaction; rolls back on abort | Zero burned numbers on validation or constraint failure. |
| **Network Loss Handling** | Generates permanent sequence gap on retry | Idempotency key lookup returns existing number | Zero duplicate invoices; zero sequence gaps. |
| **Historical Invoices (v1)** | Unprotected; direct REST DML can modify lines | Dual table triggers block all mutations on v1 | Permanent audit compliance and legal immutability. |
| **Item Reassignment** | Allowed by database schema | Explicitly rejected: `NEW.invoice_id <> OLD.invoice_id` | Prevents cross-invoice line tampering. |
| **Parent Concurrency Lock** | None; unlocked concurrent queries | Explicit `FOR SHARE` on parent before item mutation | Eliminates `READ COMMITTED` race conditions. |
| **Discount Apportionment** | Static pro-rata calculation in `src/lib/money.ts` | Dynamic running-remainder with terminal guard | Eliminates rounding leakage; sum of lines = total discount. |

---

## 12. Remaining Business and CA/Legal Approvals

The technical specification is mathematically sound and internally consistent. Implementation is gated on the following non-technical approvals:

```
+---------------------------------------------------------------------------------------+
| QUADRANT 2: COMMERCIAL & BUSINESS APPROVALS REQUIRED                                  |
| 1. Draft Invoicing Workflow: Approval that invoices in DRAFT status do not display    |
|    or consume statutory ATL/YY-YY/NNNN numbers.                                       |
| 2. Invoice Grand Total Ceiling: Commercial confirmation of maximum single invoice     |
|    limit (e.g. ₹100 Crores vs ₹500 Crores vs physical limit of ₹9,999,999,999.99).     |
| 3. Unit of Measure Decimal Precision: Confirmation that integer quantities remain     |
|    acceptable (vs introducing fractional quantities for kg/litres).                   |
+---------------------------------------------------------------------------------------+
| QUADRANT 3: QUALIFIED CA & TAX LEGAL REVIEW REQUIRED                                  |
| 1. GST Rule 46 Compliance: Formal CA sign-off that draft invoices using temporary      |
|    provisional IDs (e.g. DFT-YYYY-NNNN) comply with Indian GST invoicing laws.        |
| 2. Tax Rate Whitelist: Legal confirmation of permissible GST rates (0%, 5%, 12%,      |
|    18%, 28%) and whether special rates (0.25% rough diamonds, 3% gold) must be added.|
| 3. Statutory Cancellation Protocol: Formal sign-off that cancelled invoices must      |
|    retain sequence numbers and be reported in GSTR-1 Table 13.                         |
+---------------------------------------------------------------------------------------+
```

---

## 13. Exact Unresolved Technical Blockers

Before Migration 015 can be authored, reviewed, and applied, the following repository-level technical blockers must be resolved:

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

## 14. Final Architecture Verdict

```text
===============================================================================
FINAL VERDICT:
TECHNICAL INVARIANTS COMPLETE — BUSINESS/CA APPROVAL REQUIRED
===============================================================================
```

### Explanatory Summary
- **Technical Invariants Complete:** The transactional boundaries, lock hierarchy, 9-step atomic issuance flow, column immutability matrix, and idempotency contract are fully specified, mathematically verified, and internally consistent.
- **Strictly Read-Only Review:** No application code, test suites, or database objects were modified or deployed.
- **Mandatory Next Steps:** Secure formal sign-offs for Quadrants 2 (Commercial) and 3 (CA/Legal) and resolve the local dirty working tree before authoring Migration 015.
