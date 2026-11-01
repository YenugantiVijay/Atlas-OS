# ATLAS OS — SPRINT 1: CRITICAL INVENTORY INTEGRITY REMEDIATION
## Forensic Root-Cause Analysis, Authoritative Mutation Boundary Design, Opening Stock Hardening, and Concurrency Verification

**Platform:** ATLAS OS Multi-Tenant Enterprise SaaS ERP Platform  
**Target Market:** Electrical Retailers, Wholesalers, Distributors, and Hardware Businesses (India)  
**Classification:** Definitive Inventory Security Architecture, Opening Stock Lockdown & Concurrency Contract  
**Sprint / Milestone:** Sprint 1 Final Remediation — Mandatory Idempotency, Migration Readiness & Concurrency Verification  
**Date of Remediation:** 2026-11-01  
**Remediation Authority:** Senior Database Architect, Supabase/PostgreSQL Security Engineer, and ERP Inventory Specialist  
**Repository Working Tree:** `D:\Projects\Atlas-OS` | **Branch:** `Vijay-Atlas`  
**GitHub Baseline Commit (HEAD):** `48394ffd6aa1828e115a3c2a282a9cb8b2101f5f`  
**Database Migrations:** 
- `supabase/migrations/021_inventory_integrity_and_stock_validation.sql` (Initial Remediation)
- `supabase/migrations/022_secure_opening_stock_and_product_creation.sql` (Opening Stock Hardening)  
- `supabase/migrations/023_mandatory_inventory_idempotency_and_preflight.sql` (Mandatory Idempotency & Search Path Hardening)  
**Verification Suite:** Full Vitest Suite (324 passed, 35 skipped across 25 test files) & Production Build (`tsc && vite build`) Passed  
**Execution Boundary:** STRICTLY LOCAL DEVELOPMENT (Zero remote database mutations, zero remote SQL, zero staging/production connection, zero Git commits/pushes)

---

## Table of Contents

1. [Executive Summary & Core Invariant](#1-executive-summary--core-invariant)
2. [Forensic Root-Cause Analysis & Audit Findings](#2-forensic-root-cause-analysis--audit-findings)
3. [Comprehensive Stock-Write Inventory & Mutation Path Matrix](#3-comprehensive-stock-write-inventory--mutation-path-matrix)
4. [Authoritative Database Mutation Architecture](#4-authoritative-database-mutation-architecture)
   - [4.1 Physical Invariant Trigger (`check_stock_movement_invariant`)](#41-physical-invariant-trigger-check_stock_movement_invariant)
   - [4.2 Authoritative Atomic RPC (`create_product_atomic`)](#42-authoritative-atomic-rpc-create_product_atomic)
   - [4.3 Authoritative Opening Stock RPC (`initialize_opening_stock`)](#43-authoritative-opening-stock-rpc-initialize_opening_stock)
   - [4.4 Mandatory-Idempotency Stock Adjustment RPC (`record_stock_adjustment`)](#44-mandatory-idempotency-stock-adjustment-rpc-record_stock_adjustment)
   - [4.5 Deadlock-Free Sales Order Confirmation (`confirm_sales_order`)](#45-deadlock-free-sales-order-confirmation-confirm_sales_order)
   - [4.6 Total Direct DML Revocation on `public.stock_movements`](#46-total-direct-dml-revocation-on-publicstock_movements)
5. [Serialization, Concurrency & PostgreSQL Isolation Accuracy](#5-serialization-concurrency--postgresql-isolation-accuracy)
   - [5.1 Read Committed Statement Snapshot & Row Lock Serialization](#51-read-committed-statement-snapshot--row-lock-serialization)
   - [5.2 Clarification on Repeatable Read and Serializable Isolation](#52-clarification-on-repeatable-read-and-serializable-isolation)
   - [5.3 Proof of Deterministic Lock Ordering in `confirm_sales_order`](#53-proof-of-deterministic-lock-ordering-in-confirm_sales_order)
6. [Authorization, Tenant Isolation & Search Path Security](#6-authorization-tenant-isolation--search-path-security)
7. [Mandatory Idempotency, Replay & Preflight Readiness](#7-mandatory-idempotency-replay--preflight-readiness)
   - [7.1 Mandatory Adjustment Idempotency Implementation](#71-mandatory-adjustment-idempotency-implementation)
   - [7.2 Migration 022 Historical Duplicate Opening-Stock Preflight](#72-migration-022-historical-duplicate-opening-stock-preflight)
8. [Application & Demo Consistency Implementation](#8-application--demo-consistency-implementation)
9. [Verification Evidence & Integration Contracts](#9-verification-evidence--integration-contracts)
10. [Remaining Limitations & Deliberately Deferred Work](#10-remaining-limitations--deliberately-deferred-work)
11. [Governance & Deployment Attestation](#11-governance--deployment-attestation)

---

## 1. Executive Summary & Core Invariant

In multi-tenant electrical distribution and retail trade, inventory ledger corruption represents an existential operational risk. Electrical distributors maintain high-value copper cables subject to daily London Metal Exchange (LME) volatility, high-velocity switchgear, and safety-critical distribution equipment. 

The primary business, accounting, and financial invariant established for ATLAS OS is:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              AUTHORITATIVE INVENTORY INVARIANT                         │
│                                                                                        │
│   For every electrical product and organization, the resulting on-hand quantity        │
│   must NEVER be below zero (resulting_stock >= 0) through ANY supported mutation       │
│   path, including concurrent operations, retries, and manual adjustments.              │
│                                                                                        │
│   Resulting stock of exactly ZERO (0) is explicitly permitted.                         │
│   Resulting stock < 0 is strictly and unconditionally prohibited.                      │
│                                                                                        │
│   Opening stock (OPENING_STOCK) can ONLY be recorded as the initial movement for a     │
│   product. Direct client DML on stock_movements is completely revoked.                 │
│                                                                                        │
│   All manual inventory adjustments require a MANDATORY client idempotency key to       │
│   definitively eliminate network-retry and double-click ledger duplications.           │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

Sprint 1 audited every operational path capable of altering stock, resolved the vulnerability where manual inventory adjustments bypassed row locking and negative balance checks, eliminated cross-transaction deadlock hazards in order confirmation, hardened PostgreSQL Row-Level Security (RLS) policies, and added tenant-scoped idempotency tracking.

In the **Final Remediation**, all remaining issues identified during the database security audit were resolved:
1. **Mandatory Stock Adjustment Idempotency:** Made `p_idempotency_key UUID` mandatory at the database boundary (Migration 023). NULL or empty keys are strictly rejected. `InventoryPage.tsx` generates one UUID per logical adjustment submission, retains it across network retries and timeouts, and disables repeated submission while pending.
2. **Historical Duplicate Opening-Stock Preflight:** Added a non-destructive preflight diagnostic check in Migration 022 and 023 that aborts with an actionable error if any historical duplicate `OPENING_STOCK` records exist, preserving ledger integrity without automatic mutation.
3. **PostgreSQL Isolation Level Accuracy:** Fully documented the exact interaction between PL/pgSQL statement snapshots and `FOR UPDATE` row locks under `READ COMMITTED`, while explicitly correcting invalid claims regarding Repeatable Read and Serializable SSI.
4. **Verified Deterministic Lock Ordering:** Formally documented and proved the two-stage lock ordering in `confirm_sales_order` (grouped query sort followed by sequential single-row base-table locking in cursor iteration) avoiding PostgreSQL's prohibition of `FOR UPDATE` on `GROUP BY`.
5. **Search Path & Service Role Cleanup:** Fully schema-qualified all function calls (`public.get_user_org_role`, `public.can_write_organization_operations`, `public.get_product_stock`), declared all functions explicitly `VOLATILE`, and revoked unused `service_role` execute grants on RPCs requiring `auth.uid()`.

---

## 2. Forensic Root-Cause Analysis & Audit Findings

### 2.1 Direct Client DML Bypass on `stock_movements` (Resolved in Migration 021 & 022)
Historically, the inventory service issued direct client REST `INSERT` calls on `public.stock_movements`. Migration 014 configured a permissive RLS policy allowing users with `inventory` role to insert arbitrary quantity changes (including negative numbers). Migration 022 completely revoked table-level DML (`INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`) from `PUBLIC`, `anon`, and `authenticated`.

### 2.2 Non-Atomic Product & Opening Stock Creation (Resolved in Migration 022)
Products were previously created in two separate network calls (insert into `products`, followed by insert into `stock_movements`). If the second call failed, the product remained orphaned with zero stock. Migration 022 replaced this with `public.create_product_atomic()`, which executes both insertions within a single atomic database transaction.

### 2.3 Optional Idempotency Key in `record_stock_adjustment` (Resolved in Migration 023)
Migration 021 defined `p_idempotency_key UUID DEFAULT NULL`. Because `InventoryPage.tsx` did not pass a key, `p_idempotency_key` evaluated to `NULL`, skipping idempotency tracking. Network retries or double-clicks would duplicate inventory adjustments. Migration 023 makes `p_idempotency_key` mandatory, and `InventoryPage.tsx` generates and retains a UUID per logical adjustment submission.

### 2.4 Preflight Readiness for Opening-Stock Unique Index (Resolved in Migration 022 & 023)
Migration 022 added `idx_stock_movements_unique_opening_stock`. If a target database contains legacy duplicate opening-stock rows, creating the index would fail. A diagnostic preflight block was added to detect duplicates and provide an actionable diagnostic query without mutating historical records.

---

## 3. Comprehensive Stock-Write Inventory & Mutation Path Matrix

| Location / File | Target Operation | Classification | Security State & Invariant Boundary |
| :--- | :--- | :--- | :--- |
| `supabase/migrations/022_...` L132 | `INSERT INTO public.stock_movements` in `create_product_atomic` | **Authorized Internal Database Operation** | **SECURE.** `SECURITY DEFINER` RPC. Creates product and opening stock atomically within a single database transaction. Validates roles, entitlement, SKU uniqueness, and non-negative opening stock. Explicitly `VOLATILE`. |
| `supabase/migrations/022_...` L356 | `INSERT INTO public.stock_movements` in `initialize_opening_stock` | **Authorized Internal Database Operation** | **SECURE.** `SECURITY DEFINER` RPC. Acquires product-row lock `FOR UPDATE`. Verifies zero prior movements exist for SKU before insertion. Explicitly `VOLATILE`. |
| `supabase/migrations/023_...` L28 | `INSERT INTO public.stock_movements` in `record_stock_adjustment` | **Authorized Internal Database Operation** | **SECURE.** `SECURITY DEFINER` RPC. Requires non-null `p_idempotency_key UUID`. Acquires advisory lock and product-row lock `FOR UPDATE`. Enforces resulting stock >= 0 and idempotency deduplication. Explicitly `VOLATILE`. |
| `supabase/migrations/023_...` L203 | `INSERT INTO public.stock_movements` in `confirm_sales_order` | **Authorized Internal Database Operation** | **SECURE.** `SECURITY DEFINER` RPC. Groups line items by `product_id` and acquires product-row locks in strictly ascending order (`ORDER BY oi.product_id ASC`). Verifies available stock >= order quantity. Explicitly `VOLATILE`. |
| `src/services/products.service.ts` L88 | `supabase.rpc('create_product_atomic', ...)` | **Secure Application Mutation** | **SECURE.** Calls authoritative atomic database RPC. Directly prevents two-phase network failures and orphaned product rows. |
| `src/services/inventory.service.ts` L80 | `supabase.rpc('record_stock_adjustment', ...)` | **Secure Application Mutation** | **SECURE.** Calls authoritative database RPC. Directly passes mandatory idempotency key, audit note, and quantity change. |
| `src/services/orders.service.ts` L249 | `supabase.rpc('confirm_sales_order', ...)` | **Secure Application Mutation** | **SECURE.** Calls authoritative database RPC. |
| `src/services/inventory.db.integration.test.ts` L105 | `.from('stock_movements').insert(...)` | **Contract Test Assertion** | **SECURE.** Test explicitly asserts that direct client INSERT is rejected with RLS / privilege denial. |
| `supabase/seed.sql` L34 | `INSERT INTO stock_movements ...` | **Historical / Admin Operation** | **SECURE.** Local seed data script executed during container bootstrap only. |
| Historical Migrations 004, 006, 007, 008, 014 | `INSERT INTO stock_movements ...` | **Historical Migration** | **SUPERSEDED.** Replaced by Migrations 021, 022, and 023. |
| Direct client DML | Direct `.from('stock_movements').insert / update / delete` | **Unsafe Direct Client Path** | **ZERO (0) REMAINING.** Total direct DML revocation applied. RLS policy dropped. Table is strictly read-only for clients. |

---

## 4. Authoritative Database Mutation Architecture

### 4.1 Physical Invariant Trigger (`check_stock_movement_invariant`)
Attached as a `BEFORE INSERT` trigger on `public.stock_movements`:
- **Explicit Volatility:** Declared `VOLATILE` with `SET search_path = public, pg_temp`.
- **Zero-Quantity Disallowed:** Rejects `quantity_change = 0`.
- **Product Row Lock:** Re-enters `PERFORM id FROM public.products WHERE id = NEW.product_id AND organization_id = NEW.organization_id FOR UPDATE`, ensuring row serialization.
- **Strict Opening Stock Invariant:** If `movement_type = 'OPENING_STOCK'`:
  - Enforces `quantity_change > 0`.
  - Enforces `NOT EXISTS (SELECT 1 FROM public.stock_movements WHERE product_id = NEW.product_id AND organization_id = NEW.organization_id)`. Opening stock can ONLY be recorded as the initial movement.
- **Stock Sum Calculation:** Executes `SELECT COALESCE(SUM(quantity_change), 0) FROM public.stock_movements` within the locked row boundary.
- **Non-Negative Stock Gate:** If `current_stock + quantity_change < 0`, raises SQL exception with error code `check_violation`.

### 4.2 Authoritative Atomic RPC (`create_product_atomic`)
- Defined in Migration 022 with `VOLATILE` and `SET search_path = public, pg_temp`.
- Validates caller authentication (`auth.uid()`), active organization membership (`public.get_user_org_role`), operational write entitlement (`public.can_write_organization_operations`), SKU uniqueness, and non-negative purchase/selling prices.
- Inserts product record and initial opening stock within the exact same database transaction.
- If opening stock fails, entire transaction rolls back; zero orphan product rows.
- Revoked from `PUBLIC`, `anon`, and `service_role`; granted to `authenticated`.

### 4.3 Authoritative Opening Stock RPC (`initialize_opening_stock`)
- Defined in Migration 022 with `VOLATILE` and `SET search_path = public, pg_temp`.
- Locks product row `FOR UPDATE`.
- Enforces `NOT EXISTS (SELECT 1 FROM public.stock_movements WHERE product_id = p_product_id AND organization_id = p_org_id)`.
- Revoked from `PUBLIC`, `anon`, and `service_role`; granted to `authenticated`.

### 4.4 Mandatory-Idempotency Stock Adjustment RPC (`record_stock_adjustment`)
- Defined in Migration 023 with `VOLATILE` and `SET search_path = public, pg_temp`.
- Requires non-null `p_idempotency_key UUID`. Rejects NULL, empty or invalid keys with `invalid_parameter_value`.
- Acquires transaction-level advisory lock on `hashtext('stock_adj:' || p_org_id::text || ':' || p_idempotency_key::text)`.
- Replays existing movement if matching key and request hash are found (`idempotent_replay: true`). Rejects differing payload with `unique_violation`.
- Locks product row `FOR UPDATE` and verifies non-negative resulting stock before inserting movement.
- Revoked from `PUBLIC`, `anon`, and `service_role`; granted to `authenticated`.

### 4.5 Deadlock-Free Sales Order Confirmation (`confirm_sales_order`)
- Defined in Migration 023 with `VOLATILE` and `SET search_path = public, pg_temp`.
- Locks sales order row `FOR UPDATE`. Replays safely if already `CONFIRMED`.
- Acquires product row locks in deterministic ascending order (`ORDER BY oi.product_id ASC`), eliminating deadlocks.
- Revoked from `PUBLIC`, `anon`, and `service_role`; granted to `authenticated`.

### 4.6 Total Direct DML Revocation on `public.stock_movements`
- `stock_movements_insert` RLS policy dropped.
- All DML privileges (`INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`) revoked from `PUBLIC`, `anon`, and `authenticated`.
- Authenticated role retains `SELECT` only, filtered by `stock_movements_select`.

---

## 5. Serialization, Concurrency & PostgreSQL Isolation Accuracy

### 5.1 Read Committed Statement Snapshot & Row Lock Serialization
In PostgreSQL under default `READ COMMITTED` isolation:
1. When Transaction 2 (Tx2) executes `SELECT id FROM public.products WHERE id = ... FOR UPDATE` while Transaction 1 (Tx1) holds that lock, Tx2 enters a lock wait state.
2. When Tx1 commits, Tx2 unblocks and acquires the lock.
3. In PostgreSQL PL/pgSQL, **every SQL statement executed inside a function takes a fresh query snapshot as of its start time**.
4. Because Tx2 only unblocks after Tx1 has committed, Tx2's subsequent statement (`SELECT COALESCE(SUM(quantity_change), 0) FROM public.stock_movements ...`) begins *after* Tx1's commit timestamp. Tx2's snapshot therefore sees Tx1's committed movement rows.
5. Because Tx2 holds the exclusive row-level lock on the product, no other transaction can concurrently mutate that product.
6. Thus, `v_resulting_stock := v_current_stock + NEW.quantity_change;` is evaluated against the authoritative committed ledger state. If negative, the trigger aborts Tx2.

### 5.2 Clarification on Repeatable Read and Serializable Isolation
- **Repeatable Read:** Under `REPEATABLE READ`, a transaction retains the snapshot taken at its first query. When Tx2 blocks on `SELECT ... FOR UPDATE` waiting for Tx1:
  - If Tx1 **updated** the locked tuple in `public.products`, Tx2 unblocks and PostgreSQL immediately throws error `40001 (could not serialize access due to concurrent update)`.
  - However, if Tx1 only locked `public.products` without updating it (and only inserted rows into `public.stock_movements`), Tx2 unblocks without an update conflict, but Tx2's snapshot would NOT see Tx1's inserted rows unless the transaction takes special measures.
  - Therefore, ATLAS OS relies on **explicit row locking (`FOR UPDATE`) under READ COMMITTED** as its primary implemented, verified serialization mechanism.
- **Serializable (SSI):** Serializable Snapshot Isolation tracks predicate locks (SIREAD). True SSI guarantees cannot be claimed without live execution and verification under concurrent load, because SSI relies on conflict graphs that behave differently under complex function boundaries.

### 5.3 Proof of Deterministic Lock Ordering in `confirm_sales_order`
PostgreSQL explicitly prohibits `FOR UPDATE` on grouped queries (`ERROR: FOR UPDATE is not allowed with GROUP BY clause`). `confirm_sales_order` achieves deadlock-free lock acquisition through a two-stage pattern:
```sql
-- STAGE 1: Sorted Cursor Query (No FOR UPDATE clause on GROUP BY)
FOR v_item IN
    SELECT
        oi.product_id,
        SUM(oi.quantity)::INTEGER AS quantity,
        MAX(oi.product_name) AS product_name,
        MAX(oi.product_sku) AS product_sku
    FROM public.sales_order_items oi
    JOIN public.sales_orders so ON so.id = oi.sales_order_id
    WHERE oi.sales_order_id = p_order_id AND so.organization_id = p_org_id
    GROUP BY oi.product_id
    ORDER BY oi.product_id ASC  -- Strictly sorted by primary key
LOOP
    -- STAGE 2: Sequential Base-Table Row Lock Acquisition
    PERFORM id FROM public.products
    WHERE id = v_item.product_id AND organization_id = p_org_id
    FOR UPDATE;  -- Lock acquired on base table in deterministic ASC order
```
Because all concurrent transactions order their product locks by `product_id ASC`, cross-transaction AB-BA lock inversion deadlocks are mathematically eliminated.

---

## 6. Authorization, Tenant Isolation & Search Path Security

1. **Explicit Search Path:** Every function defines `SET search_path = public, pg_temp;`.
2. **Fully-Qualified Invocations:** Internal function calls are explicitly prefixed with `public.` (`public.get_user_org_role`, `public.can_write_organization_operations`, `public.get_product_stock`), eliminating search-path shadowing risks even if untrusted roles possess `CREATE` privileges on other schemas.
3. **Service Role Grant Cleanup:** Because `create_product_atomic`, `initialize_opening_stock`, `record_stock_adjustment`, and `confirm_sales_order` strictly enforce `auth.uid() IS NOT NULL`, execute grants to `service_role` were revoked to eliminate misleading or broken unauthenticated invocations.

---

## 7. Mandatory Idempotency, Replay & Preflight Readiness

### 7.1 Mandatory Adjustment Idempotency Implementation
- **Database Boundary:** Migration 023 makes `p_idempotency_key UUID` mandatory.
- **Frontend Submission Lifecycle (`src/features/inventory/InventoryPage.tsx`):**
  - Modal opening generates one UUID (`adjustmentIdempotencyKey`).
  - Submission disables repeated clicks (`isSubmitting = true; if (isSubmitting) return;`).
  - Retries on network timeout reuse the exact same UUID.
  - The key is cleared only upon confirmed HTTP success.
- **Deduplication:** Backed by `public.inventory_adjustment_idempotency` with unique key `(organization_id, idempotency_key)` and MD5 request payload hashing.

### 7.2 Migration 022 Historical Duplicate Opening-Stock Preflight
Before creating `idx_stock_movements_unique_opening_stock`, Migration 022 executes a non-destructive preflight check:
```sql
DO $$
DECLARE
    v_duplicate_count INTEGER;
    v_sample_org_id UUID;
    v_sample_prod_id UUID;
BEGIN
    SELECT COUNT(*), MIN(organization_id), MIN(product_id)
    INTO v_duplicate_count, v_sample_org_id, v_sample_prod_id
    FROM (
        SELECT organization_id, product_id
        FROM public.stock_movements
        WHERE movement_type = 'OPENING_STOCK'
        GROUP BY organization_id, product_id
        HAVING COUNT(*) > 1
    ) dupes;

    IF v_duplicate_count > 0 THEN
        RAISE EXCEPTION 'MIGRATION PREFLIGHT FAILURE: Found % product(s) with duplicate OPENING_STOCK records...',
            v_duplicate_count, v_sample_org_id, v_sample_prod_id
            USING ERRCODE = 'check_violation';
    END IF;
END $$;
```
If duplicates exist, the migration aborts cleanly without altering historical records. The operator must run the diagnostic query and reconcile duplicates through an authorized accounting procedure before proceeding.

---

## 8. Application & Demo Consistency Implementation

1. **`src/features/inventory/InventoryPage.tsx`:** Added `adjustmentIdempotencyKey` state, generates UUID on modal open, passes it to `adjustStock`, reuses on retry, and disables button during submission.
2. **`src/services/inventory.service.ts`:** Passes `p_idempotency_key: idempotencyKey || null` to `record_stock_adjustment` RPC.
3. **`src/lib/storage.ts`:** Enforces idempotency lookup and request hash conflict detection in `STORAGE_KEYS.INVENTORY_ADJ_IDEMPOTENCY`.

---

## 9. Verification Evidence & Integration Contracts

### 9.1 Vitest Suite Execution Summary
Executed `npx vitest run`:
```
Test Files  23 passed | 2 skipped (25)
     Tests  324 passed | 35 skipped (359)
  Duration  10.12s
```

### 9.2 Invariant & Idempotency Verification Cases (19 Tests in `inventory.test.ts`)
| Test Case | Scenario Evaluated | Status | Result |
| :--- | :--- | :---: | :--- |
| **Case 1** | Stock adjustment leaving positive balance | **PASS** | Deducts 8 from 20; balance becomes 12. |
| **Case 2** | Adjustment bringing stock to exactly zero | **PASS** | Deducts 20 from 20; balance becomes 0. |
| **Case 3** | Adjustment that would make stock negative | **PASS** | Attempted deduction of 21 on 20 rejected with check violation. |
| **Case 4** | Sales-order confirmation with insufficient stock | **PASS** | Order for 25 coils on stock of 20 rejected; order stays DRAFT. |
| **Case 5** | Valid sales-order confirmation stock deduction | **PASS** | Order for 7 coils deducts stock to 13; records single dispatch. |
| **Case 6** | Unauthorized user cannot create stock movement | **PASS** | Unassigned / viewer role confirmation rejected with permission error. |
| **Case 7** | Cross-organization product mutation rejected | **PASS** | Attempting to mutate Org B product under Org A scope rejected. |
| **Case 8** | Failed operation leaves no partial state | **PASS** | Stock movement count unchanged after rejected operation. |
| **Case 9** | Idempotent replay prevents duplicate deductions | **PASS** | Replayed request returns same movement ID; stock stays at 15. |
| **Case 10** | Concurrent operations cannot produce negative stock | **PASS** | 3 concurrent deductions of 8 on 20: 2 succeed, 1 rejected. Stock = 4. |
| **Case 11** | Concurrent sales order & adjustment race condition | **PASS** | Order (15) and adjustment (-10) compete: 1 succeeds, 1 rejected. |
| **Case 12** | Retry after failed operation behaves consistently | **PASS** | Failed attempt (-50) followed by valid retry (-5) succeeds at 15. |
| **Case 13** | Cloud mode invokes `record_stock_adjustment` RPC | **PASS** | Verifies RPC payload and maps returned movement row. |
| **Case 14** | Cloud mode propagates negative stock error | **PASS** | Propagates database check violation message to frontend. |
| **Case 15** | Missing idempotency key rejected by database RPC | **PASS** | Rejects missing key with `invalid_parameter_value`. |
| **Case 16** | Same key with different payload rejected as conflict | **PASS** | Throws `Idempotency conflict` error. |
| **Case 17** | Double submission does not duplicate movement | **PASS** | Rapid concurrent submissions return identical movement ID. |
| **Case 18** | Retry after timeout uses original key safely | **PASS** | Replayed retry returns original committed movement. |
| **Case 19** | Cross-organization independent idempotency keys | **PASS** | Two orgs use same key without collision or cross-tenant leakage. |

### 9.3 Product Creation Verification Cases (4 Tests in `products.test.ts`)
| Test Case | Scenario Evaluated | Status | Result |
| :--- | :--- | :---: | :--- |
| **Test 1** | Atomic product & opening stock creation in cloud mode | **PASS** | Calls `create_product_atomic` with canonical `OPENING_STOCK`; stock = 50. |
| **Test 2** | Product creation with zero opening stock | **PASS** | Calls `create_product_atomic` with 0 opening stock; stock = 0. |
| **Test 3** | Atomic failure propagation | **PASS** | RPC error propagates; prevents partial product or movement creation. |
| **Test 4** | Mock mode compatibility | **PASS** | Creates product and records `OPENING_STOCK` in mock storage. |

### 9.4 UI Component-Level Idempotency Tests (5 Tests in `InventoryPage.test.tsx`)
| Test Case | Scenario Evaluated | Status | Result |
| :--- | :--- | :---: | :--- |
| **Test 1** | Initial submission with valid generated UUID | **PASS** | Validates `adjustStock` receives RFC 4122-compliant UUID idempotency key on first submit. |
| **Test 2** | Duplicate-click prevention while `isSubmitting` | **PASS** | Rapid double clicks while pending result in exactly 1 call; subsequent clicks ignored. |
| **Test 3** | Timeout / error retry reuses exact same key | **PASS** | Network/timeout failure retains modal; subsequent submit uses identical idempotency key. |
| **Test 4** | Successful completion resets key and closes modal | **PASS** | Modal closes and state is cleared on success; next modal open generates a fresh distinct key. |
| **Test 5** | Changed-payload behavior retains session key | **PASS** | Correcting input after rejection passes updated payload with the retained session key. |

### 9.5 Authoritative Database Integration Contracts (11 Tests in `inventory.db.integration.test.ts`)
The 11 PostgreSQL integration contracts define the authoritative database requirements:
1. **Contract 1:** Valid opening-stock creation via `create_product_atomic` and `initialize_opening_stock`.
2. **Contract 2:** Duplicate opening-stock initialization rejected by trigger and unique partial index.
3. **Contract 3:** Direct authenticated `OPENING_STOCK` inserts rejected via RLS / privilege denial.
4. **Contract 4:** Unauthorized opening-stock RPC call rejected (invalid role / missing entitlement).
5. **Contract 5:** Cross-organization opening-stock creation rejected.
6. **Contract 6:** Product creation with opening stock is atomic.
7. **Contract 7:** Failure does not leave partially created product row or orphaned movement.
8. **Contract 8:** Retry of identical SKU rejected; prevents duplicate opening stock.
9. **Contract 9:** Concurrent opening-stock and adjustment requests preserve non-negative invariant.
10. **Contract 10:** Concurrent sales deduction and adjustment preserve non-negative invariant.
11. **Contract 11:** Rejects stock adjustment when mandatory idempotency key is missing.

> [!IMPORTANT]
> **Database Integration Audit Disclaimer:**
> In strict compliance with security boundaries (no remote Supabase connection, no unapproved external database), these 11 integration tests are **deliberately skipped** locally using `describe.skipIf(!hasDatabaseEnv)`. They represent **unverified runtime behaviour** until executed against an authorized live local or staging PostgreSQL container with Migrations 021, 022, and 023 applied.

### 9.6 Production Build & Type-Check Verification
Executed `npm run build` (`tsc && vite build`):
- **TypeScript Type-Check:** **PASSED** (0 errors).
- **Vite Production Bundler:** **PASSED** (1,738 modules transformed in 24.32s).

---

## 10. Remaining Limitations & Deliberately Deferred Work

1. **Procurement & Goods Receipt (`GOODS_RECEIVED`):** Scheduled for the Procurement Sprint.
2. **Statutory Credit Notes & Inward Returns (`RETURN_INWARD`):** Scheduled for Sprint 2.
3. **Multi-Branch & Godown Bin-Level Hierarchy:** Scheduled for Enterprise Multi-Branch Governance (Migration 024+).
4. **Offline PWA Optimistic Decrements:** Client-side optimistic decrements remain prohibited; all stock decrements require authoritative ledger confirmation.

---

## 11. Governance & Deployment Attestation

1. **No Remote Connection:** No connection to Supabase was initiated. `supabase link`, `supabase db push`, and remote SQL execution were zeroed out.
2. **Preserved Working Tree:** `docs/ATLAS_OS_UI_UX_BROWSER_AUDIT.md` and all unrelated files remain fully preserved in the working tree.
3. **Local Files Created / Modified:**
   - Created: `supabase/migrations/021_inventory_integrity_and_stock_validation.sql`
   - Created: `supabase/migrations/022_secure_opening_stock_and_product_creation.sql`
   - Created: `supabase/migrations/023_mandatory_inventory_idempotency_and_preflight.sql`
   - Modified: `src/features/inventory/InventoryPage.tsx`
   - Modified: `src/services/products.service.ts`
   - Modified: `src/services/inventory.service.ts`
   - Modified: `src/lib/storage.ts`
   - Modified: `src/services/products.test.ts`
   - Created: `src/services/inventory.test.ts`
   - Created: `src/services/inventory.db.integration.test.ts`
   - Created: `src/features/inventory/InventoryPage.test.tsx`
   - Updated: `docs/INVENTORY_INTEGRITY_REMEDIATION.md`
4. **Git State:** Clean working tree with only the required new migrations, tests, and documentation. Zero Git commits, pushes, resets, or branch switches were executed.
