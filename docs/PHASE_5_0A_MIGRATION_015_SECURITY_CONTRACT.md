# PHASE 5.0A — MIGRATION 015 SECURITY CONTRACT
## Authoritative Architecture Specification, Data Model Contracts, and Privilege Hierarchy
**ATLAS OS Enterprise SaaS ERP Platform**  
**Classification:** Restricted Engineering Blueprint — Design & Documentation Only  
**Target Repository:** `D:\Projects\Atlas-OS` | **Branch:** `Vijay-Atlas`  
**Target Staging Ref:** `bwswqnhlebbzdxumlkih` | **Production Ref:** `hrxjgbupjtikokqxjzbh` (STRICTLY FORBIDDEN)

---

## 1. Executive Summary & Architecture Scope

This document establishes the binding **Security Contract** for ATLAS OS Migration 015. It synthesizes and formalizes the forensic findings from the Phase 4.11 audit series (Phases 4.11.10 through 4.11.12) into a definitive, reviewable engineering blueprint.

### 1.1 Core Architecture Objectives
1. **Closed-Door Privilege Model:** Complete elimination of direct REST-based Data Manipulation Language (`INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`) on core business entities (`memberships`, `invoices`, `invoice_items`, `payments`, `payment_allocations`, `stock_movements`) for all client-facing roles (`anon`, `authenticated`) and administrative service roles (`service_role`).
2. **Two-Phase Deprovisioning State Machine:** A mathematically proven, acyclic identity offboarding workflow operating under a strict **Level 0.5 Lock Hierarchy**, preventing cross-schema circular deadlocks (`40P01`), tenant orphaning, and zombie access upon Auth user deletion.
3. **Atomic Financial Ledger Integrity:** Transformation of invoice generation and payment allocation into server-enforced, single-transaction Remote Procedure Calls (`create_invoice_with_items`, `record_payment_and_allocate`) backed by database-level immutability triggers.
4. **Server-Side Tenant & Invariant Enforcement:** Elimination of all client-side security dependencies (such as React-based last-owner checks and multi-step REST insertions), replacing them with PostgreSQL row locks and transaction invariants.
5. **Non-Negotiable Read-Only Mandate:** In strict adherence to Phase 5.0A boundaries, **no SQL migration file is authored or executed, no application code is modified, and no database mutations are performed** during this phase.

---

## 2. Current Staging Security Gaps & Forensic Vulnerability Register

Based on direct inspection of committed migrations `001` through `011`, local working-tree migrations `012` through `014`, and application service code, the following critical vulnerabilities exist in the current staging posture:

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│                              ACTIVE STAGING VULNERABILITY REGISTER                           │
├─────────┬──────────────────────────────┬─────────────────────────────┬───────────────────────┤
│ Gap ID  │ Component / Object           │ Current Staging Mechanism   │ Exploitation / Impact │
├─────────┼──────────────────────────────┼─────────────────────────────┼───────────────────────┤
│ GAP-01  │ `public.memberships`         │ Mig 007 RLS (lines 770-800) │ CRITICAL: Owners can  │
│         │ Direct DML Exposure          │ grants direct DML to owners │ self-delete or demote │
│         │                              │ without Level 2 org locks   │ causing deadlocks/orph│
├─────────┼──────────────────────────────┼─────────────────────────────┼───────────────────────┤
│ GAP-02  │ `service_role` Unconstrained │ Default Supabase grants     │ CRITICAL: Service key │
│         │ Direct DML Access            │ retain table-level DML and  │ bypasses all business │
│         │                              │ BYPASSRLS on all tables     │ checks and locks      │
├─────────┼──────────────────────────────┼─────────────────────────────┼───────────────────────┤
│ GAP-03  │ Financial Records Mutability │ Mig 007 RLS (lines 1038-1165│ CRITICAL: Owners and  │
│         │ (`invoices`, `payments`)     │ grants FOR ALL to accounts, │ accounts staff can    │
│         │                              │ admins, and owners          │ update/delete ledgers │
├─────────┼──────────────────────────────┼─────────────────────────────┼───────────────────────┤
│ GAP-04  │ Non-Atomic Invoice Creation  │ `invoices.service.ts`       │ HIGH: 2-step REST     │
│         │ Client Multi-Step REST       │ inserts header, then items  │ insert creates broken │
│         │                              │ across separate HTTP calls  │ header-only invoices  │
├─────────┼──────────────────────────────┼─────────────────────────────┼───────────────────────┤
│ GAP-05  │ Client-Side Last-Owner Check │ `TeamPage.tsx` lines 94-96  │ HIGH: TOCTOU race;    │
│         │ React State Validation Only  │ checks active owner count   │ direct REST bypass    │
│         │                              │ entirely in browser memory  │ leaves org ownerless  │
├─────────┼──────────────────────────────┼─────────────────────────────┼───────────────────────┤
│ GAP-06  │ Auth Deletion Orphanage      │ Bare `user_id UUID` without │ HIGH: Deleting Auth   │
│         │ Deletion Desynchronization   │ state-machine deprovisioning│ user leaves dangling  │
│         │                              │ leaves active tenant access │ active memberships    │
├─────────┼──────────────────────────────┼─────────────────────────────┼───────────────────────┤
│ GAP-07  │ `stock_movements` Mutability │ Mig 003 table lacks         │ HIGH: Inventory ledger│
│         │ Missing Immutability Trigger │ UPDATE/DELETE trigger       │ can be retroactively  │
│         │                              │ protections                 │ altered or deleted    │
├─────────┼──────────────────────────────┼─────────────────────────────┼───────────────────────┤
│ GAP-08  │ Audit Log Tamper Protection  │ `audit_events` table lacks  │ MEDIUM: Audit trail   │
│         │ Partial Coverage             │ universal trigger-enforced  │ vulnerable to direct  │
│         │                              │ append-only immutability    │ modification/truncate │
└─────────┴──────────────────────────────┴─────────────────────────────┴───────────────────────┘
```

---

## 3. Membership Security Contract

### 3.1 SQL Privilege Model on `public.memberships`
To close GAP-01 and GAP-02, Migration 015 institutes a complete closure of direct SQL manipulation privileges.

```
PostgREST Client (Browser / API)
         │
         ├─── Direct INSERT / UPDATE / DELETE / TRUNCATE  ───► [DENIED: 42501 Permission Denied]
         │
         ├─── Direct SELECT (Scoped by Tenant RLS)        ───► [PERMITTED: Active Members Only]
         │
         └─── Supabase RPC (`/rest/v1/rpc/...`)           ───► [SECURITY DEFINER Trusted Function]
                                                                        │
                                                                 Acquires Level 2 Org Lock
                                                                 Validates Last-Owner Invariant
                                                                 Enforces Deprovisioning Checks
                                                                 Executes Table Mutation as postgres
```

#### Explicit Privilege Specification:
1. **`anon` (Unauthenticated Web Traffic):**
   - `REVOKE ALL ON TABLE public.memberships FROM anon;`
   - Effective Access: Zero access. Cannot read, cannot write.
2. **`authenticated` (Standard Logged-in Tenant Users):**
   - `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.memberships FROM authenticated;`
   - `GRANT SELECT ON TABLE public.memberships TO authenticated;`
   - Effective Access: Can only read membership records belonging to organizations where the user has an active membership (enforced via Row Level Security). Direct modification via PostgREST is rejected at PostgreSQL permission validation before any RLS expression evaluates.
3. **`service_role` (Backend / Administrative Key):**
   - `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.memberships FROM service_role;`
   - `GRANT SELECT ON TABLE public.memberships TO service_role;`
   - Architectural Justification: In Supabase, the `service_role` key possesses the PostgreSQL `BYPASSRLS` attribute. If table-level DML privileges are granted to `service_role`, backend administrative scripts can bypass all Level 2 organization row locks, last-owner invariant checks, and audit logging. By revoking table DML from `service_role`, administrative workflows are forced to execute through trusted database RPCs or explicit administrative functions.
4. **Function Owner (`postgres` / Definer Role):**
   - Retains full table privileges (`ALL PRIVILEGES`).
   - Executes mutations only within designated `SECURITY DEFINER` functions with fixed `search_path = public, pg_temp`.
5. **Database Superuser / DBA (`supabase_admin` / `postgres`):**
   - Unconstrained maintenance operations, governed by strict operational DBA runbooks.

### 3.2 RLS Policy Replacement on `public.memberships`
All existing RLS policies on `public.memberships` (specifically those defined in Migration 001 and Migration 007 granting write access) are dropped and replaced with a single, read-only policy:

```sql
-- Architectural Policy Design: Strict Read-Only Tenant Membership Visibility
DROP POLICY IF EXISTS "Users can view memberships of their organizations" ON memberships;
DROP POLICY IF EXISTS "Owners can insert organization memberships" ON memberships;
DROP POLICY IF EXISTS "Owners can update organization memberships" ON memberships;
DROP POLICY IF EXISTS "Owners can delete organization memberships" ON memberships;

CREATE POLICY "memberships_read_tenant_only"
ON public.memberships
FOR SELECT
TO authenticated
USING (
    organization_id IN (SELECT public.get_user_organizations())
    OR public.is_platform_reviewer()
);
```

### 3.3 Trusted Membership RPC Suite
All membership lifecycle actions must be executed exclusively via trusted `SECURITY DEFINER` functions:

1. `public.invite_organization_member(p_org_id UUID, p_email TEXT, p_role VARCHAR, p_idempotency_key UUID)`
2. `public.accept_organization_invitation(p_invitation_token UUID)`
3. `public.update_organization_member_role(p_org_id UUID, p_member_id UUID, p_new_role VARCHAR)`
4. `public.toggle_organization_member_active(p_org_id UUID, p_member_id UUID, p_is_active BOOLEAN)`
5. `public.remove_organization_member(p_org_id UUID, p_member_id UUID)`
6. `public.transfer_organization_ownership(p_org_id UUID, p_new_owner_id UUID)`

#### Mandatory Transaction & Validation Sequence for Membership RPCs:
Every membership mutation RPC must execute the following sequence within its single transaction:
1. **Authentication Gate:** Assert `v_uid := auth.uid();` is not `NULL`.
2. **Deprovisioning Gate (Level 0.5):** Non-locking snapshot read on `user_deprovisioning_requests`:
   ```sql
   IF EXISTS (
       SELECT 1 FROM public.user_deprovisioning_requests 
       WHERE user_id IN (v_uid, v_target_user_id) 
         AND status IN ('INITIATED', 'AUTH_LOCKED', 'MEMBERSHIPS_SEVERED')
   ) THEN
       RAISE EXCEPTION 'Operation denied: Active user deprovisioning request in progress.'
           USING ERRCODE = '55P03';
   END IF;
   ```
3. **Tenant Row Lock (Level 2):** Explicitly lock the tenant row to serialize concurrent administrative actions:
   ```sql
   PERFORM 1 FROM public.organizations WHERE id = p_org_id FOR UPDATE;
   IF NOT FOUND THEN
       RAISE EXCEPTION 'Organization not found.' USING ERRCODE = 'P0002';
   END IF;
   ```
4. **Operator Authorization Check:** Verify under the Level 2 lock that `v_uid` holds the required role (`owner` or `admin` depending on the action) in `p_org_id`.
5. **Eligibility & Trial Entitlement:** Assert `public.can_write_organization_operations(p_org_id)` evaluates to `TRUE`.
6. **Last-Owner Invariant Assertion:** If the operation demotes, deactivates, or removes an owner, assert that at least one other active owner exists:
   ```sql
   SELECT COUNT(*) INTO v_remaining_owners
   FROM public.memberships
   WHERE organization_id = p_org_id
     AND role = 'owner'
     AND is_active = TRUE
     AND id <> p_member_id;

   IF v_remaining_owners = 0 THEN
       RAISE EXCEPTION 'Cannot remove or demote the sole active owner of an organization.'
           USING ERRCODE = '23514'; -- check_violation
   END IF;
   ```
7. **Table Mutation (Level 3):** Execute the single-row update or delete on `public.memberships`.
8. **Audit Trail (Level 4):** Synchronously insert an immutable audit record into `public.audit_events`.

---

## 4. Ownership and Role Decision Models

To preserve architectural neutrality until executive leadership formally signs off, Migration 015 specifies precise designs for both branches of `DEC-01` and `DEC-11`.

### 4.1 DEC-01: Owner Cardinality Model

#### Option A: Exactly One Active Owner per Organization
- **Core Concept:** A tenant has a single designated legal owner at any given point in time. Co-ownership is prohibited.
- **Schema & DDL Implementation:**
  ```sql
  CREATE UNIQUE INDEX idx_memberships_single_active_owner 
  ON public.memberships(organization_id) 
  WHERE role = 'owner' AND is_active = TRUE;
  ```
- **Ownership Transfer Protocol:**
  Must be executed as an atomic two-step swap in a single transaction under the Level 2 organization lock:
  ```sql
  -- Step 1: Demote current owner to admin
  UPDATE public.memberships SET role = 'admin', updated_at = clock_timestamp()
  WHERE organization_id = p_org_id AND role = 'owner' AND is_active = TRUE;

  -- Step 2: Promote target member to owner
  UPDATE public.memberships SET role = 'owner', updated_at = clock_timestamp()
  WHERE organization_id = p_org_id AND user_id = p_new_owner_user_id AND is_active = TRUE;
  ```
- **Deprovisioning Consequence:** If the single active owner initiates deprovisioning, the operation is **BLOCKED** at Phase 1 unless ownership is first transferred to another member. If the organization has no other members, the organization must undergo formal tenant closure/archival.
- **Migration Complexity:** High. Requires pre-migration validation to ensure no tenant in staging currently has more than one active owner. If duplicates exist, a deterministic deduplication script is required.

#### Option B: Multiple Co-Owners per Organization
- **Core Concept:** An organization may have multiple active users with the `owner` role simultaneously.
- **Schema & DDL Implementation:**
  No unique index on owner role. Relies on a trigger or RPC constraint enforcing:
  $$\text{Count}(\text{memberships WHERE org\_id} = X \land \text{role} = \text{'owner'} \land \text{is\_active} = \text{TRUE}) \ge 1$$
- **Ownership Transfer / Addition:**
  An existing owner may unilaterally promote any existing member to `owner`. Demotion of an owner is permitted as long as $\text{Remaining Owners} \ge 1$.
- **Deprovisioning Consequence:** An owner can self-deprovision without prior transfer **if and only if** at least one other active co-owner exists.
- **Migration Complexity:** Low DDL complexity, but higher runtime verification overhead to prevent race conditions during concurrent self-demotions.

---

### 4.2 DEC-11: Membership Role Cardinality Model

#### Option A: Single Role per Membership
- **Core Concept:** Each membership row specifies exactly one role (`owner`, `admin`, `sales`, `inventory`, `accounts`, `viewer`).
- **Schema & DDL Implementation:**
  ```sql
  -- Existing schema maintained
  role VARCHAR(50) NOT NULL CHECK (role IN ('owner', 'admin', 'sales', 'inventory', 'accounts', 'viewer')),
  CONSTRAINT uq_memberships_org_user UNIQUE (organization_id, user_id)
  ```
- **Authorization Mechanics:** Straightforward role checks (`get_user_org_role(org_id) = 'admin'`). Role hierarchy is linear.
- **Migration Complexity:** Zero. Directly matches migrations `001`–`014` and TypeScript domain models.

#### Option B: Multi-Role per Membership
- **Core Concept:** A user may hold multiple functional roles within the same organization (e.g., both `sales` and `inventory`).
- **Schema & DDL Implementation:**
  Either an array column `roles VARCHAR(50)[] NOT NULL` or a normalized junction table:
  ```sql
  CREATE TABLE public.membership_roles (
      membership_id UUID NOT NULL REFERENCES public.memberships(id) ON DELETE CASCADE,
      role VARCHAR(50) NOT NULL CHECK (role IN ('owner', 'admin', 'sales', 'inventory', 'accounts', 'viewer')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (membership_id, role)
  );
  ```
- **Authorization Mechanics:** Requires array containment (`'admin' = ANY(roles)`) or `EXISTS` queries in `user_has_org_role`.
- **Migration Complexity:** Extremely High. Breaks existing RLS functions (`get_user_org_role`), breaks all TypeScript types (`Role` vs `Role[]`), and requires rewrites of frontend navigation and permission hooks.

---

## 5. Financial Integrity Contract

### 5.1 Table-by-Table Security & Immutability Matrix

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 FINANCIAL INTEGRITY & PRIVILEGE CONTRACT                                   │
├─────────────────────┬──────────────┬──────────────┬──────────────┬───────────────────┬─────────────────────┤
│ Database Entity     │ Direct REST  │ Trusted RPC  │ Immutability │ Status Transition │ Auth User Deletion  │
│                     │ DML Granted  │ Path Only    │ Trigger      │ Rule              │ Behavior            │
├─────────────────────┼──────────────┼──────────────┼──────────────┼───────────────────┼─────────────────────┤
│ `invoices`          │ REVOKE ALL   │ `create_inv_ │ Trigger on   │ DRAFT -> ISSUED   │ SURVIVES: Bare UUID │
│                     │ (SELECT via  │ with_items`  │ ISSUED, PAID │ -> PARTIALLY_PAID │ `created_by` retains│
│                     │ RLS only)    │              │ CANCELLED    │ -> PAID           │ audit attribution   │
├─────────────────────┼──────────────┼──────────────┼──────────────┼───────────────────┼─────────────────────┤
│ `invoice_items`     │ REVOKE ALL   │ `create_inv_ │ Trigger on   │ Immutable upon    │ SURVIVES: Cascades  │
│                     │ (SELECT via  │ with_items`  │ parent state │ parent invoice    │ only from invoice,  │
│                     │ RLS only)    │              │ ISSUED       │ issuance          │ not from Auth user  │
├─────────────────────┼──────────────┼──────────────┼──────────────┼───────────────────┼─────────────────────┤
│ `payments`          │ REVOKE ALL   │ `record_pay_ │ Trigger on   │ Append-only       │ SURVIVES: Bare UUID │
│                     │ (SELECT via  │ and_allocate`│ INSERT; no   │ ledger entries;   │ `created_by` retains│
│                     │ RLS only)    │              │ UPDATE/DELETE│ no status edits   │ audit attribution   │
├─────────────────────┼──────────────┼──────────────┼──────────────┼───────────────────┼─────────────────────┤
│ `payment_           │ REVOKE ALL   │ `record_pay_ │ Trigger on   │ Append-only       │ SURVIVES: Cascades  │
│ allocations`        │ (SELECT via  │ and_allocate`│ INSERT; no   │ allocation;       │ only from payment,  │
│                     │ RLS only)    │              │ UPDATE/DELETE│ no status edits   │ not from Auth user  │
├─────────────────────┼──────────────┼──────────────┼──────────────┼───────────────────┼─────────────────────┤
│ `sales_orders`      │ REVOKE DML   │ `confirm_    │ Trigger on   │ DRAFT ->          │ SURVIVES: Bare UUID │
│                     │ (SELECT via  │ sales_order` │ CONFIRMED,   │ CONFIRMED ->      │ `created_by` retains│
│                     │ RLS only)    │              │ FULFILLED    │ FULFILLED/CANCEL  │ audit attribution   │
├─────────────────────┼──────────────┼──────────────┼──────────────┼───────────────────┼─────────────────────┤
│ `quotations`        │ REVOKE DML   │ Direct DML   │ Trigger on   │ DRAFT -> SENT ->  │ SURVIVES: Bare UUID │
│                     │ (SELECT via  │ restricted   │ ACCEPTED,    │ ACCEPTED /        │ `created_by` retains│
│                     │ RLS only)    │ to DRAFT     │ CONVERTED    │ REJECTED/CONVERTED│ audit attribution   │
├─────────────────────┼──────────────┼──────────────┼──────────────┼───────────────────┼─────────────────────┤
│ `stock_movements`   │ REVOKE ALL   │ System RPCs  │ Append-only  │ Immutable log of  │ SURVIVES: Bare UUID │
│                     │ (SELECT via  │ (`confirm_   │ trigger; no  │ stock changes;    │ `actor_id` retains  │
│                     │ RLS only)    │ sales_order`)│ UPDATE/DELETE│ no updates/deletes│ audit attribution   │
├─────────────────────┼──────────────┼──────────────┼──────────────┼───────────────────┼─────────────────────┤
│ `audit_events`      │ REVOKE ALL   │ System RPCs  │ Append-only  │ Immutable audit   │ SURVIVES: Bare UUID │
│                     │ (SELECT via  │ (Internal    │ trigger; no  │ trail; zero DML   │ `actor_id` retains  │
│                     │ RLS only)    │ logging)     │ UPDATE/DELETE│ permitted         │ forensic integrity  │
└─────────────────────┴──────────────┴──────────────┴──────────────┴───────────────────┴─────────────────────┘
```

### 5.2 Dissection: Immutability vs Referential Survival
To eliminate recurring confusion between referential integrity and ledger immutability:
1. **Referential Survival:** Means that deleting an identity from `auth.users` does **not** trigger a cascading delete of invoice or payment records. This is already achieved by using bare `UUID` columns for `created_by` and `actor_id` without foreign key constraints to `auth.users(id)`.
2. **Ledger Immutability:** Means that once a commercial or financial document is finalized, its numerical, fiscal, and customer attributes **cannot be altered or deleted by any user or service key**. In the current staging catalog, this is completely absent.
3. **Trigger-Enforced Immutability Contract:** Migration 015 deploys `BEFORE UPDATE OR DELETE` triggers on `invoices`, `invoice_items`, `payments`, `payment_allocations`, and `stock_movements`:
   ```sql
   CREATE OR REPLACE FUNCTION public.trg_enforce_invoice_immutability()
   RETURNS TRIGGER
   LANGUAGE plpgsql
   AS $$
   BEGIN
       IF TG_OP = 'DELETE' THEN
           IF OLD.status IN ('ISSUED', 'PARTIALLY_PAID', 'PAID') THEN
               RAISE EXCEPTION 'Illegal Operation: Issued or settled invoices cannot be deleted.'
                   USING ERRCODE = '23514';
           END IF;
           RETURN OLD;
       END IF;

       IF TG_OP = 'UPDATE' THEN
           IF OLD.status IN ('ISSUED', 'PARTIALLY_PAID', 'PAID') THEN
               -- Only total_paid, status, and updated_at may be updated via payment allocation
               IF (NEW.subtotal <> OLD.subtotal OR
                   NEW.tax_amount <> OLD.tax_amount OR
                   NEW.total_amount <> OLD.total_amount OR
                   NEW.customer_id <> OLD.customer_id OR
                   NEW.invoice_number <> OLD.invoice_number OR
                   NEW.organization_id <> OLD.organization_id OR
                   NEW.invoice_date <> OLD.invoice_date) THEN
                   RAISE EXCEPTION 'Illegal Operation: Fiscal attributes of an issued invoice are immutable.'
                       USING ERRCODE = '23514';
               END IF;
           END IF;
           RETURN NEW;
       END IF;
   END;
   $$;
   ```

### 5.3 Invoice Creation Contract: `public.create_invoice_with_items`
To eliminate the partial-write failure mode of GAP-04, all invoice issuance is moved to a single atomic RPC:
- **Input:** Organization ID, customer ID, dates, notes, and a JSONB array of line items.
- **Transaction Guarantee:**
  1. Validates caller holds `owner`, `admin`, or `accounts` role under the Level 2 organization lock.
  2. Allocates document sequence atomically (`allocate_document_number`) with `FOR UPDATE` on `document_sequences`.
  3. Calculates line subtotals, GST components, and document totals entirely server-side using integer-safe arithmetic.
  4. Inserts header into `invoices` with status `ISSUED`.
  5. Inserts line items into `invoice_items`.
  6. Emits `INVOICE_ISSUED` audit event.
  7. Returns complete invoice object with nested items.
  If any step fails, the entire transaction rolls back cleanly; no orphaned invoice header can ever be created.

### 5.4 Payment Allocation Contract: `public.record_payment_and_allocate`
Maintains the existing atomic allocation logic hardened in Migration 011 with the following security additions:
1. Re-verifies tenant eligibility and active operational status.
2. Acquires row lock on the target invoice: `SELECT * FROM invoices WHERE id = p_invoice_id FOR UPDATE`.
3. Validates: $\text{Allocated Amount} \le \text{Total Amount} - \text{Total Paid}$.
4. Generates payment receipt number from `document_sequences`.
5. Inserts payment record, inserts allocation record, updates invoice `total_paid` and `status` (`PARTIALLY_PAID` or `PAID`).
6. Enforces that direct modification of `payments` or `payment_allocations` table outside this function is impossible.

---

## 6. Deprovisioning Architecture Contract

### 6.1 Two-Phase Deprovisioning State Machine
The deprovisioning architecture cleanly decouples the external Supabase Auth identity lifecycle from PostgreSQL transactional integrity.

```
       ┌──────────────┐
       │    ACTIVE    │ (Normal tenant operation)
       └──────┬───────┘
              │  RPC: initiate_user_deprovisioning(...)
              ▼
       ┌──────────────┐
       │  INITIATED   │ (Level 0.5 request recorded; fencing token issued)
       └──────┬───────┘
              │  Worker acquires lease; calls GoTrue API: Ban / revoke tokens
              ▼
       ┌──────────────┐
       │ AUTH_LOCKED  │ (Auth identity disabled; no new JWTs can be minted)
       └──────┬───────┘
              │  Worker executes DB transaction: sever memberships & transfer/retire orgs
              ▼
 ┌──────────────────────────┐
 │   MEMBERSHIPS_SEVERED    │ (All DB memberships removed/deactivated; audit logged)
 └────────────┬─────────────┘
              │  Worker calls GoTrue Admin API: DELETE /admin/users/{id}
              ▼
       ┌──────────────┐
       │  COMPLETED   │ (Terminal state; offboarding complete)
       └──────────────┘
```

### 6.2 State Machine Invariant Table

```
┌────────────────────┬──────────────────────┬──────────────────────┬──────────────────────┬─────────────────────┐
│ Lifecycle State    │ PostgreSQL Invariant │ GoTrue Auth State    │ Mutating Transaction │ Failure Recovery    │
├────────────────────┼──────────────────────┼──────────────────────┼──────────────────────┼─────────────────────┤
│ **INITIATED**      │ Request row exists   │ ACTIVE (Valid JWTs   │ Client / Self        │ Worker claims lease;│
│                    │ with lease & token;  │ may still exist until│ or Admin RPC         │ retries ban if lease│
│                    │ memberships active   │ expiration)          │                      │ expires             │
├────────────────────┼──────────────────────┼──────────────────────┼──────────────────────┼─────────────────────┤
│ **AUTH_LOCKED**    │ Request row marked   │ BANNED / LOCKED      │ Worker Process       │ Worker re-reads DB; │
│                    │ AUTH_LOCKED; token   │ (Refresh tokens      │ (External HTTP Call) │ proceeds to sever   │
│                    │ verified             │ revoked)             │                      │ memberships         │
├────────────────────┼──────────────────────┼──────────────────────┼──────────────────────┼─────────────────────┤
│ **MEMBERSHIPS_     │ All memberships of   │ BANNED / LOCKED      │ Worker Process       │ Worker retries Auth │
│ SEVERED**          │ user are DELETED or  │                      │ (Database RPC)       │ DELETE call;        │
│                    │ marked INACTIVE      │                      │                      │ handles 404 rule    │
├────────────────────┼──────────────────────┼──────────────────────┼──────────────────────┼─────────────────────┤
│ **COMPLETED**      │ Terminal state;      │ DELETED              │ Worker Process       │ Terminal; no retry  │
│                    │ `completed_at` set   │ (Identity removed)   │ (Final DB RPC)       │ permitted           │
└────────────────────┴──────────────────────┴──────────────────────┴──────────────────────┴─────────────────────┘
```

### 6.3 Recovery & GoTrue v2.197.0 HTTP 404 Context Rules
When interacting with external network boundaries, worker processes must adhere to strict contextual error evaluation:

1. **Step 2 (Ban Operation) returns HTTP 404:**
   - **Context:** The user record was not found in GoTrue.
   - **Recovery Rule:** The worker **MUST NOT** mark the request as `COMPLETED`. Even if the Auth identity does not exist in GoTrue, active membership rows may still exist in PostgreSQL. The worker must advance status to `AUTH_LOCKED` and proceed to Step 3 (Membership Severance) to guarantee database hygiene.
2. **Step 4 (Auth Deletion) returns HTTP 404:**
   - **Context:** The worker requested deletion of an already-deleted or non-existent Auth record after memberships have been severed.
   - **Recovery Rule:** The worker treats HTTP 404 as **successful deletion** and advances the state to `COMPLETED`.
3. **Database Worker Lease Expiration & Fencing Tokens:**
   - Workers claim requests by incrementing a monotonic `fencing_token INT` and setting a `lease_expires_at TIMESTAMPTZ`.
   - Every state transition RPC validates `WHERE id = p_req_id AND fencing_token = p_fencing_token`.
   - If a partitioned worker awakens after its lease has expired and a new worker has claimed the request, the old worker's state transition is rejected by PostgreSQL (`0 rows updated`).

---

## 7. Global Lock Hierarchy

To mathematically guarantee freedom from deadlock across all concurrent operations, Migration 015 enforces an invariant lock-acquisition sequence:

```
Level 0.5: user_deprovisioning_requests (Row Lock via FOR UPDATE)
    │
    ▼
Level 1.0: idempotency_keys (Row Lock via INSERT ... ON CONFLICT / FOR UPDATE)
    │
    ▼
Level 2.0: organizations (Row Lock via SELECT ... FOR UPDATE, ORDER BY id ASC)
    │
    ▼
Level 3.0: memberships (Row Lock via SELECT ... FOR UPDATE, ORDER BY id ASC)
    │
    ▼
Level 3.5: Financial Document Headers (`invoices`, `sales_orders` FOR UPDATE)
    │
    ▼
Level 4.0: audit_events (Append-only INSERT; no row locks held)
```

### Lock Isolation Rules:
1. **No Inversion Rule:** A transaction that holds a lock at Level $N$ may never request a lock at Level $M$ where $M < N$.
2. **Ascending UUID Order:** When acquiring locks on multiple organizations (e.g., during multi-tenant membership severance), rows must be locked strictly in ascending lexicographical order: `ORDER BY organization_id ASC`.
3. **Snapshot Isolation for Operational RPCs:** Operational membership and financial RPCs check user deprovisioning status using **plain non-locking `SELECT` queries** under PostgreSQL `READ COMMITTED` isolation. This acquires a lightweight `AccessShareLock` on `user_deprovisioning_requests` but **zero row locks**, eliminating circular wait deadlocks with deprovisioning workers.

---

## 8. Proposed Migration 015 DDL Design Specification

*Note: In accordance with Phase 5.0A restrictions, the following represents structural DDL specifications and design blueprints only. No executable migration file is authored or deployed.*

### Component 1: Revocation of Direct Table Privileges
```sql
-- Target: memberships, invoices, invoice_items, payments, payment_allocations, stock_movements
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.memberships FROM anon, authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.invoices FROM anon, authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.invoice_items FROM anon, authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.payments FROM anon, authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.payment_allocations FROM anon, authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.stock_movements FROM anon, authenticated, service_role;
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon, authenticated, service_role;
```

### Component 2: Deprovisioning State Infrastructure
```sql
CREATE TABLE public.user_deprovisioning_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'INITIATED' CHECK (
        status IN ('INITIATED', 'AUTH_LOCKED', 'MEMBERSHIPS_SEVERED', 'COMPLETED', 'FAILED')
    ),
    fencing_token INTEGER NOT NULL DEFAULT 1,
    worker_id VARCHAR(100),
    lease_expires_at TIMESTAMPTZ,
    error_details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_user_deprov_active_req 
ON public.user_deprovisioning_requests(user_id) 
WHERE status IN ('INITIATED', 'AUTH_LOCKED', 'MEMBERSHIPS_SEVERED');
```

### Component 3: Immutability and Integrity Triggers
1. `trg_enforce_invoice_immutability` on `public.invoices`: Prevents mutation of fiscal fields and deletion of non-DRAFT invoices.
2. `trg_enforce_payment_immutability` on `public.payments` and `public.payment_allocations`: Prevents `UPDATE` and `DELETE` on payment records.
3. `trg_enforce_stock_immutability` on `public.stock_movements`: Blocks `UPDATE` and `DELETE`, ensuring an append-only stock ledger.
4. `trg_enforce_last_owner_retention` on `public.memberships`: Re-asserts active owner count $\ge 1$ before any owner row modification commits.

### Component 4: Function Signature & Permissions Specification
All RPCs must explicitly define:
- `LANGUAGE plpgsql`
- `SECURITY DEFINER`
- `SET search_path = public, pg_temp`
- Revocation of execute privileges: `REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC;`
- Explicit grant to authenticated: `GRANT EXECUTE ON FUNCTION ... TO authenticated;`

---

## 9. Risks, Rollback, and Unresolved Assumptions

### 9.1 Technical Risks
1. **Legacy Client Breakage:** Any third-party integration or legacy client performing direct PostgREST `POST /rest/v1/invoices` or `PATCH /rest/v1/memberships` will immediately fail with `42501 Permission Denied`. The frontend application services (`team.service.ts`, `invoices.service.ts`) must be updated simultaneously to invoke the corresponding RPCs.
2. **Transaction Timeouts:** Prolonged multi-organization severance during deprovisioning could trigger database statement timeouts if an offboarding user belongs to dozens of organizations. Bounding severance batches and setting local statement timeouts is required.

### 9.2 Rollback Strategy (Forward-Compatible & Reversible)
- **Data Safety Invariant:** Migration 015 does **not drop any existing tables or columns**. All schema changes are strictly additive (`user_deprovisioning_requests` table, new RPCs, immutability triggers).
- **Rollback Mechanism:** Should operational issues arise post-migration, a forward-remediation script can re-grant table DML privileges to `authenticated` and drop the immutability triggers without any data loss or structural damage.

### 9.3 Unresolved Assumptions
1. **Remote Staging Catalog State (BLK-01):** Untracked migrations `012`, `013`, and `014` are assumed to be deployed on staging project `bwswqnhlebbzdxumlkih`. This must be verified via direct psql connection before Migration 015 execution.
2. **Executive Decision Closure:** Migration 015 DDL remains bifurcated until formal sign-off is received for `DEC-01` (Owner Cardinality) and `DEC-11` (Membership Role Cardinality).
