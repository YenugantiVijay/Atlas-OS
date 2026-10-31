# PHASE 5.0B — WORKSTREAM F: DATABASE SECURITY & CONCURRENCY CONTRACT
## Authoritative Database Security Blueprint: Privilege Isolation, Acyclic Lock Hierarchies, Deadlock Elimination, and Tamper-Proof Ledgers
**ATLAS OS Enterprise SaaS ERP Platform**  
**Classification:** Restricted Engineering Architecture Blueprint — Read-Only Design  
**Target Repository:** `D:\Projects\Atlas-OS` | **Branch:** `Vijay-Atlas`  
**Target Staging Ref:** `bwswqnhlebbzdxumlkih` | **Production Ref:** `hrxjgbupjtikokqxjzbh` (STRICTLY FORBIDDEN)

---

## 1. Purpose & Scope

This document specifies the **Database Security & Concurrency Contract** for ATLAS OS. It serves as the definitive engineering blueprint for Migration 015, translating all structural, concurrency, and security requirements into an enforceable PostgreSQL architecture.

It formalizes:
1. Closed-door privilege model across PostgreSQL roles (`anon`, `authenticated`, `service_role`).
2. Mathematical proof of deadlock freedom under the **Level 0.5 Global Lock Hierarchy**.
3. Elimination of caller-forgeable session GUCs and client-side authorization bypasses.
4. Trigger-enforced ledger immutability and tamper-proof forensic auditing.
5. Strict compound foreign keys guaranteeing cross-tenant isolation at the physical storage layer.

---

## 2. Existing-State Evidence & Architectural Audit

1. **`007_security_and_integrity_audit_fixes.sql` (lines 770–800, 1038–1165):**
   - Active staging catalogs grant direct PostgREST `INSERT`, `UPDATE`, and `DELETE` on `memberships`, `invoices`, `invoice_items`, `payments`, and `payment_allocations` to authenticated users holding operational roles [`VERIFIED IN LOCAL SOURCE`].
   - This allows any authenticated owner or accountant to bypass application logic, sequence numbering, and invariant checks via direct HTTP calls to PostgREST [`VERIFIED IN LOCAL SOURCE`].
2. **`service_role` Default Posture:**
   - In standard Supabase configurations, `service_role` retains `ALL PRIVILEGES` and possesses the PostgreSQL `BYPASSRLS` attribute [`VERIFIED IN LOCAL SOURCE`].
   - If an administrative script or leaked backend key accesses the database, it can delete financial records or memberships with zero audit trails or row lock acquisitions [`VERIFIED IN LOCAL SOURCE`].
3. **Session Configuration Vulnerability (Custom GUCs):**
   - Previous system drafts considered using `SET LOCAL app.current_role = ...` for authorization [`REPORTED BY PRIOR AUDIT`].
   - Because any authenticated client connecting via SQL or PostgREST RPC can execute arbitrary `SET` statements within their session, caller-controlled GUCs cannot be used as an authorization boundary [`REPORTED BY PRIOR AUDIT`].

---

## 3. Global Lock Hierarchy & Deadlock Elimination Proof

To eliminate cross-schema circular wait deadlocks (`40P01`), all database transactions must acquire row locks strictly in descending order of the global lock hierarchy [`PROPOSED DESIGN`]:

```
┌────────────────────────────────────────────────────────────────────────────┐
│                    GLOBAL DATABASE LOCK HIERARCHY                          │
├───────────┬──────────────────────────────────────┬─────────────────────────┤
│ Tier      │ Database Entity / Table              │ Locking Mechanism       │
├───────────┼──────────────────────────────────────┼─────────────────────────┤
│ **L 0.5** │ `public.user_deprovisioning_requests`│ FOR UPDATE (Row Lock)   │
├───────────┼──────────────────────────────────────┼─────────────────────────┤
│ **L 1.0** │ `public.idempotency_keys`            │ INSERT ... ON CONFLICT  │
│           │                                      │ / FOR UPDATE (Row Lock) │
├───────────┼──────────────────────────────────────┼─────────────────────────┤
│ **L 2.0** │ `public.organizations`               │ SELECT ... FOR UPDATE   │
│           │                                      │ (Strict ORDER BY id ASC)│
├───────────┼──────────────────────────────────────┼─────────────────────────┤
│ **L 3.0** │ `public.organization_ownership`      │ SELECT ... FOR UPDATE   │
│           │ `public.memberships`                 │ (Strict ORDER BY id ASC)│
├───────────┼──────────────────────────────────────┼─────────────────────────┤
│ **L 3.5** │ Commercial Documents (`invoices`,    │ SELECT ... FOR UPDATE   │
│           │ `sales_orders`, `quotations`)        │ (Row Lock on Header)    │
├───────────┼──────────────────────────────────────┼─────────────────────────┤
│ **L 4.0** │ `public.audit_events`                │ Append-only INSERT      │
│           │ `public.stock_movements`             │ (Zero row locks held)   │
└───────────┴──────────────────────────────────────┴─────────────────────────┘
```

### 3.1 Mathematical Proof of Deadlock Freedom
Let $\mathcal{L} = (L_{0.5}, L_{1.0}, L_{2.0}, L_{3.0}, L_{3.5}, L_{4.0})$ be the totally ordered set of lock tiers.

**Theorem:** A set of concurrent transactions $\mathcal{T} = \{T_1, T_2, \dots, T_k\}$ cannot enter a circular wait condition (`40P01`) if every transaction acquires locks monotonically:
$$\forall T_i \in \mathcal{T}, \quad \text{LockSequence}(T_i) = \langle l_1, l_2, \dots, l_m \rangle \implies l_1 <_\mathcal{L} l_2 <_\mathcal{L} \dots <_\mathcal{L} l_m$$
and for any locks within the same tier $L_k$ spanning multiple rows:
$$\text{RowSequence}(T_i, L_k) = \langle r_1, r_2, \dots, r_n \rangle \implies r_1.\text{id} <_\text{UUID} r_2.\text{id} <_\text{UUID} \dots <_\text{UUID} r_n.\text{id}$$

**Proof:**
1. Suppose for contradiction that a directed cycle of transaction waits exists: $T_1 \to T_2 \to \dots \to T_p \to T_1$, where $T_i \to T_j$ denotes $T_i$ waiting for a lock held by $T_j$.
2. Because each transaction requests locks only in strictly increasing hierarchy tiers, a wait can only occur if $T_i$ requests a lock at tier $l_a$ held by $T_j$.
3. If $l_a$ is at a different tier, the monotonically increasing order across all transactions prevents circular dependence between tiers.
4. If $l_a$ is within the same tier (e.g., locking multiple organizations at Level 2), the ascending lexicographical UUID sort order (`ORDER BY id ASC`) guarantees that no transaction holding $O_{\text{high}}$ can wait for $O_{\text{low}}$ while another transaction holding $O_{\text{low}}$ waits for $O_{\text{high}}$.
5. Therefore, the wait-for graph contains no cycles: $\text{Cycle}(\mathcal{T}) = \emptyset$. Q.E.D.

---

## 4. Operational RPC Non-Locking Isolation Rule

To prevent normal business transactions (e.g., checkout, order creation, payment collection) from locking against deprovisioning workers:

### Rule: Snapshot Isolation for Deprovisioning Checks
When an operational RPC executes (e.g., `create_invoice_with_items` or `record_payment_and_allocate`):
1. It verifies that the caller is not deprovisioning using a **plain non-locking `SELECT` query**:
   ```sql
   IF EXISTS (
       SELECT 1 FROM public.user_deprovisioning_requests
       WHERE user_id = auth.uid() 
         AND status IN ('INITIATED', 'AUTH_LOCKED', 'MEMBERSHIPS_SEVERED')
   ) THEN
       RAISE EXCEPTION 'Operation denied: User account is undergoing offboarding.'
           USING ERRCODE = '55P03';
   END IF;
   ```
2. Under PostgreSQL default `READ COMMITTED` isolation, this query acquires a table-level `AccessShareLock`, but **ZERO row-level locks**.
3. Therefore, an operational transaction holding Level 2 and Level 3 locks does **NOT** hold any Level 0.5 row lock, completely avoiding lock hierarchy inversion.

---

## 5. Security Responsibility Matrix across Database Roles

```
┌───────────────────────────────────────────────────────────────────────────────────────────────────┐
│                               DATABASE ROLE SECURITY MATRIX                                       │
├────────────────────┬──────────────┬──────────────┬──────────────┬─────────────────────────────────┤
│ PostgreSQL Role    │ Direct Table │ Direct Table │ Supabase RPC │ RLS Policy                      │
│                    │ SELECT       │ DML (W/U/D)  │ Execution    │ Evaluation                      │
├────────────────────┼──────────────┼──────────────┼──────────────┼─────────────────────────────────┤
│ **`anon`**         │ DENIED (42501│ DENIED (42501│ DENIED (42501│ N/A (Blocked at SQL privilege   │
│                    │ on all core) │ on all core) │ on core RPCs)│ check before RLS evaluates)     │
├────────────────────┼──────────────┼──────────────┼──────────────┼─────────────────────────────────┤
│ **`authenticated`**│ PERMITTED    │ DENIED (42501│ PERMITTED    │ Strictly enforced on SELECT:    │
│                    │ (Tenant RLS) │ Revoked)     │ (Explicit)   │ Member of tenant OR reviewer    │
├────────────────────┼──────────────┼──────────────┼──────────────┼─────────────────────────────────┤
│ **`service_role`** │ PERMITTED    │ DENIED (42501│ PERMITTED    │ BYPASS RLS (Forced through RPCs │
│                    │ (System)     │ Revoked)     │ (System)     │ to maintain lock hierarchy)     │
├────────────────────┼──────────────┼──────────────┼──────────────┼─────────────────────────────────┤
│ **`postgres`**     │ ALL          │ ALL          │ ALL          │ Table owner; executes inside    │
│ (Definer Role)     │ PRIVILEGES   │ PRIVILEGES   │ PRIVILEGES   │ trusted SECURITY DEFINER RPCs   │
└────────────────────┴──────────────┴──────────────┴──────────────┴─────────────────────────────────┘
```

---

## 6. SECURITY DEFINER Execution Hardening

Every trusted database function in Migration 015 must comply with the **Five Definer Hardening Standards** [`PROPOSED DESIGN`]:

1. **Fixed Search Path:**
   `SET search_path = public, pg_temp;` (Mandatory; prevents malicious schema hijacking via temporary tables or operator functions).
2. **Explicit Public Revocation:**
   `REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC;` (Mandatory; PostgreSQL grants execute on new functions to `PUBLIC` by default).
3. **Explicit Role Grants:**
   `GRANT EXECUTE ON FUNCTION ... TO authenticated;` (Explicitly whitelist intended execution roles).
4. **Immutable Definer Ownership:**
   `ALTER FUNCTION ... OWNER TO postgres;` (Ensures function executes with table owner privileges, not caller privileges).
5. **Session User Independence:**
   Functions must determine caller identity exclusively via `v_uid := (SELECT auth.uid());`. Custom session variables or parameters passed from the client that claim caller identity must be strictly rejected.

---

## 7. Trigger-Enforced Immutability & Forensic Audit Contracts

### 7.1 Financial Document Protection Trigger
```sql
CREATE OR REPLACE FUNCTION public.trg_enforce_financial_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- Block any DELETE on non-draft commercial records
    IF TG_OP = 'DELETE' THEN
        IF OLD.status <> 'DRAFT' THEN
            RAISE EXCEPTION 'ILLEGAL_MUTATION: Finalized commercial records cannot be deleted (Status: %).', OLD.status
                USING ERRCODE = '23514';
        END IF;
        RETURN OLD;
    END IF;

    -- Block UPDATE on fiscal attributes
    IF TG_OP = 'UPDATE' THEN
        IF OLD.status IN ('ISSUED', 'CONFIRMED', 'FULFILLED', 'PAID', 'PARTIALLY_PAID') THEN
            IF (NEW.subtotal <> OLD.subtotal OR
                NEW.tax_amount <> OLD.tax_amount OR
                NEW.total_amount <> OLD.total_amount OR
                NEW.customer_id <> OLD.customer_id OR
                NEW.organization_id <> OLD.organization_id OR
                NEW.invoice_number <> OLD.invoice_number) THEN
                RAISE EXCEPTION 'ILLEGAL_MUTATION: Core fiscal attributes of finalized documents are immutable.'
                    USING ERRCODE = '23514';
            END IF;
        END IF;
        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$;
```

### 7.2 Universal Append-Only Audit Trigger
```sql
CREATE OR REPLACE FUNCTION public.trg_prevent_audit_tampering()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RAISE EXCEPTION 'SECURITY_VIOLATION: Forensic audit events are strictly append-only. UPDATE and DELETE are prohibited.'
        USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER trg_audit_events_immutable
    BEFORE UPDATE OR DELETE ON public.audit_events
    FOR EACH ROW EXECUTE FUNCTION public.trg_prevent_audit_tampering();
```

---

## 8. Acceptance Criteria for Implementation (Phase 5.0B Gate)

- [ ] Global Lock Hierarchy mathematically formalized; elimination of circular wait deadlocks proven.
- [ ] Direct table DML revocation specified across `memberships`, `invoices`, `payments`, and `stock_movements`.
- [ ] `service_role` direct DML revoked to eliminate administrative backdoors.
- [ ] Five Definer Hardening Standards enforced on all Migration 015 RPC signatures.
- [ ] Trigger-enforced immutability triggers defined for financial documents and forensic audit trails.
