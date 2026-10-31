# PHASE 5.0C — CONCURRENCY & FAILURE ANALYSIS
## Canonical Lock Hierarchy, Deadlock Prevention, Multi-Row Ordering, and Runtime Verification Specifications
**ATLAS OS Multi-Tenant Enterprise SaaS ERP Platform**  
**Classification:** Database Concurrency, Lock Architecture & Failure Analysis  
**Target Repository:** `D:\Projects\Atlas-OS` | **Branch:** `Vijay-Atlas`  
**Target Staging Ref:** `bwswqnhlebbzdxumlkih` | **Production Ref:** `hrxjgbupjtikokqxjzbh` (STRICTLY FORBIDDEN)

---

## 1. Executive Summary & Concurrency Stance

High-volume commercial ERP environments—such as busy electrical retail counters during peak festival seasons—generate extreme concurrency pressure:
- Multiple cashiers billing identical fast-moving SKUs (e.g., 2.5 sq mm copper wire, 16A modular switches) simultaneously.
- Concurrent payment allocations hitting the same outstanding wholesale invoice.
- Background cron workers processing expired approval requests while managers approve transactions in real time.

This document establishes the **Canonical 5-Level Lock Hierarchy**, analyzes potential lock inversion vectors, details multi-row deterministic sorting protocols, and specifies mandatory runtime concurrency test suites.

### Core Architectural Principle:
**Static design analysis alone cannot prove deadlock-free execution in PostgreSQL.**  
While static discipline eliminates circular dependencies in designed stored procedures, real-world deadlocks can emerge from implicit foreign key checks, out-of-order multi-row updates, and index lock upgrades. Therefore, **empirical multi-connection load testing on remote staging is a mandatory prerequisite for production release.**

---

## 2. Canonical 5-Level Lock Hierarchy

To prevent circular lock acquisition (where Transaction A waits for Transaction B while Transaction B waits for Transaction A), all database transactions in ATLAS OS must acquire row locks strictly in descending order of hierarchy:

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

## 3. Concurrency Risk Analysis & Inversion Mitigations

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       LOCK INVERSION & CONCURRENCY RISK AUDIT                                          │
├────┬─────────────────────────────┬────────────────────────────────────────────────┬────────────────────────────────────┤
│ #  │ Concurrency Scenario        │ Potential Deadlock / Race Risk                 │ Mandatory Architecture Defense     │
├────┼─────────────────────────────┼────────────────────────────────────────────────┼────────────────────────────────────┤
│ 01 │ Multi-Row Product Stock     │ Cashier A sells Product 1 then Product 2;      │ Mandatory deterministic sorting:   │
│    │ Deductions (Invoice Items)  │ Cashier B sells Product 2 then Product 1.      │ `ORDER BY id ASC FOR UPDATE`       │
│    │                             │ Circular lock wait triggers SQLSTATE 40P01.    │ enforced in all stock RPCs.        │
├────┼─────────────────────────────┼────────────────────────────────────────────────┼────────────────────────────────────┤
│ 02 │ Multi-Invoice Payment       │ Payment A allocates to Inv 1 then Inv 2;       │ Payment allocation RPC sorts       │
│    │ Allocation                  │ Payment B allocates to Inv 2 then Inv 1.       │ target invoice IDs deterministical:│
│    │                             │ Circular lock wait triggers SQLSTATE 40P01.    │ `ORDER BY invoice_id ASC`.         │
├────┼─────────────────────────────┼────────────────────────────────────────────────┼────────────────────────────────────┤
│ 03 │ Approval vs Invoice Creation│ Workflow A locks `approval_requests` then      │ Established Level 3.2 precedes     │
│    │ Collision                   │ locks `invoices`; Workflow B locks `invoices`  │ Level 3.5. Draft invoices cannot   │
│    │                             │ then locks `approval_requests`.                │ acquire Level 3.5 ledger locks.    │
├────┼─────────────────────────────┼────────────────────────────────────────────────┼────────────────────────────────────┤
│ 04 │ Implicit Foreign Key Locks  │ Updating parent key in `organizations` while   │ Compound FKs reference immutable   │
│    │ on Child Inserts            │ child rows are inserted can escalate locks to  │ keys (`id`); direct DML revoked;   │
│    │                             │ `SHARE ROW EXCLUSIVE` across transactions.     │ updates funnel through Level 1 RPC.│
├────┼─────────────────────────────┼────────────────────────────────────────────────┼────────────────────────────────────┤
│ 05 │ Document Sequence Contention│ Holding sequence row lock while performing     │ Sequence number allocation occurs  │
│    │ Bottleneck                  │ long calculation stalls all concurrent billing │ at the very END of the transaction,│
│    │                             │ workers across the branch.                     │ held for microseconds before COMMIT│
└────┴─────────────────────────────┴────────────────────────────────────────────────┴────────────────────────────────────┘
```

---

## 4. Multi-Row Deterministic Ordering Protocol

In PostgreSQL, executing:
```sql
SELECT id FROM products WHERE id IN ('uuid-B', 'uuid-A') FOR UPDATE;
```
without an explicit `ORDER BY` clause causes the PostgreSQL query planner to lock rows in physical heap scan order. If parallel transactions read the heap via differing index paths or buffer cache states, they acquire row locks in conflicting order, causing instant deadlocks (`40P01`).

### The ATLAS OS Sorting Standard:
Every stored procedure accepting an array of UUIDs must explicitly sort them prior to acquiring locks:
```sql
-- Correct, Deadlock-Proof Pattern
PERFORM id 
FROM public.products 
WHERE id = ANY(p_product_ids) 
ORDER BY id ASC 
FOR UPDATE;
```

---

## 5. Transaction Isolation & Retry Protocols

### 5.1 Transaction Isolation Level
- **Default Level:** PostgreSQL `READ COMMITTED`.
- **Justification:** `READ COMMITTED` paired with explicit `FOR UPDATE` row locks provides the highest concurrency throughput while completely preventing lost updates and dirty reads.
- **Repeatable Read Consideration:** Full `REPEATABLE READ` or `SERIALIZABLE` isolation is intentionally avoided for high-volume retail transactions because it causes excessive serialization failures (`40001: could not serialize access due to concurrent update`), degrading counter billing performance.

### 5.2 Client Retry & Backoff Strategy
Even with a strict lock hierarchy, transient lock waits or network interruptions can occur. Application clients must implement **exponential backoff with jitter**:
```typescript
async function executeWithRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await fn();
    } catch (error: any) {
      // Retry on transient serialization failure (40001) or deadlock (40P01)
      if (error?.code === '40P01' || error?.code === '40001') {
        attempt++;
        if (attempt >= maxRetries) throw error;
        const delay = Math.min(1000, Math.pow(2, attempt) * 100 + Math.random() * 50);
        await new Promise(res => setTimeout(res, delay));
      } else {
        throw error;
      }
    }
  }
  throw new Error('Transaction retry limit exceeded');
}
```

---

## 6. Runtime Concurrency Test Specifications (Tier 2)

Prior to authorizing production deployment, the following automated multi-connection stress test suite must be executed against remote staging:

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       TIER 2 CONCURRENCY STRESS TEST SUITE                                             │
├────┬─────────────────────────────┬────────────────────────────────────┬────────────────────────────────────────────────┤
│ #  │ Test Scenario               │ Workload Configuration             │ Mandatory Acceptance Threshold                 │
├────┼─────────────────────────────┼────────────────────────────────────┼────────────────────────────────────────────────┤
│ 01 │ Hot SKU Stock Allocation    │ 20 concurrent connections          │ • 100% successful commits or clean retries.    │
│    │ Contention                  │ attempting to bill 1 unit of a SKU │ • Zero negative inventory balances in movements│
│    │                             │ with total initial stock = 10.     │ • Zero PostgreSQL deadlocks (40P01 = 0).       │
├────┼─────────────────────────────┼────────────────────────────────────┼────────────────────────────────────────────────┤
│ 02 │ Concurrent Payment          │ 10 concurrent connections          │ • Final balance due equals exactly ₹0.00.      │
│    │ Allocation Against Invoice  │ allocating ₹10,000 each against    │ • Total allocated equals exactly ₹50,000.      │
│    │                             │ a ₹50,000 outstanding invoice.     │ • Zero overpayment / double-allocation error.  │
├────┼─────────────────────────────┼────────────────────────────────────┼────────────────────────────────────────────────┤
│ 03 │ Simultaneous Dual Approver  │ 2 approvers submitting sign_appr   │ • Exactly 2 signatures recorded in decisions.  │
│    │ Quorum Signing              │ at the exact same millisecond for  │ • Status transitions to APPROVED cleanly.      │
│    │                             │ the same Tier 4 request.           │ • Zero race-condition overwrite.               │
├────┼─────────────────────────────┼────────────────────────────────────┼────────────────────────────────────────────────┤
│ 04 │ Interleaved Sequence        │ 50 concurrent billing requests     │ • 50 consecutive gapless numbers generated.    │
│    │ Allocation Stress           │ across 3 branches.                 │ • Zero duplicate sequence numbers.             │
│    │                             │                                    │ • Zero sequence gaps created on rollbacks.     │
└────┴─────────────────────────────┴────────────────────────────────────┴────────────────────────────────────────────────┘
```
