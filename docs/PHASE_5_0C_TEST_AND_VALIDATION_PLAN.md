# PHASE 5.0C — TEST & VALIDATION PLAN
## Master Pre-Deployment Verification Strategy: 21 Security Test Scenarios, 6 Testing Tiers, and Evidence Retention Specifications
**ATLAS OS Multi-Tenant Enterprise SaaS ERP Platform**  
**Classification:** Quality Assurance, Security Testing & Verification Strategy  
**Target Repository:** `D:\Projects\Atlas-OS` | **Branch:** `Vijay-Atlas`  
**Target Staging Ref:** `bwswqnhlebbzdxumlkih` | **Production Ref:** `hrxjgbupjtikokqxjzbh` (STRICTLY FORBIDDEN)

---

## 1. Executive Summary & Verification Protocol

This document defines the comprehensive pre-deployment test program for ATLAS OS. In strict accordance with Phase 5.0C read-only boundaries, **no mutating tests are executed during this phase**. 

Instead, this document establishes the formal test specifications, assertions, preconditions, execution actions, expected outcomes, and evidence retention criteria required before Migration 015 can be applied to staging or production.

### Test Program Tier Architecture:
```
┌────────────────────────────────────────────────────────────────────────────────────────────────┐
│ TIER 1: Isolated Database Invariant & SQL Unit Tests (`pgTAP` / Local Transaction Harness)     │
├────────────────────────────────────────────────────────────────────────────────────────────────┤
│ TIER 2: Automated Multi-Connection Concurrency & Deadlock Stress Tests (`k6` / Go Suite)       │
├────────────────────────────────────────────────────────────────────────────────────────────────┤
│ TIER 3: End-to-End Application Integration & Role-Based UI Tests (Playwright / Vitest)        │
├────────────────────────────────────────────────────────────────────────────────────────────────┤
│ TIER 4: Security Penetration, RLS Bypass & Boundary Attack Tests (OWASP ZAP / Custom Scripts)  │
├────────────────────────────────────────────────────────────────────────────────────────────────┤
│ TIER 5: Automated Security Regression & Schema Verification Suite (CI/CD Automated Gate)       │
├────────────────────────────────────────────────────────────────────────────────────────────────┤
│ TIER 6: Manual Professional Review (Certified Chartered Accountant & Qualified Legal Counsel) │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Catalog of 21 Core Verification Scenarios

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       21 CORE PRE-DEPLOYMENT TEST SCENARIOS                                            │
├────┬─────────────────────────────┬──────────────────┬─────────────────────────────────┬────────────────────────────────┤
│ #  │ Test Scenario Name          │ Test Tier        │ Precondition & Test Action      │ Expected Result & Retained Evid│
├────┼─────────────────────────────┼──────────────────┼─────────────────────────────────┼────────────────────────────────┤
│ 01 │ Cross-Tenant Read/Write     │ Tier 1 / Tier 4  │ User authenticated in Org A;    │ Query returns 0 rows; mutation │
│    │ Isolation                   │ Database RLS     │ attempts `SELECT` / `UPDATE`    │ returns 42501; zero data leak; │
│    │                             │                  │ on records belonging to Org B.  │ logged in `audit_events`.      │
├────┼─────────────────────────────┼──────────────────┼─────────────────────────────────┼────────────────────────────────┤
│ 02 │ Cross-Branch Access Control │ Tier 3 / Tier 4  │ Branch cashier authenticated in │ Cashier cannot create invoice  │
│    │ Boundaries                  │ Application E2E  │ Branch 1; attempts to bill stock│ for Branch 2 SKU; access denied│
│    │                             │                  │ allocated to Branch 2.          │ error returned; audit recorded.│
├────┼─────────────────────────────┼──────────────────┼─────────────────────────────────┼────────────────────────────────┤
│ 03 │ Direct PostgREST RLS Bypass │ Tier 4           │ Attacker sends raw HTTP POST /  │ PostgREST returns HTTP 403 /   │
│    │ Exploitation Attempt        │ Penetration Test │ PATCH directly to `/invoices`   │ SQLSTATE 42501; direct table   │
│    │                             │                  │ bypassing UI client RPCs.       │ mutation blocked completely.   │
├────┼─────────────────────────────┼──────────────────┼─────────────────────────────────┼────────────────────────────────┤
│ 04 │ Closed-Door REST DML        │ Tier 1 / Tier 4  │ Direct `INSERT INTO invoices`   │ Database engine rejects with   │
│    │ Restriction Enforcement     │ SQL Privilege    │ attempted via `authenticated`   │ SQLSTATE 42501 (permission     │
│    │                             │                  │ database session role.          │ denied for table invoices).    │
├────┼─────────────────────────────┼──────────────────┼─────────────────────────────────┼────────────────────────────────┤
│ 05 │ Service-Role Privilege      │ Tier 1           │ Script authenticated as         │ PostgreSQL rejects TRUNCATE /  │
│    │ Boundary Protection         │ Administrative   │ `service_role` attempts to      │ DELETE with SQLSTATE 42501;    │
│    │                             │                  │ TRUNCATE or DELETE audit_events.│ ledger history preserved.      │
├────┼─────────────────────────────┼──────────────────┼─────────────────────────────────┼────────────────────────────────┤
│ 06 │ Ownership Transfer          │ Tier 1 / Tier 2  │ Incumbent Primary Owner offers  │ Two-phase transfer completes;  │
│    │ Concurrency Handshake       │ State Machine    │ ownership; nominee accepts;     │ exactly 1 Primary Owner remains│
│    │                             │                  │ concurrent queries inspect org. │ active at all times.           │
├────┼─────────────────────────────┼──────────────────┼─────────────────────────────────┼────────────────────────────────┤
│ 07 │ Exactly One Active Primary  │ Tier 1           │ Transaction attempts to delete  │ Deferred constraint trigger    │
│    │ Owner Protection (DEC-01)   │ DDL Trigger      │ Primary Owner row without       │ raises exception at COMMIT;    │
│    │                             │                  │ appointing an active successor. │ transaction rolled back.       │
├────┼─────────────────────────────┼──────────────────┼─────────────────────────────────┼────────────────────────────────┤
│ 08 │ Monotonic Custom Role       │ Tier 1           │ User with role 'Branch Manager' │ Trigger detects privilege jump;│
│    │ Delegation Escalation       │ Security Logic   │ attempts to create custom role  │ raises 42501; custom role      │
│    │                             │                  │ with permission `owner:manage`. │ creation aborted cleanly.      │
├────┼─────────────────────────────┼──────────────────┼─────────────────────────────────┼────────────────────────────────┤
│ 09 │ Permission Override Bounds  │ Tier 1 / Tier 3  │ Manager attempts to grant       │ Override creation blocked;     │
│    │ & Auditability              │ RBAC Lifecycle   │ permission override exceeding   │ attempt logged with actor ID   │
│    │                             │                  │ their own delegation authority. │ in `audit_events`.             │
├────┼─────────────────────────────┼──────────────────┼─────────────────────────────────┼────────────────────────────────┤
│ 10 │ Separation of Duties (SoD)  │ Tier 1 / Tier 3  │ Initiator of approval request   │ Trigger raises SQLSTATE 42501; │
│    │ Anti-Self-Approval          │ Governance Gate  │ attempts to sign `approve` on   │ self-approval blocked; decision│
│    │                             │                  │ their own pending request.      │ row rejected from database.    │
├────┼─────────────────────────────┼──────────────────┼─────────────────────────────────┼────────────────────────────────┤
│ 11 │ Dual-Approver Independence  │ Tier 1           │ Same authorized approver submits│ Trigger asserts approver_1 !=  │
│    │ & Quorum Verification       │ Governance Gate  │ signatures for both Approver 1  │ approver_2; request remains in │
│    │                             │                  │ and Approver 2 on Tier 4 item.  │ PENDING; status not promoted.  │
├────┼─────────────────────────────┼──────────────────┼─────────────────────────────────┼────────────────────────────────┤
│ 12 │ Approval Expiry Non-        │ Tier 1 / Tier 3  │ Approval request exceeds 72h;   │ Status transitions to EXPIRED; │
│    │ Approval Enforcement        │ Lifecycle State  │ cron runs; worker attempts to   │ associated draft NOT posted;   │
│    │                             │                  │ commit commercial transaction.  │ zero sequence number consumed. │
├────┼─────────────────────────────┼──────────────────┼─────────────────────────────────┼────────────────────────────────┤
│ 13 │ Invoice Issuance and Post-  │ Tier 1 / Tier 4  │ Invoice published (`ISSUED`);   │ Database trigger raises 42501; │
│    │ Issuance Immutability       │ Immutability Trg │ attacker attempts SQL UPDATE on │ invoice amount, items, and tax │
│    │                             │                  │ total or DELETE of row.         │ remain completely unaltered.   │
├────┼─────────────────────────────┼──────────────────┼─────────────────────────────────┼────────────────────────────────┤
│ 14 │ Payment Overpayment &       │ Tier 1 / Tier 2  │ 5 concurrent workers attempt    │ Exactly ₹10,000 allocated;     │
│    │ Double-Allocation Guard     │ Concurrency Lock │ allocating ₹5,000 each against  │ balance reaches ₹0.00; surplus │
│    │                             │                  │ a ₹10,000 balance invoice.      │ rejected; zero negative balance│
├────┼─────────────────────────────┼──────────────────┼─────────────────────────────────┼────────────────────────────────┤
│ 15 │ Idempotency Key Replay &    │ Tier 1 / Tier 3  │ Network times out; client retries│ Cached response returned;      │
│    │ Payload Collision Detection │ Integration API  │ identical payload with same key;│ zero duplicate invoice created;│
│    │                             │                  │ then retries with altered body. │ altered payload returns 409.   │
├────┼─────────────────────────────┼──────────────────┼─────────────────────────────────┼────────────────────────────────┤
│ 16 │ Physical Stock Movement     │ Tier 1           │ Transaction inserts negative    │ `CHECK (quantity > 0)` or      │
│    │ Ledger Consistency          │ Domain Ledger    │ quantity or updates historical  │ immutability trigger blocks    │
│    │                             │                  │ movement row in `stock_move`.   │ write; inventory sum accurate. │
├────┼─────────────────────────────┼──────────────────┼─────────────────────────────────┼────────────────────────────────┤
│ 17 │ High-Concurrency Hot SKU    │ Tier 2           │ 20 concurrent connections       │ All workers serialize cleanly; │
│    │ Deadlock Stress Testing     │ Load Stress Test │ billing 1 unit of SKU with 10   │ 10 succeed, 10 receive out-of- │
│    │                             │                  │ units stock simultaneously.     │ stock; zero deadlocks (40P01=0)│
├────┼─────────────────────────────┼──────────────────┼─────────────────────────────────┼────────────────────────────────┤
│ 18 │ Server-Side Actor Spoofing  │ Tier 4           │ Attacker passes `{ actor_id:    │ Server derives actor from JWT  │
│    │ Prevention in Audit Trails  │ Security Audit   │ "victim-uuid" }` in JSON body   │ `sub`; audit log records actual│
│    │                             │                  │ of invoice creation RPC.        │ authenticated actor correctly. │
├────┼─────────────────────────────┼──────────────────┼─────────────────────────────────┼────────────────────────────────┤
│ 19 │ Deprovisioning Retries &    │ Tier 1 / Tier 3  │ User deprovisioned; GoTrue Auth │ Historical invoices retain bare│
│    │ Ledger Survival Verification│ Lifecycle State  │ record deleted; queries inspect │ UUID; profile pseudonymized;   │
│    │                             │                  │ historical invoice authorship.  │ zero cascading ledger deletion.│
├────┼─────────────────────────────┼──────────────────┼─────────────────────────────────┼────────────────────────────────┤
│ 20 │ Statutory Legal Hold        │ Tier 1           │ Org placed on `legal_hold =     │ Triggers block partition drop  │
│    │ Deletion Suspension         │ Regulatory Hold  │ TRUE`; cron attempts to purge   │ and PII sanitization; data     │
│    │                             │                  │ audit logs older than 365 days. │ preserved intact for court.    │
├────┼─────────────────────────────┼──────────────────┼─────────────────────────────────┼────────────────────────────────┤
│ 21 │ Search-Path Injection &     │ Tier 4           │ Malicious user creates schema   │ Stored procedure executes with │
│    │ Trojan Schema Attack        │ Penetration Test │ `attacker_schema`; executes     │ `search_path = public, pg_temp`│
│    │                             │                  │ SECURITY DEFINER function.      │ Trojan functions never invoked.│
└────┴─────────────────────────────┴──────────────────┴─────────────────────────────────┴────────────────────────────────┘
```

---

## 3. Detailed Test Specification Format (Example: Scenario 13)

```
TEST ID: SEC-TS-13 — INVOICE ISSUANCE AND IMMUTABILITY
TIER: Tier 1 (pgTAP) & Tier 4 (Penetration Verification)

1. PRECONDITIONS:
   - Organization 'Org-Alpha' exists and is active.
   - User 'Cashier-1' is authenticated with role 'cashier'.
   - Customer 'Cust-Beta' exists in Org-Alpha.
   - Product 'SKU-Wire' has 100 units in stock movements.

2. TEST ACTION:
   - Step A: Invoke `create_invoice_with_items` for 10 units of SKU-Wire.
   - Step B: Invoice transitions to 'ISSUED' with invoice_number 'INV-2026-0001'.
   - Step C: Attempt direct SQL statement:
     `UPDATE public.invoices SET total_amount = 0.00 WHERE id = '...';`
   - Step D: Attempt direct SQL statement:
     `DELETE FROM public.invoices WHERE id = '...';`

3. EXPECTED OUTCOME:
   - Step A & B succeed; invoice reaches 'ISSUED' with sequence allocated.
   - Step C FAILS with SQLSTATE '42501' (Immutability violation).
   - Step D FAILS with SQLSTATE '42501' (Immutability violation).
   - Total amount and line items remain identical to initial state.

4. RETAINED EVIDENCE:
   - PostgreSQL error log showing SQLSTATE 42501.
   - pgTAP test output showing `throws_ok(...)` assertion pass.
   - Checksum of invoice row before and after attempted attack.
```
