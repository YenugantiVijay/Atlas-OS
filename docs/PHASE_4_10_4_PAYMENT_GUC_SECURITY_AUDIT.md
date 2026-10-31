# PHASE 4.10.4 — PAYMENT GUC SECURITY & FINANCIAL MUTATION PROTECTION AUDIT

## 1. Environment & Read-Only Safety Verification

This audit was conducted in **STRICTLY READ-ONLY** mode. Zero application files were modified, zero migrations were created or applied, zero database mutations were executed, and zero production systems were accessed.

- **Repository Target:** `D:\Projects\Atlas-OS`
- **Active Git Branch:** `Vijay-Atlas` (verified; uncommitted changes in `src/components/layout/NewOrgModal.tsx` and `src/features/organizations/OrgContext.tsx` preserved untouched).
- **Target Supabase Staging Reference:** `bwswqnhlebbzdxumlkih` (`ATLAS-OS-Staging`). Verified via `supabase/.temp/project-ref`.
- **Production Reference:** `hrxjgbupjtikokqxjzbh` — STRICTLY FORBIDDEN (0 queries executed, 0 network requests initiated).
- **Audit Scope:** Inspection of migrations `001` through `014`, RLS policies on `payments`, `payment_allocations`, `invoices`, and `invoice_items`, stored procedure `record_payment_and_allocate`, PostgreSQL custom configuration variables (GUCs), session settings, connection pooler security, and PostgREST API surface.

---

## 2. Complete Financial Mutation Inventory

Every database write path capable of mutating financial records or payment state was cataloged:

| Target Table & Columns | Mutation Entry Point | Caller Role | Database Mechanism | RLS Policy / Privilege Gate | Security Definier? | Trigger Execution | Transaction Boundary | Audit Behavior |
| :--- | :--- | :--- | :--- | :--- | :---: | :--- | :--- | :--- |
| **`invoices.total_paid` & `status`** | `record_payment_and_allocate` (RPC) | `owner`, `admin`, `accounts` | Stored Procedure UPDATE | RLS Bypassed via SECURITY DEFINER | **YES** (owned by `postgres`) | Fires `trg_protect_historical_invoices` (if deployed) | **Single Atomic Transaction** | Inserts into `audit_events` |
| **`invoices.total_paid`** | Direct PostgREST `PATCH /rest/v1/invoices` | `owner`, `admin`, `accounts` | Direct REST UPDATE | `invoices_update` (Allows update if `status = 'DRAFT'`) | **NO** (Client session) | Table triggers | Single REST Request | **None** |
| **`payments`** | `record_payment_and_allocate` (RPC) | `owner`, `admin`, `accounts` | Stored Procedure INSERT | RLS Bypassed via SECURITY DEFINER | **YES** | None | **Single Atomic Transaction** | Inserts into `audit_events` |
| **`payments`** | Direct PostgREST `POST /rest/v1/payments` | `owner`, `admin`, `accounts` | Direct REST INSERT | `payments_insert` in Migration 014 | **NO** (Client session) | None | Single REST Request | **None** |
| **`payment_allocations`** | `record_payment_and_allocate` (RPC) | `owner`, `admin`, `accounts` | Stored Procedure INSERT | RLS Bypassed via SECURITY DEFINER | **YES** | `trg_check_payment_allocation_org` | **Single Atomic Transaction** | Inserts into `audit_events` |
| **`payment_allocations`** | Direct PostgREST `POST /rest/v1/payment_allocations` | `owner`, `admin`, `accounts` | Direct REST INSERT | `payment_allocations_insert` in Migration 014 | **NO** (Client session) | `trg_check_payment_allocation_org` | Single REST Request | **None** |
| **`invoice_items`** | Direct PostgREST `POST /rest/v1/invoice_items` | `owner`, `admin`, `accounts` | Direct REST INSERT | `invoice_items_insert` in Migration 014 | **NO** (Client session) | `trg_check_invoice_item_org` | Single REST Request | **None** |
| **`document_sequences`** | `internal_allocate_document_number` (RPC) | Called by `record_payment_and_allocate` | Upsert / Row Lock | Denied to client; DEFINER execute | **YES** | None | Enclosed in caller TX | **None** |

---

## 3. PostgreSQL Custom GUC Security Analysis

### 3.1 Repository Search Results
An exhaustive regex search across migrations `001`–`014`, `src/`, and `supabase/` confirmed that **zero custom GUCs (`set_config`, `current_setting`, `SET LOCAL`, `atlas.*`) are currently used in the deployed database**.

### 3.2 Evaluation of the Proposed Variable `atlas.payment_allocation_active`
In certain architectural proposals, using a PostgreSQL custom configuration variable (GUC) was suggested to protect `invoices.total_paid`:
> *Hypothetical Proposal:* "When `record_payment_and_allocate` runs, it executes `PERFORM set_config('atlas.payment_allocation_active', 'true', true);` and a trigger on `invoices` checks `IF current_setting('atlas.payment_allocation_active', true) = 'true' THEN permit UPDATE ELSE reject`."

#### Forensic Analysis of Why Custom GUCs Cannot Serve as Security Boundaries:
1. **Client-Settable by Ordinary Authenticated Users:**
   In PostgreSQL, custom variables (any parameter containing a dot, e.g. `atlas.*`) **can be set by ANY authenticated database session without superuser privileges**:
   ```sql
   -- An untrusted authenticated client can execute:
   SELECT set_config('atlas.payment_allocation_active', 'true', false);
   -- Or via standard SQL:
   SET atlas.payment_allocation_active = 'true';
   ```
   PostgreSQL does NOT restrict custom GUC creation or modification. Any user who can execute a SQL query or call a multi-statement transaction can forge this setting.
2. **PostgREST Request Header Injection:**
   PostgREST automatically parses request headers and translates them into session-level GUCs (`request.header.<name>`). If configuration allows setting arbitrary GUCs or if an RPC accepts user-controlled configuration inputs, clients can inject GUC values directly via HTTP.
3. **Session Pollution in Connection Poolers (PgBouncer):**
   In Supabase and cloud environments, PgBouncer operates in transaction-pooling mode. If a GUC is set without `is_local = true` (or if a transaction aborts before a manual `RESET`), the setting `atlas.payment_allocation_active = 'true'` persists on the physical connection. Subsequent HTTP requests routed to that pooled backend connection will silently inherit the elevated bypass flag!
4. **Trigger Bypass Vulnerability:**
   If a trigger relies on `current_setting('atlas.payment_allocation_active', true) = 'true'` as its primary authorization check, any client executing:
   `BEGIN; SET LOCAL atlas.payment_allocation_active = 'true'; UPDATE invoices SET total_paid = 0.00; COMMIT;`
   completely bypasses the protection.
5. **Conclusion:** **A custom GUC is fundamentally UNTRUSTED and CANNOT serve as a security boundary.**

---

## 4. Forensic Inspection of `record_payment_and_allocate`

The complete implementation of `record_payment_and_allocate` (Migration 014, lines 890–1060) was traced step-by-step:

### 4.1 Step-by-Step Execution Sequence
1. **Authentication Check (Lines 905–908):** `v_uid := auth.uid();` — Throws if unauthenticated.
2. **Null & Bounds Validation (Lines 910–921):** Validates required parameters, `amount > 0`, and whitelist of payment methods (`CASH`, `UPI`, `NEFT`, `RTGS`, `CHEQUE`, `BANK_TRANSFER`).
3. **Membership Verification (Lines 923–927):** `get_user_org_role(p_org_id)` — Verifies caller has active membership in target organization.
4. **Role Verification (Lines 929–933):** Requires role in `('owner', 'admin', 'accounts')`.
5. **Operational Write Entitlement Gate (Lines 935–938):** Calls `public.can_write_organization_operations(p_org_id)` to verify non-expired trial or active paid subscription.
6. **Tenant Verification (Lines 940–943):** Asserts `customers` record exists and belongs to `p_org_id`.
7. **Allocation Bounds Validation (Lines 945–958):** If invoice specified, asserts `allocated_amount > 0` and `allocated_amount <= amount`.
8. **Atomic Receipt Allocation (Lines 960–963):** Calls `public.internal_allocate_document_number(p_org_id, 'RECEIPT', v_payment_year)` inside the transaction.
9. **Insert Payment (Lines 965–986):** Inserts into `public.payments` returning `v_payment_id`.
10. **Invoice Lock & Allocation (Lines 988–1035):**
    - Locks invoice row: `SELECT ... FROM public.invoices WHERE id = p_invoice_id AND organization_id = p_org_id FOR UPDATE;`
    - Checks `status <> 'CANCELLED'` and `status <> 'PAID'`.
    - Checks customer match: `v_inv.customer_id = p_customer_id`.
    - Asserts overpayment defense: `(v_inv.total_paid + p_allocated_amount) <= v_inv.total_amount`.
    - Inserts allocation into `public.payment_allocations`.
    - Updates invoice: `SET total_paid = v_new_paid, status = v_new_status, updated_at = NOW()`.
11. **Audit Event Logging (Lines 1037–1049):** Inserts record into `public.audit_events`.

### 4.2 Critical Deficiencies Identified in `record_payment_and_allocate`
1. **Missing DRAFT Status Check:**
   Line 993 checks `IF v_inv.status = 'CANCELLED'` and line 997 checks `IF v_inv.status = 'PAID'`.
   **It does NOT check `IF v_inv.status = 'DRAFT'`!**
   A user can record a payment and allocate funds against an unissued `DRAFT` invoice!
2. **Zero Idempotency Protection:**
   The function accepts NO idempotency key (`p_idempotency_key` is absent). If a client times out or re-submits a payment request, a second payment record is inserted, a second receipt number is allocated, and the invoice is double-allocated (or fails with overpayment violation).
3. **Advance Payments Without Allocation:**
   If `p_invoice_id IS NULL`, lines 965–986 insert an unallocated customer deposit. This is a legitimate business feature, but advance payments currently have no reconciliation RPC to allocate them to subsequent invoices.

---

## 5. Privilege and RLS Boundary Vulnerability Assessment

### 5.1 The Direct REST Mutation Vulnerability (CRITICAL)
In `supabase/migrations/014_harden_operational_rls_with_eligibility.sql`, lines 846–876:
```sql
-- 3K. Payments Table
CREATE POLICY payments_insert ON public.payments
    FOR INSERT TO authenticated
    WITH CHECK (
        public.can_write_organization_operations(organization_id)
        AND public.user_has_org_role(organization_id, 'owner', 'admin', 'accounts')
    );

-- 3L. Payment Allocations Table
CREATE POLICY payment_allocations_insert ON public.payment_allocations
    FOR INSERT TO authenticated
    WITH CHECK (
        payment_id IN (
            SELECT id FROM public.payments
            WHERE public.can_write_organization_operations(organization_id)
              AND public.user_has_org_role(organization_id, 'owner', 'admin', 'accounts')
        )
    );
```

#### What an Authenticated Client Can Exploit Today:
1. **Direct Insertion of Arbitrary Payments:**
   Any user with `accounts`, `admin`, or `owner` role can issue a direct HTTP request:
   `POST /rest/v1/payments` with body:
   `{ "organization_id": "org-id", "customer_id": "cust-id", "amount": 1000000, "payment_number": "FAKE-RCP-0001", "payment_method": "CASH" }`
   - This bypasses `record_payment_and_allocate`!
   - This bypasses `internal_allocate_document_number`!
   - A fraudulent or unverified payment record is inserted into the ledger.
2. **Direct Insertion of Arbitrary Allocations Without Invoice Updates:**
   The client can then issue:
   `POST /rest/v1/payment_allocations` with `{ "payment_id": "fake-pay-id", "invoice_id": "inv-id", "amount_allocated": 1000000 }`
   - `payment_allocations_insert` policy passes!
   - Cross-tenant trigger passes if customer matches!
   - The allocation is inserted into `payment_allocations`!
   - **`invoices.total_paid` is NOT updated!** (There is no trigger on `payment_allocations` to update `invoices`).
   - The ledger and the invoice header are now **permanently desynchronized**.

---

## 6. Proposed Secure Payment Authorization Contract

To close these vulnerabilities without relying on fragile GUCs, the following multi-layer security architecture is specified for Migration 015:

### 6.1 Layer 1: Revoke Direct Client Mutations
Direct REST insertion, updating, and deletion on `payments` and `payment_allocations` must be **revoked entirely** from `authenticated` and `anon`:
```sql
-- REVOKE direct table DML
REVOKE INSERT, UPDATE, DELETE ON public.payments FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.payment_allocations FROM authenticated, anon;

-- Drop vulnerable insert policies
DROP POLICY IF EXISTS payments_insert ON public.payments;
DROP POLICY IF EXISTS payment_allocations_insert ON public.payment_allocations;

-- Retain SELECT policies for authorized organization members
GRANT SELECT ON public.payments TO authenticated;
GRANT SELECT ON public.payment_allocations TO authenticated;
```
*Effect:* Payments and allocations can **ONLY** be created through the trusted `SECURITY DEFINER` RPC `record_payment_and_allocate`.

### 6.2 Layer 2: Column-Level Privilege Restrictions on `invoices`
```sql
-- Revoke direct updates on financial and status columns
REVOKE UPDATE (total_paid, status, invoice_number, totals_version) ON public.invoices FROM authenticated;
```

### 6.3 Layer 3: Kernel-Level Context Trigger Protection (No GUCs)
Instead of a client-forgeable GUC, the `BEFORE UPDATE` trigger on `public.invoices` verifies the PostgreSQL execution context:
```sql
CREATE OR REPLACE FUNCTION public.trg_protect_invoice_financial_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- If total_paid is being altered:
    IF NEW.total_paid IS DISTINCT FROM OLD.total_paid THEN
        -- Verify that current_user is the trusted SECURITY DEFINER owner (postgres)
        -- and NOT an untrusted client session
        IF current_user <> 'postgres' THEN
            RAISE EXCEPTION 'ERR_FORBIDDEN_MUTATION: total_paid can only be updated via record_payment_and_allocate RPC'
                USING ERRCODE = '42501';
        END IF;

        -- Verify bounds
        IF NEW.total_paid < 0.00 OR NEW.total_paid > OLD.total_amount THEN
            RAISE EXCEPTION 'ERR_OVERPAYMENT: total_paid cannot exceed total_amount' USING ERRCODE = '22023';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;
```

### 6.4 Layer 4: Idempotency Integration in `record_payment_and_allocate`
Enhance `record_payment_and_allocate` to accept `p_idempotency_key VARCHAR(128)`:
- Checks `public.idempotency_keys` table.
- If key is committed for this payment, returns cached `{ success: true, payment_id, payment_number }` immediately without incrementing sequences or double-paying.

### 6.5 Layer 5: Explicit DRAFT Status Rejection
Add line to `record_payment_and_allocate`:
```sql
IF v_inv.status = 'DRAFT' THEN
    RAISE EXCEPTION 'ERR_CANNOT_PAY_DRAFT: Payments cannot be allocated to DRAFT invoices. Invoice must be ISSUED first.'
        USING ERRCODE = '22023';
END IF;
```

---

## 7. Future Concurrency Test Matrix

The following 10 deterministic test specifications are designed for staging validation. **Zero concurrency tests were executed during this read-only audit.**

| Test ID | Test Scenario | Initial Database State | Transaction Steps & Invocations | Expected Lock Contention | Expected Final Outcome | Required HTTP / SQL Error Code |
| :-: | :--- | :--- | :--- | :--- | :--- | :--- |
| **T-01** | Two simultaneous payments against same invoice | Invoice `total_amount = 1000`, `total_paid = 0` | $T_1$ allocates 600; $T_2$ allocates 600 concurrently | Both request `invoices FOR UPDATE`. $T_2$ blocks on $T_1$. | $T_1$ succeeds (`total_paid = 600`). $T_2$ unblocks, evaluates `600 + 600 > 1000`, aborts. | `ERR_OVERPAYMENT` (HTTP 400 / 422) |
| **T-02** | Payment against invoice being cancelled | Invoice `status = 'ISSUED'` | $T_1$ calls `cancel_invoice`; $T_2$ calls `record_payment_and_allocate` | Both request `invoices FOR UPDATE`. | Whichever commits first seals document. Second transaction rejects with cancelled error. | `ERR_CANNOT_PAY_CANCELLED` |
| **T-03** | Payment retry after lost HTTP response | Invoice `total_paid = 0`, Key `K-100` | $T_1$ completes and commits; network drops. Client retries with `K-100`. | Key lookup detects `COMMITTED` status. | Returns cached receipt and payment ID with 0 sequence increment and 0 over-allocation. | HTTP 200 OK (Idempotent replay) |
| **T-04** | Direct client attempt to update `total_paid` | Issued invoice in database | Client sends `PATCH /rest/v1/invoices` setting `total_paid = 0` | RLS evaluation / Column privilege check | Request rejected at PostgreSQL boundary. | HTTP 403 Forbidden / 42501 |
| **T-05** | Direct client attempt to change invoice status | Issued invoice in database | Client sends `PATCH /rest/v1/invoices` setting `status = 'DRAFT'` | RLS policy `invoices_update` checks `status = 'DRAFT'` | Request rejected because current status is `ISSUED`. | HTTP 404 / 403 Forbidden |
| **T-06** | Client attempts to manipulate payment GUC | Active database session | Client executes `SELECT set_config('atlas.payment_allocation_active', 'true', false)` | Session variable set | Trigger ignores GUC; inspects `current_user = 'postgres'`. Direct update still rejected! | HTTP 403 Forbidden |
| **T-07** | Service-role payment operation | Service-role JWT | `service_role` calls `record_payment_and_allocate` with audit attribution | RLS bypassed via `service_role` | Operation audited with service-role actor attribution; business invariants enforced. | HTTP 200 OK |
| **T-08** | Payment allocation against cross-tenant invoice | Org A customer; Org B invoice | Client calls `record_payment_and_allocate(Org A, Cust A, Inv B)` | Invoice query scopes `WHERE id = p_inv AND organization_id = p_org` | Invoice not found in caller organization. Transaction aborts. | `ERR_INVOICE_NOT_FOUND` (HTTP 404) |
| **T-09** | Payment exceeding outstanding amount | Invoice `total = 500`, `paid = 400` | Client calls `record_payment_and_allocate` with allocation of 200 | Overpayment check: `400 + 200 > 500` | Transaction raises exception and aborts. Sequence table rolled back via MVCC. | `ERR_OVERPAYMENT` (HTTP 400) |
| **T-10** | Duplicate idempotency key with different payload | Key `K-200` committed for ₹1,000 | Client re-submits `K-200` with amount ₹2,000 | Idempotency hash mismatch | Transaction detects fingerprint divergence, raises conflict exception. | `ERR_IDEMPOTENCY_CONFLICT` (HTTP 422) |

---

## 8. Prioritized Audit Findings

| Priority | Finding ID | Severity | Description | Deployed Location | Recommended Remediation |
| :-: | :-: | :---: | :--- | :--- | :--- |
| **CRITICAL** | **SEC-01** | **CRITICAL** | **Direct REST Insertion Permitted on Payments & Allocations** allows clients to fabricate payment records and desynchronize invoice ledger. | Migration 014 (`payments_insert`, `payment_allocations_insert`) | Revoke direct `INSERT` on `payments` and `payment_allocations`. Route all payments exclusively through `record_payment_and_allocate`. |
| **CRITICAL** | **SEC-02** | **CRITICAL** | **Direct `total_paid` Modification on Draft Invoices** allows clients to inject arbitrary paid amounts before issuance. | Migration 014 (`invoices_update`) | Revoke `UPDATE (total_paid)` on `invoices` from `authenticated`. Add `current_user = 'postgres'` trigger defense. |
| **HIGH** | **SEC-03** | **HIGH** | **Missing DRAFT Check in Payment RPC** permits allocating funds against unissued draft invoices. | Migration 014 line 990 (`record_payment_and_allocate`) | Add explicit check: `IF v_inv.status = 'DRAFT' THEN RAISE EXCEPTION 'Cannot pay draft invoice';` |
| **HIGH** | **SEC-04** | **HIGH** | **Absence of Payment Idempotency Protection** causes network retries to double-pay or fail with overpayment. | Migration 014 (`record_payment_and_allocate`) | Add `p_idempotency_key` parameter and link to `idempotency_keys` table. |
| **MEDIUM** | **SEC-05** | **MEDIUM** | **Unsafe GUC Architecture Proposal** relies on client-settable session variables for authorization. | Architectural Design Notes | Strictly reject custom GUCs as authorization mechanisms. Use PostgreSQL `current_user` and column REVOKEs. |

---

## 9. Unverified Assumptions and Limitations

1. **Strictly Read-Only Review:** In accordance with execution instructions, no exploit payloads or concurrent REST requests were fired against the staging database. The vulnerabilities were verified through static inspection of PostgreSQL RLS policies in Migration 014 and PostgreSQL privilege semantics.
2. **PgBouncer Configuration:** This audit assumes Supabase staging utilizes transaction-mode pooling. Connection-level GUC contamination risks are heightened if session pooling is active.
3. **Dirty Git Working Tree:** Branch `Vijay-Atlas` retains uncommitted working tree modifications in `src/components/layout/NewOrgModal.tsx` and `src/features/organizations/OrgContext.tsx`.

---

## 10. Final Architecture Verdict

```text
===============================================================================
FINAL VERDICT:
CRITICAL FINANCIAL AUTHORIZATION BYPASS
===============================================================================
```

### Explanatory Summary
- **Why This Verdict:**
  1. **Direct REST Insertion (SEC-01):** Active RLS policies in Migration 014 (`payments_insert` and `payment_allocations_insert`) explicitly allow authenticated users to execute direct `POST /rest/v1/payments` and `POST /rest/v1/payment_allocations`. This allows malicious or buggy clients to bypass the atomic sequence allocator, bypass `record_payment_and_allocate`, insert arbitrary payment records, and create payment allocations that do not reflect in `invoices.total_paid`, permanently corrupting the financial ledger.
  2. **Direct `total_paid` Tampering (SEC-02):** Active RLS policy `invoices_update` allows updating draft invoices without column-level restrictions, allowing direct mutation of `total_paid`.
  3. **Payment on Draft Invoices (SEC-03):** `record_payment_and_allocate` fails to check whether an invoice is in `DRAFT` status.
  4. **Custom GUCs are Insecure (SEC-05):** Relying on client-settable GUCs (`atlas.payment_allocation_active`) is completely ineffective because any client can forge custom session parameters in PostgreSQL.
- **Mandatory Action:** Remediations SEC-01 through SEC-04 must be included in the formal design for Migration 015 before any financial transactions are certified for production.
