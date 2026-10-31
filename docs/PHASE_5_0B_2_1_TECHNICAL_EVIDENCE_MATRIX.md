# PHASE 5.0B.2.1 — TECHNICAL EVIDENCE & CONCURRENCY MATRIX
## Comprehensive 4-Column Deployment Inventory, Evidence-Based Concurrency Analysis, and Runtime Test Specifications
**ATLAS OS Enterprise SaaS ERP Platform**  
**Classification:** Technical Evidence, Lock Architecture & Concurrency Contract  
**Target Repository:** `D:\Projects\Atlas-OS` | **Branch:** `Vijay-Atlas`  
**Target Staging Ref:** `bwswqnhlebbzdxumlkih` | **Production Ref:** `hrxjgbupjtikokqxjzbh` (STRICTLY FORBIDDEN)

---

## 1. Executive Summary & Verification Scope

This document provides the definitive, transparent technical inventory for ATLAS OS. It establishes strict boundaries between:
1. **Local Source Presence:** Source files and SQL definitions existing on local disk.
2. **Git Commit Status:** Files tracked and committed to branch `Vijay-Atlas` versus untracked or modified working-tree files.
3. **Remote Migration History:** Migrations recorded in the `supabase_migrations` table on remote staging.
4. **Live Staging Catalog Verification:** Schemas, tables, columns, triggers, and RPCs verified by direct SQL inspection of `information_schema` / `pg_catalog` on staging reference `bwswqnhlebbzdxumlkih`.

Furthermore, this document **retracts prior theoretical claims of "absolute deadlock-free operation"** and replaces them with an **evidence-based concurrency evaluation**, detailing the 5-level lock hierarchy, known potential inversion vectors, unverified runtime paths, and mandatory automated stress-test requirements.

---

## 2. 4-Column Technical Deployment Inventory

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       4-COLUMN TECHNICAL DEPLOYMENT INVENTORY                                          │
├────┬─────────────────────────────┬─────────────────────┬──────────────────┬─────────────────────┬──────────────────────┤
│ #  │ Technical Control / Module  │ 1. Local Source     │ 2. Git Commit    │ 3. Remote Migration │ 4. Live Staging      │
│    │                             │ Presence (Disk)     │ Status (Branch)  │ History (`_mig`)    │ Catalog (`pg_cat`)   │
├────┼─────────────────────────────┼─────────────────────┼──────────────────┼─────────────────────┼──────────────────────┤
│ 01 │ Base Multi-Tenant Schema    │ `001_multi_tenant_` │ COMMITTED        │ EXPECTED DEPLOYED   │ UNVERIFIED           │
│    │ (`organizations`, `members`)│ Present on disk     │ (`Vijay-Atlas`)  │ (Migration 001)     │ (Query Blocked BLK01)│
├────┼─────────────────────────────┼─────────────────────┼──────────────────┼─────────────────────┼──────────────────────┤
│ 02 │ Master Catalog Entities     │ `002_products_...`  │ COMMITTED        │ EXPECTED DEPLOYED   │ UNVERIFIED           │
│    │ (`products`, `customers`)   │ Present on disk     │ (`Vijay-Atlas`)  │ (Migration 002)     │ (Query Blocked BLK01)│
├────┼─────────────────────────────┼─────────────────────┼──────────────────┼─────────────────────┼──────────────────────┤
│ 03 │ Inventory Stock Movement    │ `003_inventory_...` │ COMMITTED        │ EXPECTED DEPLOYED   │ UNVERIFIED           │
│    │ (`stock_movements`, helper) │ Present on disk     │ (`Vijay-Atlas`)  │ (Migration 003)     │ (Query Blocked BLK01)│
├────┼─────────────────────────────┼─────────────────────┼──────────────────┼─────────────────────┼──────────────────────┤
│ 04 │ Commercial Documents Schema │ `004_quotations...` │ COMMITTED        │ EXPECTED DEPLOYED   │ UNVERIFIED           │
│    │ (`quotations`, `invoices`)  │ `005_invoices...`   │ (`Vijay-Atlas`)  │ (Migrations 004–005)│ (Query Blocked BLK01)│
├────┼─────────────────────────────┼─────────────────────┼──────────────────┼─────────────────────┼──────────────────────┤
│ 05 │ Payment Allocation RPC      │ `007_security...`   │ COMMITTED        │ EXPECTED DEPLOYED   │ UNVERIFIED           │
│    │ (`record_payment_...`)      │ `011_robust...`     │ (`Vijay-Atlas`)  │ (Migrations 007,011)│ (Query Blocked BLK01)│
├────┼─────────────────────────────┼─────────────────────┼──────────────────┼─────────────────────┼──────────────────────┤
│ 06 │ Organization RLS Helpers    │ `008_fix_auth...`   │ COMMITTED        │ EXPECTED DEPLOYED   │ UNVERIFIED           │
│    │ (`get_user_organizations()`)│ Present on disk     │ (`Vijay-Atlas`)  │ (Migration 008)     │ (Query Blocked BLK01)│
├────┼─────────────────────────────┼─────────────────────┼──────────────────┼─────────────────────┼──────────────────────┤
│ 07 │ Document Sequences Table    │ `010_robust...`     │ COMMITTED        │ EXPECTED DEPLOYED   │ UNVERIFIED           │
│    │ (`allocate_document_number`)│ Present on disk     │ (`Vijay-Atlas`)  │ (Migration 010)     │ (Query Blocked BLK01)│
├────┼─────────────────────────────┼─────────────────────┼──────────────────┼─────────────────────┼──────────────────────┤
│ 08 │ Organization Creation RPC   │ `012_organization_` │ UNTRACKED (`??`) │ UNVERIFIED          │ UNVERIFIED           │
│    │ (Atomic Onboarding Flow)    │ Working tree file   │ NOT COMMITTED    │ Deployment Unknown  │ (Query Blocked BLK01)│
├────┼─────────────────────────────┼─────────────────────┼──────────────────┼─────────────────────┼──────────────────────┤
│ 09 │ Business Eligibility/Trials │ `013_business_...`  │ UNTRACKED (`??`) │ UNVERIFIED          │ UNVERIFIED           │
│    │ (Trial & Subscription State)│ Working tree file   │ NOT COMMITTED    │ Deployment Unknown  │ (Query Blocked BLK01)│
├────┼─────────────────────────────┼─────────────────────┼──────────────────┼─────────────────────┼──────────────────────┤
│ 10 │ Harden RLS with Eligibility │ `014_harden_...`    │ UNTRACKED (`??`) │ UNVERIFIED          │ UNVERIFIED           │
│    │ (Operational Table Policies)│ Working tree file   │ NOT COMMITTED    │ Deployment Unknown  │ (Query Blocked BLK01)│
├────┼─────────────────────────────┼─────────────────────┼──────────────────┼─────────────────────┼──────────────────────┤
│ 11 │ Target Security & Governance│ `PHASE_5_0B_...`    │ DESIGN SPEC ONLY │ NOT APPLIED         │ NOT DEPLOYED         │
│    │ (Migration 015 Target)      │ Target Blueprint    │ No Migration File│ (Awaiting Impl.)    │ (Requires Exec.)     │
└────┴─────────────────────────────┴─────────────────────┴──────────────────┴─────────────────────┴──────────────────────┘
```

### 2.1 Critical Inventory Findings
1. **Migrations 001 Through 011:** These files are committed to git in branch `Vijay-Atlas`. In prior audit phases, they were assumed to have been pushed to staging. However, **in the absence of a live query against `supabase_migrations` or `information_schema` on staging ref `bwswqnhlebbzdxumlkih`, their remote deployment status remains technically UNVERIFIED.**
2. **Migrations 012, 013, and 014 (Working-Tree State):**
   - `012_organization_creation_rpc.sql` (155 lines)
   - `013_business_eligibility_and_trials.sql` (188 lines)
   - `014_harden_operational_rls_with_eligibility.sql` (137 lines)
   These three files exist **only as untracked files (`??`) in the local workspace**. They have not been committed to git, and there is zero evidence of their remote execution on staging. **They MUST NOT be treated as deployed.**
3. **Target Migration 015:** Strictly a design specification authored across Phase 5.0A, 5.0B, and 5.0B.2. No migration SQL file has been created, and no database changes have been applied.

---

## 3. Evidence-Based Concurrency & Lock Hierarchy Analysis

Prior documentation asserted that the system was "mathematically proven deadlock-free." That assertion is hereby corrected. While the architecture enforces a disciplined strict lock hierarchy, **deadlock-free guarantees in distributed PostgreSQL applications cannot be proven theoretically without empirical validation.**

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       ATLAS OS 5-LEVEL LOCK ORDERING HIERARCHY                                         │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

    LEVEL 1: Organization Context Lock
    `SELECT id FROM organizations WHERE id = p_org_id FOR UPDATE;`
    (Serializes org-level structural operations, membership purges, status toggles)
                        │
                        ▼
    LEVEL 2: Master Entity Resource Locks
    `SELECT id FROM products WHERE id = ANY(p_product_ids) ORDER BY id ASC FOR UPDATE;`
    `SELECT id FROM customers WHERE id = p_customer_id FOR UPDATE;`
    (Always acquired in deterministic primary key ascending order!)
                        │
                        ▼
    LEVEL 3.2: Governance & Approval Workflow Locks
    `SELECT id FROM approval_requests WHERE id = p_request_id FOR UPDATE;`
    (Serializes approval decisions, dual-approver quorum signing, expiry checks)
                        │
                        ▼
    LEVEL 3.5: Operational Financial Ledger Locks
    `SELECT id, balance_due FROM invoices WHERE id = p_invoice_id FOR UPDATE;`
    `SELECT id FROM payments WHERE id = p_payment_id FOR UPDATE;`
    (Serializes balance adjustments, allocations, credit note applications)
                        │
                        ▼
    LEVEL 4: Document Sequence Numbering Lock
    `SELECT next_number FROM document_sequences WHERE ... FOR UPDATE;`
    (Guarantees gapless sequential serialization; held for microseconds before COMMIT)
                        │
                        ▼
    LEVEL 5: Audit Event Append-Only Stream
    `INSERT INTO audit_events (...) VALUES (...);`
    (Strictly append-only; zero prior locks held; zero read locks acquired)
```

---

### 3.1 Known Potential Lock Inversion Vectors

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    POTENTIAL CONCURRENCY RISKS & INVERSION VECTORS                                     │
├────┬─────────────────────────────┬────────────────────────────────────────────────┬────────────────────────────────────┤
│ #  │ Inversion Risk Scenario     │ Potential Failure Mode                         │ Architecture Defense Mechanism     │
├────┼─────────────────────────────┼────────────────────────────────────────────────┼────────────────────────────────────┤
│ 01 │ Unordered Multi-Row Locks   │ Worker A locks Product 1 then Product 2;       │ Mandatory SQL convention: All      │
│    │ (Inventory Movements)       │ Worker B locks Product 2 then Product 1.       │ array-based locks MUST enforce     │
│    │                             │ Result: Classical PostgreSQL Deadlock (40P01). │ `ORDER BY id ASC` in the query!    │
├────┼─────────────────────────────┼────────────────────────────────────────────────┼────────────────────────────────────┤
│ 02 │ Approval vs Invoice Creation│ Workflow A locks `approval_requests` then      │ Established Level 3.2 precedes     │
│    │ Lock Ordering Collision     │ creates `invoices`; Workflow B locks `invoices`│ Level 3.5. Draft invoices cannot   │
│    │                             │ then links `approval_requests`.                │ acquire financial locks.           │
├────┼─────────────────────────────┼────────────────────────────────────────────────┼────────────────────────────────────┤
│ 03 │ Implicit Foreign Key Locks  │ Updating a parent row (`organizations`) while  │ Direct DML revoked; all updates    │
│    │ on Child Inserts            │ child rows (`invoice_items`) are inserted can  │ funnel through RPCs enforcing      │
│    │                             │ upgrade locks to `SHARE ROW EXCLUSIVE`.        │ Level 1 locking upfront.           │
├────┼─────────────────────────────┼────────────────────────────────────────────────┼────────────────────────────────────┤
│ 04 │ Concurrent Multi-Invoice    │ Payment allocation spans Invoice 1 & 2;        │ Allocation RPC must sort invoice   │
│    │ Payment Allocation          │ Competing payment spans Invoice 2 & 1.         │ IDs deterministically:             │
│    │                             │ Result: Cross-document allocation deadlock.    │ `ORDER BY invoice_id ASC`.         │
└────┴─────────────────────────────┴────────────────────────────────────────────────┴────────────────────────────────────┘
```

---

### 3.2 Unverified Runtime Paths

The following code paths cannot be confirmed deadlock-free until remote stress testing is performed:
1. **Concurrent High-Concurrency Checkout:** Multiple cashiers at different branches selling the same low-stock SKU simultaneously. While `ORDER BY id ASC FOR UPDATE` prevents circular deadlocks, transaction throughput and lock wait timeout (`statement_timeout = '5s'`) behavior under saturation must be benchmarked.
2. **Simultaneous Dual-Approver Signing:** Two authorized approvers submitting `sign_approval` for the same Tier 4 request at the exact same millisecond. The row lock on `approval_requests` serializes the update, but edge cases in concurrent status updating must be tested.
3. **Cross-Branch Inventory Transfer:** Re-allocating stock from Branch A to Branch B under concurrent outbound invoicing at Branch A.

---

## 4. Pre-Deployment 3-Tier Automated Test Specification

Before Migration 015 can be considered safe for remote execution, the following 3-tier test harness must be implemented and executed:

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       3-TIER PRE-DEPLOYMENT TEST HARNESS                                               │
├────────────────────┬───────────────────────────────────────┬───────────────────────────────────────────────────────────┤
│ Test Tier          │ Testing Framework & Scope             │ Mandatory Pass Criteria & Concurrency Assertions          │
├────────────────────┼───────────────────────────────────────┼───────────────────────────────────────────────────────────┤
│ **TIER 1: SQL Unit │ `pgTAP` / Local Transaction Harness   │ • 100% of DDL constraints, triggers, and functions pass. │
│ & Invariant Suite  │ (Deterministic single-connection)     │ • Trigger asserts exactly 1 Primary Owner at COMMIT.      │
│                    │                                       │ • Immutability trigger blocks UPDATE/DELETE on invoices.  │
│                    │                                       │ • Zero sequence gaps generated on draft abandons.         │
├────────────────────┼───────────────────────────────────────┼───────────────────────────────────────────────────────────┤
│ **TIER 2: Multi-   │ `k6` / Go Concurrency Test Suite      │ • 20 concurrent connections executing competing invoice   │
│ Threaded Stress &  │ (10–50 concurrent database sessions)  │   generation on overlapping SKUs.                         │
│ Deadlock Detection │                                       │ • Zero deadlocks (PostgreSQL SQLSTATE `40P01` = 0).       │
│                    │                                       │ • Zero negative inventory balances in `stock_movements`.  │
│                    │                                       │ • Zero double-allocation in payment settlement RPCs.      │
├────────────────────┼───────────────────────────────────────┼───────────────────────────────────────────────────────────┤
│ **TIER 3: End-to-  │ Playwright / Node.js E2E Test Suite   │ • Complete onboarding, approval, and invoicing flow.      │
│ End Application    │ (Simulated multi-role browser actors) │ • Separation of Duties: Self-approval rejected in UI & DB.│
│ Integration        │                                       │ • Branch user access: Masked customer credit terms.       │
│                    │                                       │ • Expiry handling: Expired requests do not mutate ledger. │
└────────────────────┴───────────────────────────────────────┴───────────────────────────────────────────────────────────┘
```

---

## 5. Technical Validation Gate Checklist (Pre-Migration 015)

```
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
MANDATORY GATES BEFORE REMOTE STAGING DDL EXECUTION:
  [ ] RESOLVE BLK-01: Execute read-only `pg_catalog` query on staging `bwswqnhlebbzdxumlkih` to verify actual catalog.
  [ ] RECONCILE MIGRATIONS 012–014: Determine whether working-tree files are deployed or pending commit/migration.
  [ ] COMPOSE MIGRATION 015 SQL: Draft idempotent, backwards-compatible DDL scripts in `supabase/migrations/`.
  [ ] EXECUTE TIER 1 pgTAP TESTS: Verify all triggers and RPCs in an isolated staging branch.
  [ ] EXECUTE TIER 2 STRESS TESTS: Verify zero deadlocks (`40P01`) under 20-worker concurrent load.
  [ ] VERIFY IMMUTABILITY LOGIC: Confirm issued invoices cannot be mutated, updated, or deleted.
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
```
